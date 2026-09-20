import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Modal,
  ScrollView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { FileText, ChevronDown, ChevronRight, X } from 'lucide-react-native';
import { StandardPage } from '../components/common';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import {
  agentInvoiceService,
  AgentInvoiceRecord,
  AgentInvoiceCustomer,
} from '../services/agentInvoiceService';
import { usePermissions } from '../hooks/usePermissions';
import AgentPayoutModal from '../modals/AgentPayoutModal';
import { ROLE } from '../config/permissions';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

/**
 * Weekly agent referral invoices — one per team, one per solo agent.
 *
 * Grouped by billing week the way the web page groups them: a page is five
 * WEEKS, not five invoices, because a week is the unit somebody reconciles and
 * paging by invoice split a week across two pages. Each week is a collapsible
 * header carrying its own subtotal, and the invoices sit under it.
 *
 * The web page lays this out as a table with an expandable row per week. A
 * phone gets the same shape as a section list: the header is tappable, the
 * invoices are cards, and the detail that a wide table shows inline — the
 * referred customers an invoice bills for — moves to a sheet.
 */

const formatCurrency = (amount: number): string =>
  `₱${Number(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

/**
 * The statuses the list offers when changing one by hand.
 *
 * Mirrors AgentInvoice::SELECTABLE_STATUSES on the server. Sent and Cancelled
 * are still accepted by the API so invoices already carrying them keep working,
 * they are simply no longer offered as new choices.
 */
const STATUS_OPTIONS = ['Generated', 'Paid', 'Unpaid'];

/** A page is five billing WEEKS. See the note above. */
const PAGE_SIZE = 5;

/** Status colours, matching the way the billing invoice list colours its own. */
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  Generated: { bg: '#eff6ff', fg: '#1d4ed8' },
  Sent: { bg: '#fffbeb', fg: '#b45309' },
  Paid: { bg: '#ecfdf5', fg: '#047857' },
  Unpaid: { bg: '#fff1f2', fg: '#be123c' },
  Cancelled: { bg: '#e5e7eb', fg: '#374151' },
};

const toneFor = (status: string) => STATUS_TONE[status] || { bg: '#f3f4f6', fg: '#374151' };

const TYPE_OPTIONS = [
  { label: 'All Types', value: '' },
  { label: 'Team', value: 'team' },
  { label: 'Solo', value: 'solo' },
];

interface PeriodGroup {
  key: string;
  label: string;
  records: AgentInvoiceRecord[];
  subtotal: number;
}

/** A row in the flat list: either a week header or one invoice under it. */
type Row =
  | { kind: 'header'; group: PeriodGroup }
  | { kind: 'invoice'; record: AgentInvoiceRecord };

const AgentInvoice: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const { can, ready: permissionsReady } = usePermissions();

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [records, setRecords] = useState<AgentInvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastPage, setLastPage] = useState(1);

  const [expandedPeriods, setExpandedPeriods] = useState<string[]>([]);
  const [selected, setSelected] = useState<AgentInvoiceRecord | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [pdfPending, setPdfPending] = useState<number | null>(null);
  // The invoice whose status is saving, so only that card's control is
  // disabled rather than the whole list.
  const [statusPending, setStatusPending] = useState<number | null>(null);

  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({ isOpen: false, type: 'loading', title: '', message: '' });

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const showModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning',
    title: string,
    message: string,
    onConfirm?: () => void
  ) => setGlobalModal({ isOpen: true, type, title, message, onConfirm });

  const closeModal = () => setGlobalModal((prev) => ({ ...prev, isOpen: false }));

  /**
   * Whether this user may change an invoice's status, or run the generation.
   *
   * Administrators and superadmins only, resolved through usePermissions so
   * this page cannot disagree with the bar about who somebody is. The server
   * enforces it independently; this only decides whether the control is worth
   * drawing. False until permissions have loaded, so the control never appears
   * and then vanishes.
   */
  // The API demands these keys, so the buttons ask for them rather than for a
  // role id. The two seeded administrative roles hold both, so nothing changes
  // for them — a hybrid role granted the keys is no longer locked out, and the
  // two clients no longer disagree about who may do this.
  const canGenerate = permissionsReady && can('agent-invoices.generate');
  const canEditStatus = permissionsReady && can('agent-invoices.status');
  const canPayOut = permissionsReady && can('agent-invoices.payout');
  const [payoutFor, setPayoutFor] = useState<AgentInvoiceRecord | null>(null);

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('[AgentInvoice] Failed to fetch color palette:', err));
  }, []);

  const load = useCallback(
    async (page: number, quiet = false) => {
      if (!quiet) setIsLoading(true);
      setError(null);

      try {
        const response = await agentInvoiceService.list({
          search: searchTerm,
          type: typeFilter,
          page,
          per_page: PAGE_SIZE,
          // A page is N weeks, and carries every invoice in them.
          group_by_period: true,
        });

        if (response?.success) {
          setRecords(response.data || []);
          setTotalCount(response.meta?.total ?? 0);
          setLastPage(response.meta?.last_page ?? 1);
        } else {
          setRecords([]);
          setError('Failed to load invoices.');
        }
      } catch (err: any) {
        console.error('[AgentInvoice] Failed to load invoices:', err);
        setRecords([]);
        setError(err?.response?.data?.message || 'Failed to load invoices.');
      } finally {
        setIsLoading(false);
      }
    },
    [searchTerm, typeFilter]
  );

  // Filters reset to the first page: staying on page 4 of a narrower result set
  // would show an empty list.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, typeFilter]);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => load(currentPage), 250);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [load, currentPage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(currentPage, true);
    setRefreshing(false);
  };

  /**
   * The invoices grouped into billing weeks, in the order they arrived.
   *
   * The server already orders by invoice date descending, so taking the groups
   * in first-seen order keeps that ordering without sorting again.
   */
  const groups = useMemo<PeriodGroup[]>(() => {
    const out: PeriodGroup[] = [];
    const index = new Map<string, number>();

    records.forEach((record) => {
      const key = `${record.period_start ?? ''}|${record.period_end ?? ''}`;

      if (!index.has(key)) {
        index.set(key, out.length);
        out.push({
          key,
          label:
            record.period_start || record.period_end
              ? `${formatDate(record.period_start)} – ${formatDate(record.period_end)}`
              : 'Undated',
          records: [],
          subtotal: 0,
        });
      }

      const group = out[index.get(key)!];
      group.records.push(record);
      group.subtotal += Number(record.subtotal || 0);
    });

    return out;
  }, [records]);

  // Every week starts open: a collapsed list of five headers and nothing else
  // reads as an empty screen.
  useEffect(() => {
    setExpandedPeriods(groups.map((g) => g.key));
  }, [groups]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    groups.forEach((group) => {
      out.push({ kind: 'header', group });
      if (expandedPeriods.includes(group.key)) {
        group.records.forEach((record) => out.push({ kind: 'invoice', record }));
      }
    });
    return out;
  }, [groups, expandedPeriods]);

  const togglePeriod = (key: string) =>
    setExpandedPeriods((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const handleOpenDetails = async (record: AgentInvoiceRecord) => {
    setSelected(record);

    // The list already carries the customers, but re-reading gives the freshest
    // set and keeps the sheet correct if the list is stale.
    setIsLoadingDetail(true);
    try {
      const response = await agentInvoiceService.get(record.id);
      if (response?.success) setSelected(response.data);
    } catch (err) {
      console.error('[AgentInvoice] Failed to load invoice details:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handlePdf = async (record: AgentInvoiceRecord) => {
    setPdfPending(record.id);
    try {
      const outcome = await agentInvoiceService.openPdf(record);

      if (outcome.kind === 'failed') {
        showModal('error', 'PDF Unavailable', outcome.message);
      } else if (outcome.kind === 'saved') {
        // Bytes rather than a Drive link: the file is on the device but there
        // is no share sheet available to hand it to a viewer, so say where it
        // went rather than ending in silence.
        showModal(
          'warning',
          'Saved to this device',
          `Google Drive was unreachable, so ${record.invoice_number}.pdf was downloaded to the app's storage instead of opening. Try again later to view it in Drive.`
        );
      }
    } finally {
      setPdfPending(null);
    }
  };

  /**
   * Save a new status for one invoice.
   *
   * Applied to the list straight away and put back if the server refuses, so
   * the pill responds at once without ever showing a value the database does
   * not hold. The server's own copy of the record replaces it on success, so
   * anything else it changed is picked up rather than guessed.
   */
  const handleStatusChange = async (record: AgentInvoiceRecord, next: string) => {
    if (!canEditStatus || next === record.status || statusPending !== null) return;

    const previous = record.status;
    const apply = (status: string) => {
      setRecords((rows2) => rows2.map((r) => (r.id === record.id ? { ...r, status } : r)));
      setSelected((sel) => (sel && sel.id === record.id ? { ...sel, status } : sel));
    };

    apply(next);
    setStatusPending(record.id);
    setError(null);

    try {
      const response = await agentInvoiceService.updateStatus(record.id, next);

      if (!response?.success) {
        throw new Error(response?.message || 'The status could not be saved.');
      }

      if (response.data) {
        const saved = response.data;
        setRecords((rows2) => rows2.map((r) => (r.id === record.id ? { ...r, ...saved } : r)));
        setSelected((sel) => (sel && sel.id === record.id ? { ...sel, ...saved } : sel));
      }
    } catch (err: any) {
      // Put the old value back: the list must never show a status the database
      // does not hold. A 403 here means "not an administrator", which is the
      // server's rule to enforce, not this page's.
      apply(previous);
      showModal(
        'error',
        'Status Not Saved',
        err?.response?.data?.message || err?.message || 'The status could not be saved.'
      );
    } finally {
      setStatusPending(null);
    }
  };

  const handleGenerate = () => {
    if (!canGenerate) return;
    showModal(
      'confirm',
      'Generate Invoices',
      'Run the weekly invoice generation now? This is safe to repeat — it will not duplicate invoices that already exist.',
      async () => {
        closeModal();
        showModal('loading', 'Generating', 'Running the weekly generation...');
        try {
          const response = await agentInvoiceService.generate();
          if (response?.success) {
            await load(currentPage, true);
            showModal('success', 'Done', response.message || 'Invoice generation completed.');
          } else {
            showModal('error', 'Generation Failed', response?.message || 'The generation could not be run.');
          }
        } catch (err: any) {
          showModal(
            'error',
            'Generation Failed',
            err?.response?.data?.message || err?.message || 'The generation could not be run.'
          );
        }
      }
    );
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'header') {
      const open = expandedPeriods.includes(item.group.key);
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => togglePeriod(item.group.key)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: '#f3f4f6',
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            {open ? <ChevronDown size={16} color="#4b5563" /> : <ChevronRight size={16} color="#4b5563" />}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827' }} numberOfLines={1}>
              {item.group.label}
            </Text>
            <Text style={{ fontSize: 11, color: '#6b7280' }}>
              ({item.group.records.length})
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontWeight: '700', color: primaryColor }}>
            {formatCurrency(item.group.subtotal)}
          </Text>
        </TouchableOpacity>
      );
    }

    const record = item.record;
    const tone = toneFor(record.status);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleOpenDetails(record)}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
            {record.invoice_number}
          </Text>
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: tone.bg }}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: tone.fg }}>
              {record.status}
            </Text>
          </View>
        </View>

        <Text style={{ fontSize: 12, color: '#374151', marginTop: 4 }} numberOfLines={1}>
          {record.billed_to}
          <Text style={{ color: '#9ca3af' }}>  ·  {record.invoice_type === 'team' ? 'Team' : 'Solo'}</Text>
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          <Field label="Customers" value={String(record.total_customers)} />
          <Field label="Total" value={formatCurrency(record.total_amount)} />
          <Field label="Subtotal" value={formatCurrency(record.subtotal)} />
          <Field label="Dated" value={formatDate(record.invoice_date)} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          {record.has_pdf && (
            <TouchableOpacity
              onPress={() => handlePdf(record)}
              disabled={pdfPending === record.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: primaryColor,
                opacity: pdfPending === record.id ? 0.6 : 1,
              }}
            >
              {pdfPending === record.id ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <FileText size={14} color={primaryColor} />
              )}
              <Text style={{ fontSize: 12, color: primaryColor, fontWeight: '600' }}>PDF</Text>
            </TouchableOpacity>
          )}

          {canGenerate && (
            <View
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: '#d1d5db',
                borderRadius: 6,
                overflow: 'hidden',
                height: 38,
                justifyContent: 'center',
                opacity: statusPending === record.id ? 0.6 : 1,
              }}
            >
              <Picker
                enabled={statusPending !== record.id}
                selectedValue={record.status}
                onValueChange={(v) => handleStatusChange(record, String(v))}
                style={{ color: '#111827' }}
                dropdownIconColor="#6b7280"
              >
                {/* A status the server already holds but no longer offers —
                    Sent, Cancelled — is added so the control can show it
                    rather than silently reading as something else. */}
                {(STATUS_OPTIONS.includes(record.status)
                  ? STATUS_OPTIONS
                  : [...STATUS_OPTIONS, record.status]
                ).map((option) => (
                  <Picker.Item key={option} label={option} value={option} />
                ))}
              </Picker>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Invoice type is the only filter; it sits in the standard left drawer
  // rather than as a third row of chrome above the list.
  const typeDrawer = (
    <View style={{ paddingTop: 60, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: '#9ca3af', marginBottom: 8 }}>
        Invoice Type
      </Text>
      <View style={{ borderWidth: 1, borderColor: typeFilter ? '#ef4444' : '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 40, justifyContent: 'center' }}>
        <Picker
          selectedValue={typeFilter}
          onValueChange={(v) => setTypeFilter(String(v))}
          style={{ color: typeFilter ? '#ef4444' : '#111827' }}
          dropdownIconColor="#6b7280"
        >
          {TYPE_OPTIONS.map((opt) => (
            <Picker.Item key={opt.value || 'all'} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );

  return (
    <StandardPage<Row>
      data={rows}
      keyExtractor={(row) => (row.kind === 'header' ? `h:${row.group.key}` : `i:${row.record.id}`)}
      renderItem={(item) => renderRow({ item })}
      searchQuery={searchTerm}
      onSearchChange={setSearchTerm}
      searchPlaceholder="Search invoices..."
      drawerContent={typeDrawer}
      drawerActive={!!typeFilter}
      chips={
        typeFilter
          ? [{ key: 'type', label: 'Type', value: TYPE_OPTIONS.find((o) => o.value === typeFilter)?.label || typeFilter }]
          : []
      }
      onRemoveChip={() => setTypeFilter('')}
      onRefresh={() => load(currentPage)}
      refreshDisabled={isLoading}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading && records.length === 0}
      loadingText="Loading invoices..."
      error={error}
      onRetry={() => load(currentPage)}
      emptyText="No invoices found"
      progressText={`${totalCount} weeks`}
      // Paged on the server, and a page is a number of weeks rather than a
      // number of rows, so the shell is given the page count directly.
      totalPages={lastPage}
      totalItems={totalCount}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      toolbarActions={
        canGenerate ? (
          <TouchableOpacity
            onPress={handleGenerate}
            style={{ paddingHorizontal: 12, height: 38, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '600' }}>Generate</Text>
          </TouchableOpacity>
        ) : null
      }
    >
      {selected && (
        <InvoiceDetailModal
          record={selected}
          loading={isLoadingDetail}
          primaryColor={primaryColor}
          onClose={() => setSelected(null)}
          onPayOut={canPayOut ? () => setPayoutFor(selected) : undefined}
        />
      )}

      {/* Raised from an invoice, so the form asks only for the agent and takes
          the invoice number as its reference. */}
      <AgentPayoutModal
        isOpen={payoutFor !== null}
        onClose={() => setPayoutFor(null)}
        onSuccess={() => {
          setPayoutFor(null);
          load(currentPage);
        }}
        fromInvoice
        invoiceNumber={payoutFor?.invoice_number}
        agentId={(payoutFor as any)?.agent_id ?? undefined}
        agentName={payoutFor?.billed_to}
      />

      <LoadingModalGlobal
        isOpen={globalModal.isOpen}
        type={globalModal.type}
        title={globalModal.title}
        message={globalModal.message}
        onConfirm={globalModal.onConfirm || closeModal}
        onCancel={closeModal}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />
    </StandardPage>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
      {label}
    </Text>
    <Text style={{ fontSize: 11, color: '#374151' }}>{value}</Text>
  </View>
);

/**
 * One invoice in full, with the referred customers it bills for.
 *
 * The web page shows these in a table beside the invoice; a phone gets them as
 * a scrolling list, which is the same information in the shape that fits.
 */
const InvoiceDetailModal: React.FC<{
  record: AgentInvoiceRecord;
  loading: boolean;
  primaryColor: string;
  onClose: () => void;
  /**
   * Raising a payout against this invoice. Optional: the page passes it only
   * for a reader holding 'agent-invoices.payout', so an unpermitted viewer
   * never sees the button rather than seeing it and being refused.
   */
  onPayOut?: () => void;
}> = ({ record, loading, primaryColor, onClose, onPayOut }) => {
  const tone = toneFor(record.status);

  const Line: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 }}>
      <Text style={{ width: 118, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
        {label}
      </Text>
      <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>
        {value === null || value === undefined || value === '' ? '-' : String(value)}
      </Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '85%', overflow: 'hidden' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }} numberOfLines={1}>
                {record.invoice_number}
              </Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: tone.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: tone.fg }}>
                  {record.status}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Line label="Billed To" value={record.billed_to} />
            <Line label="Type" value={record.invoice_type === 'team' ? 'Team' : 'Solo'} />
            <Line label="Team" value={record.team_name} />
            <Line label="Agent" value={record.agent_name} />
            <Line label="Invoice Date" value={formatDate(record.invoice_date)} />
            <Line label="Period" value={`${formatDate(record.period_start)} – ${formatDate(record.period_end)}`} />
            <Line label="Customers" value={record.total_customers} />
            <Line label="Unit Price" value={formatCurrency(record.unit_price)} />
            <Line label="Installation Fee" value={formatCurrency(record.installation_fee)} />
            <Line label="Commission" value={formatCurrency(record.commission)} />
            <Line label="Total" value={formatCurrency(record.total_amount)} />
            <Line label="Subtotal" value={formatCurrency(record.subtotal)} />

            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af', marginBottom: 8 }}>
                Referred Customers
              </Text>

              {loading ? (
                <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={primaryColor} />
                </View>
              ) : record.customers && record.customers.length > 0 ? (
                record.customers.map((customer: AgentInvoiceCustomer) => (
                  <View
                    key={customer.id}
                    style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827' }}>{customer.customer_name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 3 }}>
                      {!!customer.referred_by_name && <Field label="By" value={customer.referred_by_name} />}
                      <Field label="Installed" value={formatDate(customer.installed_date)} />
                      <Field label="Qty" value={String(customer.quantity)} />
                      <Field label="Total" value={formatCurrency(customer.total)} />
                    </View>
                  </View>
                ))
              ) : (
                <Text style={{ fontSize: 12, color: '#6b7280' }}>No customers on this invoice.</Text>
              )}
            </View>
          </ScrollView>

          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 8 }}>
            {onPayOut && (
              <TouchableOpacity
                onPress={onPayOut}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#16a34a', alignItems: 'center' }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Pay Out</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onClose}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center' }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default AgentInvoice;

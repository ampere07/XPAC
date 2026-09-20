import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { RefreshCw, X, CheckSquare, Square, AlertTriangle, Download } from 'lucide-react-native';
import { exportToCSV } from '../utils/exportUtils';
import GlobalSearch from './globalfunctions/GlobalSearch';
import {
  billingReconcileService,
  type BillingReconcileAudit,
  type BillingReconcileReasons,
  type BillingReconcileRow,
} from '../services/billingReconcileService';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Which subscribers this billing cycle has not invoiced, and why.
 *
 * Ported from the web tool. This one WRITES: Generate raises a real bill through
 * the same generator the nightly cron uses, Dismiss records that an account is
 * deliberately not billed this cycle, Restore undoes that. The behaviour around
 * those three is kept exactly as the web has it — Dismiss asks for a reason and
 * confirms, Generate does not — rather than made more cautious here, so the two
 * clients cannot disagree about what a tap does.
 *
 * The web lays the worklist out as a wide table with a checkbox column. A phone
 * gets cards with the same selection model: tap to select, act on the selection
 * or on a single row.
 */

interface SliceDefinition {
  id: string;
  label: string;
  color: string;
}

const SLICE_DEFINITIONS: SliceDefinition[] = [
  { id: 'ready', label: 'Ready to Generate', color: '#10b981' },
  { id: 'missing_billing_day', label: 'Missing Billing Day', color: '#f59e0b' },
  { id: 'missing_plan', label: 'Missing / Unlinked Plan', color: '#f59e0b' },
  { id: 'plan_mismatch', label: 'Plan Disagreement', color: '#ec4899' },
  { id: 'zero_price', label: 'Plan Price is 0.00', color: '#f97316' },
  { id: 'inactive_status', label: 'Not Active', color: '#ef4444' },
  { id: 'open_job_order', label: 'Open Job Order', color: '#a855f7' },
  { id: 'prepaid', label: 'Prepaid (Awaiting Renewal)', color: '#3b82f6' },
  { id: 'already_invoiced', label: 'Already Invoiced', color: '#22c55e' },
  { id: 'dismissed', label: 'Dismissed', color: '#6b7280' },
];

const peso = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `₱${Number(value).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

const NOTICE_TONE = {
  success: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
  error: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' },
  info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8' },
};

const BillingReconcileTool: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [data, setData] = useState<BillingReconcileAudit | null>(null);
  const [reasons, setReasons] = useState<BillingReconcileReasons | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [selected, setSelected] = useState<number[]>([]);

  const [dismissTarget, setDismissTarget] = useState<BillingReconcileRow[] | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
    billingReconcileService.getReasons().then(setReasons).catch(() => setReasons(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await billingReconcileService.getAudit({
        reason: reasonFilter || undefined,
        search: search || undefined,
      });
      setData(result);
    } catch (e: any) {
      console.error('[BillingReconcile] failed to load audit', e);
      setNotice({ tone: 'error', text: e?.response?.data?.message || 'Could not load the reconciliation.' });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [reasonFilter, search]);

  // Debounced: the search box drives the API, not an in-memory filter.
  useEffect(() => {
    const id = setTimeout(() => load(), 250);
    return () => clearTimeout(id);
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const clearSelection = () => setSelected([]);

  const rows = data?.rows ?? [];

  /**
   * The rows on screen as CSV. The web builds this from its grid; there is no
   * grid here, so the columns are named directly — the same fields the cards
   * show, plus the identifiers a spreadsheet needs to be matched back.
   */
  const EXPORT_COLUMNS = [
    { key: 'account_no', label: 'Account No' },
    { key: 'customer_name', label: 'Subscriber' },
    { key: 'reason_label', label: 'Reason' },
    { key: 'billing_status', label: 'Billing Status' },
    { key: 'plan_name', label: 'Linked Plan' },
    { key: 'plan_price', label: 'Plan Price' },
    { key: 'billing_day', label: 'Billing Day' },
    { key: 'generation_type', label: 'Billing Type' },
    { key: 'date_installed', label: 'Date Installed' },
    { key: 'account_balance', label: 'Balance' },
    { key: 'due_this_cycle', label: 'Due This Cycle' },
  ];

  const exportValue = (row: any, key: string): string => {
    const v = row?.[key];
    if (key === 'billing_day') {
      // 0 is a real value meaning "every end of month", not a missing one.
      if (v === null || v === undefined) return '-';
      return v === 0 ? 'End of month' : String(v);
    }
    if (key === 'due_this_cycle') return v ? 'Yes' : 'No';
    if (v === null || v === undefined || String(v).trim() === '') return '-';
    return String(v);
  };

  const handleExport = () => {
    if (rows.length === 0) return;
    exportToCSV(`billing_reconcile_${data?.period ?? 'cycle'}`, EXPORT_COLUMNS, rows, exportValue);
  };
  const summary = data?.summary;

  const toggleRow = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.includes(r.billing_account_id)),
    [rows, selected]
  );
  const generatableSelection = useMemo(() => selectedRows.filter((r) => r.can_generate), [selectedRows]);

  /**
   * Run a write and re-read everything.
   *
   * Generation and dismissal both change which rows belong on the worklist and
   * what the counts say, so the whole audit is re-read rather than patched —
   * same as the web.
   */
  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; message: string }>) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({ tone: result.success ? 'success' : 'error', text: result.message });
        await load();
        clearSelection();
      } catch (e: any) {
        setNotice({ tone: 'error', text: e?.response?.data?.message || e?.message || 'The action failed.' });
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const generateOne = (row: BillingReconcileRow) =>
    runAction(`gen:${row.billing_account_id}`, () => billingReconcileService.generate([row.billing_account_id]));

  const generateSelected = () => {
    if (generatableSelection.length === 0) {
      setNotice({
        tone: 'info',
        text: 'None of the selected accounts can be billed from here — fix the flagged reason first.',
      });
      return;
    }
    const max = reasons?.max_batch ?? 200;
    const batch = generatableSelection.slice(0, max).map((r) => r.billing_account_id);
    return runAction('bulk:generate', () => billingReconcileService.generate(batch));
  };

  const confirmDismiss = () => {
    if (!dismissTarget || dismissTarget.length === 0) return;
    const ids = dismissTarget.map((r) => r.billing_account_id);
    const reason = dismissReason.trim();
    setDismissTarget(null);
    setDismissReason('');
    return runAction('bulk:dismiss', () => billingReconcileService.dismiss(ids, reason || undefined));
  };

  const restoreOne = (row: BillingReconcileRow) =>
    runAction(`res:${row.billing_account_id}`, () => billingReconcileService.restore([row.billing_account_id]));

  const sliceValue = (id: string) =>
    (summary as any)?.[id] as number | undefined;

  const renderRow = ({ item }: { item: BillingReconcileRow }) => {
    const isSelected = selected.includes(item.billing_account_id);
    const slice = SLICE_DEFINITIONS.find((s) => s.id === item.reason);
    const rowBusy = busy === `gen:${item.billing_account_id}` || busy === `res:${item.billing_account_id}`;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => toggleRow(item.billing_account_id)}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: isSelected ? '#f5f3ff' : '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          {isSelected ? <CheckSquare size={18} color={primaryColor} /> : <Square size={18} color="#cbd5e1" />}

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
                {item.account_no}
              </Text>
              <View
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: (slice?.color || '#6b7280') + '22',
                }}
              >
                <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', color: slice?.color || '#4b5563' }}>
                  {item.reason_label}
                </Text>
              </View>
            </View>

            {!!item.customer_name && (
              <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }} numberOfLines={1}>
                {item.customer_name}
              </Text>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
              <Field label="Plan" value={item.plan_name || '—'} />
              <Field label="Price" value={peso(item.plan_price)} />
              <Field label="Bill Day" value={item.billing_day === null ? '—' : String(item.billing_day)} />
              <Field label="Balance" value={peso(item.account_balance)} />
              <Field label="Status" value={item.billing_status || '—'} />
              <Field label="Last Invoice" value={formatDate(item.last_invoice_date)} />
            </View>

            {/* The sold plan against the linked one — the reason a plan
                disagreement is flagged at all. */}
            {item.plan_match === 'mismatch' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <AlertTriangle size={13} color="#ec4899" />
                <Text style={{ fontSize: 11, color: '#be185d', flexShrink: 1 }} numberOfLines={2}>
                  Sold as “{item.desired_plan}”, linked to “{item.plan_name}”
                </Text>
              </View>
            )}
            {item.plan_match === 'suggested' && !!item.suggested_plan_name && (
              <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }} numberOfLines={1}>
                Sold as “{item.desired_plan}” — resolves to {item.suggested_plan_name} ({peso(item.suggested_plan_price)})
              </Text>
            )}

            {!!item.dismissed_reason && (
              <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }} numberOfLines={2}>
                Dismissed {formatDate(item.dismissed_at)}: {item.dismissed_reason}
              </Text>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {item.can_generate && (
                <ActionBtn
                  label="Generate"
                  busy={busy === `gen:${item.billing_account_id}`}
                  disabled={!!busy}
                  filled
                  color={primaryColor}
                  onPress={() => generateOne(item)}
                />
              )}
              {item.can_dismiss && (
                <ActionBtn
                  label="Dismiss"
                  busy={false}
                  disabled={!!busy}
                  color="#b91c1c"
                  onPress={() => {
                    setDismissTarget([item]);
                    setDismissReason('');
                  }}
                />
              )}
              {!!item.dismissed_at && (
                <ActionBtn
                  label="Restore"
                  busy={busy === `res:${item.billing_account_id}`}
                  disabled={!!busy}
                  color="#047857"
                  onPress={() => restoreOne(item)}
                />
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', letterSpacing: 0.5, color: '#111827', textTransform: 'uppercase' }}>
            Billing Reconcile
          </Text>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>
            {data ? `${data.period}  ·  ${summary?.ungenerated ?? 0} of ${summary?.due ?? 0} unbilled` : '—'}
          </Text>
        </View>

        {/* Slice counters, doubling as the reason filter. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <SliceChip
            label="All"
            value={summary?.ungenerated}
            color="#111827"
            active={reasonFilter === ''}
            onPress={() => setReasonFilter('')}
          />
          {SLICE_DEFINITIONS.map((slice) => (
            <SliceChip
              key={slice.id}
              label={slice.label}
              value={sliceValue(slice.id)}
              color={slice.color}
              active={reasonFilter === slice.id}
              onPress={() => setReasonFilter(reasonFilter === slice.id ? '' : slice.id)}
            />
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlobalSearch
            searchQuery={search}
            setSearchQuery={setSearch}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search account or customer..."
          />
          <TouchableOpacity
            onPress={() => load()}
            disabled={loading || !!busy}
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: primaryColor,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: loading || busy ? 0.5 : 1,
            }}
          >
            {loading ? <ActivityIndicator size="small" color={primaryColor} /> : <RefreshCw size={16} color={primaryColor} />}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleExport}
            disabled={rows.length === 0 || loading}
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#d1d5db',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: rows.length === 0 || loading ? 0.4 : 1,
            }}
          >
            <Download size={16} color="#4b5563" />
          </TouchableOpacity>
        </View>

        {/* What the selection can do. */}
        {selected.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: '#374151' }}>
              {selected.length} selected ({generatableSelection.length} billable)
            </Text>
            <View style={{ flex: 1 }} />
            <ActionBtn
              label="Generate"
              busy={busy === 'bulk:generate'}
              disabled={!!busy}
              filled
              color={primaryColor}
              onPress={generateSelected}
            />
            <ActionBtn
              label="Dismiss"
              busy={busy === 'bulk:dismiss'}
              disabled={!!busy}
              color="#b91c1c"
              onPress={() => {
                setDismissTarget(selectedRows.filter((r) => r.can_dismiss));
                setDismissReason('');
              }}
            />
            <TouchableOpacity onPress={clearSelection}>
              <X size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>
        )}

        {!!notice && (
          <View
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              backgroundColor: NOTICE_TONE[notice.tone].bg,
              borderColor: NOTICE_TONE[notice.tone].border,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <Text style={{ flex: 1, fontSize: 12, color: NOTICE_TONE[notice.tone].fg }}>{notice.text}</Text>
            <TouchableOpacity onPress={() => setNotice(null)}>
              <X size={14} color={NOTICE_TONE[notice.tone].fg} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Reconciling this cycle...</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.billing_account_id)}
          renderItem={renderRow}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: '#6b7280', textAlign: 'center' }}>
                Nothing outstanding for this cycle under the current filter.
              </Text>
            </View>
          }
        />
      )}

      {/* Dismiss asks why, as on the web — the reason is recorded against the
          account and is the only account of why a cycle was skipped. */}
      <Modal visible={!!dismissTarget} transparent animationType="fade" onRequestClose={() => setDismissTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>
                Dismiss {dismissTarget?.length ?? 0} account{(dismissTarget?.length ?? 0) === 1 ? '' : 's'}
              </Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                They will not be billed this cycle. This is recorded against the account and can be undone.
              </Text>
            </View>

            <View style={{ padding: 16, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>Reason (optional)</Text>
              <TextInput
                value={dismissReason}
                onChangeText={setDismissReason}
                placeholder="Why is this cycle being skipped?"
                placeholderTextColor="#9ca3af"
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  minHeight: 76,
                  color: '#111827',
                  textAlignVertical: 'top',
                }}
              />
            </View>

            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => {
                  setDismissTarget(null);
                  setDismissReason('');
                }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' }}
              >
                <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDismiss}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#b91c1c', alignItems: 'center' }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
      {label}
    </Text>
    <Text style={{ fontSize: 11, color: '#374151' }} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const SliceChip: React.FC<{
  label: string;
  value?: number;
  color: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, value, color, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: active ? color : '#e5e7eb',
      backgroundColor: active ? color + '15' : '#ffffff',
      minWidth: 96,
    }}
  >
    <Text style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9ca3af' }} numberOfLines={1}>
      {label}
    </Text>
    <Text style={{ fontSize: 16, fontWeight: '700', color, marginTop: 2 }}>
      {value === undefined ? '—' : value.toLocaleString()}
    </Text>
  </TouchableOpacity>
);

const ActionBtn: React.FC<{
  label: string;
  busy: boolean;
  disabled: boolean;
  color: string;
  filled?: boolean;
  onPress: () => void;
}> = ({ label, busy, disabled, color, filled, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled || busy}
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: color,
      backgroundColor: filled ? color : '#ffffff',
      opacity: disabled || busy ? 0.55 : 1,
    }}
  >
    {busy && <ActivityIndicator size="small" color={filled ? '#ffffff' : color} />}
    <Text style={{ fontSize: 11, fontWeight: '600', color: filled ? '#ffffff' : color }}>{label}</Text>
  </TouchableOpacity>
);

export default BillingReconcileTool;

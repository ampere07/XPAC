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
  xenditReconcileService,
  type XenditAuditList,
  type XenditFilter,
  type XenditReconcileRow,
} from '../services/xenditReconcileService';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Payments Xendit has taken that billing has not posted.
 *
 * Ported from the web tool. Three writes, each refused server-side when it would
 * be wrong, and each kept behaving exactly as the web has it:
 *
 *   Verify       a live lookup against the gateway; a confirmed payment is
 *                queued for the payment worker. No confirmation — it reads.
 *   Force Post   posts a gateway-confirmed payment now instead of waiting for
 *                the worker. Confirms first, because it moves money into an
 *                account's balance.
 *   Mark Expired writes off an abandoned checkout, with a reason. Confirms.
 *
 * The web lays the worklist out as a wide table. A phone gets cards carrying the
 * same two status columns side by side — what the gateway says and what billing
 * says — because the whole point of the screen is the case where they disagree.
 */

interface SliceDefinition {
  id: string;
  label: string;
  color: string;
}

const SLICE_DEFINITIONS: SliceDefinition[] = [
  { id: 'unposted', label: 'Confirmed Paid (Unposted)', color: '#3b82f6' },
  { id: 'pending', label: 'Pending Verification', color: '#f59e0b' },
  { id: 'settled', label: 'Fully Settled', color: '#10b981' },
  { id: 'expired', label: 'Expired / Failed', color: '#6b7280' },
  { id: 'missing_account', label: 'Missing in Billing', color: '#ef4444' },
];

/**
 * Slices the API narrows for us, versus the one this screen applies itself.
 *
 * "Missing in Billing" is a property of a row, not a server filter — a payment
 * with no matching billing account can be in any of the four gateway states — so
 * it is applied over the fetched page.
 */
const CLIENT_SLICES = new Set(['missing_account']);

/** Selectable lookback windows, in days. */
const WINDOWS = [7, 30, 60, 90];

const peso = (amount: number, currency = 'PHP') =>
  `${currency === 'PHP' ? '₱' : currency + ' '}${Number(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

const formatWhen = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime())
    ? value
    : d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

const NOTICE_TONE = {
  success: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
  error: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' },
  info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8' },
};

const XenditReconcileTool: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [data, setData] = useState<XenditAuditList | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [slice, setSlice] = useState<string>('unposted');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState<number>(30);
  const [selected, setSelected] = useState<number[]>([]);

  const [postTarget, setPostTarget] = useState<XenditReconcileRow | null>(null);
  const [expireTarget, setExpireTarget] = useState<XenditReconcileRow | null>(null);
  const [expireReason, setExpireReason] = useState('');

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  // "Missing in Billing" is ours to apply; the other four are the server's.
  const serverFilter: XenditFilter =
    CLIENT_SLICES.has(slice) || slice === 'all' ? 'all' : (slice as XenditFilter);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await xenditReconcileService.getAudit({
          filter: serverFilter,
          search: search || undefined,
          days,
          per_page: 100,
        })
      );
    } catch (e: any) {
      console.error('[XenditReconcile] failed to load audit', e);
      setNotice({ tone: 'error', text: e?.response?.data?.message || 'Could not load the reconciliation.' });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [serverFilter, search, days]);

  // Debounced: the search box drives the API rather than an in-memory filter.
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

  const summary = data?.summary;

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return slice === 'missing_account' ? all.filter((r) => !r.account_exists) : all;
  }, [data, slice]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.includes(r.id)),
    [rows, selected]
  );

  /**
   * The rows on screen as CSV — the slice the reader is looking at, not the
   * whole snapshot. Both status columns are carried because the whole point of
   * this screen is the pair: what the gateway says, and what billing says.
   */
  const EXPORT_COLUMNS = [
    { key: 'reference_no', label: 'Reference No' },
    { key: 'invoice_id', label: 'Invoice ID' },
    { key: 'account_no', label: 'Account No' },
    { key: 'subscriber_name', label: 'Subscriber' },
    { key: 'amount', label: 'Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'channel', label: 'Channel' },
    { key: 'xendit_status', label: 'Xendit Status' },
    { key: 'billing_status', label: 'Billing Status' },
    { key: 'created_at', label: 'Created' },
    { key: 'settled_at', label: 'Paid' },
    { key: 'account_exists', label: 'Account Found' },
  ];

  const exportValue = (row: any, key: string): string => {
    const v = row?.[key];
    if (key === 'account_exists') return v ? 'Yes' : 'No';
    if (v === null || v === undefined || String(v).trim() === '') return '-';
    return String(v);
  };

  const handleExport = () => {
    if (rows.length === 0) return;
    exportToCSV(`xendit_reconcile_${slice}`, EXPORT_COLUMNS, rows, exportValue);
  };

  const toggleRow = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; message: string }>) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({ tone: result.success ? 'success' : 'error', text: result.message });
        // Any of the three changes which slice a row belongs to and what the
        // counters say, so the whole audit is re-read rather than patched.
        await load();
        clearSelection();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  /** Verify every selected row, one call each so a single failure is attributable. */
  const verifySelected = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setBusy('bulk:verify');
    try {
      let confirmed = 0;
      let unchanged = 0;
      let failed = 0;

      for (const row of selectedRows) {
        const result = await xenditReconcileService.verify(row.id);
        if (!result.success) failed++;
        else if (result.outcome === 'queued') confirmed++;
        else unchanged++;
      }

      setNotice({
        tone: failed > 0 ? 'error' : 'success',
        text: `Verified ${selectedRows.length} payment(s): ${confirmed} confirmed and queued, ${unchanged} unchanged, ${failed} failed.`,
      });
      await load();
      clearSelection();
    } finally {
      setBusy(null);
    }
  }, [selectedRows, load]);

  const confirmForcePost = async () => {
    const target = postTarget;
    if (!target) return;
    setPostTarget(null);
    await runAction(`post:${target.id}`, () => xenditReconcileService.forcePost(target.id));
  };

  const confirmMarkExpired = async () => {
    const target = expireTarget;
    if (!target) return;
    const reason = expireReason.trim();
    setExpireTarget(null);
    setExpireReason('');
    await runAction(`exp:${target.id}`, () => xenditReconcileService.markExpired(target.id, reason || undefined));
  };

  const sliceValue = (id: string) => (summary as any)?.[id === 'missing_account' ? 'missing_in_db' : id] as number | undefined;

  const renderRow = ({ item }: { item: XenditReconcileRow }) => {
    const isSelected = selected.includes(item.id);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => toggleRow(item.id)}
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
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827' }}>
                {peso(item.amount, item.currency)}
              </Text>
            </View>

            {!!item.subscriber_name && (
              <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }} numberOfLines={1}>
                {item.subscriber_name}
              </Text>
            )}

            {/* The two verdicts, side by side. This disagreement is the screen. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <StatusPill label="Gateway" value={item.xendit_status || 'unknown'} tone="#1d4ed8" bg="#eff6ff" />
              <Text style={{ color: '#cbd5e1' }}>→</Text>
              <StatusPill label="Billing" value={item.billing_status} tone="#4b5563" bg="#f3f4f6" />
            </View>

            {!item.account_exists && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <AlertTriangle size={13} color="#ef4444" />
                <Text style={{ fontSize: 11, color: '#b91c1c', flexShrink: 1 }}>
                  No billing account carries this account number — nothing to credit.
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
              <Field label="Ref" value={item.reference_no} />
              <Field label="Channel" value={item.channel || '—'} />
              <Field label="Created" value={formatWhen(item.created_at)} />
              {!!item.settled_at && <Field label="Paid" value={formatWhen(item.settled_at)} />}
              {item.attempts > 0 && <Field label="Attempts" value={String(item.attempts)} />}
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <ActionBtn
                label="Verify"
                busy={busy === `ver:${item.id}`}
                disabled={!!busy}
                color={primaryColor}
                onPress={() => runAction(`ver:${item.id}`, () => xenditReconcileService.verify(item.id))}
              />
              {item.can_force_post && (
                <ActionBtn
                  label="Force Post"
                  busy={busy === `post:${item.id}`}
                  disabled={!!busy}
                  filled
                  color="#047857"
                  onPress={() => setPostTarget(item)}
                />
              )}
              {item.can_mark_expired && (
                <ActionBtn
                  label="Mark Expired"
                  busy={busy === `exp:${item.id}`}
                  disabled={!!busy}
                  color="#b91c1c"
                  onPress={() => {
                    setExpireTarget(item);
                    setExpireReason('');
                  }}
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
            Xendit Reconciliation
          </Text>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>{data ? `${data.total} in ${days}d` : '—'}</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {SLICE_DEFINITIONS.map((s) => (
            <SliceChip
              key={s.id}
              label={s.label}
              value={sliceValue(s.id)}
              color={s.color}
              active={slice === s.id}
              onPress={() => {
                setSlice(s.id);
                clearSelection();
              }}
            />
          ))}
          <SliceChip
            label="All"
            value={data?.total}
            color="#111827"
            active={slice === 'all'}
            onPress={() => {
              setSlice('all');
              clearSelection();
            }}
          />
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlobalSearch
            searchQuery={search}
            setSearchQuery={setSearch}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search account, reference..."
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

        {/* Lookback window */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>Last</Text>
          {WINDOWS.map((w) => (
            <TouchableOpacity
              key={w}
              onPress={() => setDays(w)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: days === w ? primaryColor : '#d1d5db',
                backgroundColor: days === w ? primaryColor : '#ffffff',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: days === w ? '#ffffff' : '#374151' }}>{w}d</Text>
            </TouchableOpacity>
          ))}
        </View>

        {selected.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, color: '#374151' }}>{selected.length} selected</Text>
            <View style={{ flex: 1 }} />
            <ActionBtn
              label="Verify all"
              busy={busy === 'bulk:verify'}
              disabled={!!busy}
              filled
              color={primaryColor}
              onPress={verifySelected}
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
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Reading the payment worklist...</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderRow}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: '#6b7280', textAlign: 'center' }}>
                Nothing outstanding in this slice for the last {days} days.
              </Text>
            </View>
          }
        />
      )}

      {/* Force Post confirms: it moves money into a subscriber's balance. */}
      <ConfirmModal
        visible={!!postTarget}
        title="Post this payment now?"
        body={
          postTarget
            ? `${peso(postTarget.amount, postTarget.currency)} for ${postTarget.account_no} will be posted immediately instead of waiting for the payment worker. The server refuses this unless Xendit has confirmed the payment.`
            : ''
        }
        confirmLabel="Force Post"
        confirmColor="#047857"
        onCancel={() => setPostTarget(null)}
        onConfirm={confirmForcePost}
      />

      {/* Mark Expired confirms and takes a reason, as on the web. */}
      <Modal visible={!!expireTarget} transparent animationType="fade" onRequestClose={() => setExpireTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>Write this checkout off?</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {expireTarget
                  ? `${peso(expireTarget.amount, expireTarget.currency)} for ${expireTarget.account_no} will stop being re-checked by the reconciliation cron. Refused automatically if Xendit has in fact confirmed payment — verify first if unsure.`
                  : ''}
              </Text>
            </View>

            <View style={{ padding: 16, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>Reason (optional)</Text>
              <TextInput
                value={expireReason}
                onChangeText={setExpireReason}
                placeholder="Why is this being written off?"
                placeholderTextColor="#9ca3af"
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  minHeight: 72,
                  color: '#111827',
                  textAlignVertical: 'top',
                }}
              />
            </View>

            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => {
                  setExpireTarget(null);
                  setExpireReason('');
                }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' }}
              >
                <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmMarkExpired}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#b91c1c', alignItems: 'center' }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Mark Expired</Text>
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

const StatusPill: React.FC<{ label: string; value: string; tone: string; bg: string }> = ({ label, value, tone, bg }) => (
  <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, backgroundColor: bg }}>
    <Text style={{ fontSize: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
      {label}
    </Text>
    <Text style={{ fontSize: 11, fontWeight: '700', color: tone }}>{value}</Text>
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
      minWidth: 104,
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

const ConfirmModal: React.FC<{
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmColor: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ visible, title, body, confirmLabel, confirmColor, onCancel, onConfirm }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
      <View style={{ backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' }}>
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>{title}</Text>
          <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{body}</Text>
        </View>
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            onPress={onCancel}
            style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' }}
          >
            <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onConfirm}
            style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: confirmColor, alignItems: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

export default XenditReconcileTool;

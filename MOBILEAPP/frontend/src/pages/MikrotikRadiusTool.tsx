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
import { RefreshCw, X, CheckSquare, Square, Wifi, AlertTriangle, Clock, Download } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import {
  radiusReconciliationService,
  type ReconciliationData,
  type ReconciliationRow,
  type ReconciliationState,
  type OperationLog,
  type BulkOperation,
  type BulkUserPayload,
} from '../services/radiusReconciliationService';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Where the billing database and the MikroTik devices disagree.
 *
 * Ported from the web tool. Every action here writes to a live RADIUS device —
 * moving an account between groups, terminating a session, deleting a user — so
 * the two things that keep it safe are carried over unchanged:
 *
 *   • the screen opens on a cached SNAPSHOT. Nothing contacts hardware until
 *     "Sync & Reconcile Now" is pressed, so opening the page costs nothing.
 *   • every destructive action confirms first, and every action is logged
 *     server-side with an undo.
 *
 * The web renders a wide table with a column chooser. A phone gets cards: each
 * row states what disagrees, and offers only the fixes that apply to that
 * disagreement — the same mapping the web uses, which is why a row's state
 * decides its buttons rather than a fixed toolbar.
 */

interface SliceDefinition {
  id: string;
  label: string;
  color: string;
}

const SLICE_DEFINITIONS: SliceDefinition[] = [
  { id: 'group_mismatch', label: 'Mismatched Groups', color: '#f59e0b' },
  { id: 'password_mismatch', label: 'Password Mismatch', color: '#eab308' },
  { id: 'format_mismatch', label: 'Format Drift', color: '#ec4899' },
  { id: 'duplicate_radius', label: 'Duplicates', color: '#ef4444' },
  { id: 'orphan_radius', label: 'Rogue in MikroTik', color: '#a855f7' },
  { id: 'missing_radius', label: 'Missing in MikroTik', color: '#3b82f6' },
  { id: 'disabled_mismatch', label: 'Disabled', color: '#f97316' },
  { id: 'restricted', label: 'Restricted', color: '#64748b' },
  { id: 'synced', label: 'Fully Synced', color: '#10b981' },
];

const STATE_BADGES: Record<ReconciliationState, { label: string; bg: string; fg: string }> = {
  duplicate_radius: { label: 'Duplicate', bg: '#fef2f2', fg: '#dc2626' },
  password_mismatch: { label: 'Password', bg: '#fffbeb', fg: '#d97706' },
  group_mismatch: { label: 'Group', bg: '#fffbeb', fg: '#b45309' },
  disabled_mismatch: { label: 'Disabled', bg: '#fff7ed', fg: '#ea580c' },
  orphan_radius: { label: 'Orphan', bg: '#faf5ff', fg: '#9333ea' },
  missing_radius: { label: 'Missing', bg: '#eff6ff', fg: '#2563eb' },
  restricted: { label: 'Restricted', bg: '#f3f4f6', fg: '#6b7280' },
  synced: { label: 'In Sync', bg: '#ecfdf5', fg: '#059669' },
};

/** Rows rendered at once. The dataset can run to thousands. */
const PAGE_SIZE = 100;

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

const NOTICE_TONE = {
  success: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
  error: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' },
  info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8' },
};

const MikrotikRadiusTool: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [serverId, setServerId] = useState<string>('all');
  const [slice, setSlice] = useState<string>('group_mismatch');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const [view, setView] = useState<'rows' | 'logs'>('rows');
  const [logs, setLogs] = useState<OperationLog[]>([]);

  const [alignTarget, setAlignTarget] = useState<ReconciliationRow | null>(null);
  const [alignedUsername, setAlignedUsername] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; color: string; run: () => void } | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  /** The cached snapshot. Touches no hardware. */
  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      setData(await radiusReconciliationService.getSnapshot(serverId));
    } catch (e: any) {
      setNotice({ tone: 'error', text: e?.response?.data?.message || 'Could not read the snapshot.' });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  /** A live sweep of every device. This is the only call that contacts hardware. */
  const syncNow = async () => {
    setSyncing(true);
    setNotice({ tone: 'info', text: 'Contacting the RADIUS devices — this can take a while.' });
    try {
      const result = await radiusReconciliationService.getData(serverId);
      setData(result);
      setNotice({
        tone: result.errors?.length ? 'error' : 'success',
        text: result.errors?.length
          ? `Reconciled with ${result.errors.length} device error(s): ${result.errors[0]}`
          : `Reconciled ${result.summary.total} account(s) across ${result.summary.servers} device(s).`,
      });
    } catch (e: any) {
      setNotice({ tone: 'error', text: e?.response?.data?.message || 'The sweep failed.' });
    } finally {
      setSyncing(false);
    }
  };

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await radiusReconciliationService.getLogs(50));
    } catch {
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    if (view === 'logs') loadLogs();
  }, [view, loadLogs]);

  /**
   * The web downloads the current slice as CSV; the service does the same here,
   * fetching with the auth headers and landing the file in app storage. There is
   * no share sheet on this build, so the outcome is reported rather than handed
   * to a viewer — the same as the SmartOLT tool's export.
   */
  const handleExport = async () => {
    setBusy('export');
    setNotice(null);
    try {
      const result = await radiusReconciliationService.exportCsv(slice === 'all' ? 'all' : slice, serverId);
      if ('error' in result) {
        setNotice({ tone: 'error', text: result.error });
      } else {
        setNotice({ tone: 'info', text: 'Exported to the app’s storage on this device.' });
      }
    } catch (e: any) {
      setNotice({ tone: 'error', text: e?.message || 'The export failed.' });
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSnapshot();
    setRefreshing(false);
  };

  const clearSelection = () => setSelected([]);

  const allRows = data?.rows ?? [];

  /**
   * Counts per slice.
   *
   * Format drift is counted alongside the row's own state rather than instead of
   * it — a username can be both in the wrong group and misnamed — which is why a
   * row can appear under two slices.
   */
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allRows.forEach((row) => {
      counts[row.state] = (counts[row.state] ?? 0) + 1;
      if (row.is_format_valid === false) counts['format_mismatch'] = (counts['format_mismatch'] ?? 0) + 1;
    });
    return counts;
  }, [allRows]);

  const rows = useMemo(() => {
    let filtered =
      slice === 'format_mismatch'
        ? allRows.filter((r) => r.is_format_valid === false)
        : allRows.filter((r) => r.state === slice);

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) =>
        [r.username, r.account_no, r.customer_name, r.rad_group, r.bill_group]
          .some((v) => String(v ?? '').toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [allRows, slice, search]);

  const paged = useMemo(() => rows.slice(0, page * PAGE_SIZE), [rows, page]);

  useEffect(() => {
    setPage(1);
    clearSelection();
  }, [slice, search, serverId]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.includes(r.username)), [rows, selected]);
  const toggleRow = (username: string) =>
    setSelected((prev) => (prev.includes(username) ? prev.filter((x) => x !== username) : [...prev, username]));

  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; skipped: boolean; message: string }>) => {
      setBusy(key);
      try {
        const result = await action();
        setNotice({ tone: result.success ? 'success' : 'error', text: result.message });
        // Every action changes which slice a row belongs to, so the snapshot is
        // re-read rather than patched — same as the web.
        await loadSnapshot();
        clearSelection();
      } finally {
        setBusy(null);
      }
    },
    [loadSnapshot]
  );

  /** The payload shape the bulk endpoint expects, built from the row. */
  const bulkPayload = (row: ReconciliationRow): BulkUserPayload => ({
    username: row.username,
    server_id: row.server_id,
    rad_id: row.rad_id,
    rad_group: row.rad_group,
    target_group: row.bill_target_group,
    rad_password: row.rad_password,
    suggested_username: row.suggested_username,
  });

  const runBulk = (operation: BulkOperation, label: string, destructive: boolean) => {
    if (selectedRows.length === 0) return;

    const go = () =>
      runAction(`bulk:${operation}`, async () => {
        // The endpoint takes the target server alongside the rows, and reports
        // per-row outcomes under `data` rather than at the top level.
        const result = await radiusReconciliationService.bulk(operation, selectedRows.map(bulkPayload), serverId);
        const counts = result.data;
        const failed = counts?.failed ?? 0;

        return {
          success: failed === 0,
          skipped: false,
          message:
            `${label}: ${counts?.success ?? 0} succeeded, ${failed} failed` +
            (counts?.skipped ? `, ${counts.skipped} skipped` : '') +
            // The first device error is worth surfacing; the rest are in the log.
            (failed && counts?.errors?.length ? ` — ${counts.errors[0]}` : '.'),
        };
      });

    if (!destructive) return go();

    setConfirm({
      title: `${label} for ${selectedRows.length} account(s)?`,
      body: 'This writes to the live RADIUS devices. Every change is logged and can be undone from the Logs tab.',
      label,
      color: '#b91c1c',
      run: () => {
        setConfirm(null);
        go();
      },
    });
  };

  const askConfirm = (title: string, body: string, label: string, color: string, run: () => void) =>
    setConfirm({ title, body, label, color, run: () => { setConfirm(null); run(); } });

  const confirmAlign = () => {
    if (!alignTarget || !alignedUsername.trim()) return;
    const target = alignTarget;
    const next = alignedUsername.trim();
    setAlignTarget(null);
    runAction(`align:${target.username}`, () =>
      radiusReconciliationService.alignUsername(target.username, next, target.server_id)
    );
  };

  useEffect(() => {
    if (alignTarget) setAlignedUsername(alignTarget.suggested_username || alignTarget.username);
  }, [alignTarget]);

  const renderRow = ({ item }: { item: ReconciliationRow }) => {
    const isSelected = selected.includes(item.username);
    const badge = STATE_BADGES[item.state];
    const misnamed = item.is_format_valid === false;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => toggleRow(item.username)}
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
                {item.username}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {item.online && <Wifi size={13} color="#10b981" />}
                <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: badge.bg }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', color: badge.fg }}>
                    {badge.label}
                  </Text>
                </View>
              </View>
            </View>

            {!!item.customer_name && (
              <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }} numberOfLines={1}>
                {item.customer_name}
                {item.account_no ? `  ·  ${item.account_no}` : ''}
              </Text>
            )}

            {/* The disagreement itself, stated rather than implied. */}
            {item.state === 'group_mismatch' && (
              <Text style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>
                Device says “{item.rad_group || '—'}”, billing wants “{item.bill_target_group || item.bill_group || '—'}”
              </Text>
            )}
            {misnamed && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <AlertTriangle size={13} color="#ec4899" />
                <Text style={{ fontSize: 11, color: '#be185d', flexShrink: 1 }} numberOfLines={2}>
                  {item.format_issue || 'Username does not match the configured pattern'}
                  {item.suggested_username ? ` → ${item.suggested_username}` : ''}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
              <Field label="Server" value={item.server_label || '—'} />
              {!!item.rad_group && <Field label="RADIUS" value={item.rad_group} />}
              {!!item.bill_group && <Field label="Billing" value={item.bill_group} />}
              {item.online && !!item.session_ip && <Field label="IP" value={item.session_ip} />}
            </View>

            {/* Only the fixes that apply to this disagreement — the same mapping
                the web uses. */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {item.state === 'password_mismatch' && (
                <ActionBtn
                  label="Save Pass"
                  busy={busy === `pass:${item.username}`}
                  disabled={!!busy}
                  color={primaryColor}
                  onPress={() =>
                    runAction(`pass:${item.username}`, () =>
                      radiusReconciliationService.syncPassword(item.username, item.rad_password ?? '')
                    )
                  }
                />
              )}

              {item.state === 'group_mismatch' && (
                <>
                  <ActionBtn
                    label="→ MikroTik"
                    busy={busy === `gm:${item.username}`}
                    disabled={!!busy}
                    color={primaryColor}
                    onPress={() =>
                      runAction(`gm:${item.username}`, () =>
                        radiusReconciliationService.syncGroupToMikrotik(
                          item.username,
                          item.bill_target_group ?? '',
                          item.server_id,
                          item.rad_id
                        )
                      )
                    }
                  />
                  <ActionBtn
                    label="→ Billing"
                    busy={busy === `gb:${item.username}`}
                    disabled={!!busy}
                    color={primaryColor}
                    onPress={() =>
                      runAction(`gb:${item.username}`, () =>
                        radiusReconciliationService.syncGroupToBilling(item.username, item.rad_group ?? '')
                      )
                    }
                  />
                </>
              )}

              {misnamed && !!item.suggested_username && (
                <ActionBtn
                  label="Rename"
                  busy={busy === `align:${item.username}`}
                  disabled={!!busy}
                  color="#be185d"
                  onPress={() => setAlignTarget(item)}
                />
              )}

              {item.state !== 'missing_radius' && item.state !== 'restricted' && (
                <ActionBtn
                  label="Restrict"
                  busy={busy === `res:${item.username}`}
                  disabled={!!busy}
                  color="#b45309"
                  onPress={() =>
                    askConfirm(
                      `Restrict ${item.username}?`,
                      'Moves the account to the Restricted group, disables it, and terminates any live session.',
                      'Restrict',
                      '#b45309',
                      () =>
                        runAction(`res:${item.username}`, () =>
                          radiusReconciliationService.restrict(item.username, item.server_id, item.rad_id)
                        )
                    )
                  }
                />
              )}

              {item.online && (
                <ActionBtn
                  label="Disconnect"
                  busy={busy === `dc:${item.username}`}
                  disabled={!!busy}
                  color="#b91c1c"
                  onPress={() =>
                    askConfirm(
                      `Disconnect ${item.username}?`,
                      "Terminates the live session without changing the account's group. The router will usually redial.",
                      'Disconnect',
                      '#b91c1c',
                      () =>
                        runAction(`dc:${item.username}`, () =>
                          radiusReconciliationService.disconnect(item.username, item.server_id)
                        )
                    )
                  }
                />
              )}

              {item.state === 'orphan_radius' && item.server_id !== null && (
                <ActionBtn
                  label="Delete"
                  busy={busy === `del:${item.username}`}
                  disabled={!!busy}
                  color="#b91c1c"
                  filled
                  onPress={() =>
                    askConfirm(
                      `Delete ${item.username} from the device?`,
                      'This account exists on the MikroTik but not in billing. Removing it is permanent on the device, though the action is logged and can be undone.',
                      'Delete',
                      '#b91c1c',
                      () =>
                        runAction(`del:${item.username}`, () =>
                          radiusReconciliationService.deleteUser(item.username, item.rad_id, item.server_id as number)
                        )
                    )
                  }
                />
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderLog = ({ item }: { item: OperationLog }) => (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', backgroundColor: '#ffffff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
          {(item as any).operation || (item as any).action || 'operation'}
        </Text>
        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{(item as any).created_at || ''}</Text>
      </View>
      <Text style={{ fontSize: 11, color: '#475569', marginTop: 3 }} numberOfLines={2}>
        {(item as any).username || (item as any).message || ''}
      </Text>
      {!!(item as any).id && (
        <TouchableOpacity
          onPress={() =>
            askConfirm(
              'Undo this operation?',
              'The change will be reversed on the device and in billing where applicable.',
              'Undo',
              '#b45309',
              () => runAction(`undo:${(item as any).id}`, () => radiusReconciliationService.undo((item as any).id))
            )
          }
          style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db' }}
        >
          <Text style={{ fontSize: 11, color: '#374151', fontWeight: '600' }}>Undo</Text>
        </TouchableOpacity>
      )}
    </View>
  );

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
            MikroTik / RADIUS
          </Text>
          {/* Whether this is cached or freshly swept — the difference matters
              before acting on it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Clock size={11} color="#9ca3af" />
            <Text style={{ fontSize: 10, color: '#9ca3af' }}>
              {data?.stale === false ? 'live' : data?.synced_at ? `snapshot ${data.synced_at}` : 'no sweep yet'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setView(view === 'rows' ? 'logs' : 'rows')}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db' }}
          >
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151' }}>
              {view === 'rows' ? 'Logs' : 'Accounts'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={syncNow}
            disabled={syncing || !!busy}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 9,
              borderRadius: 6,
              backgroundColor: primaryColor,
              opacity: syncing || busy ? 0.6 : 1,
            }}
          >
            {syncing && <ActivityIndicator size="small" color="#ffffff" />}
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#ffffff' }}>
              {syncing ? 'Reconciling...' : 'Sync & Reconcile Now'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleExport}
            disabled={busy === 'export' || loading || syncing}
            style={{ padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db', opacity: busy === 'export' || loading || syncing ? 0.5 : 1 }}
          >
            {busy === 'export'
              ? <ActivityIndicator size="small" color="#4b5563" />
              : <Download size={16} color="#4b5563" />}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={loadSnapshot}
            disabled={loading || syncing}
            style={{ padding: 10, borderRadius: 6, borderWidth: 1, borderColor: primaryColor, opacity: loading || syncing ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator size="small" color={primaryColor} /> : <RefreshCw size={16} color={primaryColor} />}
          </TouchableOpacity>
        </View>

        {view === 'rows' && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {SLICE_DEFINITIONS.map((s) => (
                <SliceChip
                  key={s.id}
                  label={s.label}
                  value={stateCounts[s.id] ?? 0}
                  color={s.color}
                  active={slice === s.id}
                  onPress={() => setSlice(s.id)}
                />
              ))}
            </ScrollView>

            <GlobalSearch
              searchQuery={search}
              setSearchQuery={setSearch}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search username, account, customer..."
            />

            {selected.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#374151' }}>{selected.length} selected</Text>
                {slice === 'password_mismatch' && (
                  <ActionBtn label="Save Pass" busy={busy === 'bulk:sync_passwords'} disabled={!!busy} color={primaryColor}
                    onPress={() => runBulk('sync_passwords', 'Save passwords', false)} />
                )}
                {slice === 'group_mismatch' && (
                  <>
                    <ActionBtn label="→ MikroTik" busy={busy === 'bulk:sync_group_mikrotik'} disabled={!!busy} color={primaryColor}
                      onPress={() => runBulk('sync_group_mikrotik', 'Sync groups to MikroTik', false)} />
                    <ActionBtn label="→ Billing" busy={busy === 'bulk:sync_group_billing'} disabled={!!busy} color={primaryColor}
                      onPress={() => runBulk('sync_group_billing', 'Sync groups to billing', false)} />
                  </>
                )}
                {slice === 'format_mismatch' && (
                  <ActionBtn label="Rename" busy={busy === 'bulk:align_username'} disabled={!!busy} color="#be185d"
                    onPress={() => runBulk('align_username', 'Rename', true)} />
                )}
                <ActionBtn label="Restrict" busy={busy === 'bulk:restrict'} disabled={!!busy} color="#b45309"
                  onPress={() => runBulk('restrict', 'Restrict', true)} />
                <ActionBtn label="Disconnect" busy={busy === 'bulk:disconnect'} disabled={!!busy} color="#b91c1c"
                  onPress={() => runBulk('disconnect', 'Disconnect', true)} />
                {slice === 'orphan_radius' && (
                  <ActionBtn label="Delete" busy={busy === 'bulk:delete'} disabled={!!busy} color="#b91c1c" filled
                    onPress={() => runBulk('delete', 'Delete', true)} />
                )}
                <TouchableOpacity onPress={clearSelection}>
                  <X size={16} color="#6b7280" />
                </TouchableOpacity>
              </ScrollView>
            )}
          </>
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

      {loading && allRows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Reading the snapshot...</Text>
        </View>
      ) : view === 'logs' ? (
        <FlatList
          data={logs}
          keyExtractor={(item, i) => String((item as any).id ?? i)}
          renderItem={renderLog}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No operations logged yet</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={paged}
          keyExtractor={(item) => `${item.server_id ?? 'x'}:${item.username}`}
          renderItem={renderRow}
          initialNumToRender={20}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (paged.length < rows.length) setPage((p) => p + 1);
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: '#6b7280', textAlign: 'center' }}>
                Nothing in this slice. If the snapshot is old, run a sweep.
              </Text>
            </View>
          }
          ListFooterComponent={
            paged.length < rows.length ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#9ca3af' }}>
                  {paged.length} of {rows.length} — scroll for more
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Rename takes the new username, defaulted to the suggestion. */}
      <Modal visible={!!alignTarget} transparent animationType="fade" onRequestClose={() => setAlignTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>Rename in RADIUS</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {alignTarget
                  ? `“${alignTarget.username}” will be renamed on the device and in billing. The session is dropped and the router redials with the new name.`
                  : ''}
              </Text>
            </View>
            <View style={{ padding: 16, gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>New username</Text>
              <TextInput
                value={alignedUsername}
                onChangeText={setAlignedUsername}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: '#111827',
                }}
              />
            </View>
            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setAlignTarget(null)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' }}
              >
                <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmAlign}
                disabled={!alignedUsername.trim()}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#be185d', alignItems: 'center', opacity: alignedUsername.trim() ? 1 : 0.5 }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Every destructive action confirms. */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ padding: 16 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>{confirm?.title}</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{confirm?.body}</Text>
            </View>
            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setConfirm(null)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' }}
              >
                <Text style={{ color: '#374151', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirm?.run}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: confirm?.color || '#b91c1c', alignItems: 'center' }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>{confirm?.label}</Text>
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

const SliceChip: React.FC<{ label: string; value: number; color: string; active: boolean; onPress: () => void }> = ({
  label,
  value,
  color,
  active,
  onPress,
}) => (
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
    <Text style={{ fontSize: 16, fontWeight: '700', color, marginTop: 2 }}>{value.toLocaleString()}</Text>
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

export default MikrotikRadiusTool;

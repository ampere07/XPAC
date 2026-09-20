import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { RefreshCw, X, Server, AlertTriangle, Download, Play, Square as StopIcon } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import {
  smartOltReconciliationService,
  jobTypeLabel,
  jobProgressPercent,
  type JobType,
  type OnuRow,
  type SmartOltLog,
  type SmartOltState,
  type ToolJob,
} from '../services/smartOltReconciliationService';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Where SmartOLT and this system disagree about the ONUs in the field.
 *
 * Ported from the web tool, which is job-based rather than request-based: an
 * action starts a server-side job and the screen then DRIVES it, calling
 * processJob in a loop until it finishes. That mechanic is carried over
 * unchanged, because it is what makes the tool work at all:
 *
 *   • the client drives so a job moves the instant it is created rather than
 *     waiting for a scheduler tick — the tool sat at 0% on hosts with no cron.
 *   • the server-side claim means a cron and this screen cannot collide;
 *     `skipped` just means the cron got there first, which is normal.
 *   • `paused` is a SmartOLT rate-limit stop, not a failure. The job
 *     checkpointed and resumes itself, so it is polled far more slowly.
 *
 * The three cadences below are the web's, for the same reasons.
 */

/** Push hard while this screen holds the claim. */
const JOB_DRIVE_MS = 400;

/** Watch at a slower cadence when another driver holds it. */
const JOB_POLL_MS = 2_000;

/**
 * How often a rate-limit-paused job is re-read.
 *
 * A parked job only changes when its SmartOLT cooldown elapses, which is minutes
 * away, so there is nothing to see in the meantime.
 */
const PAUSED_POLL_MS = 30_000;

/** The jobs this screen can start, in the order the web offers them. */
const JOB_ACTIONS: Array<{ type: JobType; label: string; hint: string; destructive?: boolean }> = [
  { type: 'smartolt_sync', label: 'Sync Inventory', hint: 'Re-read every ONU SmartOLT knows about.' },
  { type: 'radius_scan', label: 'Sync Status', hint: 'Refresh online/offline and optical state.' },
  { type: 'rename', label: 'Push Names', hint: 'Rename ONUs whose label does not match the subscriber.' },
  { type: 'profile_sync', label: 'Push Profiles', hint: "Apply each subscriber's speed profile." },
  { type: 'sn_alignment', label: 'Align Serials', hint: 'Reconcile router/modem serials against the ONU.' },
  { type: 'delete', label: 'Unprovision', hint: 'Remove ONUs for accounts long pulled out.', destructive: true },
];

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

const NOTICE_TONE = {
  success: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
  error: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' },
  info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8' },
};

const JOB_TONE: Record<string, string> = {
  running: '#2563eb',
  paused: '#d97706',
  completed: '#059669',
  failed: '#dc2626',
  aborted: '#6b7280',
  pending: '#6b7280',
};

const SmartOltTool: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [state, setState] = useState<SmartOltState | null>(null);
  const [job, setJob] = useState<ToolJob | null>(null);
  const [logs, setLogs] = useState<SmartOltLog[]>([]);
  const [jobLog, setJobLog] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [view, setView] = useState<'onus' | 'logs'>('onus');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);

  const mounted = useRef(true);
  const jobTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastJobMessage = useRef<string | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (jobTimer.current) clearTimeout(jobTimer.current);
    };
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  const appendJobLog = (line: string) =>
    setJobLog((prev) => [...prev.slice(-80), `${new Date().toLocaleTimeString()}  ${line}`]);

  const loadState = useCallback(async (includeRows = false) => {
    try {
      const next = await smartOltReconciliationService.getState(includeRows);
      if (mounted.current) setState(next);
    } catch (e: any) {
      if (mounted.current) {
        setNotice({ tone: 'error', text: e?.response?.data?.message || 'Could not read the SmartOLT state.' });
      }
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const next = await smartOltReconciliationService.getLogs(50);
      if (mounted.current) setLogs(next);
    } catch {
      if (mounted.current) setLogs([]);
    }
  }, []);

  /**
   * Drive a job to completion.
   *
   * processJob both advances the job and reports where it got to, so the normal
   * path needs no separate status read. Only when the drive could not report at
   * all is getJobStatus called, to keep the bar truthful.
   */
  const pollJob = useCallback(
    async (jobId: number) => {
      let result = await smartOltReconciliationService.processJob(jobId);
      if (!mounted.current) return;

      if (!result.job) {
        result = await smartOltReconciliationService.getJobStatus(jobId);
        if (!mounted.current) return;
      }

      if (!result.job) return;

      setJob(result.job);

      if (result.job.status === 'running' || result.job.status === 'paused') {
        // The same step is read several times at this cadence; logging each read
        // would bury the run in duplicates.
        const message = result.job.message;
        if (message && message !== lastJobMessage.current) {
          lastJobMessage.current = message;
          appendJobLog(message);
        }

        const delay =
          result.job.status === 'paused' ? PAUSED_POLL_MS : result.skipped ? JOB_POLL_MS : JOB_DRIVE_MS;

        jobTimer.current = setTimeout(() => pollJob(jobId), delay);
        return;
      }

      lastJobMessage.current = null;
      appendJobLog(`Job ${result.job.status}: ${result.job.message}`);
      setNotice({
        tone:
          result.job.status === 'completed' ? 'success' : result.job.status === 'aborted' ? 'info' : 'error',
        text: result.job.message,
      });

      await loadState(true);
      await loadLogs();
    },
    [loadState, loadLogs]
  );

  // On open: read the state, and pick up any job already running elsewhere so
  // the screen shows it rather than offering to start a second one.
  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadState(true);
      try {
        const active = await smartOltReconciliationService.getActiveJob();
        if (active && mounted.current) {
          setJob(active);
          appendJobLog(`Picked up a job already in flight: ${jobTypeLabel(active.type)}`);
          pollJob(active.id);
        }
      } catch {
        /* no active job */
      }
      if (mounted.current) setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view === 'logs') loadLogs();
  }, [view, loadLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadState(true);
    setRefreshing(false);
  };

  const startJob = async (type: JobType, options: Record<string, any> = {}) => {
    setBusy(`start:${type}`);
    setJobLog([]);
    lastJobMessage.current = null;
    try {
      const result = await smartOltReconciliationService.startJob(type, options);
      if (result.job) {
        setJob(result.job);
        appendJobLog(`Started ${jobTypeLabel(type)}.`);
        pollJob(result.job.id);
      } else {
        setNotice({ tone: 'error', text: result.message || 'The job could not be started.' });
      }
    } catch (e: any) {
      setNotice({ tone: 'error', text: e?.response?.data?.message || 'The job could not be started.' });
    } finally {
      setBusy(null);
    }
  };

  const abortJob = async () => {
    if (!job) return;
    setBusy('abort');
    try {
      if (jobTimer.current) clearTimeout(jobTimer.current);
      const result = await smartOltReconciliationService.abortJob(job.id);
      if (result.job) setJob(result.job);
      appendJobLog('Abort requested.');
      setNotice({ tone: 'info', text: result.message || 'Job aborted.' });
      await loadState(true);
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    setBusy('export');
    try {
      const result = await smartOltReconciliationService.exportCsv('inventory');
      if ('error' in result) {
        setNotice({ tone: 'error', text: result.error });
      } else {
        // No share sheet is available on this build, so the file is reported
        // rather than handed to a viewer.
        setNotice({ tone: 'info', text: 'Inventory exported to the app’s storage on this device.' });
      }
    } finally {
      setBusy(null);
    }
  };

  const metrics = state?.metrics;
  const jobRunning = job?.status === 'running' || job?.status === 'paused';

  const rows = useMemo(() => {
    const all = (state as any)?.rows as OnuRow[] | undefined;
    if (!all) return [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((r) =>
      [r.sn, (r as any).name, (r as any).account_no, (r as any).customer_name, r.external_id]
        .some((v) => String(v ?? '').toLowerCase().includes(q))
    );
  }, [state, search]);

  const metricTiles = useMemo(
    () => [
      { label: 'Inventory', value: metrics?.inventory, color: '#111827' },
      { label: 'Authorized', value: metrics?.authorized, color: '#059669' },
      { label: 'Offline', value: metrics?.offline, color: '#6b7280' },
      { label: 'LOS', value: metrics?.los, color: '#dc2626' },
      { label: 'Power Fail', value: metrics?.pwrfail, color: '#d97706' },
      { label: 'Unnamed', value: metrics?.name_not_set, color: '#ec4899' },
      { label: 'MAC Cached', value: metrics?.mac_cached, color: '#2563eb' },
      { label: 'Rename Req.', value: metrics?.rename_required ?? undefined, color: '#a855f7' },
      { label: 'Delete Cand.', value: metrics?.delete_candidates ?? undefined, color: '#b91c1c' },
    ],
    [metrics]
  );

  const renderOnu = ({ item }: { item: OnuRow }) => (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
          {item.sn}
        </Text>
        {!!(item as any).status && (
          <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#6b7280' }}>
            {(item as any).status}
          </Text>
        )}
      </View>
      {!!(item as any).name && (
        <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }} numberOfLines={1}>
          {(item as any).name}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
        {!!(item as any).account_no && <Field label="Account" value={String((item as any).account_no)} />}
        {!!(item as any).customer_name && <Field label="Customer" value={String((item as any).customer_name)} />}
        {!!item.external_id && <Field label="ID" value={item.external_id} />}
      </View>
    </View>
  );

  const renderLog = ({ item }: { item: SmartOltLog }) => (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
          {(item as any).action || (item as any).operation || 'operation'}
        </Text>
        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{(item as any).created_at || ''}</Text>
      </View>
      <Text style={{ fontSize: 11, color: '#475569', marginTop: 3 }} numberOfLines={3}>
        {(item as any).message || (item as any).sn || ''}
      </Text>
      {!!(item as any).id && (item as any).can_undo !== false && (
        <TouchableOpacity
          onPress={() =>
            setConfirm({
              title: 'Undo this operation?',
              body: 'The change will be reversed on SmartOLT where it can be.',
              label: 'Undo',
              run: async () => {
                setConfirm(null);
                setBusy(`undo:${(item as any).id}`);
                try {
                  const r = await smartOltReconciliationService.undo((item as any).id);
                  setNotice({ tone: r.success ? 'success' : 'error', text: r.message });
                  await loadLogs();
                  await loadState(true);
                } finally {
                  setBusy(null);
                }
              },
            })
          }
          style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db' }}
        >
          <Text style={{ fontSize: 11, color: '#374151', fontWeight: '600' }}>Undo</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // SmartOLT not configured: nothing here can work, and saying so beats a screen
  // of zeroes that looks like an empty network.
  if (!loading && state && state.configured === false) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <Server size={36} color="#9ca3af" />
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827', textAlign: 'center' }}>
          SmartOLT is not configured
        </Text>
        <Text style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
          Add the sub-domain and API key under Configurations → SmartOLT Config before using this tool.
        </Text>
      </View>
    );
  }

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
            SmartOLT Tool
          </Text>
          <Text style={{ fontSize: 10, color: '#9ca3af' }}>{state?.sub_domain || '—'}</Text>
        </View>

        {/* The running job owns the screen while it is in flight. */}
        {job && jobRunning && (
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#bfdbfe', backgroundColor: '#eff6ff', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: JOB_TONE[job.status] || '#1d4ed8', flexShrink: 1 }} numberOfLines={1}>
                {jobTypeLabel(job.type)} — {job.status}
              </Text>
              <Text style={{ fontSize: 11, color: '#1d4ed8' }}>
                {job.current}/{job.total || '?'} ({jobProgressPercent(job)}%)
              </Text>
            </View>

            <View style={{ height: 6, backgroundColor: '#dbeafe', borderRadius: 3 }}>
              <View style={{ height: 6, width: `${jobProgressPercent(job)}%`, backgroundColor: '#2563eb', borderRadius: 3 }} />
            </View>

            {job.status === 'paused' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="#d97706" />
                <Text style={{ fontSize: 11, color: '#b45309', flexShrink: 1 }}>
                  SmartOLT rate limit reached — the job checkpointed and resumes itself.
                </Text>
              </View>
            )}

            {!!job.message && (
              <Text style={{ fontSize: 11, color: '#475569' }} numberOfLines={2}>
                {job.message}
              </Text>
            )}

            <TouchableOpacity
              onPress={abortJob}
              disabled={busy === 'abort'}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: '#b91c1c',
                opacity: busy === 'abort' ? 0.6 : 1,
              }}
            >
              <StopIcon size={12} color="#b91c1c" />
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#b91c1c' }}>Abort</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* What this screen can start. Disabled while a job holds the tool. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {JOB_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.type}
              disabled={jobRunning || !!busy}
              onPress={() => {
                if (action.destructive) {
                  setConfirm({
                    title: `${action.label}?`,
                    body: `${action.hint} This writes to SmartOLT and affects live subscriber equipment.`,
                    label: action.label,
                    run: () => {
                      setConfirm(null);
                      startJob(action.type);
                    },
                  });
                } else {
                  startJob(action.type);
                }
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: action.destructive ? '#b91c1c' : primaryColor,
                backgroundColor: '#ffffff',
                opacity: jobRunning || busy ? 0.5 : 1,
              }}
            >
              {busy === `start:${action.type}` ? (
                <ActivityIndicator size="small" color={action.destructive ? '#b91c1c' : primaryColor} />
              ) : (
                <Play size={12} color={action.destructive ? '#b91c1c' : primaryColor} />
              )}
              <Text style={{ fontSize: 11, fontWeight: '600', color: action.destructive ? '#b91c1c' : primaryColor }}>
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Inventory counters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {metricTiles.map((tile) => (
            <View
              key={tile.label}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', minWidth: 92 }}
            >
              <Text style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9ca3af' }} numberOfLines={1}>
                {tile.label}
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: tile.color, marginTop: 2 }}>
                {tile.value === undefined || tile.value === null ? '—' : tile.value.toLocaleString()}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            onPress={() => setView(view === 'onus' ? 'logs' : 'onus')}
            style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db' }}
          >
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151' }}>{view === 'onus' ? 'Logs' : 'ONUs'}</Text>
          </TouchableOpacity>
          {view === 'onus' && (
            <GlobalSearch
              searchQuery={search}
              setSearchQuery={setSearch}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search SN, name, account..."
            />
          )}
          <TouchableOpacity
            onPress={handleExport}
            disabled={!!busy}
            style={{ padding: 10, borderRadius: 6, borderWidth: 1, borderColor: primaryColor, opacity: busy ? 0.5 : 1 }}
          >
            <Download size={16} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => loadState(true)}
            disabled={loading}
            style={{ padding: 10, borderRadius: 6, borderWidth: 1, borderColor: primaryColor, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator size="small" color={primaryColor} /> : <RefreshCw size={16} color={primaryColor} />}
          </TouchableOpacity>
        </View>

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

        {/* The run console, while a job is driving. */}
        {jobLog.length > 0 && jobRunning && (
          <View style={{ maxHeight: 92, borderRadius: 8, backgroundColor: '#0f172a', padding: 8 }}>
            <ScrollView>
              {jobLog.slice(-12).map((line, i) => (
                <Text key={i} style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
                  {line}
                </Text>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Reading the ONU inventory...</Text>
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
          data={rows}
          keyExtractor={(item, i) => item.external_id || item.sn || String(i)}
          renderItem={renderOnu}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: '#6b7280', textAlign: 'center' }}>
                No ONUs in the local inventory. Run “Sync Inventory” to read them from SmartOLT.
              </Text>
            </View>
          }
        />
      )}

      {/* Anything that writes to live equipment confirms. */}
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
                style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#b91c1c', alignItems: 'center' }}
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

export default SmartOltTool;

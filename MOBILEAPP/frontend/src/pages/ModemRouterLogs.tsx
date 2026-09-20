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
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  RefreshCw,
  Download,
  History,
  Router as RouterIcon,
  X,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  MapPin,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import {
  modemRouterLogsService,
  type ModemRouterLogRecord,
  type ModemRouterLogSummary,
} from '../services/modemRouterLogsService';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';

/**
 * Where every modem and router has been.
 *
 * One row per movement — installed, pulled out, replaced, relocated — keyed by
 * serial number, so a device can be followed across the accounts it has served.
 * Ported from the web page of the same name.
 *
 * The web lays this out as a table with a row-expanding detail column. A phone
 * gets cards, and the two things the table does that a card cannot — read the
 * full record, and follow one serial through its whole history — become sheets.
 */

const EVENT_TONES: Record<string, { label: string; bg: string; fg: string }> = {
  Installation: { label: 'Installation', bg: '#ecfdf5', fg: '#047857' },
  Pullout: { label: 'Pullout', bg: '#fff1f2', fg: '#be123c' },
  'Router Replacement (Removed)': { label: 'Replace (Removed)', bg: '#fffbeb', fg: '#b45309' },
  'Router Replacement (Installed)': { label: 'Replace (Installed)', bg: '#eff6ff', fg: '#1d4ed8' },
  'Transfer / Relocation': { label: 'Relocation', bg: '#f5f3ff', fg: '#6d28d9' },
};

/**
 * The badge for an event type.
 *
 * Falls back through the same substring checks the web uses, because the event
 * text is composed server side and does not always match one of the five names
 * exactly.
 */
const getEventBadge = (eventType: string) => {
  if (EVENT_TONES[eventType]) return EVENT_TONES[eventType];

  const lower = (eventType || '').toLowerCase();
  if (lower.includes('pullout')) return EVENT_TONES['Pullout'];
  if (lower.includes('replace')) {
    return lower.includes('installed')
      ? EVENT_TONES['Router Replacement (Installed)']
      : EVENT_TONES['Router Replacement (Removed)'];
  }
  if (lower.includes('install')) return EVENT_TONES['Installation'];

  return { label: eventType || '—', bg: '#f3f4f6', fg: '#4b5563' };
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const EVENT_TABS = [
  { id: 'all', label: 'All', icon: Layers },
  { id: 'installation', label: 'Installs', icon: CheckCircle2 },
  { id: 'pullout', label: 'Pullouts', icon: AlertTriangle },
  { id: 'replacement', label: 'Replacements', icon: Wrench },
  { id: 'transfer', label: 'Relocations', icon: MapPin },
];

const ModemRouterLogs: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [search, setSearch] = useState<string>('');
  const [activeSnFilter, setActiveSnFilter] = useState<string>('');
  const [eventType, setEventType] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(50);

  const [logs, setLogs] = useState<ModemRouterLogRecord[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [lastPage, setLastPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [summary, setSummary] = useState<ModemRouterLogSummary | null>(null);

  const [selectedRecord, setSelectedRecord] = useState<ModemRouterLogRecord | null>(null);
  const [timelineSn, setTimelineSn] = useState<string | null>(null);
  const [timelineLogs, setTimelineLogs] = useState<ModemRouterLogRecord[]>([]);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await modemRouterLogsService.getSummary());
    } catch (e) {
      console.error('Failed to load summary', e);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await modemRouterLogsService.getLogs({
        // The serial filter and the free-text search are alternatives, not a
        // pair: filtering by SN means "this device", and a search term left in
        // place would narrow it further to no purpose.
        search: activeSnFilter ? '' : search,
        sn: activeSnFilter || undefined,
        event_type: eventType,
        page,
        per_page: perPage,
      });

      setLogs(response.data);
      setTotal(response.meta.total);
      setLastPage(response.meta.last_page);
    } catch (e) {
      console.error('Failed to load modem router logs', e);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [search, activeSnFilter, eventType, page, perPage]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Debounced, because the search box drives this straight off the API rather
  // than filtering a page already in memory.
  useEffect(() => {
    const id = setTimeout(() => loadLogs(), 250);
    return () => clearTimeout(id);
  }, [loadLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadLogs(), loadSummary()]);
    setRefreshing(false);
  };

  const handleOpenTimeline = useCallback(async (sn: string) => {
    setTimelineSn(sn);
    setTimelineLoading(true);
    try {
      setTimelineLogs(await modemRouterLogsService.getTimelineBySn(sn));
    } catch (e) {
      console.error('Failed to load timeline for SN', sn, e);
      setTimelineLogs([]);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const handleFilterBySn = (sn: string) => {
    setActiveSnFilter(sn);
    setSearch('');
    setPage(1);
    setSelectedRecord(null);
    setTimelineSn(null);
  };

  const handleClearSnFilter = () => {
    setActiveSnFilter('');
    setPage(1);
  };

  /** The same thirteen columns the web exports. */
  const handleExport = () => {
    if (logs.length === 0) return;

    const columns = [
      { key: 'event_date', label: 'Date' },
      { key: 'sn', label: 'Serial Number (SN)' },
      { key: 'model', label: 'Model' },
      { key: 'event_type', label: 'Event Type' },
      { key: 'description', label: 'Description' },
      { key: 'account_no', label: 'Account No' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'address', label: 'Address' },
      { key: 'lcpnap', label: 'LCP/NAP' },
      { key: 'port', label: 'Port' },
      { key: 'technician', label: 'Technician' },
      { key: 'status', label: 'Status' },
      { key: 'remarks', label: 'Remarks' },
    ];

    exportToCSV('modem_router_logs', columns, logs, (record: ModemRouterLogRecord, key: string) =>
      (record as any)[key] ?? ''
    );
  };

  const summaryTiles = useMemo(
    () => [
      { label: 'Movements', value: summary?.total_movements, color: '#111827' },
      { label: 'Serials', value: summary?.unique_serials, color: '#0284c7' },
      { label: 'Installs', value: summary?.total_installations, color: '#047857' },
      { label: 'Pullouts', value: summary?.total_pullouts, color: '#be123c' },
      { label: 'Replacements', value: summary?.total_replacements, color: '#b45309' },
    ],
    [summary]
  );

  const renderItem = ({ item }: { item: ModemRouterLogRecord }) => {
    const badge = getEventBadge(item.event_type);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setSelectedRecord(item)}
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: badge.bg }}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: badge.fg }}>
              {badge.label}
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(item.event_date)}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <RouterIcon size={14} color="#6b7280" />
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
            {item.sn}
          </Text>
          {!!item.model && <Text style={{ fontSize: 11, color: '#9ca3af' }}>{item.model}</Text>}
        </View>

        {!!item.description && (
          <Text style={{ fontSize: 12, color: '#475569', marginTop: 4 }} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {!!item.account_no && <Field label="Account" value={item.account_no} />}
          {!!item.customer_name && <Field label="Customer" value={item.customer_name} />}
          {!!item.lcpnap && <Field label="LCP/NAP" value={item.lcpnap} />}
          {!!item.port && <Field label="Port" value={item.port} />}
          {!!item.technician && <Field label="Tech" value={item.technician} />}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            onPress={() => handleOpenTimeline(item.sn)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: primaryColor,
            }}
          >
            <History size={13} color={primaryColor} />
            <Text style={{ fontSize: 11, color: primaryColor, fontWeight: '600' }}>Timeline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleFilterBySn(item.sn)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: '#d1d5db',
            }}
          >
            <Text style={{ fontSize: 11, color: '#374151', fontWeight: '600' }}>Only this SN</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
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
            Modem / Router Logs
          </Text>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>{total.toLocaleString()}</Text>
        </View>

        {/* Summary counters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {summaryTiles.map((tile) => (
            <View
              key={tile.label}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#e5e7eb',
                minWidth: 92,
              }}
            >
              <Text style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
                {tile.label}
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: tile.color, marginTop: 2 }}>
                {tile.value === undefined ? '—' : tile.value.toLocaleString()}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlobalSearch
            searchQuery={search}
            setSearchQuery={(v: string) => {
              setSearch(v);
              setPage(1);
            }}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search SN, account, customer..."
          />
          <TouchableOpacity
            onPress={handleExport}
            disabled={loading || logs.length === 0}
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: primaryColor,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: loading || logs.length === 0 ? 0.5 : 1,
            }}
          >
            <Download size={16} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => loadLogs()}
            disabled={loading}
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: primaryColor,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? <ActivityIndicator size="small" color={primaryColor} /> : <RefreshCw size={16} color={primaryColor} />}
          </TouchableOpacity>
        </View>

        {/* Event type tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {EVENT_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = eventType === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => {
                  setEventType(tab.id);
                  setPage(1);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: active ? primaryColor : '#ffffff',
                  borderWidth: 1,
                  borderColor: active ? primaryColor : '#d1d5db',
                }}
              >
                <Icon size={13} color={active ? '#ffffff' : '#6b7280'} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#ffffff' : '#374151' }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* The active serial filter, and how to leave it. */}
        {!!activeSnFilter && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: '#eff6ff',
              borderWidth: 1,
              borderColor: '#bfdbfe',
            }}
          >
            <Text style={{ fontSize: 12, color: '#1d4ed8', flexShrink: 1 }} numberOfLines={1}>
              Showing only SN {activeSnFilter}
            </Text>
            <TouchableOpacity onPress={handleClearSnFilter}>
              <X size={16} color="#1d4ed8" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Body */}
      {loading && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading movements...</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No device movements found</Text>
            </View>
          }
          ListFooterComponent={
            logs.length > 0 ? (
              <View
                style={{
                  padding: 12,
                  gap: 10,
                  backgroundColor: '#ffffff',
                  borderTopWidth: 1,
                  borderTopColor: '#e5e7eb',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
                    <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 36, justifyContent: 'center' }}>
                      <Picker
                        selectedValue={perPage}
                        onValueChange={(v) => {
                          setPerPage(Number(v));
                          setPage(1);
                        }}
                        style={{ width: 96, color: '#111827' }}
                        dropdownIconColor="#6b7280"
                      >
                        {[25, 50, 100].map((v) => (
                          <Picker.Item key={v} label={String(v)} value={v} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: '#6b7280' }}>{total.toLocaleString()} total</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <PageBtn label="‹ Prev" disabled={page === 1} onPress={() => setPage((p) => Math.max(1, p - 1))} />
                  <Text style={{ fontSize: 13, color: '#111827' }}>
                    Page {page} of {lastPage}
                  </Text>
                  <PageBtn label="Next ›" disabled={page >= lastPage} onPress={() => setPage((p) => Math.min(lastPage, p + 1))} />
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* One movement in full */}
      {selectedRecord && (
        <RecordModal
          record={selectedRecord}
          primaryColor={primaryColor}
          onClose={() => setSelectedRecord(null)}
          onTimeline={() => {
            const sn = selectedRecord.sn;
            setSelectedRecord(null);
            handleOpenTimeline(sn);
          }}
        />
      )}

      {/* Everywhere one serial has been */}
      {timelineSn && (
        <TimelineModal
          sn={timelineSn}
          logs={timelineLogs}
          loading={timelineLoading}
          primaryColor={primaryColor}
          onClose={() => {
            setTimelineSn(null);
            setTimelineLogs([]);
          }}
        />
      )}
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

const PageBtn: React.FC<{ label: string; disabled: boolean; onPress: () => void }> = ({ label, disabled, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={{
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: disabled ? '#e5e7eb' : '#d1d5db',
      backgroundColor: disabled ? '#f3f4f6' : '#ffffff',
    }}
  >
    <Text style={{ fontSize: 12, color: disabled ? '#9ca3af' : '#111827' }}>{label}</Text>
  </TouchableOpacity>
);

const Line: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 }}>
    <Text style={{ width: 104, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af' }}>
      {label}
    </Text>
    <Text style={{ flex: 1, fontSize: 13, color: '#111827' }}>{value || '—'}</Text>
  </View>
);

/** One movement, with every column the web's detail pane shows. */
const RecordModal: React.FC<{
  record: ModemRouterLogRecord;
  primaryColor: string;
  onClose: () => void;
  onTimeline: () => void;
}> = ({ record, primaryColor, onClose, onTimeline }) => {
  const badge = getEventBadge(record.event_type);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '85%', overflow: 'hidden' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }} numberOfLines={1}>
                {record.sn}
              </Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: badge.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: badge.fg }}>
                  {badge.label}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Line label="Date" value={formatDate(record.event_date)} />
            <Line label="Model" value={record.model} />
            <Line label="Event" value={record.event_type} />
            <Line label="Description" value={record.description} />
            <Line label="Account No" value={record.account_no} />
            <Line label="Customer" value={record.customer_name} />
            <Line label="Address" value={record.address} />
            <Line label="LCP/NAP" value={record.lcpnap} />
            <Line label="Port" value={record.port} />
            <Line label="Technician" value={record.technician} />
            <Line label="Status" value={record.status} />
            <Line label="Remarks" value={record.remarks} />
            <Line label="Source" value={`${record.source_type === 'job_order' ? 'Job Order' : 'Service Order'} #${record.reference_id}`} />
          </ScrollView>

          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={onTimeline}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, alignItems: 'center' }}
            >
              <Text style={{ color: primaryColor, fontWeight: '600' }}>View Timeline</Text>
            </TouchableOpacity>
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

/**
 * Everywhere one serial has been, newest first as the endpoint returns it.
 *
 * This is the question the page exists to answer — a device is a physical thing
 * that moves between customers, and the table only ever shows one stop at a time.
 */
const TimelineModal: React.FC<{
  sn: string;
  logs: ModemRouterLogRecord[];
  loading: boolean;
  primaryColor: string;
  onClose: () => void;
}> = ({ sn, logs, loading, primaryColor, onClose }) => (
  <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
      <View style={{ backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '85%', overflow: 'hidden' }}>
        <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <History size={18} color={primaryColor} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }} numberOfLines={1}>
              {sn}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={primaryColor} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {logs.length === 0 ? (
              <Text style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', paddingVertical: 24 }}>
                No history recorded for this serial.
              </Text>
            ) : (
              logs.map((entry, index) => {
                const badge = getEventBadge(entry.event_type);
                const isLast = index === logs.length - 1;

                return (
                  <View key={entry.id} style={{ flexDirection: 'row', gap: 10 }}>
                    {/* The spine: a dot per stop, joined until the last one. */}
                    <View style={{ alignItems: 'center', width: 14 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: badge.fg, marginTop: 5 }} />
                      {!isLast && <View style={{ flex: 1, width: 2, backgroundColor: '#e5e7eb', marginTop: 2 }} />}
                    </View>

                    <View style={{ flex: 1, paddingBottom: isLast ? 0 : 18 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: badge.bg }}>
                          <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', color: badge.fg }}>
                            {badge.label}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{formatDate(entry.event_date)}</Text>
                      </View>

                      {!!entry.description && (
                        <Text style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{entry.description}</Text>
                      )}

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                        {!!entry.account_no && <Field label="Account" value={entry.account_no} />}
                        {!!entry.customer_name && <Field label="Customer" value={entry.customer_name} />}
                        {!!entry.technician && <Field label="Tech" value={entry.technician} />}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
          <TouchableOpacity
            onPress={onClose}
            style={{ paddingVertical: 12, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

export default ModemRouterLogs;

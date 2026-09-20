import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { MessageSquare, RefreshCw, Download, X, Circle } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';

interface SmsLog {
  id: number;
  organization_id?: number | null;
  account_no?: string | null;
  contact_no: string;
  message: string;
  message_length?: number | null;
  provider?: string | null;
  sender_id?: string | null;
  status: string;
  attempts?: number | null;
  error_message?: string | null;
  provider_response?: string | null;
  source?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
}

interface StatusItem {
  id: string;
  name: string;
  count: number;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  sent: { label: 'Sent', color: '#22c55e' },
  failed: { label: 'Failed', color: '#ef4444' },
};

const exportColumns = [
  { key: 'date', label: 'Date' },
  { key: 'contact_no', label: 'Recipient' },
  { key: 'sender_id', label: 'Sender' },
  { key: 'message', label: 'Message' },
  { key: 'provider', label: 'Provider' },
  { key: 'account_no', label: 'Account No.' },
  { key: 'status', label: 'Status' },
  { key: 'source', label: 'Source' },
  { key: 'message_length', label: 'Length' },
  { key: 'sent_at', label: 'Sent At' },
];

const SmsLogs: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<SmsLog | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('All');

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.get<any>('/sms/logs', {
        params: { per_page: 1000 },
      });

      // Laravel paginator returns { data: [...] }
      const data = response.data?.data ?? response.data ?? [];
      setLogs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to fetch SMS logs:', err);
      setError('Failed to load SMS logs. Please try again.');
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchLogs().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLogs();
    setRefreshing(false);
  };

  // Recursive search across all fields
  const checkValue = (obj: any, query: string): boolean => {
    if (!obj || query === '') return query === '';
    if (typeof obj === 'string') return obj.toLowerCase().includes(query.toLowerCase());
    if (typeof obj === 'number') return obj.toString().includes(query);
    if (Array.isArray(obj)) return obj.some((item) => checkValue(item, query));
    if (typeof obj === 'object') return Object.values(obj).some((value) => checkValue(value, query));
    return false;
  };

  const getLogDate = (log: SmsLog) => log.sent_at || log.created_at || '';

  const formatDateTime = (dateStr?: string | null): string => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
      const parts = formatter.formatToParts(date);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
      return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
    } catch {
      return dateStr;
    }
  };

  // Records matching the global filters (search) but NOT status/month
  const globalFilteredLogs = useMemo(() => {
    return logs.filter(log => {
      return searchQuery === '' || checkValue(log, searchQuery);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, searchQuery]);

  // Status filter items
  const statusItems: StatusItem[] = useMemo(() => {
    const filtered = globalFilteredLogs.filter(log => {
      const month = getLogDate(log).substring(0, 7);
      return selectedDate === 'All' || month === selectedDate;
    });
    const counts = new Map<string, number>();
    filtered.forEach(log => {
      const s = (log.status || 'unknown').toLowerCase();
      counts.set(s, (counts.get(s) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([id, count]) => ({
      id,
      name: STATUS_META[id]?.label || id,
      count,
    }));
  }, [globalFilteredLogs, selectedDate]);

  const dateItems = useMemo(() => {
    const filtered = globalFilteredLogs.filter(log =>
      selectedStatus === 'all' || (log.status || '').toLowerCase() === selectedStatus
    );
    const counts: Record<string, number> = {};
    const months = new Set<string>();
    filtered.forEach(log => {
      const month = getLogDate(log).substring(0, 7);
      if (month) {
        counts[month] = (counts[month] || 0) + 1;
        months.add(month);
      }
    });
    const sortedMonths = Array.from(months).sort().reverse().map(month => ({ date: month, count: counts[month] }));
    return { all: filtered.length, dates: sortedMonths };
  }, [globalFilteredLogs, selectedStatus]);

  // Final filtered records
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesStatus = selectedStatus === 'all' || (log.status || '').toLowerCase() === selectedStatus;
      const matchesSearch = searchQuery === '' || checkValue(log, searchQuery);
      const month = getLogDate(log).substring(0, 7);
      const matchesMonth = selectedDate === 'All' || month === selectedDate;
      return matchesStatus && matchesSearch && matchesMonth;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, selectedStatus, searchQuery, selectedDate]);

  const renderExportCell = (log: SmsLog, key: string) => {
    switch (key) {
      case 'date': return formatDateTime(getLogDate(log));
      case 'status': return STATUS_META[(log.status || '').toLowerCase()]?.label || log.status || '';
      case 'sent_at': return formatDateTime(log.sent_at);
      case 'message_length': return log.message_length ?? '';
      default: return (log as any)[key] ?? '';
    }
  };

  const handleExport = () => {
    if (filteredLogs.length === 0) return;
    exportToCSV('sms_logs', exportColumns, filteredLogs, renderExportCell);
  };

  const statusColor = (status: string) => STATUS_META[(status || '').toLowerCase()]?.color || '#3b82f6';
  const statusLabel = (status: string) => STATUS_META[(status || '').toLowerCase()]?.label || status;

  const renderItem = ({ item }: { item: SmsLog }) => {
    const color = statusColor(item.status);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setSelectedLog(item)}
        style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#ef4444', flex: 1 }} numberOfLines={1}>
            {item.contact_no || 'Unknown'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Circle size={10} color={color} fill={color} />
            <Text style={{ fontSize: 12, fontWeight: '600', color }}>{statusLabel(item.status)}</Text>
          </View>
        </View>
        <Text style={{ fontSize: 13, color: '#374151', marginTop: 6 }} numberOfLines={2}>
          {item.message || '-'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {!!item.sender_id && <Field label="Sender" value={String(item.sender_id)} />}
          {!!item.provider && <Field label="Provider" value={String(item.provider)} />}
          {!!item.account_no && <Field label="Acct" value={String(item.account_no)} />}
        </View>
        <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{formatDateTime(getLogDate(item))}</Text>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={20} color={primaryColor} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>SMS Logs</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GlobalSearch searchQuery={searchQuery} setSearchQuery={setSearchQuery} isDarkMode={isDarkMode} colorPalette={colorPalette} placeholder="Search SMS logs..." />
          <TouchableOpacity onPress={handleExport} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
            <Download size={16} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={fetchLogs} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
            {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>
        {/* Filters */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, height: 40, justifyContent: 'center' }}>
            <Picker selectedValue={selectedStatus} onValueChange={(v) => setSelectedStatus(String(v))} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              <Picker.Item label={`All Status (${globalFilteredLogs.length})`} value="all" />
              {statusItems.map((s) => (
                <Picker.Item key={s.id} label={`${s.name} (${s.count})`} value={s.id} />
              ))}
            </Picker>
          </View>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, height: 40, justifyContent: 'center' }}>
            <Picker selectedValue={selectedDate} onValueChange={(v) => setSelectedDate(String(v))} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              <Picker.Item label="All Months" value="All" />
              {dateItems.dates.map((d) => (
                <Picker.Item key={d.date} label={`${d.date} (${d.count})`} value={d.date} />
              ))}
            </Picker>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>{filteredLogs.length} records</Text>
      </View>

      {/* Body */}
      {isLoading && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading SMS logs...</Text>
        </View>
      ) : error && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={fetchLogs} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No SMS logs found matching your filters</Text>
            </View>
          }
        />
      )}

      {/* Details modal */}
      <Modal
        visible={!!selectedLog}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedLog(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%', paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>SMS Log Details</Text>
              <TouchableOpacity onPress={() => setSelectedLog(null)} style={{ padding: 6, borderRadius: 6, backgroundColor: '#f3f4f6' }}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {selectedLog && (
              <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
                <DetailRow label="Recipient" value={selectedLog.contact_no} />
                <DetailRow label="Sender" value={selectedLog.sender_id || '-'} />
                <DetailRow label="Account No" value={selectedLog.account_no || '-'} />
                <DetailRow label="Provider" value={selectedLog.provider || '-'} />
                <DetailRow label="Source" value={selectedLog.source || '-'} />
                <DetailRow label="Sent At" value={formatDateTime(selectedLog.sent_at || selectedLog.created_at)} />
                <View>
                  <Text style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Status</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Circle size={10} color={statusColor(selectedLog.status)} fill={statusColor(selectedLog.status)} />
                    <Text style={{ fontSize: 14, fontWeight: '600', color: statusColor(selectedLog.status) }}>{statusLabel(selectedLog.status)}</Text>
                  </View>
                </View>
                <View>
                  <Text style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Message</Text>
                  <Text style={{ fontSize: 14, color: '#111827' }}>{selectedLog.message}</Text>
                </View>
                {!!selectedLog.error_message && (
                  <View>
                    <Text style={{ fontSize: 12, color: '#ef4444', textTransform: 'uppercase', marginBottom: 4 }}>Error</Text>
                    <Text style={{ fontSize: 14, color: '#dc2626' }}>{selectedLog.error_message}</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View>
    <Text style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{label}</Text>
    <Text style={{ fontSize: 14, color: '#111827' }}>{value}</Text>
  </View>
);

export default SmsLogs;

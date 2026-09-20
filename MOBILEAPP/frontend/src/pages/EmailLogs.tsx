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
import { Mail, Circle, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';

interface EmailLog {
  id: number;
  organization_id?: number | null;
  account_no?: string | null;
  recipient_email: string;
  cc?: string | null;
  bcc?: string | null;
  subject?: string | null;
  body_html?: string | null;
  attachment_path?: string | null;
  status: string;
  sent_at?: string | null;
  attempts?: number | null;
  error_message?: string | null;
  email_sender?: string | null;
  sender_name?: string | null;
  created_at?: string | null;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  sent: { label: 'Sent', color: '#22c55e' },
  pending: { label: 'Pending', color: '#eab308' },
  failed: { label: 'Failed', color: '#ef4444' },
};

const ITEMS_PER_PAGE = 50;

const formatDateTime = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
  } catch {
    return dateStr;
  }
};

const getLogDate = (log: EmailLog) => log.sent_at || log.created_at || '';

const checkValue = (obj: any, query: string): boolean => {
  if (!obj || query === '') return query === '';
  if (typeof obj === 'string') return obj.toLowerCase().includes(query.toLowerCase());
  if (typeof obj === 'number') return obj.toString().includes(query);
  if (Array.isArray(obj)) return obj.some((item) => checkValue(item, query));
  if (typeof obj === 'object') return Object.values(obj).some((value) => checkValue(value, query));
  return false;
};

const EmailLogs: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<EmailLog | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await apiClient.get<any>('/email-queue', { params: { per_page: 1000 } });
      const data = response.data?.data ?? response.data ?? [];
      setLogs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to fetch email logs:', err);
      setError('Failed to load email logs. Please try again.');
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

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus, selectedDate]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLogs();
    setRefreshing(false);
  };

  // Records matching the global filters (search only)
  const globalFilteredLogs = useMemo(() => {
    return logs.filter((log) => searchQuery === '' || checkValue(log, searchQuery));
  }, [logs, searchQuery]);

  // Status options derived from search-filtered + month-filtered logs
  const statusItems = useMemo(() => {
    const filtered = globalFilteredLogs.filter((log) => {
      const month = getLogDate(log).substring(0, 7);
      return selectedDate === 'All' || month === selectedDate;
    });
    const counts = new Map<string, number>();
    filtered.forEach((log) => {
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
    const filtered = globalFilteredLogs.filter(
      (log) => selectedStatus === 'all' || (log.status || '').toLowerCase() === selectedStatus
    );
    const counts: Record<string, number> = {};
    const months = new Set<string>();
    filtered.forEach((log) => {
      const month = getLogDate(log).substring(0, 7);
      if (month) {
        counts[month] = (counts[month] || 0) + 1;
        months.add(month);
      }
    });
    const sortedMonths = Array.from(months).sort().reverse().map((month) => ({ date: month, count: counts[month] }));
    return { all: filtered.length, dates: sortedMonths };
  }, [globalFilteredLogs, selectedStatus]);

  // Final filtered records
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesStatus = selectedStatus === 'all' || (log.status || '').toLowerCase() === selectedStatus;
      const matchesSearch = searchQuery === '' || checkValue(log, searchQuery);
      const month = getLogDate(log).substring(0, 7);
      const matchesMonth = selectedDate === 'All' || month === selectedDate;
      return matchesStatus && matchesSearch && matchesMonth;
    });
  }, [logs, selectedStatus, searchQuery, selectedDate]);

  const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLogs.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredLogs, currentPage]);

  const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const s = (status || '').toLowerCase();
    const color = STATUS_META[s]?.color || '#3b82f6';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Circle size={10} color={color} fill={color} />
        <Text style={{ fontSize: 12, color }}>{STATUS_META[s]?.label || status}</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: EmailLog }) => (
    <TouchableOpacity
      onPress={() => setSelectedLog(item)}
      activeOpacity={0.7}
      style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 14 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
          {item.recipient_email || 'Unknown'}
        </Text>
        <StatusBadge status={item.status} />
      </View>
      {!!item.subject && (
        <Text style={{ fontSize: 13, color: '#374151', marginTop: 4 }} numberOfLines={1}>
          {item.subject}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        {!!(item.email_sender || item.sender_name) && (
          <Field label="Sender" value={String(item.email_sender || item.sender_name)} />
        )}
        {!!item.account_no && <Field label="Acct" value={String(item.account_no)} />}
        <Field label="Attempts" value={String(item.attempts ?? 0)} />
      </View>
      <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{formatDateTime(getLogDate(item))}</Text>
    </TouchableOpacity>
  );

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            <Mail size={20} color={primaryColor} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', flex: 1 }}>Email Logs</Text>
          <TouchableOpacity
            onPress={fetchLogs}
            disabled={isLoading}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center', opacity: isLoading ? 0.5 : 1 }}
          >
            {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>

        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search email logs..."
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, height: 40, justifyContent: 'center' }}>
            <Picker selectedValue={selectedStatus} onValueChange={(v) => setSelectedStatus(v)} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              <Picker.Item label={`All Status (${globalFilteredLogs.length})`} value="all" />
              {statusItems.map((s) => (
                <Picker.Item key={s.id} label={`${s.name} (${s.count})`} value={s.id} />
              ))}
            </Picker>
          </View>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, height: 40, justifyContent: 'center' }}>
            <Picker selectedValue={selectedDate} onValueChange={(v) => setSelectedDate(v)} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              <Picker.Item label="All Months" value="All" />
              {dateItems.dates.map((d) => (
                <Picker.Item key={d.date} label={`${d.date} (${d.count})`} value={d.date} />
              ))}
            </Picker>
          </View>
        </View>
      </View>

      {/* Body */}
      {isLoading && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading email logs...</Text>
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
          data={paginatedLogs}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No email logs found matching your filters</Text>
            </View>
          }
          ListFooterComponent={
            filteredLogs.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 }}>
                <TouchableOpacity
                  onPress={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  style={{ padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', opacity: currentPage === 1 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={18} color="#374151" />
                </TouchableOpacity>
                <Text style={{ fontSize: 13, fontWeight: '500', color: '#6b7280' }}>
                  Page {currentPage} of {totalPages || 1} ({filteredLogs.length})
                </Text>
                <TouchableOpacity
                  onPress={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  style={{ padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', opacity: currentPage === totalPages || totalPages === 0 ? 0.3 : 1 }}
                >
                  <ChevronRight size={18} color="#374151" />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Details modal */}
      <Modal visible={!!selectedLog} animationType="slide" transparent onRequestClose={() => setSelectedLog(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88%', paddingTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Email Log Details</Text>
              <TouchableOpacity onPress={() => setSelectedLog(null)} style={{ padding: 6, borderRadius: 6, backgroundColor: '#f3f4f6' }}>
                <X size={20} color="#374151" />
              </TouchableOpacity>
            </View>
            {selectedLog && (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                <DetailRow label="Recipient" value={selectedLog.recipient_email} />
                <DetailRow label="Sender" value={selectedLog.email_sender || selectedLog.sender_name || '-'} />
                <DetailRow label="Account No" value={selectedLog.account_no || '-'} />
                <DetailRow label="CC" value={selectedLog.cc || '-'} />
                <DetailRow label="BCC" value={selectedLog.bcc || '-'} />
                <DetailRow label="Attempts" value={String(selectedLog.attempts ?? 0)} />
                <DetailRow label="Sent At" value={formatDateTime(selectedLog.sent_at || selectedLog.created_at)} />
                <View>
                  <Text style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>Status</Text>
                  <StatusBadge status={selectedLog.status} />
                </View>
                <DetailRow label="Subject" value={selectedLog.subject || '-'} />
                {!!selectedLog.error_message && (
                  <View>
                    <Text style={{ fontSize: 12, textTransform: 'uppercase', color: '#ef4444', marginBottom: 4 }}>Error</Text>
                    <Text style={{ color: '#b91c1c' }}>{selectedLog.error_message}</Text>
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
    <Text style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280', marginBottom: 4 }}>{label}</Text>
    <Text style={{ color: '#111827', fontSize: 14 }}>{value}</Text>
  </View>
);

export default EmailLogs;

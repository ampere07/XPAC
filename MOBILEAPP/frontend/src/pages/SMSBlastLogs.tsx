import React, { useState, useEffect, useMemo } from 'react';
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
import { X, RefreshCw, MessageSquare } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';

interface SMSBlastLog {
  id: string;
  messageId: string;
  recipientNumber: string;
  status: string;
  sentDate: string;
  deliveryDate?: string;
  failureReason?: string;
  provider: string;
  messageType: string;
  cost?: number;
  barangay?: string;
  city?: string;
  organization_id?: number;
}

const statusFilters = ['All', 'Delivered', 'Failed', 'Pending', 'Sent'];
const providerFilters = ['All', 'Globe', 'Smart', 'DITO'];
const messageTypeFilters = ['All', 'Customer Advisory', 'Maintenance Advisory', 'Network Advisory', 'Service Advisory'];

const getStatusColors = (status: string): { bg: string; text: string } => {
  switch (status) {
    case 'Delivered': return { bg: '#dcfce7', text: '#15803d' };
    case 'Failed':    return { bg: '#fee2e2', text: '#b91c1c' };
    case 'Pending':   return { bg: '#fef9c3', text: '#a16207' };
    default:          return { bg: '#dbeafe', text: '#1d4ed8' };
  }
};

const SMSBlastLogs: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [logs, setLogs] = useState<SMSBlastLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<SMSBlastLog | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedProvider, setSelectedProvider] = useState<string>('All');
  const [selectedMessageType, setSelectedMessageType] = useState<string>('All');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    const loadOrg = async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        const authData = raw ? JSON.parse(raw) : {};
        setUserOrgId(authData.organization_id ?? null);
      } catch (err) {
        console.error('Failed to load auth data:', err);
      }
    };
    loadOrg();
  }, []);

  const fetchLogs = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await apiClient.get('/sms-blast-logs');
      const result = response.data;
      if (result.status === 'success') {
        setLogs(result.data ?? []);
      } else {
        setLogs([]);
      }
    } catch (err: any) {
      console.error('Failed to fetch SMS Blast logs:', err);
      setError(err.message || 'Failed to load SMS Blast logs. Please try again.');
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchLogs().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLogs();
    setRefreshing(false);
  };

  const filteredLogs = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return logs.filter((log) => {
      if (userOrgId && log.organization_id && log.organization_id !== userOrgId) return false;
      if (selectedStatus !== 'All' && log.status !== selectedStatus) return false;
      if (selectedProvider !== 'All' && log.provider !== selectedProvider) return false;
      if (selectedMessageType !== 'All' && log.messageType !== selectedMessageType) return false;
      if (q) {
        return (
          (log.recipientNumber || '').toLowerCase().includes(q) ||
          (log.messageId || '').toLowerCase().includes(q) ||
          (log.failureReason ? log.failureReason.toLowerCase().includes(q) : false)
        );
      }
      return true;
    });
  }, [logs, selectedStatus, selectedProvider, selectedMessageType, searchQuery, userOrgId]);

  const renderItem = ({ item }: { item: SMSBlastLog }) => {
    const statusColors = getStatusColors(item.status);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setSelectedLog(item)}
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
            {item.recipientNumber}
          </Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: statusColors.bg }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: statusColors.text }}>{item.status}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {!!item.messageId && <Field label="Msg ID" value={item.messageId} />}
          {!!item.provider && <Field label="Provider" value={item.provider} />}
          {!!item.sentDate && <Field label="Sent" value={item.sentDate} />}
        </View>
        {!!item.messageType && (
          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{item.messageType}</Text>
        )}
        {!!item.failureReason && (
          <Text style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }} numberOfLines={1}>
            {item.failureReason}
          </Text>
        )}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search SMS logs..."
          />
          <TouchableOpacity
            onPress={fetchLogs}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
          >
            {isLoading && !refreshing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <RefreshCw size={16} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>

        {/* Filter row: Status */}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 100, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 40, justifyContent: 'center' }}>
            <Picker
              selectedValue={selectedStatus}
              onValueChange={(v) => setSelectedStatus(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {statusFilters.map((s) => (
                <Picker.Item key={s} label={s === 'All' ? 'All Statuses' : s} value={s} />
              ))}
            </Picker>
          </View>
          <View style={{ flex: 1, minWidth: 100, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 40, justifyContent: 'center' }}>
            <Picker
              selectedValue={selectedProvider}
              onValueChange={(v) => setSelectedProvider(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {providerFilters.map((p) => (
                <Picker.Item key={p} label={p === 'All' ? 'All Providers' : p} value={p} />
              ))}
            </Picker>
          </View>
        </View>

        {/* Message type filter + count */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 40, justifyContent: 'center' }}>
            <Picker
              selectedValue={selectedMessageType}
              onValueChange={(v) => setSelectedMessageType(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {messageTypeFilters.map((m) => (
                <Picker.Item key={m} label={m === 'All' ? 'All Message Types' : m} value={m} />
              ))}
            </Picker>
          </View>
          <Text style={{ fontSize: 12, color: '#6b7280', minWidth: 40, textAlign: 'right' }}>
            {filteredLogs.length} logs
          </Text>
        </View>
      </View>

      {/* Body */}
      {isLoading && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading SMS Blast logs...</Text>
        </View>
      ) : error && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={fetchLogs}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No SMS blast logs found</Text>
            </View>
          }
        />
      )}

      {/* Detail Modal */}
      <Modal
        visible={!!selectedLog}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSelectedLog(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
          {/* Modal Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingTop: isTablet ? 16 : 60,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>SMS Log Details</Text>
            <TouchableOpacity
              onPress={() => setSelectedLog(null)}
              style={{ padding: 6, borderRadius: 6, backgroundColor: '#f1f5f9' }}
            >
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Modal Body */}
          {selectedLog && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
              <DetailRow label="Message ID" value={selectedLog.messageId} />
              <DetailRow label="Recipient" value={selectedLog.recipientNumber} />
              <View>
                <Text style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Status</Text>
                <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: getStatusColors(selectedLog.status).bg }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: getStatusColors(selectedLog.status).text }}>{selectedLog.status}</Text>
                </View>
              </View>
              <DetailRow label="Sent Date" value={selectedLog.sentDate} />
              {!!selectedLog.deliveryDate && <DetailRow label="Delivery Date" value={selectedLog.deliveryDate} />}
              <DetailRow label="Provider" value={selectedLog.provider} />
              <DetailRow label="Message Type" value={selectedLog.messageType} />
              {!!selectedLog.failureReason && <DetailRow label="Failure Reason" value={selectedLog.failureReason} />}
              {typeof selectedLog.cost === 'number' && (
                <DetailRow label="Cost" value={`₱${selectedLog.cost.toFixed(2)}`} />
              )}
              {!!selectedLog.barangay && <DetailRow label="Barangay" value={selectedLog.barangay} />}
              {!!selectedLog.city && <DetailRow label="City" value={selectedLog.city} />}
            </ScrollView>
          )}
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
  <View style={{ marginBottom: 12 }}>
    <Text style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>{label}</Text>
    <Text style={{ fontSize: 15, color: '#111827' }}>{value}</Text>
  </View>
);

export default SMSBlastLogs;

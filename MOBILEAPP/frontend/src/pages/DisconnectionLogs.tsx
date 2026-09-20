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
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { AlertTriangle, Circle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import DisconnectionLogsDetails from '../components/DisconnectionLogsDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useDisconnectionStore } from '../store/disconnectionStore';
import { DisconnectionLogRecord } from '../services/disconnectionService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ITEMS_PER_PAGE = 50;

const getCityName = (cityId: number): string => {
  const cityMap: Record<number, string> = {
    1: 'Binangonan',
    2: 'Cardona',
  };
  return cityMap[cityId] || `City ${cityId}`;
};

const checkValue = (obj: any, query: string): boolean => {
  if (!obj || query === '') return query === '';
  if (typeof obj === 'string') return obj.toLowerCase().includes(query.toLowerCase());
  if (typeof obj === 'number') return obj.toString().includes(query);
  if (Array.isArray(obj)) return obj.some((item) => checkValue(item, query));
  if (typeof obj === 'object') return Object.values(obj).some((value) => checkValue(value, query));
  return false;
};

const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
  } catch (e) {
    return dateStr;
  }
};

const DisconnectionLogs: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const { logRecords, isLoading, error, fetchLogRecords, refreshLogRecords } = useDisconnectionStore();
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<DisconnectionLogRecord | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [userOrgId, setUserOrgId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        const authData = JSON.parse(raw || '{}');
        const orgId =
          authData.organization_id ||
          authData.user?.organization_id ||
          authData.organization?.id ||
          authData.user?.organization?.id ||
          null;
        setUserOrgId(orgId);
      } catch {
        setUserOrgId(null);
      }
    })();
  }, []);

  useEffect(() => {
    fetchLogRecords();
  }, [fetchLogRecords]);

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshLogRecords().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [refreshLogRecords]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedLocation, selectedDate]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshLogRecords();
    setRefreshing(false);
  };

  const orgFilter = (record: DisconnectionLogRecord): boolean => {
    if (userOrgId) {
      return record.organization_id === userOrgId;
    }
    return !record.organization_id;
  };

  // Records matching the global filters (org + search) but NOT categorical filters
  const globalFilteredRecords = useMemo(() => {
    return logRecords.filter((record) => {
      if (!orgFilter(record)) return false;
      return searchQuery === '' || checkValue(record, searchQuery);
    });
  }, [logRecords, searchQuery, userOrgId]);

  // Location (city) options derived from search + month filtered records
  const locationItems = useMemo(() => {
    const filtered = globalFilteredRecords.filter((record) => {
      return selectedDate === 'All' || (record.date && record.date.startsWith(selectedDate));
    });
    const cityCountMap = new Map<number, number>();
    filtered.forEach((record) => {
      if (record.cityId !== undefined) {
        cityCountMap.set(record.cityId, (cityCountMap.get(record.cityId) || 0) + 1);
      }
    });
    const items: { id: string; name: string; count: number }[] = [];
    cityCountMap.forEach((count, cityId) => {
      items.push({ id: String(cityId), name: getCityName(cityId), count });
    });
    return items;
  }, [globalFilteredRecords, selectedDate]);

  const dateItems = useMemo(() => {
    const filtered = globalFilteredRecords.filter((record) => {
      return selectedLocation === 'all' || (record.cityId !== undefined && record.cityId === Number(selectedLocation));
    });
    const counts: Record<string, number> = {};
    const months = new Set<string>();
    filtered.forEach((record) => {
      if (record.date && record.date !== '-') {
        const monthKey = record.date.substring(0, 7);
        counts[monthKey] = (counts[monthKey] || 0) + 1;
        months.add(monthKey);
      }
    });
    const sortedMonths = Array.from(months)
      .sort()
      .reverse()
      .map((month) => ({ date: month, count: counts[month] }));
    return { all: filtered.length, dates: sortedMonths };
  }, [globalFilteredRecords, selectedLocation]);

  const filteredLogRecords = useMemo(() => {
    return logRecords.filter((record) => {
      if (!orgFilter(record)) return false;
      const matchesLocation =
        selectedLocation === 'all' || (record.cityId !== undefined && record.cityId === Number(selectedLocation));
      const matchesSearch = searchQuery === '' || checkValue(record, searchQuery);
      const matchesMonth = selectedDate === 'All' || (record.date && record.date.startsWith(selectedDate));
      return matchesLocation && matchesSearch && matchesMonth;
    });
  }, [logRecords, selectedLocation, searchQuery, selectedDate, userOrgId]);

  const totalPages = Math.ceil(filteredLogRecords.length / ITEMS_PER_PAGE);
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLogRecords.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredLogRecords, currentPage]);

  const renderItem = ({ item }: { item: DisconnectionLogRecord }) => (
    <TouchableOpacity
      onPress={() => setSelectedLog(item)}
      activeOpacity={0.7}
      style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#ef4444', flex: 1 }} numberOfLines={1}>
          {item.accountNo || 'Unknown'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Circle size={10} color="#ef4444" fill="#ef4444" />
          <Text style={{ fontSize: 12, color: '#ef4444' }}>{item.status || 'Disconnected'}</Text>
        </View>
      </View>
      {!!item.customerName && (
        <Text style={{ fontSize: 13, color: '#374151', marginTop: 4 }} numberOfLines={1}>
          {item.customerName}
        </Text>
      )}
      {!!item.address && (
        <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }} numberOfLines={1}>
          {item.address}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        {!!item.username && <Field label="User" value={String(item.username)} />}
        {!!item.sessionId && <Field label="Session" value={String(item.sessionId)} />}
        {!!item.disconnectedBy && <Field label="By" value={String(item.disconnectedBy)} />}
        {!!item.remarks && <Field label="Remarks" value={String(item.remarks)} />}
      </View>
      <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        {formatDateTime(item.date || item.disconnectionDate)}
      </Text>
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
            <AlertTriangle size={20} color={primaryColor} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', flex: 1 }}>Disconnected Logs</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={isLoading}
            style={{
              padding: 10,
              borderRadius: 8,
              backgroundColor: primaryColor,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <RefreshCw size={16} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>

        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search disconnection logs..."
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 6,
              overflow: 'hidden',
              flex: 1,
              height: 40,
              justifyContent: 'center',
            }}
          >
            <Picker
              selectedValue={selectedLocation}
              onValueChange={(v) => setSelectedLocation(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              <Picker.Item label={`All Locations (${globalFilteredRecords.length})`} value="all" />
              {locationItems.map((loc) => (
                <Picker.Item key={loc.id} label={`${loc.name} (${loc.count})`} value={loc.id} />
              ))}
            </Picker>
          </View>
          <View
            style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 6,
              overflow: 'hidden',
              flex: 1,
              height: 40,
              justifyContent: 'center',
            }}
          >
            <Picker
              selectedValue={selectedDate}
              onValueChange={(v) => setSelectedDate(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              <Picker.Item label="All Months" value="All" />
              {dateItems.dates.map((d) => (
                <Picker.Item key={d.date} label={`${d.date} (${d.count})`} value={d.date} />
              ))}
            </Picker>
          </View>
        </View>
      </View>

      {/* Body */}
      {isLoading && logRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading disconnection logs...</Text>
        </View>
      ) : error && logRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedRecords}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={primaryColor}
              colors={[primaryColor]}
            />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No disconnection logs found matching your filters</Text>
            </View>
          }
          ListFooterComponent={
            filteredLogRecords.length > 0 ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  paddingVertical: 16,
                }}
              >
                <TouchableOpacity
                  onPress={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    opacity: currentPage === 1 ? 0.3 : 1,
                  }}
                >
                  <ChevronLeft size={18} color="#374151" />
                </TouchableOpacity>
                <Text style={{ fontSize: 13, fontWeight: '500', color: '#6b7280' }}>
                  Page {currentPage} of {totalPages || 1} ({filteredLogRecords.length})
                </Text>
                <TouchableOpacity
                  onPress={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    opacity: currentPage === totalPages || totalPages === 0 ? 0.3 : 1,
                  }}
                >
                  <ChevronRight size={18} color="#374151" />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Details modal */}
      <Modal visible={!!selectedLog} animationType="slide" onRequestClose={() => setSelectedLog(null)}>
        {selectedLog && (
          <DisconnectionLogsDetails
            disconnectionRecord={selectedLog}
            onClose={() => setSelectedLog(null)}
            isMobile
          />
        )}
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

export default DisconnectionLogs;

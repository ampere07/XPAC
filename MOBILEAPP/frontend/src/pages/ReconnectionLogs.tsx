import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { RefreshCw, Circle } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ReconnectionLogsDetails from '../components/ReconnectionLogsDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useReconnectionStore } from '../store/reconnectionStore';
import { userService } from '../services/userService';
import { ReconnectionLogRecord } from '../services/reconnectionService';

// App is forced light mode.
const isDarkMode = false;

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

function getCityName(cityId: number): string {
  const cityMap: Record<number, string> = {
    1: 'Binangonan',
    2: 'Cardona',
  };
  return cityMap[cityId] || `City ${cityId}`;
}

// Recursive search function to enable deep searching through all record data
const checkValue = (obj: any, query: string): boolean => {
  if (!obj || query === '') return query === '';
  if (typeof obj === 'string') return obj.toLowerCase().includes(query.toLowerCase());
  if (typeof obj === 'number') return obj.toString().includes(query);
  if (Array.isArray(obj)) return obj.some((item) => checkValue(item, query));
  if (typeof obj === 'object') return Object.values(obj).some((value) => checkValue(value, query));
  return false;
};

const ReconnectionLogs: React.FC = () => {
  const { logRecords, isLoading, error, fetchLogRecords, refreshLogRecords, silentRefresh } = useReconnectionStore();
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<ReconnectionLogRecord | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [userOrgId, setUserOrgId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
    AsyncStorage.getItem('authData').then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        setUserOrgId(
          d.organization_id || d.user?.organization_id || d.organization?.id || d.user?.organization?.id || null
        );
      } catch {
        /* ignore */
      }
    });
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await userService.getAllUsers();
        if (response.success && response.data) {
          const map: Record<string, string> = {};
          response.data.forEach((user: any) => {
            const firstName = (user.first_name || '').trim();
            const lastName = (user.last_name || '').trim();
            const fullName = `${firstName} ${lastName}`.trim();
            map[user.id.toString()] = fullName || user.username || user.email_address || user.email || 'Unknown User';
          });
          setUsersMap(map);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchLogRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      silentRefresh().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [silentRefresh]);

  const resolveReconnectedBy = (val: any): string => {
    if (!val) return '-';
    const strVal = String(val);
    if (/^\d+$/.test(strVal)) {
      return usersMap[strVal] || strVal;
    }
    return strVal;
  };

  // Records filtered by org + search only (drives the count badges/pickers)
  const orgSearchFiltered = useMemo(() => {
    return logRecords.filter((record) => {
      if (userOrgId) {
        if (record.organization_id !== userOrgId) return false;
      } else {
        if (record.organization_id) return false;
      }
      return searchQuery === '' || checkValue(record, searchQuery);
    });
  }, [logRecords, searchQuery, userOrgId]);

  // Distinct months for the month picker
  const monthItems = useMemo(() => {
    const filteredForMonths = orgSearchFiltered.filter((record) => {
      return selectedLocation === 'all' || (record.cityId !== undefined && record.cityId === Number(selectedLocation));
    });
    const months = new Set<string>();
    filteredForMonths.forEach((record) => {
      if (record.date && record.date !== '-') {
        months.add(record.date.substring(0, 7)); // YYYY-MM
      }
    });
    return Array.from(months).sort().reverse();
  }, [orgSearchFiltered, selectedLocation]);

  // Distinct locations (cities) for the location picker
  const locationItems = useMemo(() => {
    const filteredForLocations = orgSearchFiltered.filter((record) => {
      return selectedDate === 'All' || (record.date && record.date.startsWith(selectedDate));
    });
    const cityCountMap = new Map<number, number>();
    filteredForLocations.forEach((record) => {
      if (record.cityId !== undefined) {
        cityCountMap.set(record.cityId, (cityCountMap.get(record.cityId) || 0) + 1);
      }
    });
    const items: { id: string; name: string; count: number }[] = [];
    cityCountMap.forEach((count, cityId) => {
      items.push({ id: String(cityId), name: getCityName(cityId), count });
    });
    return items;
  }, [orgSearchFiltered, selectedDate]);

  // Fully filtered records for the list
  const filteredLogRecords = useMemo(() => {
    return orgSearchFiltered.filter((record) => {
      const matchesLocation =
        selectedLocation === 'all' || (record.cityId !== undefined && record.cityId === Number(selectedLocation));
      const matchesMonth = selectedDate === 'All' || (record.date && record.date.startsWith(selectedDate));
      return matchesLocation && matchesMonth;
    });
  }, [orgSearchFiltered, selectedLocation, selectedDate]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshLogRecords();
    setRefreshing(false);
  };

  const renderItem = ({ item }: { item: ReconnectionLogRecord }) => {
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
            {item.customerName || 'Unknown'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Circle size={10} color="#22c55e" fill="#22c55e" />
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#16a34a' }}>Reconnected</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {!!item.accountNo && <Field label="Acct" value={String(item.accountNo)} valueColor="#ef4444" />}
          {!!item.username && <Field label="User" value={String(item.username)} />}
          {!!item.plan && <Field label="Plan" value={String(item.plan)} />}
          {item.reconnectionFee ? <Field label="Fee" value={`₱${(Number(item.reconnectionFee) || 0).toFixed(2)}`} /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
          <Field label="Date" value={formatDateTime(item.date || item.reconnectionDate)} />
          {!!item.reconnectedBy && <Field label="By" value={resolveReconnectedBy(item.reconnectedBy)} />}
        </View>
        {!!item.remarks && (
          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }} numberOfLines={2}>
            {item.remarks}
          </Text>
        )}
        {!!item.address && (
          <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }} numberOfLines={1}>
            {item.address}
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
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Reconnection Logs</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search reconnection logs..."
          />
          <TouchableOpacity
            onPress={() => fetchLogRecords(true)}
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
            {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>

        {/* Filters */}
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
              selectedValue={selectedDate}
              onValueChange={(v) => setSelectedDate(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              <Picker.Item label="All Months" value="All" />
              {monthItems.map((m) => (
                <Picker.Item key={m} label={m} value={m} />
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
              selectedValue={selectedLocation}
              onValueChange={(v) => setSelectedLocation(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              <Picker.Item label="All Locations" value="all" />
              {locationItems.map((loc) => (
                <Picker.Item key={loc.id} label={`${loc.name} (${loc.count})`} value={loc.id} />
              ))}
            </Picker>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>{filteredLogRecords.length} records</Text>
      </View>

      {/* Body */}
      {isLoading && logRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading reconnection logs...</Text>
        </View>
      ) : error && logRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => fetchLogRecords(true)}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredLogRecords}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No reconnection logs found matching your filters</Text>
            </View>
          }
          ListFooterComponent={
            isLoading && logRecords.length > 0 ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={primaryColor} />
                <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Loading more...</Text>
              </View>
            ) : null
          }
        />
      )}

      {selectedLog && (
        <ReconnectionLogsDetails
          reconnectionRecord={selectedLog}
          onClose={() => setSelectedLog(null)}
          isMobile={!isTablet}
        />
      )}
    </View>
  );
};

const Field: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    <Text style={{ color: valueColor || '#6b7280' }}>{value}</Text>
  </Text>
);

export default ReconnectionLogs;

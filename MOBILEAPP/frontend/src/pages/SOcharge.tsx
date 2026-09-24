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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { RefreshCw, Download } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useSOChargeStore, SOChargeRecord } from '../store/soChargeStore';
import { exportToCSV } from '../utils/exportUtils';

const allColumns = [
  { key: 'id', label: 'ID' },
  { key: 'account_no', label: 'Account No' },
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount' },
  { key: 'source', label: 'Source' },
  { key: 'remarks', label: 'Remarks' },
];

const formatDate = (dateString: string | null) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '-';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
};

const SOChargePage: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const { chargeRecords, totalCount, isLoading, error, fetchChargeRecords, refreshChargeRecords, silentRefresh } = useSOChargeStore();

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

  // Resolve organization id from stored auth data (async in RN).
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
    fetchChargeRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      silentRefresh().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [silentRefresh]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshChargeRecords();
    } finally {
      setRefreshing(false);
    }
  };

  // Organization + search + date-range filtering (mirrors web logic).
  const globalFilteredRecords = useMemo(() => {
    let filtered = chargeRecords;

    if (userOrgId) {
      filtered = filtered.filter((record) => record.organization_id === userOrgId);
    } else {
      filtered = filtered.filter((record) => !record.organization_id);
    }

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') {
          return Object.values(val).some((v) => checkValue(v));
        }
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      filtered = filtered.filter((record) => checkValue(record));
    }

    return filtered;
  }, [chargeRecords, searchQuery, userOrgId]);

  // Group by Month/Year for the date filter.
  const dateItems = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();

    globalFilteredRecords.forEach((record) => {
      if (record.date) {
        const date = new Date(record.date);
        if (isNaN(date.getTime())) return;
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        const formatted = `${mm}/${yyyy}`;
        dateCounts[formatted] = (dateCounts[formatted] || 0) + 1;
        dates.set(formatted, record.date);
      }
    });

    return Array.from(dates.entries())
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
      .map(([formatted]) => ({ date: formatted, count: dateCounts[formatted] }));
  }, [globalFilteredRecords]);

  const filteredRecords = useMemo(() => {
    let filtered = globalFilteredRecords.filter((record) => {
      if (selectedDate === 'All') return true;
      if (!record.date) return false;
      const date = new Date(record.date);
      if (isNaN(date.getTime())) return false;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${yyyy}` === selectedDate;
    });

    // Default sort: newest first by date.
    filtered = [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return filtered;
  }, [globalFilteredRecords, selectedDate]);

  const renderCellValue = (record: SOChargeRecord, columnKey: string) => {
    switch (columnKey) {
      case 'id':
        return String(record.display_id);
      case 'account_no':
        return record.account_no || '-';
      case 'date':
        return formatDate(record.date);
      case 'type':
        return record.type || '-';
      case 'amount':
        return `₱ ${Number(record.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
      case 'source':
        return record.source || '-';
      case 'remarks':
        return record.remarks || '-';
      default:
        return '-';
    }
  };

  const handleExport = () => {
    if (!filteredRecords.length) return;
    exportToCSV('so_charge_export', allColumns, filteredRecords, renderCellValue);
  };

  const renderItem = ({ item }: { item: SOChargeRecord }) => (
    <View style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
          {item.type || 'Charge'}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: primaryColor }}>
          {renderCellValue(item, 'amount')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        <Field label="ID" value={String(item.display_id)} />
        {!!item.account_no && <Field label="Acct" value={String(item.account_no)} />}
        {!!item.date && <Field label="Date" value={formatDate(item.date)} />}
        {!!item.source && <Field label="Source" value={String(item.source)} />}
      </View>
      {!!item.remarks && (
        <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }} numberOfLines={2}>
          {item.remarks}
        </Text>
      )}
    </View>
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
          <GlobalSearch searchQuery={searchQuery} setSearchQuery={setSearchQuery} isDarkMode={isDarkMode} colorPalette={colorPalette} placeholder="Search SO charges..." />
          <TouchableOpacity onPress={handleExport} disabled={filteredRecords.length === 0} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center', opacity: filteredRecords.length === 0 ? 0.5 : 1 }}>
            <Download size={16} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => fetchChargeRecords(true)} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
            {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, marginRight: 12, height: 40, justifyContent: 'center' }}>
            <Picker selectedValue={selectedDate} onValueChange={(v) => setSelectedDate(v)} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              <Picker.Item label="All Records" value="All" />
              {dateItems.map((item) => (
                <Picker.Item key={item.date} label={`${item.date} (${item.count})`} value={item.date} />
              ))}
            </Picker>
          </View>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            {filteredRecords.length}{totalCount ? ` / ${totalCount}` : ''}
          </Text>
        </View>
      </View>

      {/* Body */}
      {isLoading && chargeRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading records...</Text>
        </View>
      ) : error && chargeRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={() => fetchChargeRecords(true)} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No charge records found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

export default SOChargePage;

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
import { RefreshCw, Download } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useOverdueStore } from '../store/overdueStore';
import { Overdue } from '../services/overdueService';
import { exportToCSV } from '../utils/exportUtils';

const allColumns = [
  { key: 'id', label: 'ID' },
  { key: 'account_no', label: 'Account No' },
  { key: 'full_name', label: 'Customer Name' },
  { key: 'overdue_date', label: 'Overdue Date' },
  { key: 'invoice_id', label: 'Invoice ID' },
  { key: 'plan', label: 'Plan' },
  { key: 'contact_number', label: 'Contact' },
  { key: 'email_address', label: 'Email' },
  { key: 'address', label: 'Address' },
];

const formatDate = (value?: string) => {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value).split('T')[0];
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  } catch {
    return String(value);
  }
};

const OverduePage: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { overdueRecords, totalCount, isLoading, error, fetchOverdueRecords, refreshOverdueRecords, silentRefresh } = useOverdueStore();

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
    fetchOverdueRecords();
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
    await refreshOverdueRecords();
    setRefreshing(false);
  };

  const distinctDates = useMemo(() => {
    const set = new Set<string>();
    overdueRecords.forEach((r) => {
      const d = (r as any).overdue_date;
      if (d) set.add(String(d).split('T')[0]);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [overdueRecords]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return overdueRecords.filter((r) => {
      const rec = r as any;
      const dateOk = selectedDate === 'All' || String(rec.overdue_date || '').startsWith(selectedDate);
      if (!dateOk) return false;
      if (!q) return true;
      return [rec.account_no, rec.full_name, rec.email_address, rec.contact_number, rec.plan, rec.address]
        .some((f) => String(f || '').toLowerCase().includes(q));
    });
  }, [overdueRecords, selectedDate, searchQuery]);

  const renderCell = (item: Overdue, key: string) => {
    const v = (item as any)[key];
    if (key === 'overdue_date') return formatDate(v);
    return v ?? '';
  };

  const handleExport = () => {
    if (filtered.length === 0) return;
    exportToCSV('overdue_records', allColumns, filtered, renderCell);
  };

  const renderItem = ({ item }: { item: Overdue }) => {
    const r = item as any;
    return (
      <View style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
            {r.full_name || 'Unknown'}
          </Text>
          {!!r.overdue_date && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#fee2e2' }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#b91c1c' }}>{formatDate(r.overdue_date)}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
          {!!r.account_no && <Field label="Acct" value={String(r.account_no)} />}
          {!!r.plan && <Field label="Plan" value={String(r.plan)} />}
          {!!r.contact_number && <Field label="Contact" value={String(r.contact_number)} />}
        </View>
        {!!r.email_address && <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{r.email_address}</Text>}
        {!!r.address && <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }} numberOfLines={1}>{r.address}</Text>}
      </View>
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
          <GlobalSearch searchQuery={searchQuery} setSearchQuery={setSearchQuery} isDarkMode={isDarkMode} colorPalette={colorPalette} placeholder="Search Overdue" />
          <TouchableOpacity onPress={handleExport} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
            <Download size={16} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => fetchOverdueRecords(true)} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
            {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, marginRight: 12, height: 40, justifyContent: 'center' }}>
            <Picker selectedValue={selectedDate} onValueChange={(v) => setSelectedDate(v)} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              <Picker.Item label="All Overdue Dates" value="All" />
              {distinctDates.map((d) => (
                <Picker.Item key={d} label={formatDate(d)} value={d} />
              ))}
            </Picker>
          </View>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            {filtered.length}{totalCount ? ` / ${totalCount}` : ''}
          </Text>
        </View>
      </View>

      {/* Body */}
      {isLoading && overdueRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading overdue records...</Text>
        </View>
      ) : error && overdueRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={() => fetchOverdueRecords(true)} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, idx) => String((item as any).id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No overdue records found</Text>
            </View>
          }
          ListFooterComponent={
            isLoading && overdueRecords.length > 0 ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={primaryColor} />
                <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Loading more...</Text>
              </View>
            ) : null
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

export default OverduePage;

import React, { useState, useEffect, useMemo } from 'react';
import { View, Text } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { StandardPage, RecordCard } from '../components/common';
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

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

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

  // A narrowed list can be shorter than the page the reader is on.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate]);

  return (
    <StandardPage<Overdue>
      data={filtered}
      keyExtractor={(item, idx) => String((item as any).id ?? idx)}
      renderItem={(item) => {
        const r = item as any;
        return (
          <RecordCard
            title={r.full_name || 'Unknown'}
            subtitle={[
              r.account_no ? `Acct: ${r.account_no}` : null,
              r.plan ? `Plan: ${r.plan}` : null,
              r.contact_number ? `Contact: ${r.contact_number}` : null,
            ].filter(Boolean).join('  |  ')}
            showStatus={false}
            right={
              r.overdue_date ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#fee2e2' }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#b91c1c' }}>{formatDate(r.overdue_date)}</Text>
                </View>
              ) : undefined
            }
          >
            {!!r.email_address && <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{r.email_address}</Text>}
            {!!r.address && (
              <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }} numberOfLines={1}>
                {r.address}
              </Text>
            )}
          </RecordCard>
        );
      }}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search Overdue"
      onExport={handleExport}
      exportDisabled={filtered.length === 0}
      onRefresh={() => fetchOverdueRecords(true)}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading && overdueRecords.length === 0}
      loadingText="Loading overdue records..."
      error={error}
      onRetry={() => fetchOverdueRecords(true)}
      emptyText="No overdue records found"
      // The store keeps pulling pages in the background; say so rather than
      // leaving a spinner pinned to the bottom of the list.
      progressText={isLoading && overdueRecords.length > 0 ? `Loading more records... (${overdueRecords.length}${totalCount ? `/${totalCount}` : ''})` : null}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={setItemsPerPage}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      header={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: '#ffffff',
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}
        >
          <View
            style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 6,
              overflow: 'hidden',
              flex: 1,
              marginRight: 12,
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
              <Picker.Item label="All Overdue Dates" value="All" />
              {distinctDates.map((d) => (
                <Picker.Item key={d} label={formatDate(d)} value={d} />
              ))}
            </Picker>
          </View>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            {filtered.length}
            {totalCount ? ` / ${totalCount}` : ''}
          </Text>
        </View>
      }
    />
  );
};

export default OverduePage;

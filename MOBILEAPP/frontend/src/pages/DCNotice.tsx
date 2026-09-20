import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Dimensions, Alert } from 'react-native';
import { Calendar, ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { StandardPage, RecordCard } from '../components/common';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useDCNoticeContext } from '../contexts/DCNoticeContext';
import { DCNotice } from '../services/dcNoticeService';
import { exportToCSV } from '../utils/exportUtils';

const allColumns = [
  { key: 'id', label: 'ID' },
  { key: 'account_no', label: 'Account No' },
  { key: 'full_name', label: 'Customer Name' },
  { key: 'dc_notice_date', label: 'DC Notice Date' },
  { key: 'invoice_id', label: 'Invoice ID' },
  { key: 'plan', label: 'Plan' },
  { key: 'contact_number', label: 'Contact' },
  { key: 'email_address', label: 'Email' },
  { key: 'address', label: 'Address' },
];

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return '-';
  }
};

const renderCellValue = (record: DCNotice, columnKey: string): string => {
  switch (columnKey) {
    case 'id': return String(record.id);
    case 'account_no': return record.account_no || '-';
    case 'full_name': return record.full_name || '-';
    case 'dc_notice_date': return formatDate(record.dc_notice_date);
    case 'invoice_id': return record.invoice_id != null ? String(record.invoice_id) : '-';
    case 'plan': return record.plan || '-';
    case 'contact_number': return record.contact_number || '-';
    case 'email_address': return record.email_address || '-';
    case 'address': return record.address || '-';
    default: return '-';
  }
};

const DCNoticePage: React.FC = () => {
  // Forced light mode
  const isDarkMode = false;

  const { dcNoticeRecords, isLoading, error, refreshDCNoticeRecords, silentRefresh, isFullyLoaded } = useDCNoticeContext();

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState(false);

  // Date filter
  const [selectedDate, setSelectedDate] = useState<string>('All');
  const [dcNoticeDateFrom, setDcNoticeDateFrom] = useState('');
  const [dcNoticeDateTo, setDcNoticeDateTo] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showDateList, setShowDateList] = useState(true);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  // Silent refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      silentRefresh().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [silentRefresh]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedDate, itemsPerPage, dcNoticeDateFrom, dcNoticeDateTo]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshDCNoticeRecords();
    setRefreshing(false);
  };

  const handleManualRefresh = async () => {
    setIsRefreshingManual(true);
    try {
      await silentRefresh();
    } finally {
      setIsRefreshingManual(false);
    }
  };

  // Filtered records (global — for date sidebar counts)
  const globalFilteredRecords = useMemo(() => {
    let filtered = dcNoticeRecords as DCNotice[];

    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      filtered = filtered.filter((record) => {
        const searchableText = [
          record.id,
          record.account_no,
          record.full_name,
          record.invoice_id,
          record.plan,
          record.contact_number,
          record.email_address,
          record.address,
          record.dc_notice_date,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchableText.includes(normalizedQuery);
      });
    }

    if (dcNoticeDateFrom || dcNoticeDateTo) {
      filtered = filtered.filter((record) => {
        if (!record.dc_notice_date) return false;
        const dateValue = new Date(record.dc_notice_date).getTime();
        if (isNaN(dateValue)) return false;
        if (dcNoticeDateFrom) {
          const fromDate = new Date(dcNoticeDateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (dateValue < fromDate.getTime()) return false;
        }
        if (dcNoticeDateTo) {
          const toDate = new Date(dcNoticeDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (dateValue > toDate.getTime()) return false;
        }
        return true;
      });
    }

    return filtered;
  }, [dcNoticeRecords, searchQuery, dcNoticeDateFrom, dcNoticeDateTo]);

  // Derive distinct dates with counts
  const dateItems = useMemo(() => {
    const dateCounts: Record<string, number> = {};
    const dates = new Map<string, string>();

    globalFilteredRecords.forEach((record) => {
      if (record.dc_notice_date) {
        const date = new Date(record.dc_notice_date);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        const formatted = `${mm}/${dd}/${yyyy}`;
        dateCounts[formatted] = (dateCounts[formatted] || 0) + 1;
        dates.set(formatted, record.dc_notice_date);
      }
    });

    const sortedDates = Array.from(dates.entries())
      .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
      .map(([formatted]) => ({ date: formatted, count: dateCounts[formatted] }));

    return { all: globalFilteredRecords.length, dates: sortedDates };
  }, [globalFilteredRecords]);

  // Final filtered + sorted records
  const filteredRecords = useMemo(() => {
    return globalFilteredRecords.filter((record) => {
      if (selectedDate === 'All') return true;
      if (!record.dc_notice_date) return false;
      return formatDate(record.dc_notice_date) === selectedDate;
    });
  }, [globalFilteredRecords, selectedDate]);

  // Paginated slice
  const handleExport = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;
    exportToCSV('dc_notice_export', allColumns, filteredRecords, renderCellValue);
  };

  const handleClearDateRange = () => {
    setDcNoticeDateFrom('');
    setDcNoticeDateTo('');
  };

  const renderItem = ({ item }: { item: DCNotice }) => {
    const r = item as any;
    return (
      <View
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        {/* Name + Date row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text
            style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 }}
            numberOfLines={1}
          >
            {r.full_name || 'Unknown'}
          </Text>
          {!!r.dc_notice_date && (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: '#ede9fe',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: primaryColor }}>
                {formatDate(r.dc_notice_date)}
              </Text>
            </View>
          )}
        </View>

        {/* Fields row */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
          {!!r.account_no && <FieldChip label="Acct" value={String(r.account_no)} />}
          {!!r.invoice_id && <FieldChip label="Invoice" value={String(r.invoice_id)} />}
          {!!r.plan && <FieldChip label="Plan" value={String(r.plan)} />}
          {!!r.contact_number && <FieldChip label="Contact" value={String(r.contact_number)} />}
        </View>

        {!!r.email_address && (
          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{r.email_address}</Text>
        )}
        {!!r.address && (
          <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }} numberOfLines={1}>
            {r.address}
          </Text>
        )}
      </View>
    );
  };

  // Filter modal content
  const FilterModal = () => (
    <Modal
      visible={showFilterModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowFilterModal(false)}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            backgroundColor: '#ffffff',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: 32,
            maxHeight: '85%',
          }}
        >
          {/* Modal header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>Filter DC Notices</Text>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ paddingHorizontal: 16 }}>
            {/* Date range filter */}
            <View style={{ marginTop: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  DC Notice Date Range
                </Text>
                {(dcNoticeDateFrom || dcNoticeDateTo) && (
                  <TouchableOpacity onPress={handleClearDateRange}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: primaryColor, textTransform: 'uppercase' }}>
                      Clear
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>From (YYYY-MM-DD)</Text>
              <TextInput
                value={dcNoticeDateFrom}
                onChangeText={setDcNoticeDateFrom}
                placeholder="e.g. 2024-01-01"
                placeholderTextColor="#9ca3af"
                style={{
                  borderWidth: 1,
                  borderColor: dcNoticeDateFrom ? primaryColor : '#d1d5db',
                  borderRadius: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  fontSize: 13,
                  color: '#111827',
                  marginBottom: 10,
                }}
              />

              <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>To (YYYY-MM-DD)</Text>
              <TextInput
                value={dcNoticeDateTo}
                onChangeText={setDcNoticeDateTo}
                placeholder="e.g. 2024-12-31"
                placeholderTextColor="#9ca3af"
                style={{
                  borderWidth: 1,
                  borderColor: dcNoticeDateTo ? primaryColor : '#d1d5db',
                  borderRadius: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  fontSize: 13,
                  color: '#111827',
                  marginBottom: 16,
                }}
              />
            </View>

            {/* All records button */}
            <TouchableOpacity
              onPress={() => { setSelectedDate('All'); setShowFilterModal(false); }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: selectedDate === 'All' ? `${primaryColor}1a` : '#f9fafb',
                marginBottom: 6,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: selectedDate === 'All' ? primaryColor : '#374151' }}>
                All Records
              </Text>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 12,
                  backgroundColor: selectedDate === 'All' ? primaryColor : '#e5e7eb',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: selectedDate === 'All' ? '#ffffff' : '#6b7280' }}>
                  {dateItems.all}
                </Text>
              </View>
            </TouchableOpacity>

            {/* DC Notice dates list */}
            <TouchableOpacity
              onPress={() => setShowDateList(!showDateList)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 10,
                paddingHorizontal: 4,
                marginBottom: 4,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151' }}>
                DC Notice Month ({dateItems.dates.length})
              </Text>
              {showDateList
                ? <ChevronUp size={16} color="#6b7280" />
                : <ChevronDown size={16} color="#6b7280" />
              }
            </TouchableOpacity>

            {showDateList && dateItems.dates.map((item, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => { setSelectedDate(item.date); setShowFilterModal(false); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: selectedDate === item.date ? `${primaryColor}1a` : 'transparent',
                  marginBottom: 2,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Calendar size={14} color={selectedDate === item.date ? primaryColor : '#9ca3af'} style={{ marginRight: 8 }} />
                  <Text style={{ fontSize: 13, color: selectedDate === item.date ? primaryColor : '#374151' }}>
                    {item.date}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                    borderRadius: 10,
                    backgroundColor: selectedDate === item.date ? primaryColor : '#e5e7eb',
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: selectedDate === item.date ? '#ffffff' : '#6b7280' }}>
                    {item.count}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            <View style={{ height: 16 }} />
          </ScrollView>

          <TouchableOpacity
            onPress={() => setShowFilterModal(false)}
            style={{
              marginHorizontal: 16,
              marginTop: 8,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: primaryColor,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 14 }}>Apply Filter</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // Active filter indicator text
  const activeFilterLabel = selectedDate !== 'All'
    ? selectedDate
    : (dcNoticeDateFrom || dcNoticeDateTo)
      ? `${dcNoticeDateFrom || '...'} → ${dcNoticeDateTo || '...'}`
      : null;

  return (
    <StandardPage<DCNotice>
      data={filteredRecords}
      keyExtractor={(item, idx) => String((item as any).id ?? idx)}
      renderItem={(item) => {
        const r = item as any;
        return (
          <RecordCard
            title={r.full_name || 'Unknown'}
            subtitle={[
              r.account_no ? `Acct: ${r.account_no}` : null,
              r.invoice_id ? `Invoice: ${r.invoice_id}` : null,
              r.plan ? `Plan: ${r.plan}` : null,
              r.contact_number ? `Contact: ${r.contact_number}` : null,
            ].filter(Boolean).join('  |  ')}
            showStatus={false}
            right={
              r.dc_notice_date ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: '#ede9fe' }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: primaryColor }}>
                    {formatDate(r.dc_notice_date)}
                  </Text>
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
      searchPlaceholder="Search DC Notice records..."
      // The date filter keeps its own bottom sheet; the standard funnel button
      // is what opens it, and the badge says whether it is narrowing anything.
      onOpenFunnel={() => setShowFilterModal(true)}
      activeFilterCount={activeFilterLabel ? 1 : 0}
      rangeChip={
        activeFilterLabel
          ? {
              label: 'Dates',
              value: activeFilterLabel,
              onClear: () => { setSelectedDate('All'); handleClearDateRange(); },
            }
          : null
      }
      onExport={handleExport}
      exportDisabled={filteredRecords.length === 0}
      onRefresh={handleManualRefresh}
      isRefreshing={isLoading || isRefreshingManual}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading && dcNoticeRecords.length === 0}
      loadingText="Loading DC Notice records..."
      error={error}
      onRetry={handleManualRefresh}
      emptyText="No DC Notice records found"
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={setItemsPerPage}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
    >
      <FilterModal />
    </StandardPage>
  );
};

const FieldChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

export default DCNoticePage;

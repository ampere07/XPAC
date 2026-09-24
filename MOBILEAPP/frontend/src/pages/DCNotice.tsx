import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Calendar, ChevronDown, ChevronUp, Download, RefreshCw, X } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
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
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRecords, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);

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
        {/* Title + action buttons */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>DC Notice</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={handleExport}
              disabled={filteredRecords.length === 0}
              style={{
                padding: 9,
                borderRadius: 8,
                backgroundColor: primaryColor,
                opacity: filteredRecords.length === 0 ? 0.4 : 1,
              }}
            >
              <Download size={16} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleManualRefresh}
              disabled={isLoading || isRefreshingManual}
              style={{
                padding: 9,
                borderRadius: 8,
                backgroundColor: primaryColor,
                opacity: (isLoading || isRefreshingManual) ? 0.4 : 1,
              }}
            >
              {(isLoading || isRefreshingManual) ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <RefreshCw size={16} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search DC Notice records..."
        />

        {/* Filter row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setShowFilterModal(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: activeFilterLabel ? primaryColor : '#d1d5db',
              backgroundColor: activeFilterLabel ? `${primaryColor}1a` : '#f9fafb',
            }}
          >
            <Calendar size={14} color={activeFilterLabel ? primaryColor : '#6b7280'} />
            <Text style={{ fontSize: 12, color: activeFilterLabel ? primaryColor : '#6b7280', fontWeight: activeFilterLabel ? '600' : '400' }}>
              {activeFilterLabel || 'All Dates'}
            </Text>
            {activeFilterLabel ? (
              <TouchableOpacity
                onPress={() => { setSelectedDate('All'); handleClearDateRange(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={12} color={primaryColor} />
              </TouchableOpacity>
            ) : (
              <ChevronDown size={14} color="#6b7280" />
            )}
          </TouchableOpacity>

          <Text style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
            {filteredRecords.length} records
          </Text>
        </View>
      </View>

      {/* Body */}
      {isLoading && dcNoticeRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading DC Notice records...</Text>
        </View>
      ) : error && dcNoticeRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={handleManualRefresh}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedRecords}
          keyExtractor={(item, idx) => String((item as any).id ?? idx)}
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
              <Text style={{ color: '#6b7280' }}>No DC Notice records found</Text>
            </View>
          }
          ListFooterComponent={
            filteredRecords.length > 0 ? (
              <View
                style={{
                  backgroundColor: '#ffffff',
                  borderTopWidth: 1,
                  borderTopColor: '#e5e7eb',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  gap: 10,
                }}
              >
                {/* Page size + count info */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: '#d1d5db',
                        borderRadius: 6,
                        overflow: 'hidden',
                        height: 34,
                        justifyContent: 'center',
                        minWidth: 80,
                      }}
                    >
                      <Picker
                        selectedValue={itemsPerPage}
                        onValueChange={(v) => setItemsPerPage(Number(v))}
                        style={{ color: '#111827', height: 34 }}
                        dropdownIconColor="#6b7280"
                      >
                        <Picker.Item label="10" value={10} />
                        <Picker.Item label="25" value={25} />
                        <Picker.Item label="50" value={50} />
                        <Picker.Item label="100" value={100} />
                      </Picker>
                    </View>
                    <Text style={{ fontSize: 12, color: '#6b7280' }}>entries</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#6b7280' }}>
                    {filteredRecords.length === 0
                      ? '0'
                      : `${(currentPage - 1) * itemsPerPage + 1}–${Math.min(currentPage * itemsPerPage, filteredRecords.length)}`
                    } of {filteredRecords.length}
                  </Text>
                </View>

                {/* Prev / page indicator / Next */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    style={{ opacity: currentPage === 1 ? 0.3 : 1, paddingHorizontal: 8, paddingVertical: 6 }}
                  >
                    <Text style={{ fontSize: 18, color: primaryColor }}>{'«'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: currentPage === 1 ? '#f3f4f6' : primaryColor,
                      opacity: currentPage === 1 ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ color: currentPage === 1 ? '#9ca3af' : '#ffffff', fontWeight: '600' }}>Prev</Text>
                  </TouchableOpacity>

                  <Text style={{ fontSize: 13, color: '#374151' }}>
                    Page {currentPage} of {totalPages || 1}
                  </Text>

                  <TouchableOpacity
                    onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: (currentPage === totalPages || totalPages === 0) ? '#f3f4f6' : primaryColor,
                      opacity: (currentPage === totalPages || totalPages === 0) ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ color: (currentPage === totalPages || totalPages === 0) ? '#9ca3af' : '#ffffff', fontWeight: '600' }}>Next</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages || totalPages === 0}
                    style={{ opacity: (currentPage === totalPages || totalPages === 0) ? 0.3 : 1, paddingHorizontal: 8, paddingVertical: 6 }}
                  >
                    <Text style={{ fontSize: 18, color: primaryColor }}>{'»'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null
          }
        />
      )}

      <FilterModal />
    </View>
  );
};

const FieldChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

export default DCNoticePage;

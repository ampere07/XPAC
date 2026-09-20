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
  Switch,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RefreshCw,
  Columns3,
  Download,
  ArrowUp,
  ArrowDown,
  X,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { useTableColumns } from './globalfunctions/useTableColumns';
import { useDataLogsStore } from '../store/dataLogsStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { DataLogRecord } from '../services/dataLogsService';
import { exportToCSV } from '../utils/exportUtils';

const allColumns = [
  { key: 'log_type', label: 'Log Type' },
  { key: 'id', label: 'ID' },
  { key: 'old_details', label: 'Old Details' },
  { key: 'new_details', label: 'New Details' },
  { key: 'created_at', label: 'Created At' },
  { key: 'created_by', label: 'Created By' },
  { key: 'updated_at', label: 'Updated At' },
  { key: 'updated_by', label: 'Updated By' },
];

const LOG_TYPE_OPTIONS = [
  { label: 'All Log Types', value: 'all' },
  { label: 'Service Orders', value: 'service_order' },
  { label: 'JobOrders', value: 'job_order' },
  { label: 'Applications', value: 'application' },
  { label: 'Customer Details', value: 'customer_details' },
  { label: 'Billing Details', value: 'billing_details' },
  { label: 'Technical Details', value: 'technical_details' },
  { label: 'Other System Logs', value: 'other' },
];

const parseData = (v: any) => {
  if (!v) return {};
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return parsed.data || parsed;
  } catch (e) {
    return {};
  }
};

const formatValue = (v: any, row: DataLogRecord, keyName?: string, multiline?: boolean) => {
  if (v === null || v === undefined || v === '') return '(empty)';

  if (keyName && keyName.toLowerCase() === 'technicians') {
    const logType = row.log_type?.toLowerCase() || '';
    if (
      logType.includes('service order') ||
      logType.includes('jo order') ||
      logType.includes('job order') ||
      logType.includes('serviceorder') ||
      logType.includes('joborder')
    ) {
      let arr = v;
      if (typeof v === 'string' && v.startsWith('[') && v.endsWith(']')) {
        try {
          arr = JSON.parse(v);
        } catch (e) {
          /* noop */
        }
      }
      if (Array.isArray(arr)) {
        const filtered = arr.filter((t) => t !== 'None' && t !== null && t !== '');
        return filtered.length > 0 ? filtered.join(', ') : '(empty)';
      }
    }
  }

  if (typeof v === 'object') {
    try {
      if (multiline) return JSON.stringify(v, null, 2);
      return JSON.stringify(v).replace(/[{}"]/g, '').replace(/:/g, ': ').replace(/,/g, ', ');
    } catch (e) {
      return '[Complex Object]';
    }
  }
  return String(v);
};

const titleCaseKey = (k: string) =>
  k
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const DataLogs: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const { logRecords, isLoading, error, fetchLogRecords, refreshLogRecords } = useDataLogsStore();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [logTypeFilter, setLogTypeFilter] = useState<string>('all');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedCompareLog, setSelectedCompareLog] = useState<DataLogRecord | null>(null);
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [userOrgId, setUserOrgId] = useState<any>(null);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const {
    visibleColumns,
    displayedColumns,
    sortColumn,
    sortDirection,
    handleSort,
    handleToggleColumn,
    handleSelectAllColumns,
    handleDeselectAllColumns,
  } = useTableColumns({
    storageKeyPrefix: 'dataLogs',
    allColumns,
    defaultVisibleColumns: ['log_type', 'id', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    const loadOrgId = async () => {
      try {
        const authDataStr = await AsyncStorage.getItem('authData');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          const orgId =
            authData.organization_id ||
            authData.user?.organization_id ||
            authData.organization?.id ||
            authData.user?.organization?.id ||
            null;
          setUserOrgId(orgId);
        }
      } catch (e) {
        // ignore
      }
    };
    loadOrgId();
  }, []);

  // Load records on mount
  useEffect(() => {
    fetchLogRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchLogRecords(true).catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset pagination when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, logTypeFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshLogRecords();
    setRefreshing(false);
  };

  // Client-side instant live filtering
  const filteredLogs = useMemo(() => {
    let filtered = logRecords.filter((row) => {
      // Organization filter — mirrors web logic exactly
      if (userOrgId) {
        if ((row as any).organization_id !== userOrgId) return false;
      } else {
        if ((row as any).organization_id) return false;
      }
      // Filter by log type
      if (logTypeFilter !== 'all') {
        const rowType = String(row.log_type || '').toLowerCase();
        const filter = logTypeFilter.toLowerCase();

        if (filter === 'service_order' && !rowType.includes('service order') && !rowType.includes('serviceorders') && !rowType.includes('serviceorder')) return false;
        if (filter === 'job_order' && !rowType.includes('job order') && !rowType.includes('joborders') && !rowType.includes('joborder')) return false;
        if (filter === 'application' && !rowType.includes('application')) return false;
        if (filter === 'customer_details' && !rowType.includes('customer details')) return false;
        if (filter === 'billing_details' && !rowType.includes('billing details')) return false;
        if (filter === 'technical_details' && !rowType.includes('technical details')) return false;
        if (filter === 'other' && (
          rowType.includes('service order') || rowType.includes('serviceorders') || rowType.includes('serviceorder') ||
          rowType.includes('job order') || rowType.includes('joborders') || rowType.includes('joborder') ||
          rowType.includes('application') ||
          rowType.includes('customer details') ||
          rowType.includes('billing details') ||
          rowType.includes('technical details')
        )) return false;
      }

      // Filter by search query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchType = String(row.log_type || '').toLowerCase().includes(q);
        const matchId = String(row.id || '').toLowerCase().includes(q);
        const matchCreatedBy = String(row.created_by || '').toLowerCase().includes(q);
        const matchUpdatedBy = String(row.updated_by || '').toLowerCase().includes(q);
        const matchOld = row.old_details ? row.old_details.toLowerCase().includes(q) : false;
        const matchNew = row.new_details ? row.new_details.toLowerCase().includes(q) : false;
        return matchType || matchId || matchCreatedBy || matchUpdatedBy || matchOld || matchNew;
      }

      return true;
    });

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const getVal = (t: any) => {
          switch (sortColumn) {
            case 'log_type': return t.log_type || '';
            case 'id': return t.id || '';
            case 'old_details': return typeof t.old_details === 'string' ? t.old_details : JSON.stringify(t.old_details || '');
            case 'new_details': return typeof t.new_details === 'string' ? t.new_details : JSON.stringify(t.new_details || '');
            case 'created_at': return t.created_at || '';
            case 'created_by': return t.created_by || '';
            case 'updated_at': return t.updated_at || '';
            case 'updated_by': return t.updated_by || '';
            default: return '';
          }
        };
        let aVal: any = getVal(a);
        let bVal: any = getVal(b);
        if (sortColumn === 'created_at' || sortColumn === 'updated_at') {
          aVal = aVal ? new Date(aVal).getTime() || 0 : 0;
          bVal = bVal ? new Date(bVal).getTime() || 0 : 0;
        } else {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [logRecords, logTypeFilter, searchQuery, userOrgId, sortColumn, sortDirection]);

  const handleExport = () => {
    if (!filteredLogs || filteredLogs.length === 0) return;

    const exportColumns = displayedColumns;
    const getExportValue = (record: DataLogRecord, columnKey: string) => {
      switch (columnKey) {
        case 'old_details':
          return record.old_details ? JSON.stringify(record.old_details) : '';
        case 'new_details':
          return record.new_details ? JSON.stringify(record.new_details) : '';
        default:
          return (record as any)[columnKey] || '';
      }
    };

    exportToCSV('data_logs_export', exportColumns, filteredLogs, getExportValue);
  };

  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLogs, currentPage, itemsPerPage]);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const renderDetailsSummary = (row: DataLogRecord) => {
    const oldData = parseData(row.old_details);
    const newData = parseData(row.new_details);
    const allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]))
      .filter((k) => k !== 'type')
      .sort();
    if (allKeys.length === 0) return null;

    const showNew = visibleColumns.includes('new_details');
    const showOld = visibleColumns.includes('old_details');
    if (!showNew && !showOld) return null;

    const source = showNew ? newData : oldData;

    return (
      <View style={{ marginTop: 8, gap: 2 }}>
        {allKeys.slice(0, 6).map((k) => (
          <Text key={k} style={{ fontSize: 11, color: '#374151' }} numberOfLines={2}>
            <Text style={{ fontWeight: '600', color: '#6b7280' }}>{titleCaseKey(k)}: </Text>
            {formatValue(source[k], row, k)}
          </Text>
        ))}
        {allKeys.length > 6 && (
          <Text style={{ fontSize: 11, color: '#9ca3af' }}>+{allKeys.length - 6} more fields</Text>
        )}
      </View>
    );
  };

  const renderItem = ({ item }: { item: DataLogRecord }) => {
    const show = (key: string) => visibleColumns.includes(key);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setSelectedCompareLog(item)}
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          {show('log_type') && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: primaryColor }}>
              <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: '#ffffff', textTransform: 'uppercase' }}>
                {item.log_type}
              </Text>
            </View>
          )}
          {show('id') && (
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#6b7280' }}>ID: {item.id}</Text>
          )}
        </View>

        {renderDetailsSummary(item)}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {show('created_at') && !!item.created_at && <Field label="Created" value={item.created_at} />}
          {show('created_by') && !!item.created_by && <Field label="By" value={item.created_by} />}
          {show('updated_at') && !!item.updated_at && <Field label="Updated" value={item.updated_at} />}
          {show('updated_by') && !!item.updated_by && <Field label="By" value={item.updated_by} />}
        </View>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', letterSpacing: 0.5, color: '#111827', textTransform: 'uppercase' }}>
            Data Logs
          </Text>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>{filteredLogs.length}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search data logs..."
          />
          <TouchableOpacity
            onPress={() => setColumnsModalOpen(true)}
            style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}
          >
            <Columns3 size={16} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleExport}
            disabled={isLoading || filteredLogs.length === 0}
            style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', opacity: isLoading || filteredLogs.length === 0 ? 0.5 : 1 }}
          >
            <Download size={16} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => refreshLogRecords()}
            disabled={isLoading}
            style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: primaryColor, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', opacity: isLoading ? 0.5 : 1 }}
          >
            {isLoading ? <ActivityIndicator size="small" color={primaryColor} /> : <RefreshCw size={16} color={primaryColor} />}
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ borderWidth: 1, borderColor: logTypeFilter !== 'all' ? '#ef4444' : '#d1d5db', borderRadius: 6, overflow: 'hidden', flex: 1, height: 40, justifyContent: 'center' }}>
            <Picker
              selectedValue={logTypeFilter}
              onValueChange={(v) => setLogTypeFilter(String(v))}
              style={{ color: logTypeFilter !== 'all' ? '#ef4444' : '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {LOG_TYPE_OPTIONS.map((opt) => (
                <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
              ))}
            </Picker>
          </View>
          {/* Sort control */}
          <TouchableOpacity
            onPress={() => handleSort(sortColumn || 'created_at')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 40, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff' }}
          >
            <Text style={{ fontSize: 12, color: '#374151' }}>
              {sortColumn ? (allColumns.find((c) => c.key === sortColumn)?.label || sortColumn) : 'Sort'}
            </Text>
            {sortColumn ? (sortDirection === 'asc' ? <ArrowUp size={14} color="#374151" /> : <ArrowDown size={14} color="#374151" />) : null}
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      {isLoading && logRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading consolidated logs...</Text>
        </View>
      ) : error && logRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={() => refreshLogRecords()} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedLogs}
          keyExtractor={(item) => `${item.log_type}-${item.id}`}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No data logs found matching your filters</Text>
            </View>
          }
          ListFooterComponent={
            filteredLogs.length > 0 ? (
              <PaginationFooter
                currentPage={currentPage}
                totalPages={totalPages}
                itemsPerPage={itemsPerPage}
                totalResults={filteredLogs.length}
                primaryColor={primaryColor}
                setCurrentPage={setCurrentPage}
                setItemsPerPage={(n) => {
                  setItemsPerPage(n);
                  setCurrentPage(1);
                }}
              />
            ) : null
          }
        />
      )}

      {/* Column Visibility Modal */}
      <Modal visible={columnsModalOpen} transparent animationType="fade" onRequestClose={() => setColumnsModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '80%', overflow: 'hidden' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>Column Visibility</Text>
              <TouchableOpacity onPress={() => setColumnsModalOpen(false)}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              <TouchableOpacity onPress={handleSelectAllColumns}>
                <Text style={{ fontSize: 13, color: primaryColor, fontWeight: '600' }}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeselectAllColumns}>
                <Text style={{ fontSize: 13, color: primaryColor, fontWeight: '600' }}>Deselect All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {allColumns.map((column) => (
                <View
                  key={column.key}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}
                >
                  <Text style={{ fontSize: 14, color: '#111827' }}>{column.label}</Text>
                  <Switch
                    value={visibleColumns.includes(column.key)}
                    onValueChange={() => handleToggleColumn(column.key)}
                    trackColor={{ true: primaryColor, false: '#d1d5db' }}
                    thumbColor="#ffffff"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Comparison Modal */}
      {selectedCompareLog && (
        <DetailsCompareModal
          row={selectedCompareLog}
          onClose={() => setSelectedCompareLog(null)}
          colorPalette={colorPalette}
        />
      )}
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280', maxWidth: 220 }} numberOfLines={1}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

interface PaginationFooterProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalResults: number;
  primaryColor: string;
  setCurrentPage: (n: number | ((p: number) => number)) => void;
  setItemsPerPage: (n: number) => void;
}

const PaginationFooter: React.FC<PaginationFooterProps> = ({
  currentPage,
  totalPages,
  itemsPerPage,
  totalResults,
  primaryColor,
  setCurrentPage,
  setItemsPerPage,
}) => {
  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalResults);

  const navBtn = (label: string, onPress: () => void, disabled: boolean) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#d1d5db',
        backgroundColor: '#ffffff',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontSize: 13, color: '#374151' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#ffffff', gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
          <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', width: 90, height: 36, justifyContent: 'center' }}>
            <Picker selectedValue={itemsPerPage} onValueChange={(v) => setItemsPerPage(Number(v))} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
              {[10, 25, 50, 100].map((v) => (
                <Picker.Item key={v} label={String(v)} value={v} />
              ))}
            </Picker>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>
          {start} to {end} of {totalResults}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        {navBtn('« First', () => setCurrentPage(1), currentPage === 1)}
        {navBtn('‹ Prev', () => setCurrentPage((p) => Math.max(p - 1, 1)), currentPage === 1)}
        <Text style={{ fontSize: 13, color: '#111827', paddingHorizontal: 4 }}>
          Page {currentPage} of {totalPages}
        </Text>
        {navBtn('Next ›', () => setCurrentPage((p) => Math.min(p + 1, totalPages)), currentPage === totalPages)}
        {navBtn('Last »', () => setCurrentPage(totalPages), currentPage === totalPages)}
      </View>
    </View>
  );
};

interface DetailsCompareModalProps {
  row: DataLogRecord;
  onClose: () => void;
  colorPalette: ColorPalette | null;
}

const DetailsCompareModal: React.FC<DetailsCompareModalProps> = ({ row, onClose, colorPalette }) => {
  const oldData = parseData(row.old_details);
  const newData = parseData(row.new_details);

  const allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]))
    .filter((k) => k !== 'type')
    .sort();

  const primaryColor = colorPalette?.primary || '#7c3aed';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 12 }}>
        <View style={{ backgroundColor: '#ffffff', borderRadius: 16, maxHeight: '90%', overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb' }}>
          {/* Header */}
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', backgroundColor: '#f9fafb' }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: primaryColor }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: '#ffffff', textTransform: 'uppercase' }}>
                      {row.log_type}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#6b7280' }}>ID: {row.id}</Text>
                </View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', marginTop: 6 }}>Data Log Comparison</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Metadata */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            <MetaItem label="Created At" value={row.created_at || '-'} />
            <MetaItem label="Created By" value={row.created_by || '-'} />
            <MetaItem label="Updated At" value={row.updated_at || '-'} />
            <MetaItem label="Updated By" value={row.updated_by || '-'} />
          </View>

          {/* Body */}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 16 }}>
            {allKeys.length === 0 ? (
              <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#6b7280' }}>No details available for comparison.</Text>
              </View>
            ) : (
              <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                {/* Header row */}
                <View style={{ flexDirection: 'row', backgroundColor: '#f3f4f6', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                  <Text style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: '#475569', textTransform: 'uppercase' }}>Field</Text>
                  <Text style={{ flex: 1.3, paddingHorizontal: 10, paddingVertical: 8, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: '#475569', textTransform: 'uppercase' }}>Old</Text>
                  <Text style={{ flex: 1.3, paddingHorizontal: 10, paddingVertical: 8, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: '#475569', textTransform: 'uppercase' }}>New</Text>
                </View>
                {allKeys.map((k) => {
                  const oldVal = oldData[k];
                  const newVal = newData[k];
                  const isChanged = oldVal !== newVal;
                  return (
                    <View
                      key={k}
                      style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', backgroundColor: isChanged ? '#fff7ed' : '#ffffff' }}
                    >
                      <Text style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 11, fontWeight: '600', color: '#374151' }}>
                        {titleCaseKey(k)}
                      </Text>
                      <Text style={{ flex: 1.3, paddingHorizontal: 10, paddingVertical: 8, fontSize: 11, color: isChanged ? '#b91c1c' : '#475569', backgroundColor: isChanged ? '#fef2f2' : 'transparent' }}>
                        {formatValue(oldVal, row, k, true)}
                      </Text>
                      <Text style={{ flex: 1.3, paddingHorizontal: 10, paddingVertical: 8, fontSize: 11, color: isChanged ? '#15803d' : '#475569', backgroundColor: isChanged ? '#f0fdf4' : 'transparent' }}>
                        {formatValue(newVal, row, k, true)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const MetaItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ minWidth: 130 }}>
    <Text style={{ fontSize: 11, fontWeight: '500', color: '#9ca3af' }}>{label}</Text>
    <Text style={{ fontSize: 12, fontWeight: '600', color: '#111827' }} numberOfLines={1}>{value}</Text>
  </View>
);

export default DataLogs;

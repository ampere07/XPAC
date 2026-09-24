import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Linking,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  RefreshCw,
  X,
  FileText,
  Plus,
  DownloadCloud,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AddReportModal from '../modals/AddReportModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportData {
  id: number;
  report_name: string;
  report_type: string;
  report_schedule: string;
  report_time: string;
  day: string;
  send_to: string;
  date_range: string;
  created_by: string;
  created_at: string;
  file_url?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (d?: string | null) => {
  if (!d) return '—';
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hh = String(hours).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
  } catch {
    return d;
  }
};

const formatTime = (raw?: string | null): string => {
  if (!raw) return '—';
  try {
    const [h, m] = String(raw).split(':');
    let hours = parseInt(h, 10);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${m} ${ampm} GMT+8`;
  } catch {
    return String(raw);
  }
};

// ─── Role Guard Helper ────────────────────────────────────────────────────────

const checkReportsAccess = (user: any): boolean => {
  try {
    if (!user) return false;
    const roleId = String(user.role_id ?? '');
    const role = (user.role ?? '').toLowerCase().trim();
    return roleId === '1' || roleId === '7' || role === 'administrator' || role === 'superadmin';
  } catch {
    return false;
  }
};

// ─── Main Component ───────────────────────────────────────────────────────────

const Reports: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Data
  const [rows, setRows] = useState<ReportData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const primary = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  // ── Color palette ───────────────────────────────────────────────────────────

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then((p) => setColorPalette(p))
      .catch(() => {});
  }, []);

  // ── Access check (AsyncStorage is async) ────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const authDataStr = await AsyncStorage.getItem('authData');
        const user = authDataStr ? JSON.parse(authDataStr) : null;
        setAccessDenied(!checkReportsAccess(user));
      } catch {
        setAccessDenied(true);
      } finally {
        setAccessChecked(true);
      }
    })();
  }, []);

  // ── Fetch data ───────────────────────────────────────────────────────────────

  const fetchReports = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setIsLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: ReportData[] }>('/reports');
      if (res.data.success && Array.isArray(res.data.data)) {
        setRows(res.data.data);
      }
      setCurrentPage(1);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (accessChecked && !accessDenied) fetchReports();
  }, [accessChecked, accessDenied]);

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    if (accessDenied) return;
    const intervalId = setInterval(() => {
      fetchReports(true).catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [accessDenied]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchReports(true);
  };

  // ── Derived Data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let f = [...rows];

    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      f = f.filter(
        (r) =>
          r.report_name?.toLowerCase().includes(lower) ||
          r.report_type?.toLowerCase().includes(lower) ||
          r.send_to?.toLowerCase().includes(lower)
      );
    }

    // Sort by created_at desc (default)
    f.sort((a, b) => {
      const va = a.created_at || '';
      const vb = b.created_at || '';
      return vb.localeCompare(va);
    });

    return f;
  }, [rows, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [itemsPerPage, searchQuery]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleDownload = (url?: string) => {
    if (!url) return;
    Linking.openURL(url).catch((err) => console.error('Failed to open URL:', err));
  };

  // ── Access guard ────────────────────────────────────────────────────────────

  if (accessChecked && accessDenied) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View
          style={{
            alignItems: 'center',
            gap: 16,
            padding: 32,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: '#e5e7eb',
            backgroundColor: '#ffffff',
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#ef444420',
            }}
          >
            <X size={32} color="#ef4444" strokeWidth={2.5} />
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 }}>Access Denied</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
              You do not have permission to view the reports page.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Card row ──────────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ReportData }) => (
    <View
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
          {item.report_name || 'Untitled Report'}
        </Text>
        {!!item.report_type && (
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: `${primary}20` }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: primary }}>{item.report_type}</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        <Field label="ID" value={String(item.id)} />
        {!!item.report_schedule && <Field label="Schedule" value={item.report_schedule} />}
        {!!item.day && <Field label="Day" value={String(item.day)} />}
        {!!item.report_time && <Field label="Time" value={formatTime(item.report_time)} />}
      </View>

      {!!item.send_to && (
        <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          <Text style={{ fontWeight: '600' }}>Send To: </Text>
          {item.send_to}
        </Text>
      )}
      {!!item.date_range && (
        <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          <Text style={{ fontWeight: '600' }}>Date Range: </Text>
          {item.date_range}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ fontSize: 11, color: '#9ca3af' }}>
          {item.created_by ? `${item.created_by} · ` : ''}
          {formatDate(item.created_at)}
        </Text>
        {item.file_url ? (
          <TouchableOpacity
            onPress={() => handleDownload(item.file_url)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <DownloadCloud size={14} color={primary} />
            <Text style={{ fontSize: 11, fontWeight: '500', color: '#374151' }}>Download</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ fontSize: 11, fontStyle: 'italic', color: '#9ca3af' }}>No file</Text>
        )}
      </View>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FileText size={20} color={primary} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Reports</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 11, fontWeight: '500', color: '#6b7280' }}>{filtered.length} records</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => setIsAddModalOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: primary,
            }}
          >
            <Plus size={14} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Add</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search reports…"
          />
          <TouchableOpacity
            onPress={() => fetchReports(true)}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}
          >
            {refreshing || isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <RefreshCw size={16} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      {isLoading && rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primary} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading reports…</Text>
        </View>
      ) : (
        <FlatList
          data={paginated}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          initialNumToRender={20}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center', gap: 8 }}>
              <FileText size={40} color="#9ca3af" />
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>No records found</Text>
              <Text style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', paddingHorizontal: 24 }}>
                {searchQuery ? 'Try adjusting your search query.' : 'No report data available. Tap "+ Add" to create one.'}
              </Text>
              {!!searchQuery && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={{ fontSize: 13, color: primary, textDecorationLine: 'underline' }}>Clear search</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && filtered.length > 0 && totalPages > 1 && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: '#e5e7eb',
            padding: 12,
            backgroundColor: '#ffffff',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
            <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 36, justifyContent: 'center' }}>
              <Picker
                selectedValue={itemsPerPage}
                onValueChange={(v) => setItemsPerPage(Number(v))}
                style={{ width: 90, color: '#111827' }}
                dropdownIconColor="#6b7280"
              >
                {[10, 25, 50, 100].map((v) => (
                  <Picker.Item key={v} label={String(v)} value={v} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PageBtn disabled={currentPage === 1} onPress={() => handlePageChange(1)} icon={<ChevronsLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />} />
            <PageBtn disabled={currentPage === 1} onPress={() => handlePageChange(currentPage - 1)} icon={<ChevronLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827', paddingHorizontal: 6 }}>
              Page {currentPage} of {totalPages}
            </Text>
            <PageBtn disabled={currentPage === totalPages} onPress={() => handlePageChange(currentPage + 1)} icon={<ChevronRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />} />
            <PageBtn disabled={currentPage === totalPages} onPress={() => handlePageChange(totalPages)} icon={<ChevronsRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />} />
          </View>
        </View>
      )}

      {/* Add Report Modal */}
      <AddReportModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSaved={() => fetchReports(true)}
      />
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text style={{ fontSize: 11, color: '#6b7280' }}>
    <Text style={{ fontWeight: '600' }}>{label}: </Text>
    {value}
  </Text>
);

const PageBtn: React.FC<{ disabled: boolean; onPress: () => void; icon: React.ReactNode }> = ({ disabled, onPress, icon }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={{
      padding: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: disabled ? '#e5e7eb' : '#d1d5db',
      backgroundColor: disabled ? '#f3f4f6' : '#ffffff',
    }}
  >
    {icon}
  </TouchableOpacity>
);

export default Reports;

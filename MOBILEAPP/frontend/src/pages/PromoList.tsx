import React, { useState, useEffect } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import apiClient from '../config/api';
import PromoFormModal from '../modals/PromoFormModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface Promo {
  id: number;
  name: string;
  promo_name?: string;
  description?: string;
  status?: string;
  organization_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

const PromoList: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [promos, setPromos] = useState<Promo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Promo | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: '',
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const showGlobalModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning',
    title: string,
    message: string,
    onConfirm?: () => void
  ) => {
    setGlobalModal({ isOpen: true, type, title, message, onConfirm });
  };

  const closeGlobalModal = () => {
    setGlobalModal((prev) => ({ ...prev, isOpen: false }));
  };

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
            authData.user?.organization?.id ||
            authData.user?.organization_id ||
            authData.organization?.id ||
            authData.organization_id ||
            null;
          setCurrentUserOrgId(orgId);
        }
      } catch (e) {
        // ignore
      }
    };
    loadOrgId();
  }, []);

  useEffect(() => {
    loadPromos();
  }, []);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000;
    const intervalId = setInterval(() => {
      loadPromos(true).catch((err) => console.error('Idle refresh failed:', err));
    }, IDLE_TIME_LIMIT);
    return () => clearInterval(intervalId);
  }, []);

  const loadPromos = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await apiClient.get('/promos');
      const data = response.data;
      if (data.success) {
        setPromos(data.data || []);
      } else {
        console.error('API returned error:', data.message);
        setPromos([]);
      }
    } catch (error) {
      console.error('Error loading promos:', error);
      setPromos([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPromos(true);
    setRefreshing(false);
  };

  const handleDelete = (promo: Promo) => {
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete "${promo.name}"?`,
      () => executeDelete(promo)
    );
  };

  const executeDelete = async (promo: Promo) => {
    closeGlobalModal();

    setDeletingItems((prev) => new Set(prev).add(promo.id));
    showGlobalModal('loading', 'Deleting Promo', `Permanently removing "${promo.name}" from database...`);

    try {
      const response = await apiClient.delete(`/promos/${promo.id}`);
      const data = response.data;

      if (data.success) {
        await loadPromos(true);
        showGlobalModal('success', 'Deleted', data.message || 'Promo deleted successfully');
      } else {
        showGlobalModal('error', 'Delete Failed', data.message || 'Failed to delete promo');
      }
    } catch (error: any) {
      console.error('Error deleting promo:', error);
      const msg = error?.response?.data?.message || error.message || 'Unknown error';
      showGlobalModal('error', 'Error', 'Failed to delete promo: ' + msg);
    } finally {
      setDeletingItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(promo.id);
        return newSet;
      });
    }
  };

  const handleEdit = (promo: Promo) => {
    setEditingPromo(promo);
    setShowAddPanel(true);
  };

  const handleAddNew = () => {
    setEditingPromo(null);
    setShowAddPanel(true);
  };

  const handleCloseModal = () => {
    setShowAddPanel(false);
    setEditingPromo(null);
  };

  const handleSaveModal = () => {
    loadPromos();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
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
    } catch (e) {
      return dateString;
    }
  };

  const filteredPromos = promos.filter((promo) => {
    const matchesOrg = currentUserOrgId ? promo.organization_id === currentUserOrgId : !promo.organization_id;
    if (!matchesOrg) return false;
    const query = searchQuery.toLowerCase();
    return promo.name.toLowerCase().includes(query) || (promo.status ? promo.status.toLowerCase().includes(query) : false);
  });

  const totalPages = Math.ceil(filteredPromos.length / itemsPerPage);
  const paginatedPromos = filteredPromos.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const statusColors = (status?: string) => {
    if (status === 'Active') return { bg: '#dcfce7', text: '#15803d' };
    if (status === 'Inactive') return { bg: '#fee2e2', text: '#b91c1c' };
    return { bg: '#dbeafe', text: '#1d4ed8' };
  };

  const renderListItem = ({ item: promo }: { item: Promo }) => {
    const sc = statusColors(promo.status);
    return (
      <TouchableOpacity
        onPress={() => handleEdit(promo)}
        activeOpacity={0.7}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          backgroundColor: '#ffffff',
        }}
      >
        <View style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, color: '#111827' }}>
              {promo.name}
            </Text>
            {!!promo.status && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: sc.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: sc.text }}>{promo.status}</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
            <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: '#9ca3af' }}>
              Created: {formatDate(promo.created_at)}
            </Text>
            <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: '#9ca3af' }}>
              Updated: {formatDate(promo.updated_at)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={() => handleEdit(promo)} style={{ padding: 8, borderRadius: 6 }}>
            <Edit2 size={18} color="#4b5563" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(promo)}
            disabled={deletingItems.has(promo.id)}
            style={{ padding: 8, borderRadius: 6, opacity: deletingItems.has(promo.id) ? 0.5 : 1 }}
          >
            {deletingItems.has(promo.id) ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Trash2 size={18} color="#ef4444" />
            )}
          </TouchableOpacity>
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
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search Promos"
        />
        <TouchableOpacity
          onPress={handleAddNew}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: primaryColor,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Plus size={16} color="#ffffff" />
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add Promo</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => loadPromos()}
          style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
        >
          {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading && promos.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : (
        <FlatList
          data={paginatedPromos}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderListItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No promos found</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && filteredPromos.length > 0 && totalPages > 1 && (
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

      <PromoFormModal
        isOpen={showAddPanel}
        onClose={handleCloseModal}
        onSave={handleSaveModal}
        editingPromo={editingPromo}
      />

      <LoadingModalGlobal
        isOpen={globalModal.isOpen}
        type={globalModal.type}
        title={globalModal.title}
        message={globalModal.message}
        onConfirm={globalModal.onConfirm || closeGlobalModal}
        onCancel={closeGlobalModal}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />
    </View>
  );
};

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

export default PromoList;

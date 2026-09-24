import React, { useState, useEffect, useRef } from 'react';
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
import EditNapModal from '../modals/EditNapModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useNapStore } from '../store/napStore';
import { NAP } from '../services/napService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface NapFormData {
  name: string;
}

const NapList: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NAP | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState<number>(50);

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

  const {
    napItems,
    isLoading,
    error,
    currentPage,
    totalCount,
    fetchNapItems,
    addNapItem,
    updateNapItem,
    deleteNapItem,
    searchQuery,
    setSearchQuery,
    refreshNapItems,
    silentRefresh,
  } = useNapStore();

  const totalPages = Math.ceil(totalCount / itemsPerPage);
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

  const closeGlobalModal = () => setGlobalModal((prev) => ({ ...prev, isOpen: false }));

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

  // Initial load
  useEffect(() => {
    refreshNapItems();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const intervalId = setInterval(() => {
      silentRefresh().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [silentRefresh]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      fetchNapItems(newPage, itemsPerPage, searchQuery);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchNapItems(1, itemsPerPage, query);
    }, 500);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNapItems(currentPage, itemsPerPage, searchQuery, true);
    setRefreshing(false);
  };

  const handleDelete = (item: NAP) => {
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete "${item.nap_name}"?`,
      () => executeDelete(item)
    );
  };

  const executeDelete = async (item: NAP) => {
    closeGlobalModal();
    setDeletingItems((prev) => new Set(prev).add(item.id));
    showGlobalModal('loading', 'Deleting', `Removing ${item.nap_name}...`);

    try {
      await deleteNapItem(item.id);
      showGlobalModal('success', 'Deleted', 'NAP item deleted successfully');
    } catch (error: any) {
      console.error('Error deleting NAP:', error);
      showGlobalModal('error', 'Error', error.response?.data?.message || error.message || 'Failed to delete NAP');
    } finally {
      setDeletingItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(item.id);
        return newSet;
      });
    }
  };

  const handleEdit = (item: NAP) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleSave = async (formData: NapFormData) => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      const currentUserEmail = authData ? JSON.parse(authData)?.email : 'system';
      if (editingItem) {
        await updateNapItem(editingItem.id, formData.name.trim(), currentUserEmail);
      } else {
        await addNapItem(formData.name.trim(), currentUserEmail);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      throw error;
    }
  };

  const filteredNapItems = napItems.filter((item) => {
    // RN NAP type has no organization_id; guard so org-scoping still works if the API returns it.
    const orgId = (item as any).organization_id;
    if (currentUserOrgId) return orgId === currentUserOrgId;
    return !orgId;
  });

  const renderListItem = ({ item }: { item: NAP }) => (
    <TouchableOpacity
      onPress={() => handleEdit(item)}
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
        <Text style={{ fontSize: 14, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, color: '#111827' }}>
          {item.nap_name}
        </Text>
        {!!item.created_at && (
          <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: '#9ca3af', marginTop: 4 }}>
            Created: {new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TouchableOpacity onPress={() => handleEdit(item)} style={{ padding: 8, borderRadius: 6 }}>
          <Edit2 size={18} color="#4b5563" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDelete(item)}
          disabled={deletingItems.has(item.id)}
          style={{ padding: 8, borderRadius: 6, opacity: deletingItems.has(item.id) ? 0.5 : 1 }}
        >
          {deletingItems.has(item.id) ? (
            <ActivityIndicator size="small" color="#ef4444" />
          ) : (
            <Trash2 size={18} color="#ef4444" />
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

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
          setSearchQuery={handleSearchChange}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search NAP"
        />
        <TouchableOpacity
          onPress={handleAddNew}
          style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Plus size={16} color="#ffffff" />
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add NAP</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => fetchNapItems(1, itemsPerPage, searchQuery)}
          style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
        >
          {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
        </TouchableOpacity>
      </View>

      {/* Body */}
      {isLoading && napItems.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={() => fetchNapItems(1, itemsPerPage, searchQuery)} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry Fetching</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredNapItems}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderListItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No NAP items found</Text>
              {!!searchQuery && <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>Try adjusting your search query</Text>}
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && !error && napItems.length > 0 && totalPages > 1 && (
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
                onValueChange={(v) => {
                  setItemsPerPage(Number(v));
                  fetchNapItems(1, Number(v), searchQuery);
                }}
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

      <EditNapModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        napItem={editingItem}
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

export default NapList;

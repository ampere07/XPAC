import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plus, Edit2, Trash2 } from 'lucide-react-native';
import EditNapModal from '../modals/EditNapModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useNapStore } from '../store/napStore';
import { NAP } from '../services/napService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { StandardPage, RecordCard } from '../components/common';

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

  const rowActions = (item: NAP) => (
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
  );

  return (
    <StandardPage<NAP>
      data={filteredNapItems}
      keyExtractor={(item) => String(item.id)}
      renderItem={(item) => (
        <RecordCard
          title={item.nap_name}
          // NAP names are identifiers, not people's names.
          normalizeTitle={false}
          titleStyle={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
          subtitle={
            item.created_at
              ? `Created: ${new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
              : undefined
          }
          showStatus={false}
          onPress={() => handleEdit(item)}
          disabled={deletingItems.has(item.id)}
          right={rowActions(item)}
        />
      )}
      searchQuery={searchQuery}
      onSearchChange={handleSearchChange}
      searchPlaceholder="Search NAP"
      isLoading={isLoading && napItems.length === 0}
      error={error}
      onRetry={() => fetchNapItems(1, itemsPerPage, searchQuery)}
      emptyText="No NAP items found"
      onRefresh={() => fetchNapItems(1, itemsPerPage, searchQuery)}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      // Paged on the server: `data` is already one page, so the shell must not
      // slice it again — it only needs the true total to size the pager.
      totalItems={totalCount}
      currentPage={currentPage}
      onPageChange={handlePageChange}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={(n) => {
        setItemsPerPage(n);
        fetchNapItems(1, n, searchQuery);
      }}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      toolbarActions={
        <TouchableOpacity
          onPress={handleAddNew}
          style={{
            height: 38,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: primaryColor,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Plus size={16} color="#ffffff" />
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add NAP</Text>}
        </TouchableOpacity>
      }
    >
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
    </StandardPage>
  );
};

export default NapList;

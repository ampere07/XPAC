import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Pressable } from 'react-native';
import { Plus, Edit2, Trash2 } from 'lucide-react-native';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import StatusRemarksFormModal from '../modals/StatusRemarksFormModal';
import { StandardListPage, standardPageStyles as s, STANDARD_COLORS } from '../components/common';

interface StatusRemark {
  id: number;
  status_remarks: string;
  created_at?: string;
  created_by_user?: string;
  updated_at?: string;
  updated_by_user?: string;
}

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

const StatusRemarkCard = React.memo(({ item, onEdit, onDelete, deleting }: {
  item: StatusRemark;
  onEdit: (r: StatusRemark) => void;
  onDelete: (r: StatusRemark) => void;
  deleting: boolean;
}) => (
  <Pressable
    onPress={() => onEdit(item)}
    style={[s.cardRow, { borderColor: STANDARD_COLORS.border }]}
  >
    <View style={s.cardInner}>
      <View style={s.cardLeft}>
        <Text style={[s.cardName, { color: STANDARD_COLORS.text }]} numberOfLines={2}>
          {item.status_remarks}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: STANDARD_COLORS.textDisabled }}>
            Created: {formatDate(item.created_at)}
          </Text>
          <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: STANDARD_COLORS.textDisabled }}>
            By: {item.created_by_user || 'System'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 16 }}>
        <TouchableOpacity onPress={() => onEdit(item)} style={{ padding: 8, borderRadius: 6 }}>
          <Edit2 size={18} color="#4b5563" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(item)}
          disabled={deleting}
          style={{ padding: 8, borderRadius: 6, opacity: deleting ? 0.5 : 1 }}
        >
          {deleting ? <ActivityIndicator size="small" color="#ef4444" /> : <Trash2 size={18} color="#ef4444" />}
        </TouchableOpacity>
      </View>
    </View>
  </Pressable>
));
StatusRemarkCard.displayName = 'StatusRemarkCard';

const StatusRemarksList: React.FC = () => {
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [statusRemarks, setStatusRemarks] = useState<StatusRemark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRemark, setEditingRemark] = useState<StatusRemark | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({ isOpen: false, type: 'loading', title: '', message: '' });

  const primaryColor = colorPalette?.primary || STANDARD_COLORS.primary;

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
    loadStatusRemarks();
  }, []);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000;
    const intervalId = setInterval(() => {
      loadStatusRemarks(true).catch((err) => console.error('Idle refresh failed:', err));
    }, IDLE_TIME_LIMIT);
    return () => clearInterval(intervalId);
  }, []);

  const loadStatusRemarks = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await apiClient.get('/status-remarks');
      const data = response.data;
      if (data.success) {
        setStatusRemarks(data.data || []);
      } else {
        console.error('API returned error:', data.message);
        setStatusRemarks([]);
      }
    } catch (error) {
      console.error('Error loading status remarks:', error);
      setStatusRemarks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStatusRemarks(true);
    setRefreshing(false);
  }, []);

  const executeDelete = async (remark: StatusRemark) => {
    closeGlobalModal();
    setDeletingItems((prev) => new Set(prev).add(remark.id));
    showGlobalModal('loading', 'Deleting', `Removing status remark...`);
    try {
      const response = await apiClient.delete(`/status-remarks/${remark.id}`);
      const data = response.data;
      if (data.success) {
        await loadStatusRemarks(true);
        showGlobalModal('success', 'Deleted', data.message || 'Status remark deleted successfully');
      } else {
        showGlobalModal('error', 'Delete Failed', data.message || 'Failed to delete status remark');
      }
    } catch (error: any) {
      console.error('Error deleting status remark:', error);
      const msg = error?.response?.data?.message || error.message || 'An unexpected error occurred during deletion';
      showGlobalModal('error', 'Error', msg);
    } finally {
      setDeletingItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(remark.id);
        return newSet;
      });
    }
  };

  const handleDelete = useCallback((remark: StatusRemark) => {
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete this status remark?`,
      () => executeDelete(remark)
    );
  }, []);

  const handleEdit = useCallback((remark: StatusRemark) => {
    setEditingRemark(remark);
    setShowAddModal(true);
  }, []);

  const handleAddNew = () => {
    setEditingRemark(null);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingRemark(null);
  };

  const handleSaveModal = async () => {
    await loadStatusRemarks();
  };

  const filteredStatusRemarks = useMemo(
    () => statusRemarks.filter((sr) => (sr.status_remarks || '').toLowerCase().includes(searchQuery.toLowerCase())),
    [statusRemarks, searchQuery],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const renderItem = useCallback((item: StatusRemark) => (
    <StatusRemarkCard item={item} onEdit={handleEdit} onDelete={handleDelete} deleting={deletingItems.has(item.id)} />
  ), [handleEdit, handleDelete, deletingItems]);

  return (
    <>
      <StandardListPage<StatusRemark>
        title="Status Remarks"
        data={filteredStatusRemarks}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search Status Remarks"
        isLoading={isLoading && statusRemarks.length === 0}
        emptyText="No status remarks found"
        isRefreshing={refreshing}
        onRefresh={handleRefresh}
        itemsPerPage={50}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        colorPalette={colorPalette}
        toolbarActions={
          <Pressable onPress={handleAddNew} style={[s.actionBtn, { backgroundColor: primaryColor }]}>
            <Plus size={20} color="#ffffff" />
          </Pressable>
        }
      />

      <StatusRemarksFormModal
        isOpen={showAddModal}
        onClose={handleCloseModal}
        onSave={handleSaveModal}
        editingRemark={editingRemark}
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
    </>
  );
};

export default StatusRemarksList;

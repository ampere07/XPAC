import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Dimensions,
  Modal,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
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
import { Group } from '../types/api';
import { groupService } from '../services/userService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AddNewGroupForm from '../components/AddNewGroupForm';
import EditGroupForm from '../components/EditGroupForm';

const GroupManagement: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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
    loadGroups();
  }, []);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const intervalId = setInterval(() => {
      loadGroups(true).catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  const loadGroups = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await groupService.getAllGroups();
      if (response.success && response.data) {
        setGroups(response.data);
      }
    } catch (error: any) {
      console.error('Failed to load groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadGroups(true);
    setRefreshing(false);
  };

  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return groups;
    return groups.filter((group) => {
      return (
        (group.group_name && group.group_name.toLowerCase().includes(q)) ||
        (group.company_name && group.company_name.toLowerCase().includes(q)) ||
        (group.email && group.email.toLowerCase().includes(q))
      );
    });
  }, [groups, searchQuery]);

  const totalItems = filteredGroups.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentGroups = filteredGroups.slice(startIndex, startIndex + itemsPerPage);
  const showingStart = totalItems === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(startIndex + itemsPerPage, totalItems);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const handleAddNew = () => {
    setShowAddForm(true);
  };

  const handleCancelAdd = () => {
    setShowAddForm(false);
  };

  const handleGroupCreated = (newGroup: Group) => {
    if (!newGroup) {
      Alert.alert('Warning', 'Failed to receive Affiliate data. Please refresh.');
      return;
    }
    setGroups((prev) => [...prev, newGroup]);
    setShowAddForm(false);
  };

  const handleEdit = (group: Group) => {
    if (!group) {
      Alert.alert('Error', 'Cannot edit Affiliate: No Affiliate data');
      return;
    }
    setEditingGroup(group);
  };

  const handleCancelEdit = () => {
    setEditingGroup(null);
  };

  const handleGroupUpdated = (updatedGroup: Group) => {
    setGroups((prev) =>
      prev.map((g) => (g.group_id === updatedGroup.group_id ? updatedGroup : g))
    );
    setEditingGroup(null);
  };

  const handleDeleteClick = (group: Group) => {
    setDeletingGroup(group);
    setDeleteModalVisible(true);
  };

  const handleCancelDelete = () => {
    setDeletingGroup(null);
    setDeleteModalVisible(false);
  };

  const handleConfirmDelete = async () => {
    if (!deletingGroup) return;
    setDeleteModalVisible(false);
    try {
      const response = await groupService.deleteGroup(deletingGroup.group_id);
      if (response.success) {
        setGroups((prev) => prev.filter((g) => g.group_id !== deletingGroup.group_id));
        setDeletingGroup(null);
      } else {
        Alert.alert('Error', response.message || 'Failed to delete Affiliate');
      }
    } catch (error: any) {
      console.error('Failed to delete Affiliate:', error);
      const msg = error.response?.data?.message || error.message || 'Failed to delete Affiliate';
      Alert.alert('Error', msg);
    }
  };

  // Show Add / Edit forms as full-screen overlays.
  if (showAddForm) {
    return (
      <AddNewGroupForm
        onCancel={handleCancelAdd}
        onGroupCreated={handleGroupCreated}
        colorPalette={colorPalette}
      />
    );
  }

  if (editingGroup) {
    return (
      <EditGroupForm
        group={editingGroup}
        onCancel={handleCancelEdit}
        onGroupUpdated={handleGroupUpdated}
        colorPalette={colorPalette}
      />
    );
  }

  const renderItem = ({ item: group }: { item: Group }) => (
    <View
      style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 }} numberOfLines={1}>
          {group.group_name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity
            onPress={() => handleEdit(group)}
            style={{ padding: 8, borderRadius: 6 }}
          >
            <Edit2 size={18} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDeleteClick(group)}
            style={{ padding: 8, borderRadius: 6 }}
          >
            <Trash2 size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ marginTop: 6, gap: 4 }}>
        {!!group.company_name && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Company:</Text>
            <Text style={{ fontSize: 12, color: '#374151', flex: 1, textAlign: 'right' }} numberOfLines={1}>
              {group.company_name}
            </Text>
          </View>
        )}
        {!!group.email && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Email:</Text>
            <Text style={{ fontSize: 12, color: '#374151', flex: 1, textAlign: 'right' }} numberOfLines={1}>
              {group.email}
            </Text>
          </View>
        )}
        {!!group.hotline && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Hotline:</Text>
            <Text style={{ fontSize: 12, color: '#374151' }}>{group.hotline}</Text>
          </View>
        )}
        {!!group.modified_date && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Modified:</Text>
            <Text style={{ fontSize: 12, color: '#374151' }}>
              {new Date(group.modified_date).toLocaleDateString()}
            </Text>
          </View>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search Affiliates"
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
            {isTablet && (
              <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add Affiliate</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => loadGroups()}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <RefreshCw size={16} color="#ffffff" />
            )}
          </TouchableOpacity>
        </View>
        {totalItems > 0 && (
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            Showing {showingStart}–{showingEnd} of {totalItems}
          </Text>
        )}
      </View>

      {/* List */}
      {loading && groups.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading Affiliates...</Text>
        </View>
      ) : (
        <FlatList
          data={currentGroups}
          keyExtractor={(item) => String(item.group_id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No Affiliates found</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!loading && totalItems > 0 && totalPages > 1 && (
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
            <View
              style={{
                borderWidth: 1,
                borderColor: '#d1d5db',
                borderRadius: 6,
                overflow: 'hidden',
                height: 36,
                justifyContent: 'center',
              }}
            >
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
            <PageBtn
              disabled={currentPage === 1}
              onPress={() => handlePageChange(1)}
              icon={<ChevronsLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />}
            />
            <PageBtn
              disabled={currentPage === 1}
              onPress={() => handlePageChange(currentPage - 1)}
              icon={<ChevronLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />}
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827', paddingHorizontal: 6 }}>
              Page {currentPage} of {totalPages}
            </Text>
            <PageBtn
              disabled={currentPage === totalPages}
              onPress={() => handlePageChange(currentPage + 1)}
              icon={<ChevronRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />}
            />
            <PageBtn
              disabled={currentPage === totalPages}
              onPress={() => handlePageChange(totalPages)}
              icon={<ChevronsRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />}
            />
          </View>
        </View>
      )}

      {/* Delete Confirmation Modal */}
      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={handleCancelDelete}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 400,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 }}>
              Confirm Delete
            </Text>
            <Text style={{ fontSize: 14, color: '#374151', marginBottom: 24, lineHeight: 20 }}>
              Are you sure you want to delete affiliate "{deletingGroup?.group_name}"? This action cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end' }}>
              <TouchableOpacity
                onPress={handleCancelDelete}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmDelete}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: '#ef4444',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const PageBtn: React.FC<{ disabled: boolean; onPress: () => void; icon: React.ReactNode }> = ({
  disabled,
  onPress,
  icon,
}) => (
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

export default GroupManagement;

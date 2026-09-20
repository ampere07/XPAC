import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Dimensions,
} from 'react-native';
import { Plus, Edit2, Trash2, RefreshCw } from 'lucide-react-native';
import apiClient from '../config/api';
import AddRouterModelModal from '../modals/AddRouterModelModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import GlobalSearch from './globalfunctions/GlobalSearch';

interface RouterModel {
  SN: string;
  Model?: string;
  brand?: string;
  description?: string;
  is_active?: boolean;
  modified_date?: string;
  modified_by?: string;
  created_at?: string;
  updated_at?: string;
}

const RouterModelList: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [routers, setRouters] = useState<RouterModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRouter, setEditingRouter] = useState<RouterModel | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<string>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    loadRouters();
  }, []);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000;
    const intervalId = setInterval(() => {
      loadRouters(true).catch((err) => console.error('Idle refresh failed:', err));
    }, IDLE_TIME_LIMIT);
    return () => clearInterval(intervalId);
  }, []);

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

  const loadRouters = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await apiClient.get('/router-models');
      const data = response.data;
      if (data.success) {
        setRouters(data.data || []);
      } else {
        console.error('API returned error:', data.message);
        setRouters([]);
      }
    } catch (error) {
      console.error('Error loading router models:', error);
      setRouters([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRouters(true);
    setRefreshing(false);
  };

  const handleDelete = (router: RouterModel) => {
    Alert.alert(
      'Permanent Delete',
      `Are you sure you want to permanently delete router model "${router.brand} ${router.Model}"?\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => executeDelete(router) },
      ]
    );
  };

  const executeDelete = async (router: RouterModel) => {
    setDeletingItems((prev) => new Set(prev).add(router.SN));

    try {
      const response = await apiClient.delete(`/router-models/${router.SN}`);
      const data = response.data;

      if (data.success) {
        await loadRouters(true);
        Alert.alert('Deleted', data.message || 'Router model deleted successfully');
      } else {
        Alert.alert('Delete Failed', data.message || 'Failed to delete router model');
      }
    } catch (error: any) {
      console.error('Error deleting router model:', error);
      const msg = error?.response?.data?.message || error.message || 'Unknown error';
      Alert.alert('Error', `Failed to delete router model: ${msg}`);
    } finally {
      setDeletingItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(router.SN);
        return newSet;
      });
    }
  };

  const handleEdit = (router: RouterModel) => {
    setEditingRouter(router);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingRouter(null);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingRouter(null);
  };

  const handleModalSave = () => {
    loadRouters();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (e) {
      return dateString;
    }
  };

  const filteredRouters = !searchQuery
    ? routers
    : routers.filter(
        (router) =>
          (router.brand && router.brand.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (router.Model && router.Model.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (router.SN && router.SN.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (router.description && router.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );

  const renderListItem = ({ item: router }: { item: RouterModel }) => {
    const isActive = router.is_active !== undefined ? router.is_active : true;

    return (
      <View style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Text style={{ color: '#111827', fontWeight: '600', fontSize: 16 }}>
                {router.brand || 'Unknown Brand'} {router.Model || 'Unknown Model'}
              </Text>
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#dbeafe' }}>
                <Text style={{ fontSize: 10, color: '#1d4ed8' }}>SN: {router.SN}</Text>
              </View>
              {isActive && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#dcfce7' }}>
                  <Text style={{ fontSize: 10, color: '#15803d' }}>Active</Text>
                </View>
              )}
            </View>
            {!!router.description && (
              <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>{router.description}</Text>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
              <Text style={{ fontSize: 11, color: '#9ca3af' }}>Modified: {formatDate(router.modified_date)}</Text>
              <Text style={{ fontSize: 11, color: '#9ca3af' }}>By: {router.modified_by || 'System'}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity onPress={() => handleEdit(router)} style={{ padding: 8, borderRadius: 6 }}>
              <Edit2 size={18} color="#4b5563" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(router)}
              disabled={deletingItems.has(router.SN)}
              style={{ padding: 8, borderRadius: 6, opacity: deletingItems.has(router.SN) ? 0.5 : 1 }}
            >
              {deletingItems.has(router.SN) ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Trash2 size={18} color="#ef4444" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
          placeholder="Search Router Models"
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
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => loadRouters()}
          style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
        >
          {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading && routers.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : (
        <FlatList
          data={filteredRouters}
          keyExtractor={(item) => item.SN}
          renderItem={renderListItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No router models found</Text>
            </View>
          }
        />
      )}

      <AddRouterModelModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSave={handleModalSave}
        editingRouter={editingRouter}
      />
    </View>
  );
};

export default RouterModelList;

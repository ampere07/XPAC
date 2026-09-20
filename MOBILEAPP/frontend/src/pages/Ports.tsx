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
import { Plus, Edit2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { getAllPorts, deletePort, Port } from '../services/portService';
import AddPortModal from '../modals/AddPortModal';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const Ports: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [ports, setPorts] = useState<Port[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPort, setEditingPort] = useState<Port | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    fetchPorts();
  }, [currentPage, searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const fetchPorts = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getAllPorts(searchQuery, currentPage, 10);
      if (response.success) {
        setPorts(response.data);
        if (response.pagination) setTotalPages(response.pagination.total_pages);
      } else {
        setError(response.message || 'Failed to fetch ports');
      }
    } catch (error) {
      console.error('Error fetching ports:', error);
      setError('Failed to fetch ports');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPorts();
    setRefreshing(false);
  };

  const handleSearchChange = (q: string) => {
    setCurrentPage(1);
    setSearchQuery(q);
  };

  const handleAddClick = () => {
    setEditingPort(null);
    setShowAddModal(true);
  };

  const handleEditClick = (port: Port) => {
    setEditingPort(port);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingPort(null);
  };

  const handleSaveModal = async () => {
    await fetchPorts();
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Port', 'Are you sure you want to delete this port?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(id);
          try {
            const response = await deletePort(id);
            if (response.success) {
              await fetchPorts();
            } else {
              Alert.alert('Error', 'Failed to delete port: ' + response.message);
            }
          } catch (error) {
            console.error('Error deleting port:', error);
            Alert.alert('Error', 'Failed to delete port');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return 'N/A';
    }
  };

  const renderListItem = ({ item: port }: { item: Port }) => (
    <View style={{ backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>{port.PORT_ID}</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f3f4f6' }}>
              <Text style={{ fontSize: 12, color: '#374151' }}>{port.Label}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
            <Text style={{ fontSize: 10, color: '#9ca3af' }}>Created: {formatDateTime(port.created_at)}</Text>
            <Text style={{ fontSize: 10, color: '#9ca3af' }}>Updated: {formatDateTime(port.updated_at)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={() => handleEditClick(port)} style={{ padding: 8, borderRadius: 6 }}>
            <Edit2 size={18} color="#4b5563" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(port.id)}
            disabled={deletingId === port.id}
            style={{ padding: 8, borderRadius: 6, opacity: deletingId === port.id ? 0.5 : 1 }}
          >
            {deletingId === port.id ? <ActivityIndicator size="small" color="#ef4444" /> : <Trash2 size={18} color="#ef4444" />}
          </TouchableOpacity>
        </View>
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
          placeholder="Search Ports"
        />
        <TouchableOpacity
          onPress={handleAddClick}
          style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Plus size={16} color="#ffffff" />
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add</Text>}
        </TouchableOpacity>
      </View>

      {/* Body */}
      {loading && ports.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading ports...</Text>
        </View>
      ) : error && ports.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>Error Loading Ports</Text>
          <Text style={{ color: '#6b7280' }}>{error}</Text>
          <TouchableOpacity onPress={fetchPorts} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={ports}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderListItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ fontSize: 16, color: '#6b7280' }}>No ports found</Text>
              <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                {searchQuery ? 'Try adjusting your search filter' : 'Start by adding some ports'}
              </Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!loading && !error && ports.length > 0 && totalPages > 1 && (
        <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb', padding: 12, backgroundColor: '#ffffff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{ padding: 8, borderRadius: 6, borderWidth: 1, borderColor: currentPage === 1 ? '#e5e7eb' : '#d1d5db', backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff' }}
          >
            <ChevronLeft size={16} color={currentPage === 1 ? '#9ca3af' : '#111827'} />
          </TouchableOpacity>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827' }}>Page {currentPage} of {totalPages}</Text>
          <TouchableOpacity
            onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{ padding: 8, borderRadius: 6, borderWidth: 1, borderColor: currentPage === totalPages ? '#e5e7eb' : '#d1d5db', backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff' }}
          >
            <ChevronRight size={16} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />
          </TouchableOpacity>
        </View>
      )}

      <AddPortModal isOpen={showAddModal} onClose={handleCloseModal} onSave={handleSaveModal} editingPort={editingPort} />
    </View>
  );
};

export default Ports;

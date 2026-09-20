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
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Plus,
  RefreshCw,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  User as UserIcon,
  Trash2,
  Edit,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Technician } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import TechnicianModal from '../modals/TechnicianModal';
import { useTechnicianStore } from '../store/technicianStore';
import { technicianService } from '../services/technicianService';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

const TechUsers: React.FC = () => {
  // FORCED LIGHT MODE
  const isDarkMode = false;

  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authData, setAuthData] = useState<any>({});

  const {
    technicians,
    isLoading,
    error,
    fetchTechnicians,
    refreshTechnicians,
    addTechnician,
    updateTechnician,
    removeTechnician,
  } = useTechnicianStore();

  const [selectedTech, setSelectedTech] = useState<Technician | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  useEffect(() => {
    const init = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
      try {
        const raw = await AsyncStorage.getItem('authData');
        setAuthData(raw ? JSON.parse(raw) : {});
      } catch (err) {
        console.error('Failed to load authData:', err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    fetchTechnicians();
  }, [fetchTechnicians]);

  // Auto refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      refreshTechnicians().catch((e) => console.error('Idle refresh failed:', e));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshTechnicians]);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const getFullName = (t: Technician): string => {
    const parts = [t.first_name, t.middle_initial, t.last_name].filter(Boolean);
    return parts.join(' ');
  };

  const userOrgId = useMemo(() => {
    return (
      authData.organization_id ||
      authData.user?.organization_id ||
      authData.organization?.id ||
      authData.user?.organization?.id ||
      null
    );
  }, [authData]);

  const filteredTechs = useMemo(() => {
    return technicians.filter((tech) => {
      // Organization filter — mirrors applicationmanagement.tsx logic exactly
      if (userOrgId) {
        if (tech.organization_id !== userOrgId) return false;
      } else {
        if (tech.organization_id) return false;
      }

      const fullName = getFullName(tech).toLowerCase();
      const query = searchQuery.toLowerCase().trim();
      return fullName.includes(query);
    });
  }, [technicians, searchQuery, userOrgId]);

  const totalPages = Math.ceil(filteredTechs.length / itemsPerPage);
  const paginatedTechs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTechs.slice(start, start + itemsPerPage);
  }, [filteredTechs, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTechnicians();
    setRefreshing(false);
  };

  const handleSaveTech = (savedTech: Technician) => {
    const exists = technicians.find((t) => t.id === savedTech.id);
    if (exists) {
      updateTechnician(savedTech);
    } else {
      addTechnician(savedTech);
    }
  };

  const handleDeleteTech = (id: number) => {
    Alert.alert('Delete Technician', 'Are you sure you want to delete this technician?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await technicianService.deleteTechnician(id);
            if (res.success) {
              removeTechnician(id);
            } else {
              Alert.alert('Error', res.message || 'Failed to delete technician');
            }
          } catch (err: any) {
            Alert.alert('Error', err.message || 'An error occurred');
          }
        },
      },
    ]);
  };

  const renderTech = ({ item: tech }: { item: Technician }) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: '#f3f4f6',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <UserIcon size={18} color="#6b7280" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 }} numberOfLines={1}>
          {getFullName(tech)}
        </Text>
        <Text style={{ fontSize: 12, color: '#9ca3af' }} numberOfLines={1}>
          {tech.updated_at ? new Date(tech.updated_at).toLocaleDateString() : 'N/A'}
          {tech.updated_by ? ` • ${tech.updated_by}` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TouchableOpacity
          onPress={() => {
            setSelectedTech(tech);
            setShowModal(true);
          }}
          style={{ padding: 8, borderRadius: 8, backgroundColor: '#eff6ff' }}
        >
          <Edit size={16} color="#2563eb" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDeleteTech(tech.id)}
          style={{ padding: 8, borderRadius: 8, backgroundColor: '#fef2f2' }}
        >
          <Trash2 size={16} color="#dc2626" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const PaginationControls = () => {
    if (totalPages <= 1) return null;
    const start = Math.min((currentPage - 1) * itemsPerPage + 1, filteredTechs.length);
    const end = Math.min(currentPage * itemsPerPage, filteredTechs.length);
    return (
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          padding: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden', minWidth: 70 }}>
              <Picker
                selectedValue={String(itemsPerPage)}
                onValueChange={(v) => {
                  setItemsPerPage(Number(v));
                  setCurrentPage(1);
                }}
                style={{ height: 36, fontSize: 12 }}
              >
                {[10, 25, 50, 100].map((v) => (
                  <Picker.Item key={v} label={String(v)} value={String(v)} />
                ))}
              </Picker>
            </View>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>
              {start}-{end} of {filteredTechs.length}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity onPress={() => handlePageChange(1)} disabled={currentPage === 1} style={{ padding: 4, opacity: currentPage === 1 ? 0.3 : 1 }}>
              <ChevronsLeft size={16} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} style={{ padding: 4, opacity: currentPage === 1 ? 0.3 : 1 }}>
              <ChevronLeft size={16} color="#374151" />
            </TouchableOpacity>
            <Text style={{ fontSize: 12, color: '#374151', paddingHorizontal: 8 }}>
              Page {currentPage} of {totalPages}
            </Text>
            <TouchableOpacity onPress={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} style={{ padding: 4, opacity: currentPage === totalPages ? 0.3 : 1 }}>
              <ChevronRight size={16} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} style={{ padding: 4, opacity: currentPage === totalPages ? 0.3 : 1 }}>
              <ChevronsRight size={16} color="#374151" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const ListContent = () => {
    if (isLoading && technicians.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}>Loading technicians...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={{ fontSize: 14, color: '#ef4444' }}>{error}</Text>
        </View>
      );
    }
    if (filteredTechs.length === 0) {
      return (
        <View style={{ padding: 48, alignItems: 'center', opacity: 0.4 }}>
          <UserIcon size={48} color="#6b7280" />
          <Text style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}>No technicians found</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingTop: isTablet ? 16 : 60,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Technician Management</Text>
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Manage system technicians</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => refreshTechnicians()} style={{ padding: 8, borderRadius: 8, backgroundColor: '#f3f4f6' }}>
              <RefreshCw size={18} color="#6b7280" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setSelectedTech(null);
                setShowModal(true);
              }}
              style={{ padding: 8, borderRadius: 8, backgroundColor: primaryColor }}
            >
              <Plus size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search technician name..."
        />
      </View>

      {/* List */}
      <View style={{ flex: 1 }}>
        <ListContent />
        {filteredTechs.length > 0 && (
          <FlatList
            data={paginatedTechs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderTech}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[primaryColor]} />
            }
            contentContainerStyle={{ backgroundColor: '#ffffff' }}
          />
        )}
        {!isLoading && filteredTechs.length > 0 && <PaginationControls />}
      </View>

      <TechnicianModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveTech}
        technician={selectedTech}
      />
    </View>
  );
};

export default TechUsers;

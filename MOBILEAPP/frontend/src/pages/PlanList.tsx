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
import AddPlanModal from '../modals/AddPlanModal';
import PlanListDetails from '../components/PlanListDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface Plan {
  id: number;
  name: string;
  description?: string;
  price: number;
  is_active?: boolean;
  organization_id?: number | null;
  modified_date?: string;
  modified_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface PlanListProps {
  onNavigate?: (section: string, extra?: string) => void;
  initialSearchQuery?: string;
}

const PlanList: React.FC<PlanListProps> = ({ onNavigate, initialSearchQuery = '' }) => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
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
    loadPlans();
  }, []);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000;
    const intervalId = setInterval(() => {
      loadPlans(true).catch((err) => console.error('Idle refresh failed:', err));
    }, IDLE_TIME_LIMIT);
    return () => clearInterval(intervalId);
  }, []);

  const loadPlans = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await apiClient.get('/plans');
      const data = response.data;
      if (data.success) {
        setPlans(data.data || []);
      } else {
        console.error('API returned error:', data.message);
        setPlans([]);
      }
    } catch (error) {
      console.error('Error loading plans:', error);
      setPlans([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadPlans(true);
    setRefreshing(false);
  };

  const handleDelete = (plan: Plan) => {
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete "${plan.name}"?`,
      () => executeDelete(plan)
    );
  };

  const executeDelete = async (plan: Plan) => {
    closeGlobalModal();

    setDeletingItems((prev) => new Set(prev).add(plan.id));
    showGlobalModal('loading', 'Deleting Plan', `Permanently removing "${plan.name}" from database...`);

    try {
      const response = await apiClient.delete(`/plans/${plan.id}`);
      const data = response.data;

      if (data.success) {
        await loadPlans(true);
        if (selectedPlan && selectedPlan.id === plan.id) setSelectedPlan(null);
        showGlobalModal('success', 'Deleted', data.message || 'Plan deleted successfully');
      } else {
        showGlobalModal('error', 'Delete Failed', data.message || 'Failed to delete plan');
      }
    } catch (error: any) {
      console.error('Error deleting plan:', error);
      const msg = error?.response?.data?.message || error.message || 'Unknown error';
      showGlobalModal('error', 'Error', 'Failed to delete plan: ' + msg);
    } finally {
      setDeletingItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(plan.id);
        return newSet;
      });
    }
  };

  const handleEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingPlan(null);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingPlan(null);
  };

  const handleModalSave = async () => {
    await loadPlans();
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(price);

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

  const filteredPlans = plans.filter((plan) => {
    const matchesOrg = currentUserOrgId ? plan.organization_id === currentUserOrgId : !plan.organization_id;
    if (!matchesOrg) return false;
    const query = searchQuery.toLowerCase();
    return plan.name.toLowerCase().includes(query) || (plan.description ? plan.description.toLowerCase().includes(query) : false);
  });

  const totalPages = Math.ceil(filteredPlans.length / itemsPerPage);
  const paginatedPlans = filteredPlans.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  // Keep selectedPlan in sync after list reloads.
  useEffect(() => {
    if (selectedPlan) {
      const updated = plans.find((p) => p.id === selectedPlan.id);
      if (updated) setSelectedPlan(updated);
    }
  }, [plans]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const renderListItem = ({ item: plan }: { item: Plan }) => {
    const isActive = plan.is_active !== undefined ? plan.is_active : true;
    return (
      <TouchableOpacity
        onPress={() => setSelectedPlan(plan)}
        activeOpacity={0.7}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          backgroundColor: selectedPlan?.id === plan.id ? '#eff6ff' : '#ffffff',
        }}
      >
        <View style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, color: '#111827' }}>
              {plan.name}
            </Text>
            <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 14 }}>{formatPrice(plan.price)}</Text>
            {isActive && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#dcfce7' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#15803d' }}>Active</Text>
              </View>
            )}
          </View>
          {!!plan.description && (
            <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }} numberOfLines={1}>{plan.description}</Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
            <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: '#9ca3af' }}>
              Modified: {formatDate(plan.modified_date)}
            </Text>
            <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: '#9ca3af' }}>
              By: {plan.modified_by || 'System'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={() => handleEdit(plan)} style={{ padding: 8, borderRadius: 6 }}>
            <Edit2 size={18} color="#4b5563" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(plan)}
            disabled={deletingItems.has(plan.id)}
            style={{ padding: 8, borderRadius: 6, opacity: deletingItems.has(plan.id) ? 0.5 : 1 }}
          >
            {deletingItems.has(plan.id) ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Trash2 size={18} color="#ef4444" />
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // Detail overlay takes over the screen when a plan is selected.
  if (selectedPlan) {
    return (
      <View style={{ flex: 1 }}>
        <PlanListDetails
          plan={selectedPlan}
          onClose={() => setSelectedPlan(null)}
          isMobile={!isTablet}
          onNavigate={onNavigate}
        />
      </View>
    );
  }

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
          placeholder="Search Plans"
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
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add Plan</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => loadPlans()}
          style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
        >
          {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading && plans.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : (
        <FlatList
          data={paginatedPlans}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderListItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No plans found</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && filteredPlans.length > 0 && totalPages > 1 && (
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

      <AddPlanModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSave={handleModalSave}
        editingPlan={editingPlan}
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

export default PlanList;

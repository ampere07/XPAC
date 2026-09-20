import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plus, Edit2, Trash2 } from 'lucide-react-native';
import apiClient from '../config/api';
import AddPlanModal from '../modals/AddPlanModal';
import PlanListDetails from '../components/PlanListDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { StandardPage, RecordCard } from '../components/common';

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

  const rowActions = (plan: Plan) => (
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
  );

  return (
    <StandardPage<Plan>
      data={filteredPlans}
      keyExtractor={(item) => String(item.id)}
      renderItem={(plan) => (
        <RecordCard
          title={plan.name}
          normalizeTitle={false}
          titleStyle={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
          subtitle={[formatPrice(plan.price), plan.description].filter(Boolean).join('  |  ')}
          status={(plan.is_active !== undefined ? plan.is_active : true) ? 'Active' : 'Inactive'}
          selected={selectedPlan?.id === plan.id}
          onPress={() => setSelectedPlan(plan)}
          disabled={deletingItems.has(plan.id)}
          right={rowActions(plan)}
        >
          <Text style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: '500', color: '#9ca3af', marginTop: 4 }}>
            Modified: {formatDate(plan.modified_date)}  |  By: {plan.modified_by || 'System'}
          </Text>
        </RecordCard>
      )}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search Plans"
      isLoading={isLoading && plans.length === 0}
      emptyText="No plans found"
      onRefresh={() => loadPlans()}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={setItemsPerPage}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      // The detail is passed in rather than returned early, so the list keeps
      // its scroll position and page while a plan is open.
      detail={
        selectedPlan ? (
          <PlanListDetails
            plan={selectedPlan}
            onClose={() => setSelectedPlan(null)}
            isMobile={!isTablet}
            onNavigate={onNavigate}
          />
        ) : null
      }
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
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add Plan</Text>}
        </TouchableOpacity>
      }
    >
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
    </StandardPage>
  );
};

export default PlanList;

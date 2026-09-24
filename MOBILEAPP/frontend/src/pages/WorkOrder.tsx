import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  RefreshControl,
  Modal,
  Platform,
  StyleSheet,
  useWindowDimensions,
  DeviceEventEmitter
} from 'react-native';
import { Search, Plus, RefreshCw, Filter, Check } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useWorkOrderStore } from '../store/workOrderStore';
import { WorkOrder } from '../types/workOrder';
import WorkOrderDetails from '../components/WorkOrderDetails';
import AssignWorkOrderModal from '../modals/AssignWorkOrderModal';
import { useUserDirectory } from '../hooks/useUserDirectory';
import { UserDirectory, resolveUserDisplayName } from '../utils/userDisplay';

// --- Static Helpers & Components ---
const ITEMS_PER_PAGE = 50;

const checkIsStarted = (time?: string | null) => {
  if (!time) return false;
  const lowerTime = String(time).toLowerCase().trim();
  return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lowerTime);
};

const isWorkStarted = (wo: WorkOrder) => {
  const hasStart = checkIsStarted(wo.start_time);
  const hasEnd = checkIsStarted(wo.end_time);
  
  return hasStart && !hasEnd;
};

const StatusText = React.memo(({ status }: { status?: string | null }) => {
  if (!status) return <Text style={st.statusDash}>-</Text>;

  let textColor = '#9ca3af';
  const s = status.toLowerCase();

  if (s === 'completed' || s === 'done') textColor = '#4ade80';
  else if (s === 'in progress' || s === 'inprogress') textColor = '#60a5fa';
  else if (s === 'pending') textColor = '#fb923c';
  else if (s === 'failed' || s === 'cancelled') textColor = '#ef4444';

  return (
    <Text style={[st.statusLabel, { color: textColor }]}>
      {s === 'inprogress' ? 'In Progress' : status}
    </Text>
  );
});

const WorkOrderCard = React.memo(({
  wo,
  onPress,
  isSelected,
  formatDate,
  userDirectory
}: {
  wo: WorkOrder;
  onPress: (wo: WorkOrder) => void;
  isSelected: boolean;
  formatDate: (d?: string) => string;
  userDirectory: UserDirectory;
}) => (
  <TouchableOpacity
    onPress={() => onPress(wo)}
    style={[st.cardRow, {
      backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
      borderColor: '#e5e7eb'
    }]}
  >
    <View style={st.cardInner}>
      <View style={st.cardLeft}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
          <Text style={[st.cardName, { color: '#111827', marginBottom: 0, flex: 1 }]} numberOfLines={1} ellipsizeMode="tail">
            {wo.instructions || 'No Instructions'}
          </Text>
          {isWorkStarted(wo) && (
            <View style={{ backgroundColor: '#dcfce7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: '#15803d', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' }}>
                Work Started
              </Text>
            </View>
          )}
        </View>
        <Text style={[st.cardSub, { color: '#4b5563' }]}>
          {formatDate(wo.requested_date)}
        </Text>
        <Text style={[st.cardSub, { color: '#6b7280', marginTop: 4, fontStyle: 'italic' }]}>
          {wo.assign_to ? `Assigned to: ${resolveUserDisplayName(wo.assign_to, userDirectory, wo.assign_to)}` : 'Unassigned'}
        </Text>
      </View>
      <View style={st.cardRight}>
        <StatusText status={wo.work_status} />
      </View>
    </View>
  </TouchableOpacity>
));

const WorkOrderPage: React.FC = () => {
  const userDirectory = useUserDirectory();
  const isDarkMode = false; // Forced light mode as per user request
  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());

  const { workOrders, isLoading, fetchWorkOrders, error } = useWorkOrderStore();
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [userRole, setUserRole] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  useEffect(() => {
    const loadAuthData = async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const parsed = JSON.parse(authData);
          setUserRole(parsed.role_id || parsed.roleId || null);
          setUserEmail(parsed.email_address || parsed.email || '');
          const fullName = parsed.full_name || `${parsed.first_name || ''} ${parsed.last_name || ''}`.trim();
          setUserName(fullName || parsed.username || '');
        }
      } catch (e) {
        console.error('Error loading auth data:', e);
      }
    };
    loadAuthData();
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

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => paletteSub.remove();
  }, []);

  // Dark mode loading removed as per user request

  useEffect(() => {
    fetchWorkOrders(1, 1000, '', '');
  }, [fetchWorkOrders]);

  const filteredWorkOrders = useMemo(() => {
    let filtered = workOrders;

    // Apply role-based filtering for OSP (6), Agent (4), and Technician (2)
    const roleIdNum = Number(userRole);
    if (roleIdNum === 6 || roleIdNum === 4 || roleIdNum === 2) {
      const meEmail = userEmail.toLowerCase().trim();
      const meName = userName.toLowerCase().trim();
      filtered = filtered.filter((wo: WorkOrder) => {
        const targetAssign = (wo.assign_to || '').toLowerCase().trim();
        return (meEmail && targetAssign === meEmail) || (meName && targetAssign === meName);
      });
    }

    // Universal 1-day visibility filter: hide done/completed/failed/cancelled work orders after today if search is empty
    const isSearchEmpty = searchQuery.toLowerCase().trim() === '';
    if (isSearchEmpty) {
      filtered = filtered.filter((wo: WorkOrder) => {
        const status = (wo.work_status || '').toLowerCase().trim();
        if (status === 'done' || status === 'completed' || status === 'failed' || status === 'cancelled') {
          const completionTime = wo.end_time || wo.updated_date;
          if (completionTime) {
            const completionDate = new Date(completionTime);
            const today = new Date();
            const isToday = completionDate.getFullYear() === today.getFullYear() &&
              completionDate.getMonth() === today.getMonth() &&
              completionDate.getDate() === today.getDate();

            if (!isToday) return false;
          }
        }
        return true;
      });
    }
    
    // Status filtering
    if (statusFilter !== 'all') {
      filtered = filtered.filter((wo: WorkOrder) => {
        const s = (wo.work_status || '').toLowerCase().trim();
        if (statusFilter === 'pending') {
          return s === 'pending';
        } else if (statusFilter === 'inprogress') {
          return s === 'inprogress' || s === 'in progress' || s === 'in-progress';
        } else if (statusFilter === 'done') {
          return s === 'done' || s === 'completed';
        } else if (statusFilter === 'cancelled') {
          return s === 'cancelled';
        } else if (statusFilter === 'failed') {
          return s === 'failed';
        }
        return true;
      });
    }

    if (!searchQuery) return filtered;

    const query = searchQuery.toLowerCase();
    return filtered.filter((wo: WorkOrder) =>
      (wo.instructions || '').toLowerCase().includes(query) ||
      (wo.report_to || '').toLowerCase().includes(query) ||
      (wo.assign_to || '').toLowerCase().includes(query) ||
      (wo.requested_by || '').toLowerCase().includes(query)
    );
  }, [workOrders, searchQuery, statusFilter, userRole, userEmail, userName]);

  const totalPages = useMemo(() => Math.ceil(filteredWorkOrders.length / ITEMS_PER_PAGE), [filteredWorkOrders.length]);

  const paginatedWorkOrders = useMemo(() => {
    return filteredWorkOrders.slice(
      (currentPage - 1) * ITEMS_PER_PAGE,
      currentPage * ITEMS_PER_PAGE
    );
  }, [filteredWorkOrders, currentPage]);

  const handleCardPress = useCallback((workOrder: WorkOrder) => {
    setSelectedWorkOrder(workOrder);
    setShowDetailsModal(true);
  }, []);

  const handleAddNew = useCallback(() => {
    setSelectedWorkOrder(null);
    setShowAssignModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowDetailsModal(false);
    setSelectedWorkOrder(null);
    fetchWorkOrders(1, 1000, '', '');
  }, [fetchWorkOrders]);

  const handleCloseAssignModal = useCallback(() => {
    setShowAssignModal(false);
  }, []);

  const handleSaveAssignModal = useCallback(() => {
    setShowAssignModal(false);
    fetchWorkOrders(1, 1000, '', '');
  }, [fetchWorkOrders]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  }, [totalPages]);

  const formatDate = useCallback((dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return dateString;
      const datePart = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
      const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return `${datePart} ${timePart}`;
    } catch (e) {
      return dateString;
    }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const PaginationControls = () => {
    if (totalPages <= 1) return null;

    return (
      <View style={[st.pagination, { backgroundColor: '#ffffff', borderColor: '#e5e7eb' }]}>
        <View style={st.paginationInfo}>
          <Text style={[st.paginationText, { color: '#6b7280' }]}>
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredWorkOrders.length)} of {filteredWorkOrders.length}
          </Text>
        </View>
        <View style={st.paginationBtns}>
          <TouchableOpacity
            onPress={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            style={[st.pageBtn, {
              backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff',
              borderColor: '#d1d5db',
              borderWidth: currentPage === 1 ? 0 : 1
            }]}
          >
            <Text style={[st.pageBtnText, {
              color: currentPage === 1 ? '#4b5563' : '#374151',
              fontSize: 18,
              fontWeight: 'bold'
            }]}>{"<"}</Text>
          </TouchableOpacity>

          <Text style={[st.pageCountText, { color: '#111827' }]}>
            {currentPage}/{totalPages}
          </Text>

          <TouchableOpacity
            onPress={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            style={[st.pageBtn, {
              backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff',
              borderColor: '#d1d5db',
              borderWidth: currentPage === totalPages ? 0 : 1
            }]}
          >
            <Text style={[st.pageBtnText, {
              color: currentPage === totalPages ? '#4b5563' : '#374151',
              fontSize: 18,
              fontWeight: 'bold'
            }]}>{">"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // StatusText moved to top for optimization

  return (
    <SafeAreaView style={[st.container, { backgroundColor: '#f9fafb' }]}>
      <View style={[st.header, {
        backgroundColor: '#ffffff',
        borderBottomColor: '#e5e7eb',
        paddingTop: isTablet ? 16 : 60
      }]}>
        <View style={st.toolbarRow}>
          <View style={st.searchBarContainer}>
            <Search size={20} color="#9ca3af" style={st.searchIcon} />
            <TextInput
              placeholder="Search work orders..."
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[st.searchInput, {
                backgroundColor: '#f3f4f6',
                color: '#111827',
                borderColor: '#d1d5db'
              }]}
            />
          </View>

          <View style={st.actionsRow}>
            <TouchableOpacity
              onPress={() => setShowStatusModal(true)}
              style={[st.actionIconBtn, { 
                backgroundColor: statusFilter !== 'all' ? (colorPalette?.primary || '#7c3aed') : '#f3f4f6',
                borderWidth: statusFilter !== 'all' ? 0 : 1,
                borderColor: '#d1d5db',
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 4
              }]}
            >
              <Filter size={20} color={statusFilter !== 'all' ? 'white' : '#4b5563'} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => fetchWorkOrders(1, 1000, '', '')}
              disabled={isLoading}
              style={[st.actionIconBtn, { backgroundColor: isLoading ? '#d1d5db' : (colorPalette?.primary || '#7c3aed') }]}
            >
              <RefreshCw size={20} color="white" />
            </TouchableOpacity>

            {(userRole === 1 || userRole === 7) && (
              <TouchableOpacity
                onPress={handleAddNew}
                style={[st.actionIconBtn, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}
              >
                <Plus size={20} color="white" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        style={st.scrollView}
        contentContainerStyle={st.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && workOrders.length > 0}
            onRefresh={() => fetchWorkOrders(1, 1000, '', '')}
            tintColor="black"
          />
        }
      >
        {isLoading && workOrders.length === 0 ? (
          <View style={st.centerContent}>
            <ActivityIndicator size="large" color={colorPalette?.primary || '#7c3aed'} />
          </View>
        ) : error ? (
          <Text style={st.errorText}>{error}</Text>
        ) : filteredWorkOrders.length > 0 ? (
          <>
            <View style={st.cardList}>
              {paginatedWorkOrders.map((wo: WorkOrder) => (
                <WorkOrderCard
                  key={wo.id}
                  wo={wo}
                  onPress={handleCardPress}
                  isSelected={selectedWorkOrder?.id === wo.id}
                  formatDate={formatDate}
                  userDirectory={userDirectory}
                />
              ))}
            </View>
            <PaginationControls />
            <View style={{ height: !isTablet ? 120 : 40 }} />
          </>
        ) : (
          <View style={st.emptyState}>
            <Text style={[st.emptyText, { color: '#9ca3af' }]}>
              No work orders found
            </Text>
          </View>
        )}
      </ScrollView>

      {showDetailsModal && selectedWorkOrder && (
        <Modal
          visible={showDetailsModal}
          animationType="none"
          onRequestClose={handleCloseModal}
          transparent={false}
        >
          <WorkOrderDetails
            workOrder={selectedWorkOrder}
            onClose={handleCloseModal}
            onEdit={() => {
              setShowAssignModal(true);
            }}
            onRefresh={() => fetchWorkOrders(1, 1000, '', '')}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
          />
        </Modal>
      )}

      {showAssignModal && (
        <AssignWorkOrderModal
          isOpen={showAssignModal}
          onClose={handleCloseAssignModal}
          onSave={handleSaveAssignModal}
          onRefresh={() => fetchWorkOrders(1, 1000, '', '')}
          isEditMode={!!selectedWorkOrder}
          workOrder={selectedWorkOrder || undefined}
        />
      )}

      <Modal
        visible={showStatusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <TouchableOpacity 
          activeOpacity={1} 
          style={st.statusModalOverlay} 
          onPress={() => setShowStatusModal(false)}
        >
          <View style={st.statusModalContent}>
            <View style={st.statusModalHeader}>
              <Text style={st.statusModalTitle}>Filter by Status</Text>
            </View>
            {[
              { label: 'All Status', value: 'all' },
              { label: 'Pending', value: 'pending' },
              { label: 'In Progress', value: 'inprogress' },
              { label: 'Done', value: 'done' },
              { label: 'Cancelled', value: 'cancelled' },
              { label: 'Failed', value: 'failed' }
            ].map((item) => (
              <TouchableOpacity
                key={item.value}
                style={st.statusItem}
                onPress={() => {
                  setStatusFilter(item.value);
                  setShowStatusModal(false);
                }}
              >
                <Text style={[st.statusItemText, statusFilter === item.value && { color: colorPalette?.primary || '#7c3aed', fontWeight: '700' }]}>
                  {item.label}
                </Text>
                {statusFilter === item.value && <Check size={18} color={colorPalette?.primary || '#7c3aed'} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
};

const st = StyleSheet.create({
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchBarContainer: { position: 'relative', flex: 1 },
  searchIcon: { position: 'absolute', left: 12, top: 10, zIndex: 10 },
  searchInput: { width: '100%', paddingLeft: 40, paddingRight: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionIconBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { paddingVertical: 16 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  errorText: { textAlign: 'center', paddingVertical: 80, color: '#ef4444' },
  cardList: { flexDirection: 'column' },
  cardRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  cardInner: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLeft: { flex: 1, minWidth: 0 },
  cardName: { fontWeight: '500', fontSize: 14, marginBottom: 4 },
  cardSub: { fontSize: 12 },
  cardRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 },
  statusDash: { color: '#9ca3af' },
  statusLabel: { fontWeight: 'bold', textTransform: 'uppercase', fontSize: 12 },

  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 16, marginTop: 24, borderRadius: 8, borderWidth: 1 },
  paginationInfo: { flex: 1 },
  paginationText: { fontSize: 12 },
  paginationBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  pageBtnText: { fontSize: 12 },
  pageCountText: { paddingHorizontal: 4, fontSize: 12 },
  emptyState: { paddingVertical: 80 },
  emptyText: { textAlign: 'center' },
  // Status Modal
  statusModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  statusModalContent: { width: '80%', backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  statusModalHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', alignItems: 'center' },
  statusModalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  statusItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusItemText: { fontSize: 14, color: '#374151' },
});

export default WorkOrderPage;

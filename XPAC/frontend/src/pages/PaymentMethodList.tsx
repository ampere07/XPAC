import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Loader2, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { API_BASE_URL } from '../config/api';
import AddPaymentMethodModal from '../modals/AddPaymentMethodModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { authFetch } from '../config/api';
import { usePageActions } from '../hooks/usePageActions';

interface PaymentMethod {
  id: number;
  payment_method: string;
  created_at?: string;
  updated_at?: string;
  organization_id?: number | null;
  created_by_user_id?: number;
  updated_by_user_id?: number;
}

const PaymentMethodList: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed.
  const actions = usePageActions('payment-method');

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<PaymentMethod | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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
    message: ''
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const showGlobalModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning', 
    title: string, 
    message: string,
    onConfirm?: () => void
  ) => {
    setGlobalModal({
      isOpen: true,
      type,
      title,
      message,
      onConfirm
    });
  };

  const closeGlobalModal = () => {
    setGlobalModal(prev => ({ ...prev, isOpen: false }));
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
    const observer = new MutationObserver(() => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme !== 'light');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    const theme = localStorage.getItem('theme');
    setIsDarkMode(theme !== 'light');

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    loadPaymentMethods();
  }, []);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      console.log('User idle for 15 minutes, auto-refreshing Payment Method data...');
      try {
        await loadPaymentMethods(true); // Silent refresh
      } catch (err) {
        console.error('Idle refresh failed:', err);
      }
      // Set the timer again to refresh every 15 mins if they remain idle
      startTimer();
    };

    const startTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(refreshData, IDLE_TIME_LIMIT);
    };

    const resetTimer = () => {
      startTimer();
    };

    const activityEvents = ['mousedown', 'keypress', 'touchstart'];

    const handleActivity = () => {
      resetTimer();
    };

    // Use passive listeners for performance
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    startTimer(); // Initialize timer on mount

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, []);

  const loadPaymentMethods = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/payment-methods`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json();

      if (data.success) {
        setPaymentMethods(data.data || []);
      } else {
        console.error('API returned error:', data.message);
        setPaymentMethods([]);
      }
    } catch (error) {
      console.error('Error loading payment methods:', error);
      setPaymentMethods([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (paymentMethod: PaymentMethod) => {
    if (!actions.canDelete) return;
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete "${paymentMethod.payment_method}"?`,
      () => executeDelete(paymentMethod)
    );
  };

  const executeDelete = async (paymentMethod: PaymentMethod) => {
    closeGlobalModal();
    
    setDeletingItems(prev => {
      const newSet = new Set(prev);
      newSet.add(paymentMethod.id);
      return newSet;
    });

    showGlobalModal('loading', 'Deleting', `Removing payment method "${paymentMethod.payment_method}"...`);

    try {
      const response = await authFetch(`${API_BASE_URL}/payment-methods/${paymentMethod.id}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await loadPaymentMethods(true);
        showGlobalModal('success', 'Deleted', data.message || 'Payment method deleted successfully');
      } else {
        showGlobalModal('error', 'Delete Failed', data.message || 'Failed to delete payment method');
      }
    } catch (error: any) {
      console.error('Error deleting payment method:', error);
      showGlobalModal('error', 'Error', error.message || 'An unexpected error occurred during deletion');
    } finally {
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(paymentMethod.id);
        return newSet;
      });
    }
  };

  const handleEdit = (paymentMethod: PaymentMethod) => {
    if (!actions.canEdit) return;
    setEditingPaymentMethod(paymentMethod);
    setShowAddModal(true);
  };

  const handleAddNew = () => {
    if (!actions.canCreate) return;
    setEditingPaymentMethod(null);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingPaymentMethod(null);
  };

  const handleSaveModal = async () => {
    await loadPaymentMethods();
  };

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

  const filteredPaymentMethods = paymentMethods.filter(pm => {
    // Get current user's organization_id for frontend-side filtering
    let currentUserOrgId: number | null = null;
    const authDataStr = localStorage.getItem('authData');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        currentUserOrgId = authData.user?.organization?.id || authData.user?.organization_id || authData.organization?.id || authData.organization_id || null;
      } catch (e) {}
    }

    // Organization filter
    const matchesOrg = currentUserOrgId 
      ? pm.organization_id === currentUserOrgId 
      : !pm.organization_id;

    if (!matchesOrg) return false;

    const query = searchQuery.toLowerCase();
    return pm.payment_method.toLowerCase().includes(query);
  });

  const totalPages = Math.ceil(filteredPaymentMethods.length / itemsPerPage);
  const paginatedPaymentMethods = filteredPaymentMethods.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleItemsPerPageChange = (newCount: number) => {
    setItemsPerPage(newCount);
    setCurrentPage(1);
  };

  const renderListItem = (pm: PaymentMethod) => {
    return (
      <div 
        key={pm.id} 
        onClick={() => handleEdit(pm)}
        className={`group px-4 py-3 flex items-center justify-between cursor-pointer transition-all duration-200 border-b border-gray-800/10 dark:divide-white/5 ${isDarkMode 
          ? 'hover:bg-white/[0.02]' 
          : 'hover:bg-gray-50'
        }`}
      >
        <div className="flex-1 min-w-0 pr-4">
          <h3 className={`text-sm font-medium uppercase tracking-wide group-hover:translate-x-1 transition-transform duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>
            {pm.payment_method}
          </h3>
          <div className={`flex items-center gap-4 mt-1 text-[10px] uppercase font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
            }`}>
            <span>Created: {formatDate(pm.created_at)}</span>
            <span>Updated: {formatDate(pm.updated_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions.canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); handleEdit(pm); }}
            className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-800'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
          >
            <Edit2 size={16} />
          </button>
          )}
          {actions.canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(pm); }}
            disabled={deletingItems.has(pm.id)}
            className={`p-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
              ? 'text-gray-400 hover:text-red-400 hover:bg-gray-800'
              : 'text-gray-600 hover:text-red-600 hover:bg-gray-100'
              }`}
          >
            {deletingItems.has(pm.id) ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}
          </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`h-full flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'
      }`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
        }`}>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <GlobalSearch 
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search Payment Methods"
            />
            {actions.canCreate && (
            <button
              onClick={handleAddNew}
              className="px-4 py-2.5 text-white rounded-lg flex items-center gap-2 transition-all font-medium text-xs active:scale-95 shadow-sm"
              style={{
                backgroundColor: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent) {
                  e.currentTarget.style.backgroundColor = colorPalette.accent;
                }
              }}
              onMouseLeave={(e) => {
                if (colorPalette?.primary) {
                  e.currentTarget.style.backgroundColor = colorPalette.primary;
                }
              }}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden md:inline">Add Method</span>
            </button>
            )}
            <button
              onClick={() => loadPaymentMethods()}
              className="p-2.5 rounded-lg flex items-center justify-center transition-colors shadow-sm active:rotate-180 duration-500"
              title="Refresh List"
              style={{
                backgroundColor: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent) {
                  e.currentTarget.style.backgroundColor = colorPalette.accent;
                }
              }}
              onMouseLeave={(e) => {
                if (colorPalette?.primary) {
                  e.currentTarget.style.backgroundColor = colorPalette.primary;
                }
              }}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                style={{
                  color: '#ffffff'
                }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {isLoading && paymentMethods.length === 0 ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className={`h-8 w-8 animate-spin ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} />
          </div>
        ) : paginatedPaymentMethods.length > 0 ? (
          <div>
            {paginatedPaymentMethods.map(renderListItem)}
          </div>
        ) : (
          <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
            }`}>
            No payment methods found
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {!isLoading && filteredPaymentMethods.length > 0 && totalPages > 1 && (
        <div className={`border-t p-4 flex items-center justify-between ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200 shadow-lg'}`}>
          <div className={`flex items-center gap-4 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            <div className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={itemsPerPage}
                onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                className={`px-2 py-1 rounded border focus:outline-none text-xs transition-colors ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white focus:border-orange-500'
                  : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
                  }`}
              >
                {[10, 25, 50, 100].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <span>entries</span>
            </div>
            <div>
              Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredPaymentMethods.length)}</span> of <span className="font-medium">{filteredPaymentMethods.length}</span> results
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
              className={`p-1.5 rounded transition-colors ${currentPage === 1
                ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                }`}
              title="First Page"
            >
              <ChevronsLeft size={14} />
            </button>

            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`p-1.5 rounded transition-colors ${currentPage === 1
                ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                }`}
            >
              <ChevronLeft size={14} />
            </button>

            <div className="flex items-center space-x-1">
              <span className={`px-2 text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Page {currentPage} of {totalPages}
              </span>
            </div>

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`p-1.5 rounded transition-colors ${currentPage === totalPages
                ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                }`}
            >
              <ChevronRight size={14} />
            </button>

            <button
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
              className={`p-1.5 rounded transition-colors ${currentPage === totalPages
                ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                }`}
              title="Last Page"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      )}

      <AddPaymentMethodModal
        isOpen={showAddModal}
        onClose={handleCloseModal}
        onSave={handleSaveModal}
        editingPaymentMethod={editingPaymentMethod}
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
    </div>
  );
};

export default PaymentMethodList;

import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, Loader2, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import StatusRemarksFormModal from '../modals/StatusRemarksFormModal';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { usePageActions } from '../hooks/usePageActions';

interface StatusRemark {
  id: number;
  status_remarks: string;
  created_at?: string;
  created_by_user?: string;
  updated_at?: string;
  updated_by_user?: string;
}

interface GlobalModalState {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
}

const StatusRemarksList: React.FC = () => {
  // Add/edit/delete on this list. The same key the API demands, so a
  // control is only drawn when the request behind it would succeed.
  const actions = usePageActions('status-remarks-list');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusRemarks, setStatusRemarks] = useState<StatusRemark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRemark, setEditingRemark] = useState<StatusRemark | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [globalModal, setGlobalModal] = useState<GlobalModalState>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

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
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    loadStatusRemarks();
  }, []);

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

  const loadStatusRemarks = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await apiClient.get('/status-remarks') as any;

      if (response.data.success) {
        setStatusRemarks(response.data.data || []);
      } else {
        console.error('API returned error:', response.data.message);
        setStatusRemarks([]);
      }
    } catch (error) {
      console.error('Error loading status remarks:', error);
      setStatusRemarks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (remark: StatusRemark) => {
    if (!actions.canDelete) return;
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete this status remark?`,
      () => executeDelete(remark)
    );
  };

  const executeDelete = async (remark: StatusRemark) => {
    closeGlobalModal();
    
    setDeletingItems(prev => {
      const newSet = new Set(prev);
      newSet.add(remark.id);
      return newSet;
    });

    showGlobalModal('loading', 'Deleting Remark', `Removing from database...`);

    try {
      const response = await apiClient.delete(`/status-remarks/${remark.id}`) as any;

      if (response.data.success) {
        await loadStatusRemarks(true);
        showGlobalModal(
          'success', 
          'Deleted', 
          (response.data.message || 'Status remark deleted successfully')
        );
      } else {
        showGlobalModal(
          'error', 
          'Delete Failed', 
          (response.data.message || 'Failed to delete status remark')
        );
      }
    } catch (error: any) {
      console.error('Error deleting status remark:', error);
      showGlobalModal(
        'error', 
        'Error', 
        error.response?.data?.message || 'Failed to delete status remark'
      );
    } finally {
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(remark.id);
        return newSet;
      });
    }
  };

  const handleEdit = (remark: StatusRemark) => {
    if (!actions.canEdit) return;
    setEditingRemark(remark);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingRemark(null);
  };

  const handleSaveModal = () => {
    loadStatusRemarks();
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

  const filteredRemarks = statusRemarks.filter(remark => {
    const query = searchQuery.toLowerCase();
    return remark.status_remarks.toLowerCase().includes(query);
  });

  const totalPages = Math.ceil(filteredRemarks.length / itemsPerPage);
  const paginatedRemarks = filteredRemarks.slice(
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

  const renderListItem = (remark: StatusRemark) => {
    return (
      <div key={remark.id} className={`border-b group cursor-pointer transition-colors ${isDarkMode ? 'bg-gray-900 border-gray-800 hover:bg-gray-800/50' : 'bg-white border-gray-200 hover:bg-gray-50'
        }`}
        onClick={() => handleEdit(remark)}
      >
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-3">
              <h3 className={`font-medium text-sm uppercase tracking-wide group-hover:translate-x-1 transition-transform duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{remark.status_remarks}</h3>
            </div>
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[10px] uppercase font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>
              <span>Created: {formatDate(remark.created_at)} (By: {remark.created_by_user || 'System'})</span>
              <span>Updated: {formatDate(remark.updated_at)} (By: {remark.updated_by_user || 'System'})</span>
            </div>
          </div>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions.canEdit && (
              <button
                onClick={() => handleEdit(remark)}
                className={`p-2 rounded transition-colors ${isDarkMode
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                title="Edit"
              >
                <Edit2 className="h-4 w-4" />
              </button>
            )}
            {actions.canDelete && (
              <button
                onClick={() => handleDelete(remark)}
                disabled={deletingItems.has(remark.id)}
                className={`p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${isDarkMode
                  ? 'text-gray-400 hover:text-red-400 hover:bg-gray-700'
                  : 'text-gray-600 hover:text-red-600 hover:bg-gray-100'
                  }`}
                title="Delete"
              >
                {deletingItems.has(remark.id) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };


  return (
    <div className={`h-full flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      <div className={`sticky top-0 z-10 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
        }`}>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <GlobalSearch 
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search Status Remarks..."
            />
            {actions.canCreate && (
            <button
              onClick={() => {
                setEditingRemark(null);
                setShowAddModal(true);
              }}
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
              <span className="hidden md:inline">Add Remark</span>
            </button>
            )}
            <button
              onClick={() => loadStatusRemarks()}
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

      <div className="flex-1 overflow-auto custom-scrollbar">
        {isLoading && statusRemarks.length === 0 ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className={`h-8 w-8 animate-spin ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} />
          </div>
        ) : paginatedRemarks.length > 0 ? (
          <div>
            {paginatedRemarks.map(renderListItem)}
          </div>
        ) : (
          <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
            }`}>
            No status remarks found
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {!isLoading && filteredRemarks.length > 0 && totalPages > 1 && (
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
              Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredRemarks.length)}</span> of <span className="font-medium">{filteredRemarks.length}</span> results
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
    </div>
  );
};

export default StatusRemarksList;

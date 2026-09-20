import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Edit2, Trash2, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import EditNapModal from '../modals/EditNapModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useNapStore } from '../store/napStore';
import { NAP } from '../services/napService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { usePageActions } from '../hooks/usePageActions';

interface NapFormData {
  name: string;
}

const NapList: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed. handleEdit also backs the row click, so guarding it stops a
  // row opening the edit modal for a role that may not save from it.
  const actions = usePageActions('nap');

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NAP | null>(null);

  const [deletingItems, setDeletingItems] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState<number>(50);

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

  const {
    napItems,
    isLoading,
    error,
    currentPage,
    totalCount,
    fetchNapItems,
    addNapItem,
    updateNapItem,
    deleteNapItem,
    searchQuery,
    setSearchQuery,
    refreshNapItems
  } = useNapStore();

  const totalPages = Math.ceil(totalCount / itemsPerPage);

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

  // Initial load
  useEffect(() => {
    refreshNapItems();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Idle detection and auto-refresh logic
  const { silentRefresh } = useNapStore();
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      console.log('User idle for 15 minutes, auto-refreshing NAP data...');
      try {
        await silentRefresh();
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
  }, [silentRefresh]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      fetchNapItems(newPage, itemsPerPage, searchQuery);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    searchTimeout.current = setTimeout(() => {
      fetchNapItems(1, itemsPerPage, query);
    }, 500);
  };

  const handleItemsPerPageChange = (newCount: number) => {
    setItemsPerPage(newCount);
    fetchNapItems(1, newCount, searchQuery);
  };

  const handleDelete = (item: NAP, event: React.MouseEvent) => {
    if (!actions.canDelete) return;
    event.stopPropagation();
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete "${item.nap_name}"?`,
      () => executeDelete(item)
    );
  };

  const executeDelete = async (item: NAP) => {
    closeGlobalModal();
    
    setDeletingItems(prev => {
      const newSet = new Set(prev);
      newSet.add(item.id);
      return newSet;
    });

    showGlobalModal('loading', 'Deleting', `Removing ${item.nap_name}...`);

    try {
      await deleteNapItem(item.id);
      showGlobalModal('success', 'Deleted', 'NAP item deleted successfully');
    } catch (error: any) {
      console.error('Error deleting NAP:', error);
      showGlobalModal('error', 'Error', error.response?.data?.message || error.message || 'Failed to delete NAP');
    } finally {
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(item.id);
        return newSet;
      });
    }
  };

  const handleEdit = (item: NAP, event: React.MouseEvent) => {
    if (!actions.canEdit) return;
    event.stopPropagation();
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    if (!actions.canCreate) return;
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleSave = async (formData: NapFormData) => {
    try {
      const authData = localStorage.getItem('authData');
      const currentUserEmail = authData ? JSON.parse(authData)?.email : 'system';

      if (editingItem) {
        await updateNapItem(editingItem.id, formData.name.trim(), currentUserEmail);
      } else {
        await addNapItem(formData.name.trim(), currentUserEmail);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      throw error;
    }
  };

  return (
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      } h-full flex overflow-hidden`}>
      <div className={`${isDarkMode ? 'bg-gray-900' : 'bg-white'
        } overflow-hidden flex-1`}>
        <div className="flex flex-col h-full text-xs md:text-sm">
          {/* Header */}
          <div className={`sticky top-0 z-10 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <GlobalSearch 
                  searchQuery={searchQuery}
                  setSearchQuery={handleSearchChange}
                  isDarkMode={isDarkMode}
                  colorPalette={colorPalette}
                  placeholder="Search NAP"
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
                  <span className="hidden md:inline">Add NAP</span>
                </button>
                )}
                <button
                  onClick={() => fetchNapItems(1, itemsPerPage, searchQuery)}
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

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {isLoading && napItems.length === 0 ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <div className="flex flex-col items-center">
                    <Loader2 size={32} className="animate-spin mb-4" style={{ color: colorPalette?.primary }} />
                    <p className="font-medium">Loading NAP items...</p>
                  </div>
                </div>
              ) : error ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'
                  }`}>
                  <p className="font-medium text-lg mb-4">{error}</p>
                  <button
                    onClick={() => fetchNapItems(1, itemsPerPage, searchQuery)}
                    className="px-6 py-2 rounded-lg text-white font-medium transition-all shadow-md active:scale-95"
                    style={{
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    }}>
                    Retry Fetching
                  </button>
                </div>
              ) : napItems.length === 0 ? (
                <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  <div className="flex flex-col items-center">
                    <Search size={48} className="mb-4 opacity-20" />
                    <p className="text-lg">No NAP items found</p>
                    {searchQuery && <p className="text-sm mt-1">Try adjusting your search query</p>}
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {napItems.filter(item => {
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
                    if (currentUserOrgId) {
                      // User with org: only show items for that org
                      return item.organization_id === currentUserOrgId;
                    } else {
                      // User with NO org: only show items with NO org
                      return !item.organization_id;
                    }
                  }).map((item) => (
                    <div
                      key={item.id}
                      onClick={(e) => handleEdit(item, e)}
                      className={`px-4 py-3 cursor-pointer transition-all duration-200 border-b flex items-center justify-between group ${isDarkMode
                        ? 'hover:bg-gray-800/50 border-gray-800'
                        : 'hover:bg-gray-50 border-gray-100'
                        }`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className={`font-medium text-sm uppercase tracking-wide group-hover:translate-x-1 transition-transform duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>
                          {item.nap_name}
                        </div>
                        {item.created_at && (
                          <div className={`text-[10px] mt-1 font-medium flex items-center gap-1.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            <span>Created: {new Date(item.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {actions.canEdit && (
                        <button
                          onClick={(e) => handleEdit(item, e)}
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
                          onClick={(e) => handleDelete(item, e)}
                          disabled={deletingItems.has(item.id)}
                          className={`p-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                            ? 'text-gray-400 hover:text-red-400 hover:bg-gray-800'
                            : 'text-gray-600 hover:text-red-600 hover:bg-gray-100'
                            }`}
                        >
                          {deletingItems.has(item.id) ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className={`px-4 py-8 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      <div className="flex flex-col items-center">
                        <Loader2 size={24} className="animate-spin mb-2" style={{ color: colorPalette?.primary }} />
                        <p className="text-sm">Loading more items...</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {!isLoading && napItems.length > 0 && totalPages > 1 && (
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
                    Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalCount)}</span> of <span className="font-medium">{totalCount}</span> results
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
          </div>
        </div>
      </div>

      {/* Edit/Add NAP Modal */}
      <EditNapModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        napItem={editingItem}
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

export default NapList;

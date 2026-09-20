import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Loader2, X, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { concernService, Concern } from '../services/concernService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import EditConcernModal from '../modals/EditConcernModal';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { usePageActions } from '../hooks/usePageActions';

interface ConcernFormData {
  name: string;
  userId?: number;
  modified_by?: string;
}

const ConcernConfig: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed.
  const actions = usePageActions('concern-config');

  const [isDarkMode, setIsDarkMode] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Concern | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    loadConcerns();
  }, []);

  const loadConcerns = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await concernService.getAllConcerns();
      setConcerns(data);
    } catch (error) {
      console.error('Error loading concerns:', error);
      setError('Failed to load concerns. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (item: Concern, event: React.MouseEvent) => {
    if (!actions.canDelete) return;
    event.stopPropagation();
    showGlobalModal(
      'confirm',
      'Confirm Deletion',
      `Are you sure you want to permanently delete "${item.concern_name}"?`,
      () => executeDelete(item)
    );
  };

  const executeDelete = async (item: Concern) => {
    closeGlobalModal();
    
    setDeletingItems(prev => {
      const newSet = new Set(prev);
      newSet.add(item.id);
      return newSet;
    });

    showGlobalModal('loading', 'Deleting', `Removing concern "${item.concern_name}"...`);

    try {
      await concernService.deleteConcern(item.id);
      await loadConcerns();
      showGlobalModal('success', 'Deleted', 'Concern item deleted successfully');
    } catch (error: any) {
      console.error('Error deleting concern:', error);
      showGlobalModal('error', 'Error', error.message || 'Failed to delete concern');
    } finally {
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(item.id);
        return newSet;
      });
    }
  };

  const handleEdit = (item: Concern, event: React.MouseEvent) => {
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

  const handleSave = async (formData: ConcernFormData) => {
    try {
      if (editingItem) {
        await concernService.updateConcern(editingItem.id, formData.name.trim(), formData.modified_by, formData.userId);
      } else {
        await concernService.createConcern(formData.name.trim(), formData.modified_by, formData.userId);
      }
      await loadConcerns();
    } catch (error) {
      console.error('Error submitting form:', error);
      throw error;
    }
  };

  const filteredConcerns = concerns.filter(item => {
    const query = searchQuery.toLowerCase();
    return item.concern_name.toLowerCase().includes(query);
  });

  const totalPages = Math.ceil(filteredConcerns.length / itemsPerPage);
  const paginatedConcerns = filteredConcerns.slice(
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

  const renderListItem = (item: Concern) => {
    return (
      <div 
        key={item.id} 
        onClick={(e) => handleEdit(item, e)}
        className={`group px-4 py-3 flex items-center justify-between cursor-pointer transition-all duration-200 border-b border-gray-800/10 dark:divide-white/5 ${isDarkMode 
          ? 'hover:bg-white/[0.02]' 
          : 'hover:bg-gray-50'
        }`}
      >
        <div className="flex-1 min-w-0 pr-4">
          <h3 className={`text-sm font-medium uppercase tracking-wide group-hover:translate-x-1 transition-transform duration-200 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>
            {item.concern_name}
          </h3>
          <div className={`flex items-center gap-4 mt-1 text-[10px] uppercase font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
            }`}>
            <span>System Classification ID: {item.id}</span>
          </div>
        </div>
        {item.modified_by && item.modified_at && (
          <div className="hidden lg:flex flex-col items-end px-6 text-[10px] uppercase tracking-widest font-bold">
            <div className="flex items-center gap-2">
              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>MODIFIED BY:</span>
              <span className={isDarkMode ? 'text-white' : 'text-black'}>
                {item.modified_by}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>MODIFIED AT:</span>
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                {new Date(item.modified_at).toLocaleString('en-US', {
                  month: '2-digit',
                  day: '2-digit',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: true
                }).replace(',', '')}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
              placeholder="Search Concern database"
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
              <span className="hidden md:inline">Add Concern</span>
            </button>
            )}
            <button
              onClick={() => loadConcerns()}
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
        {isLoading && concerns.length === 0 ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className={`h-8 w-8 animate-spin ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`} />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="bg-red-500/10 p-4 rounded-full">
              <X size={48} className="text-red-500" />
            </div>
            <p className="text-lg font-bold text-red-500">{error}</p>
            <button
              onClick={() => loadConcerns()}
              className="px-8 py-2.5 rounded-xl text-white font-bold transition-all shadow-xl active:scale-95"
              style={{
                backgroundColor: colorPalette?.primary || '#7c3aed'
              }}>
              Retry Connection
            </button>
          </div>
        ) : paginatedConcerns.length > 0 ? (
          <div>
            {paginatedConcerns.map(renderListItem)}
          </div>
        ) : (
          <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
            }`}>
            No matching concerns found
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {!isLoading && filteredConcerns.length > 0 && totalPages > 1 && (
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
              Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredConcerns.length)}</span> of <span className="font-medium">{filteredConcerns.length}</span> results
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

      {/* Edit/Add Concern Modal */}
      <EditConcernModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        concernItem={editingItem}
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

export default ConcernConfig;

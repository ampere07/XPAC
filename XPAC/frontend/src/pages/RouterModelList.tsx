import React, { useState, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, Filter, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import AddRouterModelModal from '../modals/AddRouterModelModal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { authFetch } from '../config/api';
import { usePageActions } from '../hooks/usePageActions';

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
  // Add/edit/delete on this list. The same key the API demands, so a
  // control is only drawn when the request behind it would succeed.
  const actions = usePageActions('router-models');
  const [searchQuery, setSearchQuery] = useState('');
  const [routers, setRouters] = useState<RouterModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRouter, setEditingRouter] = useState<RouterModel | null>(null);
  const [deletingItems, setDeletingItems] = useState<Set<string>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    loadRouters();
  }, []);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      console.log('User idle for 15 minutes, auto-refreshing Router Model data...');
      try {
        await loadRouters(true); // Silent refresh
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
      console.log('Loading routers from API:', `${API_BASE_URL}/router-models`);

      const response = await authFetch(`${API_BASE_URL}/router-models`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      console.log('API Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error:', errorData);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log('API Response data:', data);

      if (data.success) {
        console.log('Setting routers data:', data.data);
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

  const handleDelete = async (router: RouterModel) => {
    if (!actions.canDelete) return;
    if (!window.confirm(`⚠️ PERMANENT DELETE WARNING ⚠️\n\nAre you sure you want to permanently delete router model "${router.brand} ${router.Model}"?\n\nThis will PERMANENTLY REMOVE the router model from the database and CANNOT BE UNDONE!\n\nClick OK to permanently delete, or Cancel to keep the router model.`)) {
      return;
    }

    setDeletingItems(prev => {
      const newSet = new Set(prev);
      newSet.add(router.SN);
      return newSet;
    });

    try {
      const response = await authFetch(`${API_BASE_URL}/router-models/${router.SN}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await loadRouters();
        alert('✅ Router model permanently deleted from database: ' + (data.message || 'Router model deleted successfully'));
      } else {
        alert('❌ Failed to delete router model: ' + (data.message || 'Failed to delete router model'));
      }
    } catch (error) {
      console.error('Error deleting router model:', error);
      alert('Failed to delete router model: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setDeletingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(router.SN);
        return newSet;
      });
    }
  };

  const handleEdit = (router: RouterModel) => {
    if (!actions.canEdit) return;
    setEditingRouter(router);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    if (!actions.canCreate) return;
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

  const getFilteredRouters = () => {
    if (!searchQuery) return routers;

    return routers.filter(router =>
      (router.brand && router.brand.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (router.Model && router.Model.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (router.SN && router.SN.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (router.description && router.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  };

  const renderListItem = (router: RouterModel) => {
    const isActive = router.is_active !== undefined ? router.is_active : true;

    return (
      <div key={router.SN} className="bg-gray-900 border-b border-gray-800">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="text-white font-medium text-lg">
                {router.brand || 'Unknown Brand'} {router.Model || 'Unknown Model'}
              </h3>
              <span className="text-xs px-2 py-1 rounded bg-blue-800 text-blue-400">
                SN: {router.SN}
              </span>
              {isActive && (
                <span className="text-xs px-2 py-1 rounded bg-green-800 text-green-400">
                  Active
                </span>
              )}
            </div>
            {router.description && (
              <p className="text-gray-400 text-sm mt-1">{router.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>Modified: {formatDate(router.modified_date)}</span>
              <span>By: {router.modified_by || 'System'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actions.canEdit && (
              <button
                onClick={() => handleEdit(router)}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                title="Edit"
              >
                <Edit2 className="h-4 w-4" />
              </button>
            )}
            {actions.canDelete && (
              <button
                onClick={() => handleDelete(router)}
                disabled={deletingItems.has(router.SN)}
                className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title={deletingItems.has(router.SN) ? 'Permanently Deleting...' : 'Permanently Delete'}
              >
                {deletingItems.has(router.SN) ? (
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

  const filteredRouters = getFilteredRouters();

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-white">Router Models</h1>
            <div className="flex items-center gap-3">
              {actions.canCreate && (
                <button
                  onClick={handleAddNew}
                  className="px-4 py-2 text-white rounded-lg flex items-center gap-2 transition-colors"
                  style={{
                    backgroundColor: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </button>
              )}
              <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                <Filter className="h-5 w-5" />
              </button>
              <button className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-500" />
            <input
              type="text"
              placeholder="Search Router Models"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:outline-none"
              onFocus={(e) => {
                if (colorPalette?.primary) {
                  e.currentTarget.style.borderColor = colorPalette.primary;
                  e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#374151';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        ) : filteredRouters.length > 0 ? (
          <div>
            {filteredRouters.map(renderListItem)}
          </div>
        ) : (
          <div className="text-center py-20 text-gray-500">
            No router models found
          </div>
        )}
      </div>

      <AddRouterModelModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSave={handleModalSave}
        editingRouter={editingRouter}
      />
    </div>
  );
};

export default RouterModelList;

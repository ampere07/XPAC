import React, { useState, useEffect } from 'react';
import { Plus, Eye, Edit, Trash2 } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import AddInventoryCategoryModal from '../modals/AddInventoryCategoryModal';
import {
  getInventoryCategories,
  createInventoryCategory,
  deleteInventoryCategory,
  InventoryCategory
} from '../services/inventoryCategoryService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';

const InventoryCategoryList: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userOrgId] = useState<number | null>(() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
    } catch {
      return null;
    }
  });

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
    fetchCategories();
  }, []);

  // Real-time updates via Pusher/Soketi
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      try {
        await fetchCategories(true);
      } catch (err) {
        console.error('[InventoryCategory Soketi] Failed to refresh data:', err);
      }
    };

    const categoryChannel = pusher.subscribe('inventory-categories');
    categoryChannel.bind('inventory-category-updated', handleUpdate);

    return () => {
      categoryChannel.unbind('inventory-category-updated', handleUpdate);
      pusher.unsubscribe('inventory-categories');
    };
  }, []);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await fetchCategories(true); // Silent refresh
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

  const fetchCategories = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const data = await getInventoryCategories();
      setCategories(data);

    } catch (error) {
      console.error('Error fetching inventory categories:', error);
      setError('Failed to fetch inventory categories');
    } finally {
      setLoading(false);
    }
  };

  const filteredCategories = categories.filter(category => {
    const matchesSearch = category.name.toLowerCase().includes(searchQuery.toLowerCase());
    // Mirror applicationmanagement.tsx org filter logic exactly
    const matchesOrg = userOrgId
      ? category.organization_id === userOrgId
      : !category.organization_id;
    return matchesSearch && matchesOrg;
  });

  const handleView = (category: InventoryCategory) => {
    // Implement view functionality
  };

  const handleEdit = (category: InventoryCategory) => {
    // Implement edit functionality
  };

  const handleDelete = async (category: InventoryCategory) => {
    if (window.confirm(`Are you sure you want to delete the category "${category.name}"?`)) {
      try {
        await deleteInventoryCategory(category.id);
        setCategories(prev => prev.filter(c => c.id !== category.id));
      } catch (error) {
        console.error('Error deleting category:', error);
        alert('Failed to delete category. Please try again.');
      }
    }
  };

  const handleAddCategory = async (categoryData: { name: string; modified_by?: string }) => {
    try {
      const newCategory = await createInventoryCategory(categoryData);
      setCategories(prev => [newCategory, ...prev]);
    } catch (error) {
      console.error('Error adding category:', error);
      alert('Failed to add category. Please try again.');
    }
  };

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return 'N/A';
    }
  };

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mb-4" style={{ borderColor: 'transparent', borderBottomColor: colorPalette?.primary || '#7c3aed' }}></div>
          <div className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Loading categories...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
        <div className="text-center">
          <div className={`text-lg mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Error Loading Categories</div>
          <div className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>{error}</div>
          <button
            onClick={() => fetchCategories()}
            className="text-white px-4 py-2 rounded transition-colors"
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
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {/* Header */}
      <div className={`px-6 py-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}>
        <div className="flex items-center justify-between">
          <h1 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Inventory Category List</h1>
          <div className="flex items-center space-x-4">
            <button className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>
            <button className="text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Search and Add Section */}
      <div className={`px-6 py-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}>
        <div className="flex items-center justify-between">
          <GlobalSearch 
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search Inventory Category List"
          />
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="text-white px-4 py-2 rounded text-sm flex items-center space-x-2 transition-colors ml-4"
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
            <Plus size={16} />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Categories List */}
      <div className="flex-1 overflow-y-auto">
        {filteredCategories.length > 0 ? (
          <div className="divide-y divide-gray-700">
            {filteredCategories.map((category) => (
              <div
                key={category.id}
                className={`px-6 py-4 flex items-center justify-between transition-colors group ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  }`}
              >
                <div className="flex-1">
                  <div className={`font-medium text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                    {category.name}
                  </div>
                  {(category.modified_date || category.updated_at) && (
                    <div className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      {formatDateTime(category.modified_date || category.updated_at || '')}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleView(category)}
                    className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-blue-400' : 'text-gray-600 hover:text-blue-600'
                      }`}
                    title="View"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    onClick={() => handleEdit(category)}
                    className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-green-400' : 'text-gray-600 hover:text-green-600'
                      }`}
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(category)}
                    className={`p-2 rounded transition-colors ${isDarkMode ? 'text-gray-400 hover:text-red-400' : 'text-gray-600 hover:text-red-600'
                      }`}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`p-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
            <div className="text-lg mb-2">No categories found</div>
            <div className="text-sm">
              {categories.length === 0
                ? 'Start by adding some inventory categories'
                : 'Try adjusting your search filter'
              }
            </div>
          </div>
        )}
      </div>

      <AddInventoryCategoryModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddCategory}
      />
    </div>
  );
};

export default InventoryCategoryList;
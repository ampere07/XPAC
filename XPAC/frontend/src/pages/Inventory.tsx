import React, { useState, useEffect } from 'react';
import { AlertTriangle, Plus, Package } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import InventoryFormModal from '../modals/InventoryFormModal';
import InventoryDetails from '../components/InventoryDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import pusher from '../services/pusherService';

interface InventoryItem {
  item_name: string;
  item_description?: string;
  supplier?: string;
  quantity_alert?: number;
  image?: string;
  category?: string;
  item_id?: number;
  modified_by?: string;
  modified_date?: string;
  user_email?: string;
  total_quantity?: number;
  created_at?: string;
  updated_at?: string;
  organization_id?: number | null;
}

interface Category {
  id: string;
  name: string;
  count: number;
}

interface InventoryFormData {
  itemName: string;
  itemDescription: string;
  supplier: string;
  quantityAlert: number;
  image: File | string | null;
  modifiedBy: string;
  modifiedDate: string;
  category: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

const Inventory: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dbCategories, setDbCategories] = useState<{ id: number; name: string }[]>([]);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentUserOrgId] = useState<number | null>(() => {
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
    fetchInventoryData();
    fetchCategories();
  }, []);

  // Real-time updates via Pusher/Soketi
  useEffect(() => {
    const handleUpdate = async (data: any) => {
      try {
        await Promise.all([fetchInventoryData(true), fetchCategories()]);
      } catch (err) {
        console.error('[Inventory Soketi] Failed to refresh data:', err);
      }
    };

    const inventoryChannel = pusher.subscribe('inventory');
    inventoryChannel.bind('inventory-updated', handleUpdate);

    return () => {
      inventoryChannel.unbind('inventory-updated', handleUpdate);
      pusher.unsubscribe('inventory');
    };
  }, []);

  // Polling for updates every 3 seconds
  useEffect(() => {
    const POLLING_INTERVAL = 3000; // 3 seconds
    const intervalId = setInterval(async () => {
      try {
        await Promise.all([
          fetchInventoryData(true),
          fetchCategories()
        ]);
      } catch (err) {
        console.error('[Inventory Page] Polling failed:', err);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, []);

  // Idle detection and auto-refresh logic
  useEffect(() => {
    const IDLE_TIME_LIMIT = 15 * 60 * 1000; // 15 minutes
    let idleTimer: NodeJS.Timeout | null = null;

    const refreshData = async () => {
      try {
        await Promise.all([
          fetchInventoryData(true), // Silent refresh
          fetchCategories()
        ]);
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
    if (dbCategories.length > 0) {
      // Use org-filtered items for counts so the sidebar reflects what the user can actually see
      const visibleItems = inventoryItems.filter(item => {
        if (currentUserOrgId) {
          return item.organization_id === currentUserOrgId;
        } else {
          return !item.organization_id;
        }
      });

      const categoriesWithCount: Category[] = [
        {
          id: 'all',
          name: 'ALL',
          count: visibleItems.length
        },
        ...dbCategories.map((cat) => {
          const categoryId = cat.name.toLowerCase().replace(/\s+/g, '-');
          const count = visibleItems.filter(item => {
            const itemCategory = (item.category || '').toLowerCase().replace(/\s+/g, '-');
            return itemCategory === categoryId;
          }).length;
          return {
            id: categoryId,
            name: cat.name,
            count
          };
        })
      ];
      setCategories(categoriesWithCount);
    }
  }, [inventoryItems, dbCategories, currentUserOrgId]);

  const getDriveDirectUrl = (url: string | undefined) => {
    if (!url) return '';

    // Check for Google Drive URLs
    if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
      let fileId = '';

      // Try to match /d/ID pattern
      const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (matchD && matchD[1]) {
        fileId = matchD[1];
      }

      // If not found, try id=ID pattern
      if (!fileId) {
        const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (matchId && matchId[1]) {
          fileId = matchId[1];
        }
      }

      if (fileId) {
        // Use thumbnail endpoint which is more reliable for images
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
      }
    }

    return url;
  };

  const fetchInventoryData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const response = await apiClient.get<ApiResponse<InventoryItem[]>>('/inventory');
      const data = response.data;

      if (data.success) {
        setInventoryItems(data.data || []);
        return data.data || [];
      } else {
        setError(data.message || 'Failed to fetch inventory data');
      }
    } catch (error) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const items = await fetchInventoryData(true);
    if (selectedItem && items) {
      const updatedItem = items.find(i => i.item_id === selectedItem.item_id);
      if (updatedItem) {
        setSelectedItem(updatedItem);
      }
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await apiClient.get<ApiResponse<{ id: number; name: string }[]>>('/inventory-categories');
      const data = response.data;

      if (data.success) {
        setDbCategories(data.data || []);
      }
    } catch (error) {
    }
  };

  // Org-filtered base list (mirrors applicationmanagement.tsx logic exactly)
  const orgFilteredItems = inventoryItems.filter(item => {
    if (currentUserOrgId) {
      // User belongs to an org: only show items assigned to that same org
      return item.organization_id === currentUserOrgId;
    } else {
      // User has no org: only show items that have no org assigned
      return !item.organization_id;
    }
  });

  const filteredItems = selectedCategory === '' ? [] : orgFilteredItems.filter(item => {
    const itemCategory = (item.category || '').toLowerCase().replace(/\s+/g, '-');
    const matchesCategory = selectedCategory === 'all' || itemCategory === selectedCategory;

    const checkValue = (val: any): boolean => {
      if (val === null || val === undefined) return false;
      if (typeof val === 'object') {
        return Object.values(val).some(v => checkValue(v));
      }
      return String(val).toLowerCase().includes(searchQuery.toLowerCase());
    };

    const matchesSearch = searchQuery === '' || checkValue(item);

    return matchesCategory && matchesSearch;
  });

  const handleItemClick = (item: InventoryItem) => {
    setSelectedItem(item);
  };

  const handleCloseDetails = () => {
    setSelectedItem(null);
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setShowInventoryForm(true);
  };

  const getSelectedCategoryName = (): string => {
    if (selectedCategory === 'all' || selectedCategory === '') {
      return '';
    }
    const category = categories.find(cat => cat.id === selectedCategory);
    return category ? category.name : '';
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setShowInventoryForm(true);
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    try {
      const response = await apiClient.delete<ApiResponse>(`/inventory/${encodeURIComponent(item.item_name)}`);
      const data = response.data;

      if (data.success) {
        alert('Inventory item deleted successfully!');
        if (selectedItem?.item_name === item.item_name) {
          setSelectedItem(null);
        }
        await fetchInventoryData();
      } else {
        alert('Failed to delete inventory item: ' + data.message);
        console.error('Delete Error:', data);
      }
    } catch (error) {
      console.error('Error deleting inventory item:', error);
      alert('Failed to delete inventory item: Network error');
    }
  };

  const handleSaveInventoryItem = async (formData: InventoryFormData) => {
    try {

      const isEditing = editingItem !== null;
      const payload = {
        item_name: formData.itemName,
        item_description: formData.itemDescription,
        supplier: formData.supplier,
        quantity_alert: formData.quantityAlert,
        category: formData.category,
        item_id: null,
        image: typeof formData.image === 'string' ? formData.image : '',
        modified_by: formData.modifiedBy,
      };

      const response = isEditing

        ? await apiClient.put<ApiResponse>(`/inventory/${encodeURIComponent(editingItem.item_name)}`, payload)
        : await apiClient.post<ApiResponse>('/inventory', payload);

      const data = response.data;

      if (data.success) {
        const message = isEditing ? 'Inventory item updated successfully!' : 'Inventory item added successfully!';
        alert(message);
        setShowInventoryForm(false);
        setEditingItem(null);
        await fetchInventoryData();
        await fetchCategories();
      } else {
        alert('Failed to save inventory item: ' + data.message);
        console.error('Save Error:', data);
      }
    } catch (error) {
      console.error('Error saving inventory item:', error);
      alert('Failed to save inventory item: Network error');
    }
  };

  if (loading) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mb-4" style={{ borderColor: 'transparent', borderBottomColor: colorPalette?.primary || '#7c3aed' }}></div>
          <div className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Loading inventory...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mb-4 mx-auto" />
          <div className={`text-lg mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Error Loading Inventory</div>
          <div className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>{error}</div>
          <button
            onClick={() => fetchInventoryData()}
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
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      } h-full flex flex-col md:flex-row overflow-hidden`}>
      {/* Category Sidebar - Desktop Only */}
      <div className={`hidden md:flex md:w-64 md:border-r flex-shrink-0 flex-col order-1 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}>
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <h2 className={`text-lg font-semibold flex items-center ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>
            <Package className="mr-2" size={20} />
            Inventory
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  }`}
                style={selectedCategory === category.id ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                  color: colorPalette?.primary || '#7c3aed',
                  fontWeight: 500,
                  borderRight: '2px solid',
                  borderRightColor: colorPalette?.primary || '#7c3aed'
                } : {
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}
              >
                <span className="uppercase font-medium text-xs md:text-sm whitespace-nowrap">{category.name}</span>
                <span
                  className="px-2 py-1 rounded-full text-xs"
                  style={selectedCategory === category.id ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    color: 'white'
                  } : {
                    backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                    color: isDarkMode ? '#d1d5db' : '#374151'
                  }}
                >
                  {category.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 overflow-hidden order-2 pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        <div className="flex flex-col h-full">
          {/* Search Bar */}
          <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">
              <GlobalSearch 
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                placeholder="Search inventory..."
              />
              <button
                className="text-white px-4 py-2 rounded text-sm flex items-center space-x-2 transition-colors"
                onClick={handleAddItem}
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
                <span className="hidden sm:inline">Add Item</span>
              </button>
            </div>
          </div>

          {/* Items List */}
          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-gray-700">
              {filteredItems.length > 0 ? (
                filteredItems.map((item, index) => (
                  <div
                    key={item.item_name + index}
                    className={`px-6 py-4 flex items-center justify-between transition-colors cursor-pointer group ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      } ${selectedItem?.item_name === item.item_name
                        ? isDarkMode ? 'bg-gray-800 border-r-2' : 'bg-gray-100 border-r-2'
                        : ''
                      }`}
                    style={selectedItem?.item_name === item.item_name ? { borderRightColor: colorPalette?.primary || '#7c3aed' } : {}}
                    onClick={() => handleItemClick(item)}
                  >
                    <div className="flex items-center">
                      <div className={`w-12 h-12 rounded mr-4 flex items-center justify-center overflow-hidden flex-shrink-0 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                        {item.image ? (
                          <img
                            src={getDriveDirectUrl(item.image)}
                            alt={item.item_name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : (
                          <Package size={24} className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                        )}
                        <Package
                          size={24}
                          className={`hidden absolute ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                        />
                      </div>
                      <div>
                        <div className={`font-medium text-base ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>
                          {item.item_name}
                        </div>
                        {item.modified_date && (
                          <div className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                            }`}>
                            {(() => {
                              const date = new Date(item.modified_date);
                              if (isNaN(date.getTime())) return item.modified_date;
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
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className={`mr-4 text-xs md:text-sm flex flex-col md:flex-row md:items-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        <div className="flex items-center">
                          Total Stock: <span className={`font-medium ml-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.total_quantity || 0}</span>
                        </div>
                        {item.quantity_alert !== undefined && item.quantity_alert !== null && (
                          <div className={`flex items-center md:ml-4 mt-1 md:mt-0 ${item.total_quantity && item.total_quantity <= (item.quantity_alert || 0) ? 'text-red-500 font-bold' : ''}`}>
                            Quantity Alert: <span className={`font-medium ml-1 ${isDarkMode && !(item.total_quantity && item.total_quantity <= (item.quantity_alert || 0)) ? 'text-white' : ''}`}>
                              {item.quantity_alert}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={`p-12 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  <Package size={48} className="mx-auto mb-4 text-gray-600" />
                  <div className="text-lg mb-2">
                    {selectedCategory === '' ? 'Select a category to view items' : 'No items found'}
                  </div>
                  <div className="text-sm">
                    {selectedCategory === ''
                      ? 'Choose a category from the sidebar to see inventory items'
                      : inventoryItems.length === 0
                        ? 'Start by adding some inventory items'
                        : 'Try adjusting your search or category filter'
                    }
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Bar */}
      <div className={`md:hidden fixed bottom-0 left-0 right-0 border-t z-40 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}>
        <div className="flex overflow-x-auto hide-scrollbar">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex-shrink-0 flex flex-col items-center justify-center px-4 py-2 text-xs transition-colors ${selectedCategory === category.id
                ? ''
                : 'text-gray-300'
                }`}
              style={selectedCategory === category.id ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                color: colorPalette?.primary || '#7c3aed'
              } : {}}
            >
              <Package className="h-5 w-5 mb-1" />
              <span className="capitalize whitespace-nowrap">{category.name}</span>
              {category.count > 0 && (
                <span className="mt-1 px-2 py-0.5 rounded-full text-xs"
                  style={selectedCategory === category.id ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    color: 'white'
                  } : {
                    backgroundColor: '#374151',
                    color: '#d1d5db'
                  }}>
                  {category.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Details Panel */}
      {selectedItem && (
        <div className="flex-shrink-0 overflow-hidden order-3">
          <InventoryDetails
            item={selectedItem}
            inventoryLogs={[]}
            jobOrders={[]}
            serviceOrders={[]}
            defectiveLogs={[]}
            totalStockIn={0}
            totalStockAvailable={0}
            onEdit={handleEditItem}
            onDelete={handleDeleteItem}
            onClose={handleCloseDetails}
            onRefresh={handleRefresh}
          />
        </div>
      )}

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Inventory Form Modal */}
      <InventoryFormModal
        isOpen={showInventoryForm}
        onClose={() => {
          setShowInventoryForm(false);
          setEditingItem(null);
        }}
        onSave={handleSaveInventoryItem}
        initialCategory={getSelectedCategoryName()}
        editData={editingItem ? {
          itemName: editingItem.item_name,
          itemDescription: editingItem.item_description || '',
          supplier: editingItem.supplier || '',
          quantityAlert: editingItem.quantity_alert || 0,
          image: editingItem.image || null,
          modifiedBy: editingItem.modified_by || '',
          modifiedDate: editingItem.modified_date || new Date().toISOString().slice(0, 16),
          category: editingItem.category || '',
          createdAt: editingItem.created_at || '',
          updatedAt: editingItem.updated_at || '',
        } : null}
      />
    </div>
  );
};

export default Inventory;

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Pressable,
  Modal,
  Dimensions,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlertTriangle, Plus, Search, Package } from 'lucide-react-native';
import InventoryFormModal from '../modals/InventoryFormModal';
import InventoryDetails from '../components/InventoryDetails';
import { useInventoryContext, InventoryItem } from '../contexts/InventoryContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';

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
  image: File | null;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  category: string;
  totalStockAvailable: number;
  totalStockIn: number;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

const Inventory: React.FC = () => {

  const { inventoryItems, dbCategories, isLoading: loading, error, refreshInventory } = useInventoryContext();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

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
    if (dbCategories.length > 0) {
      const categoriesWithCount: Category[] = [
        {
          id: 'all',
          name: 'ALL',
          count: inventoryItems.length,
        },
        ...dbCategories.map((cat) => {
          const categoryId = cat.name.toLowerCase().replace(/\s+/g, '-');
          const count = inventoryItems.filter((item) => {
            const itemCategory = (item.category || '').toLowerCase().replace(/\s+/g, '-');
            return itemCategory === categoryId;
          }).length;
          return {
            id: categoryId,
            name: cat.name,
            count,
          };
        }),
      ];
      setCategories(categoriesWithCount);
    }
  }, [inventoryItems, dbCategories]);

  // Sync selectedItem with latest data from inventoryItems
  useEffect(() => {
    if (selectedItem) {
      const latestItem = inventoryItems.find((i) => i.item_id === selectedItem.item_id);
      if (latestItem) {
        setSelectedItem((prev) => {
          // Only update if something actually changed to avoid unnecessary re-renders
          if (JSON.stringify(prev) !== JSON.stringify(latestItem)) {
            return latestItem;
          }
          return prev;
        });
      }
    }
  }, [inventoryItems, selectedItem]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshInventory();
    setIsRefreshing(false);
  };

  const filteredItems =
    selectedCategory === ''
      ? []
      : inventoryItems.filter((item) => {
        const itemCategory = (item.category || '').toLowerCase().replace(/\s+/g, '-');
        const matchesCategory = selectedCategory === 'all' || itemCategory === selectedCategory;

        const matchesSearch =
          searchQuery === '' ||
          item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (item.item_description &&
            item.item_description.toLowerCase().includes(searchQuery.toLowerCase()));

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
    const category = categories.find((cat) => cat.id === selectedCategory);
    return category ? category.name : '';
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setShowInventoryForm(true);
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    try {
      const response = await apiClient.delete<ApiResponse>(
        `/inventory/${encodeURIComponent(item.item_name)}`
      );
      const data = response.data;

      if (data.success) {
        Alert.alert('Success', 'Inventory item deleted successfully!');
        if (selectedItem?.item_name === item.item_name) {
          setSelectedItem(null);
        }
        await refreshInventory();
      } else {
        Alert.alert('Error', 'Failed to delete inventory item: ' + data.message);
        console.error('Delete Error:', data);
      }
    } catch (error) {
      console.error('Error deleting inventory item:', error);
      Alert.alert('Error', 'Failed to delete inventory item: Network error');
    }
  };

  const handleSaveInventoryItem = async (formData: InventoryFormData) => {
    try {
      console.log('Saving inventory item:', formData);

      const isEditing = editingItem !== null;
      const payload = {
        item_name: formData.itemName,
        item_description: formData.itemDescription,
        supplier: formData.supplier,
        quantity_alert: formData.quantityAlert,
        category: formData.category,
        item_id: null,
        image: '',
      };

      const response = isEditing
        ? await apiClient.put<ApiResponse>(
          `/inventory/${encodeURIComponent(editingItem.item_name)}`,
          payload
        )
        : await apiClient.post<ApiResponse>('/inventory', payload);

      const data = response.data;

      if (data.success) {
        const message = isEditing
          ? 'Inventory item updated successfully!'
          : 'Inventory item added successfully!';
        Alert.alert('Success', message);
        setShowInventoryForm(false);
        setEditingItem(null);
        await refreshInventory();
      } else {
        Alert.alert('Error', 'Failed to save inventory item: ' + data.message);
        console.error('Save Error:', data);
      }
    } catch (error) {
      console.error('Error saving inventory item:', error);
      Alert.alert('Error', 'Failed to save inventory item: Network error');
    }
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
        }}
      >
        <ActivityIndicator size="large" color="#7c3aed" style={{ marginBottom: 16 }} />
        <Text style={{ fontSize: 18, color: '#111827' }}>
          Loading inventory...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
        }}
      >
        <AlertTriangle size={48} color="#ef4444" style={{ marginBottom: 16 }} />
        <Text
          style={{
            fontSize: 18,
            marginBottom: 8,
            color: '#111827',
          }}
        >
          Error Loading Inventory
        </Text>
        <Text
          style={{
            marginBottom: 16,
            color: '#4b5563',
          }}
        >
          {error}
        </Text>
        <TouchableOpacity
          onPress={refreshInventory}
          style={{
            backgroundColor: primaryColor,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 6,
          }}
        >
          <Text style={{ color: '#ffffff' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#f9fafb',
      }}
    >
      {/* Main Content Area */}
      <View
        style={{
          flex: 1,
          backgroundColor: '#ffffff',
          paddingBottom: 64,
        }}
      >
        {/* Search Bar */}
        <View
          style={{
            padding: 16,
            paddingTop: isTablet ? 16 : 60,
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
            backgroundColor: '#ffffff',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <View style={{ flex: 1, position: 'relative', justifyContent: 'center' }}>
            <Search
              size={16}
              color={'#6b7280'}
              style={{ position: 'absolute', left: 10, zIndex: 1 }}
            />
            <TextInput
              placeholder="Search inventory..."
              placeholderTextColor={'#9ca3af'}
              value={searchQuery}
              onChangeText={(text) => setSearchQuery(text)}
              style={{
                width: '100%',
                borderRadius: 6,
                paddingLeft: 36,
                paddingRight: 16,
                paddingVertical: 8,
                borderWidth: 1,
                backgroundColor: '#f3f4f6',
                color: '#111827',
                borderColor: '#d1d5db',
              }}
            />
          </View>
          <TouchableOpacity
            onPress={handleAddItem}
            style={{
              backgroundColor: primaryColor,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={16} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 14 }}>Add Item</Text>
          </TouchableOpacity>
        </View>

        {/* Items List */}
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colorPalette?.primary || '#7c3aed'}
              colors={[colorPalette?.primary || '#7c3aed']}
            />
          }
        >
          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => {
              const isSelected = selectedItem?.item_name === item.item_name;
              return (
                <Pressable
                  key={item.item_name + index}
                  onPress={() => handleItemClick(item)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
                    borderColor: '#e5e7eb'
                  }}
                >
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{
                        fontWeight: '500',
                        fontSize: 16,
                        color: '#111827'
                      }}>
                        {item.item_name}
                      </Text>
                    </View>
                    <View style={{
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 4,
                      marginLeft: 16,
                      flexShrink: 0
                    }}>
                      <Text style={{ fontSize: 13, color: '#374151', fontWeight: '500' }}>
                        Total Stock: <Text style={{ color: '#111827', fontWeight: 'bold' }}>{item.total_quantity || 0}</Text>
                      </Text>
                      <Text style={{ fontSize: 13, color: '#ef4444', fontWeight: '500' }}>
                        Qty Alert: <Text style={{ fontWeight: 'bold' }}>{item.quantity_alert || 0}</Text>
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })
          ) : (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <Package size={48} color="#4b5563" style={{ marginBottom: 16 }} />
              <Text
                style={{
                  fontSize: 18,
                  marginBottom: 8,
                  color: '#4b5563',
                }}
              >
                {selectedCategory === '' ? 'Select a category to view items' : 'No items found'}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  color: '#4b5563',
                  textAlign: 'center',
                }}
              >
                {selectedCategory === ''
                  ? 'Choose a category from the bottom bar to see inventory items'
                  : inventoryItems.length === 0
                    ? 'Start by adding some inventory items'
                    : 'Try adjusting your search or category filter'}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Inventory Details Panel */}
      <Modal visible={!!selectedItem} animationType="slide" onRequestClose={handleCloseDetails}>
        {selectedItem && (
          <View style={{ flex: 1 }}>
            <InventoryDetails
              item={selectedItem}
              inventoryLogs={[]}
              borrowedLogs={[]}
              jobOrders={[]}
              serviceOrders={[]}
              defectiveLogs={[]}
              totalStockIn={selectedItem.total_quantity || 0}
              totalStockAvailable={selectedItem.total_quantity || 0}
              onEdit={handleEditItem}
              onDelete={handleDeleteItem}
              onClose={handleCloseDetails}
            />
          </View>
        )}
      </Modal>

      {/* Bottom Category Bar */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          zIndex: 40,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {categories.map((category) => {
            const isActive = selectedCategory === category.id;
            return (
              <TouchableOpacity
                key={category.id}
                onPress={() => setSelectedCategory(category.id)}
                style={{
                  flexShrink: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  backgroundColor: isActive
                    ? colorPalette?.primary
                      ? `${colorPalette.primary}33`
                      : 'rgba(249, 115, 22, 0.2)'
                    : 'transparent',
                }}
              >
                <Package
                  size={20}
                  color={isActive ? (colorPalette?.primary || '#fb923c') : '#d1d5db'}
                  style={{ marginBottom: 4 }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    color: isActive ? (colorPalette?.primary || '#fb923c') : '#d1d5db',
                    textTransform: 'capitalize',
                  }}
                >
                  {category.name}
                </Text>
                {category.count > 0 && (
                  <View
                    style={{
                      marginTop: 4,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 9999,
                      backgroundColor: isActive
                        ? (colorPalette?.primary || '#7c3aed')
                        : '#374151',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: isActive ? '#ffffff' : '#d1d5db',
                      }}
                    >
                      {category.count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Inventory Form Modal */}
      <InventoryFormModal
        isOpen={showInventoryForm}
        onClose={() => {
          setShowInventoryForm(false);
          setEditingItem(null);
        }}
        onSave={handleSaveInventoryItem}
        initialCategory={getSelectedCategoryName()}
        editData={
          editingItem
            ? {
              itemName: editingItem.item_name,
              itemDescription: editingItem.item_description || '',
              supplier: editingItem.supplier || '',
              quantityAlert: editingItem.quantity_alert || 0,
              image: null,
              modifiedBy: editingItem.modified_by || 'ravenampere0123@gmail.com',
              modifiedDate:
                editingItem.modified_date || new Date().toISOString().slice(0, 16),
              userEmail: editingItem.user_email || 'ravenampere0123@gmail.com',
              category: editingItem.category || '',
              totalStockAvailable: 0,
              totalStockIn: 0,
            }
            : null
        }
      />
    </View>
  );
};

export default Inventory;

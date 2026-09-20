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
  Dimensions,
  RefreshControl,
} from 'react-native';
import { Search, Plus, Edit, Trash2 } from 'lucide-react-native';
import AddInventoryCategoryModal from '../modals/AddInventoryCategoryModal';
import {
  createInventoryCategory,
  updateInventoryCategory,
  deleteInventoryCategory,
} from '../services/inventoryCategoryService';
import EditInventoryCategoryModal from '../modals/EditInventoryCategoryModal';
import { useInventoryContext, InventoryCategory } from '../contexts/InventoryContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const InventoryCategoryList: React.FC = () => {

  const { dbCategories: categories, isLoading: contextLoading, refreshInventory } = useInventoryContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<InventoryCategory | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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



  const fetchCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      await refreshInventory();
    } catch (error) {
      console.error('Error fetching inventory categories:', error);
      setError('Failed to fetch inventory categories');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshInventory();
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  };

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleView = (category: InventoryCategory) => {
    // Implement view functionality
    console.log('View category:', category);
  };

  const handleEdit = (category: InventoryCategory) => {
    setCategoryEditing(category);
    setIsEditModalOpen(true);
  };

  const handleUpdateCategory = async (id: number, categoryData: { name: string; modified_by?: string }) => {
    try {
      setLoading(true);
      await updateInventoryCategory(id, categoryData);
      await refreshInventory();
      console.log('Category updated');
    } catch (error) {
      console.error('Error updating category:', error);
      Alert.alert('Error', 'Failed to update category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (category: InventoryCategory) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete the category "${category.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await deleteInventoryCategory(category.id);
              await refreshInventory();
              console.log('Category deleted:', category);
            } catch (error) {
              console.error('Error deleting category:', error);
              Alert.alert('Error', 'Failed to delete category. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleAddCategory = async (categoryData: { name: string; modified_by?: string }) => {
    try {
      setLoading(true);
      await createInventoryCategory(categoryData);
      await refreshInventory();
      console.log('Category added');
    } catch (error) {
      console.error('Error adding category:', error);
      Alert.alert('Error', 'Failed to add category. Please try again.');
    } finally {
      setLoading(false);
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
        hour12: true,
      });
    } catch {
      return 'N/A';
    }
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';

  if (categories.length === 0 && contextLoading) {
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
          Loading categories...
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
        <Text
          style={{
            fontSize: 18,
            marginBottom: 8,
            color: '#111827',
          }}
        >
          Error Loading Categories
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
          onPress={fetchCategories}
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
      {/* Search and Add Section */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 16,
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
            placeholder="Search Inventory Category List"
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
          onPress={() => setIsAddModalOpen(true)}
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
          <Text style={{ color: '#ffffff', fontSize: 14 }}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Categories List */}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={primaryColor}
            colors={[primaryColor]}
          />
        }
      >
        {filteredCategories.length > 0 ? (
          filteredCategories.map((category) => (
            <Pressable
              key={category.id}
              style={({ pressed }) => ({
                minHeight: 150,
                borderBottomWidth: 1.5,
                borderBottomColor: '#f1f5f9',
                backgroundColor: pressed ? '#f8fafc' : '#ffffff',
              })}
            >
              <View style={{
                paddingHorizontal: 20,
                paddingVertical: 30,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flex: 1,
              }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontWeight: '600',
                      fontSize: 18,
                      color: '#111827',
                      marginBottom: 4,
                    }}
                  >
                    {category.name}
                  </Text>
                  {(category.modified_date || category.updated_at) && (
                    <Text
                      style={{
                        fontSize: 13,
                        color: '#64748b',
                        fontWeight: '500',
                      }}
                    >
                      Modified: {formatDateTime(category.modified_date || category.updated_at || '')}
                    </Text>
                  )}
                </View>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  marginLeft: 16,
                  flexShrink: 0
                }}>
                  <TouchableOpacity
                    onPress={() => handleEdit(category)}
                    style={{ padding: 10, borderRadius: 8 }}
                  >
                    <Edit size={24} color="#4b5563" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(category)}
                    style={{ padding: 10, borderRadius: 8 }}
                  >
                    <Trash2 size={24} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{
                height: 1.5,
                backgroundColor: '#cbd5e1',
                width: '100%',
              }} />
            </Pressable>
          ))
        ) : (
          <View style={{ padding: 48, alignItems: 'center' }}>
            <Text
              style={{
                fontSize: 18,
                marginBottom: 8,
                color: '#4b5563',
              }}
            >
              No categories found
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: '#4b5563',
                textAlign: 'center',
              }}
            >
              {categories.length === 0
                ? 'Start by adding some inventory categories'
                : 'Try adjusting your search filter'}
            </Text>
          </View>
        )}
      </ScrollView>

      <AddInventoryCategoryModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddCategory}
      />

      <EditInventoryCategoryModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setCategoryEditing(null);
        }}
        onSave={handleUpdateCategory}
        category={categoryEditing}
      />
    </View>
  );
};

export default InventoryCategoryList;

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Minus, Plus, Camera, Calendar } from 'lucide-react-native';
import { API_BASE_URL, authFetch } from '../config/api';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

interface InventoryFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: InventoryFormData) => Promise<void>;
  editData?: InventoryFormData | null;
  initialCategory?: string;
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

const InventoryFormModal: React.FC<InventoryFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editData,
  initialCategory = '',
}) => {

  const [formData, setFormData] = useState<InventoryFormData>({
    itemName: '',
    itemDescription: '',
    supplier: '',
    quantityAlert: 0,
    image: null,
    modifiedBy: '',
    modifiedDate: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    userEmail: '',
    category: '',
    totalStockAvailable: 0,
    totalStockIn: 0,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);



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
    const fetchCategories = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/inventory-categories`);
        const data = await response.json();
        if (data.success) {
          const categoryNames = data.data.map((cat: { id: number; name: string }) => cat.name);
          setCategories(categoryNames);
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    const fetchImageSizeSettings = async () => {
      if (isOpen) {
        try {
          const settings = await getActiveImageSize();
          setActiveImageSize(settings);
        } catch (error) {
          setActiveImageSize(null);
        }
      }
    };
    fetchImageSizeSettings();
  }, [isOpen]);

  useEffect(() => {
    const initForm = async () => {
      const authData = await AsyncStorage.getItem('authData');
      let currentEmail = '';
      if (authData) {
        const userData = JSON.parse(authData);
        currentEmail = userData.email || userData.email_address || '';
      }

      if (editData) {
        setFormData({
          itemName: editData.itemName || '',
          itemDescription: editData.itemDescription || '',
          supplier: editData.supplier || '',
          quantityAlert: editData.quantityAlert || 0,
          image: editData.image || null,
          modifiedBy: editData.modifiedBy || currentEmail,
          modifiedDate: editData.modifiedDate || dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
          userEmail: editData.userEmail || currentEmail,
          category: editData.category || '',
          totalStockAvailable: editData.totalStockAvailable || 0,
          totalStockIn: editData.totalStockIn || 0,
        });
      } else {
        setFormData({
          itemName: '',
          itemDescription: '',
          supplier: '',
          quantityAlert: 0,
          image: null,
          modifiedBy: currentEmail,
          modifiedDate: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
          userEmail: currentEmail,
          category: initialCategory,
          totalStockAvailable: 0,
          totalStockIn: 0,
        });
      }
      setErrors({});
      setSelectedImageName(null);
    };

    if (isOpen) {
      initForm();
    }
  }, [isOpen, editData, initialCategory]);

  const handleInputChange = (
    field: keyof InventoryFormData,
    value: string | number | File | null
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleQuantityChange = (
    field: 'quantityAlert' | 'totalStockAvailable' | 'totalStockIn',
    increment: boolean
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: increment ? prev[field] + 1 : Math.max(0, prev[field] - 1),
    }));
  };

  const handleImageUpload = async () => {
    try {
      if (Platform.OS === 'ios') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission required', 'Media library access is required to select an image.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: activeImageSize && activeImageSize.image_size_value < 100
          ? activeImageSize.image_size_value / 100
          : 1,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImageName(asset.fileName || asset.uri.split('/').pop() || 'image');
        // Keep business logic compatible — store uri as a placeholder in image field
        handleInputChange('image', asset.uri as unknown as File);
      }
    } catch (error) {
      console.error('Error picking image:', error);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.itemName.trim()) newErrors.itemName = 'Item Name is required';
    if (!formData.itemDescription.trim()) newErrors.itemDescription = 'Item Description is required';
    if (!formData.userEmail.trim()) newErrors.userEmail = 'User Email is required';
    if (!formData.modifiedDate.trim()) newErrors.modifiedDate = 'Modified Date is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setLoadingPercentage(0);

    progressIntervalRef.current = setInterval(() => {
      setLoadingPercentage((prev) => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        if (prev >= 70) return prev + 2;
        return prev + 5;
      });
    }, 300);

    try {
      await onSave(formData);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setLoadingPercentage(100);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      console.error('Error saving inventory item:', error);
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    setErrors({});
    onClose();
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const labelStyle = {
    fontSize: 14,
    fontWeight: '500' as const,
    marginBottom: 8,
    color: '#374151',
  };

  const inputStyle = (hasError?: boolean) => ({
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    borderColor: hasError ? '#ef4444' : '#d1d5db',
    backgroundColor: '#ffffff',
    color: '#111827',
  });

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={handleCancel}>
      {/* Loading Overlay */}
      {loading && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <View
            style={{
              borderRadius: 12,
              padding: 32,
              alignItems: 'center',
              gap: 24,
              minWidth: 280,
              backgroundColor: '#ffffff',
            }}
          >
            <ActivityIndicator size="large" color="#f97316" />
            <Text
              style={{
                fontSize: 36,
                fontWeight: '700',
                color: '#111827',
              }}
            >
              {loadingPercentage}%
            </Text>
          </View>
        </View>
      )}

      {/* Overlay */}
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'flex-end',
          alignItems: 'flex-end',
        }}
      >
        {/* Panel */}
        <View
          style={{
            height: '100%',
            width: '100%',
            maxWidth: 672,
            backgroundColor: '#ffffff',
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 20,
            elevation: 10,
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <View
            style={{
              paddingHorizontal: 24,
              paddingVertical: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f3f4f6',
            }}
          >
            <Text
              style={{
                fontSize: 20,
                fontWeight: '600',
                color: '#111827',
              }}
            >
              {editData ? 'Edit Inventory Item' : 'Add Inventory Item'}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity
                onPress={handleCancel}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 6,
                  backgroundColor: '#e5e7eb',
                }}
              >
                <Text style={{ fontSize: 14, color: '#111827' }}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 6,
                  backgroundColor: primaryColor,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                <Text style={{ fontSize: 14, color: '#ffffff' }}>
                  {loading ? 'Saving...' : editData ? 'Update' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Form Body */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 16 }}>
            {/* Item Name */}
            <View>
              <Text style={labelStyle}>
                Item Name<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <TextInput
                value={formData.itemName}
                onChangeText={(val) => handleInputChange('itemName', val)}
                placeholder="Enter item name"
                placeholderTextColor={'#9ca3af'}
                style={inputStyle(!!errors.itemName)}
              />
              {errors.itemName ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                  {errors.itemName}
                </Text>
              ) : null}
            </View>

            {/* Item Description */}
            <View>
              <Text style={labelStyle}>
                Item Description<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <TextInput
                value={formData.itemDescription}
                onChangeText={(val) => handleInputChange('itemDescription', val)}
                placeholder="Enter item description"
                placeholderTextColor={'#9ca3af'}
                multiline
                numberOfLines={3}
                style={[inputStyle(!!errors.itemDescription), { height: 80, textAlignVertical: 'top' }]}
              />
              {errors.itemDescription ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                  {errors.itemDescription}
                </Text>
              ) : null}
            </View>

            {/* Quantity Alert */}
            <View>
              <Text style={labelStyle}>
                Quantity Alert<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderRadius: 6,
                  borderColor: '#d1d5db',
                  backgroundColor: '#ffffff',
                  overflow: 'hidden',
                }}
              >
                <TextInput
                  value={String(formData.quantityAlert)}
                  onChangeText={(val) => handleInputChange('quantityAlert', parseInt(val) || 0)}
                  keyboardType="numeric"
                  style={{
                    flex: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    color: '#111827',
                  }}
                />
                <TouchableOpacity
                  onPress={() => handleQuantityChange('quantityAlert', false)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderLeftWidth: 1,
                    borderLeftColor: '#d1d5db',
                  }}
                >
                  <Minus size={16} color={'#4b5563'} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleQuantityChange('quantityAlert', true)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderLeftWidth: 1,
                    borderLeftColor: '#d1d5db',
                  }}
                >
                  <Plus size={16} color={'#4b5563'} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Image */}
            <View>
              <Text style={labelStyle}>Image</Text>
              <TouchableOpacity
                onPress={handleImageUpload}
                style={{
                  width: '100%',
                  height: 96,
                  borderWidth: 2,
                  borderStyle: 'dashed',
                  borderRadius: 6,
                  borderColor: '#d1d5db',
                  backgroundColor: '#f9fafb',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Camera size={24} color={'#6b7280'} />
              </TouchableOpacity>
              {selectedImageName && (
                <Text style={{ fontSize: 12, marginTop: 8, color: '#4b5563' }}>
                  Selected: {selectedImageName}
                </Text>
              )}
            </View>

            {/* Modified By */}
            <View>
              <Text style={labelStyle}>Modified By</Text>
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderRadius: 6,
                  borderColor: '#d1d5db',
                  backgroundColor: '#f3f4f6',
                }}
              >
                <Text style={{ color: '#4b5563' }}>
                  {formData.modifiedBy}
                </Text>
              </View>
            </View>

            {/* Modified Date */}
            <View>
              <Text style={labelStyle}>
                Modified Date<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <View style={{ position: 'relative', justifyContent: 'center' }}>
                <TextInput
                  value={formData.modifiedDate}
                  onChangeText={(val) => handleInputChange('modifiedDate', val)}
                  placeholder="YYYY-MM-DDTHH:MM"
                  placeholderTextColor={'#9ca3af'}
                  style={[inputStyle(!!errors.modifiedDate), { paddingRight: 44 }]}
                />
                <Calendar
                  size={20}
                  color={'#6b7280'}
                  style={{ position: 'absolute', right: 12 }}
                />
              </View>
              {errors.modifiedDate ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                  {errors.modifiedDate}
                </Text>
              ) : null}
            </View>

            {/* User Email */}
            <View>
              <Text style={labelStyle}>
                User Email<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <TextInput
                value={formData.userEmail}
                onChangeText={(val) => handleInputChange('userEmail', val)}
                placeholder="Enter user email"
                placeholderTextColor={'#9ca3af'}
                keyboardType="email-address"
                autoCapitalize="none"
                style={inputStyle(!!errors.userEmail)}
              />
              {errors.userEmail ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                  {errors.userEmail}
                </Text>
              ) : null}
            </View>

            {/* Category */}
            <View>
              <Text style={labelStyle}>Category</Text>
              <TouchableOpacity
                onPress={() => setShowCategoryDropdown((prev) => !prev)}
                style={{
                  ...inputStyle(),
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ color: formData.category ? '#111827' : '#9ca3af' }}>
                  {formData.category || 'Select category'}
                </Text>
                <Text style={{ color: '#6b7280' }}>▾</Text>
              </TouchableOpacity>

              {showCategoryDropdown && (
                <View
                  style={{
                    borderWidth: 1,
                    borderRadius: 6,
                    borderColor: '#d1d5db',
                    backgroundColor: '#ffffff',
                    marginTop: 4,
                    maxHeight: 200,
                    overflow: 'hidden',
                  }}
                >
                  <ScrollView nestedScrollEnabled>
                    <Pressable
                      onPress={() => {
                        handleInputChange('category', '');
                        setShowCategoryDropdown(false);
                      }}
                      style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                    >
                      <Text style={{ color: '#6b7280' }}>
                        Select category
                      </Text>
                    </Pressable>
                    {categories.map((category) => (
                      <Pressable
                        key={category}
                        onPress={() => {
                          handleInputChange('category', category);
                          setShowCategoryDropdown(false);
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          backgroundColor: pressed
                            ? '#f3f4f6'
                            : 'transparent',
                        })}
                      >
                        <Text style={{ color: '#111827' }}>
                          {category}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Total Stock Available */}
            <View>
              <Text style={labelStyle}>Total Stock Available</Text>
              <TextInput
                value={String(formData.totalStockAvailable)}
                onChangeText={(val) => handleInputChange('totalStockAvailable', parseInt(val) || 0)}
                placeholder="0"
                placeholderTextColor={'#9ca3af'}
                keyboardType="numeric"
                style={inputStyle()}
              />
            </View>

            {/* Total Stock IN */}
            <View>
              <Text style={labelStyle}>Total Stock IN</Text>
              <TextInput
                value={String(formData.totalStockIn)}
                onChangeText={(val) => handleInputChange('totalStockIn', parseInt(val) || 0)}
                placeholder="0"
                placeholderTextColor={'#9ca3af'}
                keyboardType="numeric"
                style={inputStyle()}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default InventoryFormModal;

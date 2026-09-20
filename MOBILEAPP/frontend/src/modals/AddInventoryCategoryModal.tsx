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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { X, Calendar, Loader2 } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface AddInventoryCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (categoryData: { name: string; modified_by?: string }) => Promise<void>;
}

const AddInventoryCategoryModal: React.FC<AddInventoryCategoryModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  // Enforce light theme
  const isDarkMode = false;
  const [categoryName, setCategoryName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [modifiedDate, setModifiedDate] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
    message: '',
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
    if (isOpen) {
      setModal((prev) => ({ ...prev, isOpen: false }));
      setLoading(false);
      setLoadingProgress(0);
      setCategoryName('');
      setErrors({});

      const now = new Date();
      setModifiedDate(now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }));
    }
  }, [isOpen]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!categoryName.trim()) {
      newErrors.categoryName = 'Category name is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setLoadingProgress(0);

    progressIntervalRef.current = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        return prev + 5;
      });
    }, 100);

    try {
      const authData = await AsyncStorage.getItem('authData');
      const user = authData ? JSON.parse(authData) : null;

      await onSave({
        name: categoryName.trim(),
        modified_by: user?.email || 'ravenampere0123@gmail.com',
      });

      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setLoadingProgress(100);

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Inventory category created successfully!',
        onConfirm: () => {
          setModal((prev) => ({ ...prev, isOpen: false }));
          onClose();
        },
      });
    } catch (error: any) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      console.error('Error creating inventory category:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error.message || 'Failed to create inventory category.',
      });
    } finally {
      setLoading(false);
    }
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="slide"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-end">
        {/* Loading Modal */}
        <Modal visible={loading} transparent={true} animationType="fade">
          <View className="flex-1 bg-black/70 items-center justify-center">
            <View className="bg-white rounded-xl p-8 items-center space-y-6 min-w-[320px]">
              <ActivityIndicator size="large" color={primaryColor} />
              <View>
                <Text className="text-4xl font-bold text-gray-900">
                  {Math.round(loadingProgress)}%
                </Text>
              </View>
            </View>
          </View>
        </Modal>

        {/* Result Modal */}
        <Modal visible={modal.isOpen} transparent={true} animationType="fade">
          <View className="flex-1 bg-black/75 items-center justify-center p-4">
            <View className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80%] overflow-hidden">
              <View className="px-6 py-4 border-b border-gray-200 flex-row items-center justify-between">
                <Text className="text-lg font-semibold text-gray-900">{modal.title}</Text>
                <TouchableOpacity onPress={() => setModal((prev) => ({ ...prev, isOpen: false }))}>
                  <X size={20} color="#4B5563" />
                </TouchableOpacity>
              </View>
              <ScrollView className="px-6 py-4">
                <View className="space-y-3">
                  <View className={`flex-row items-center gap-3 p-3 rounded-lg border ${modal.type === 'success' ? 'bg-green-100 border-green-300' : 'bg-red-100 border-red-300'
                    }`}>
                    <Text className={`text-sm flex-1 ${modal.type === 'success' ? 'text-green-800' : 'text-red-800'
                      }`}>
                      {modal.message}
                    </Text>
                  </View>
                </View>
              </ScrollView>
              <View className="px-6 py-4 border-t border-gray-200 flex-row justify-end">
                <TouchableOpacity
                  onPress={modal.onConfirm || (() => setModal((prev) => ({ ...prev, isOpen: false })))}
                  className="px-6 py-2 rounded-lg"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Text className="text-white font-medium text-center">OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Main Panel */}
        <View className="h-[70%] w-full shadow-2xl rounded-t-3xl overflow-hidden flex-col bg-gray-50">
          <View className="px-6 py-4 flex-row items-center justify-between border-b bg-gray-100 border-gray-200">
            <Text className="text-xl font-semibold text-gray-900">Add Category</Text>
            <View className="flex-row items-center space-x-3 gap-2">
              <TouchableOpacity
                onPress={onClose}
                className="px-4 py-[8px] border rounded-lg"
                style={{ borderColor: primaryColor }}
              >
                <Text style={{ color: primaryColor }} className="text-sm font-medium">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="px-6 py-[8px] rounded-lg"
                style={{ backgroundColor: loading ? '#9ca3af' : primaryColor }}
              >
                <Text className="text-white text-sm font-medium">Save</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
            {/* Category Name */}
            <View className="mb-6">
              <Text className="text-sm font-medium mb-2 text-gray-700">
                Category Name<Text className="text-red-500">*</Text>
              </Text>
              <TextInput
                value={categoryName}
                onChangeText={(text) => {
                  setCategoryName(text);
                  if (errors.categoryName) setErrors({});
                }}
                placeholder="Enter category name"
                placeholderTextColor="#9ca3af"
                className={`w-full px-4 py-[12px] border rounded-lg bg-white text-gray-900 ${errors.categoryName ? 'border-red-500' : 'border-gray-300'
                  }`}
              />
              {errors.categoryName && (
                <Text className="text-red-500 text-xs mt-1">{errors.categoryName}</Text>
              )}
            </View>

            {/* Modified Date */}
            <View className="mb-6">
              <Text className="text-sm font-medium mb-2 text-gray-700">Modified Date</Text>
              <View className="relative justify-center">
                <TextInput
                  value={modifiedDate}
                  editable={false}
                  className="w-full pl-4 pr-11 py-[12px] border rounded-lg bg-gray-100 border-gray-300 text-gray-500"
                />
                <Calendar size={18} color="#9ca3af" style={{ position: 'absolute', right: 16 }} />
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default AddInventoryCategoryModal;

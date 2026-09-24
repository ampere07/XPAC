import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { X, ChevronDown, Minus, Plus } from 'lucide-react-native';
import * as lcpnapService from '../services/lcpnapService';
import * as lcpService from '../services/lcpService';
import { barangayService, Barangay } from '../services/barangayService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';

interface AddSMSBlastModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type TargetType = 'lcpnap' | 'lcp' | 'barangay' | 'billing_day' | null;

const AddSMSBlastModal: React.FC<AddSMSBlastModalProps> = ({ isOpen, onClose, onSave }) => {
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [formData, setFormData] = useState({
    message: '',
    targetType: null as TargetType,
    selectedId: null as number | null,
    billingDay: 0,
  });

  const [lcpnapList, setLcpnapList] = useState<lcpnapService.LCPNAP[]>([]);
  const [lcpList, setLcpList] = useState<lcpService.LCP[]>([]);
  const [barangayList, setBarangayList] = useState<Barangay[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Search/dropdown state
  const [lcpnapSearch, setLcpnapSearch] = useState('');
  const [isLcpnapOpen, setIsLcpnapOpen] = useState(false);
  const [lcpSearch, setLcpSearch] = useState('');
  const [isLcpOpen, setIsLcpOpen] = useState(false);
  const [barangaySearch, setBarangaySearch] = useState('');
  const [isBarangayOpen, setIsBarangayOpen] = useState(false);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadAllData();
      // Reset form on open
      setFormData({ message: '', targetType: null, selectedId: null, billingDay: 0 });
      setErrors({});
    }
  }, [isOpen]);

  const loadAllData = async () => {
    try {
      const [lcpnapResponse, lcpResponse, barangayResponse] = await Promise.all([
        lcpnapService.getAllLCPNAPs(),
        lcpService.getAllLCPs(),
        barangayService.getAll(),
      ]);
      if (lcpnapResponse.success) setLcpnapList(lcpnapResponse.data);
      if (lcpResponse.success) setLcpList(lcpResponse.data);
      if (barangayResponse.success) setBarangayList(barangayResponse.data);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleTargetTypeChange = (type: TargetType) => {
    setFormData((prev) => ({ ...prev, targetType: type, selectedId: null }));
    setErrors((prev) => ({ ...prev, targetType: '', selectedId: '' }));
    setLcpnapSearch('');
    setLcpSearch('');
    setBarangaySearch('');
    setIsLcpnapOpen(false);
    setIsLcpOpen(false);
    setIsBarangayOpen(false);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.message || formData.message.trim() === '') {
      newErrors.message = 'Message is required';
    }
    if (!formData.targetType) {
      newErrors.targetType = 'Please select a target type';
    }
    if (formData.targetType && formData.targetType !== 'billing_day' && !formData.selectedId) {
      newErrors.selectedId = 'Please select an item from the list';
    }
    if (formData.targetType === 'billing_day' && (!formData.billingDay || formData.billingDay <= 0)) {
      newErrors.billingDay = 'Please enter a valid billing day';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      Alert.alert('Validation Error', 'Please fill in all required fields correctly.');
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage((prev) => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        if (prev >= 70) return prev + 2;
        return prev + 5;
      });
    }, 300);

    try {
      const raw = await AsyncStorage.getItem('authData');
      const currentUser = raw ? JSON.parse(raw) : null;

      const payload: any = {
        message: formData.message,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };

      if (formData.targetType === 'lcpnap') {
        payload.lcpnap_id = formData.selectedId;
      } else if (formData.targetType === 'lcp') {
        payload.lcp_id = formData.selectedId;
      } else if (formData.targetType === 'barangay') {
        payload.barangay_id = formData.selectedId;
      } else if (formData.targetType === 'billing_day') {
        payload.billing_day = formData.billingDay;
      }

      await apiClient.post('/sms-blast', payload);

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      await new Promise((resolve) => setTimeout(resolve, 500));

      Alert.alert('Success', 'SMS Blast created successfully!', [
        {
          text: 'OK',
          onPress: () => {
            onSave();
            onClose();
          },
        },
      ]);
    } catch (error: any) {
      clearInterval(progressInterval);
      let errorMessage = 'Unknown error occurred';
      if (error.response?.data?.errors) {
        const validationErrors = error.response.data.errors;
        errorMessage = Object.entries(validationErrors)
          .map(([field, messages]: [string, any]) => {
            const arr = Array.isArray(messages) ? messages : [messages];
            return `${field}: ${arr.join(', ')}`;
          })
          .join('\n');
        errorMessage = `Validation failed:\n${errorMessage}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      Alert.alert('Error', `Failed to save SMS blast: ${errorMessage}`);
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    setFormData({ message: '', targetType: null, selectedId: null, billingDay: 0 });
    setErrors({});
    onClose();
  };

  const selectedLcpnap = lcpnapList.find((i) => i.id === formData.selectedId);
  const selectedLcp = lcpList.find((i) => i.id === formData.selectedId);
  const selectedBarangay = barangayList.find((i) => i.id === formData.selectedId);

  const filteredLcpnap = lcpnapList.filter((i) =>
    i.lcpnap_name.toLowerCase().includes(lcpnapSearch.toLowerCase())
  );
  const filteredLcp = lcpList.filter((i) =>
    i.lcp_name.toLowerCase().includes(lcpSearch.toLowerCase())
  );
  const filteredBarangay = barangayList.filter((i) =>
    i.barangay.toLowerCase().includes(barangaySearch.toLowerCase())
  );

  const targetTypeButtons: { key: TargetType; label: string }[] = [
    { key: 'lcpnap', label: 'LCPNAP' },
    { key: 'lcp', label: 'LCP' },
    { key: 'barangay', label: 'Barangay' },
    { key: 'billing_day', label: 'Billing Day' },
  ];

  const inputBase = {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#ffffff',
  };

  return (
    <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      {/* Loading overlay */}
      {loading && (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0,0,0,0.7)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: 32,
              alignItems: 'center',
              gap: 16,
              minWidth: 200,
            }}
          >
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={{ fontSize: 32, fontWeight: '700', color: '#111827' }}>
              {loadingPercentage}%
            </Text>
          </View>
        </View>
      )}

      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#f3f4f6',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>Add SMS Blast</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            onPress={handleCancel}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: '#e5e7eb',
              borderRadius: 6,
            }}
          >
            <Text style={{ color: '#374151', fontWeight: '500' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            disabled={loading}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              backgroundColor: loading ? '#c4b5fd' : primaryColor,
              borderRadius: 6,
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>
              {loading ? 'Saving...' : 'Save'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCancel} style={{ padding: 4 }}>
            <X size={22} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1, backgroundColor: '#ffffff' }} contentContainerStyle={{ padding: 16, gap: 20 }}>
        {/* Message field */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
            Message <Text style={{ color: '#ef4444' }}>*</Text>
          </Text>
          <TextInput
            value={formData.message}
            onChangeText={(v) => handleInputChange('message', v)}
            placeholder="Type your message here..."
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={4}
            style={[
              inputBase,
              {
                minHeight: 100,
                textAlignVertical: 'top',
                borderColor: errors.message ? '#ef4444' : formData.message ? primaryColor : '#d1d5db',
              },
            ]}
          />
          {errors.message ? (
            <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.message}</Text>
          ) : null}
        </View>

        {/* Target type selector */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
            Target Type <Text style={{ color: '#ef4444' }}>*</Text>
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {targetTypeButtons.map(({ key, label }) => {
              const active = formData.targetType === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => handleTargetTypeChange(key)}
                  style={{
                    flex: 1,
                    minWidth: 80,
                    paddingVertical: 10,
                    borderRadius: 6,
                    borderWidth: 1,
                    alignItems: 'center',
                    backgroundColor: active ? primaryColor : '#ffffff',
                    borderColor: active ? primaryColor : '#d1d5db',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '500',
                      color: active ? '#ffffff' : '#374151',
                    }}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {errors.targetType ? (
            <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.targetType}</Text>
          ) : null}
        </View>

        {/* LCPNAP dropdown */}
        {formData.targetType === 'lcpnap' && (
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
              Select LCPNAP <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <TouchableOpacity
              onPress={() => { setIsLcpnapOpen(true); setLcpnapSearch(''); }}
              style={[
                inputBase,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderColor: errors.selectedId ? '#ef4444' : '#d1d5db',
                },
              ]}
            >
              <Text style={{ color: selectedLcpnap ? '#111827' : '#9ca3af', fontSize: 14 }}>
                {selectedLcpnap ? selectedLcpnap.lcpnap_name : 'Select LCP-NAP...'}
              </Text>
              <ChevronDown size={18} color="#6b7280" />
            </TouchableOpacity>
            {errors.selectedId ? (
              <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.selectedId}</Text>
            ) : null}
            <Modal visible={isLcpnapOpen} transparent animationType="fade" onRequestClose={() => setIsLcpnapOpen(false)}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
                activeOpacity={1}
                onPress={() => setIsLcpnapOpen(false)}
              >
                <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: 420 }}>
                  <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                    <TextInput
                      value={lcpnapSearch}
                      onChangeText={setLcpnapSearch}
                      placeholder="Search LCP-NAP..."
                      placeholderTextColor="#9ca3af"
                      autoFocus
                      style={[inputBase, { marginBottom: 0 }]}
                    />
                  </View>
                  <FlatList
                    data={filteredLcpnap}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        onPress={() => {
                          handleInputChange('selectedId', item.id);
                          setIsLcpnapOpen(false);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 13,
                          borderBottomWidth: 1,
                          borderBottomColor: '#f1f5f9',
                          backgroundColor: formData.selectedId === item.id ? '#ede9fe' : '#ffffff',
                        }}
                      >
                        <Text style={{ fontSize: 14, color: formData.selectedId === item.id ? '#7c3aed' : '#111827' }}>
                          {item.lcpnap_name}
                        </Text>
                      </TouchableOpacity>
                    )}
                    keyboardShouldPersistTaps="handled"
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          </View>
        )}

        {/* LCP dropdown */}
        {formData.targetType === 'lcp' && (
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
              Select LCP <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <TouchableOpacity
              onPress={() => { setIsLcpOpen(true); setLcpSearch(''); }}
              style={[
                inputBase,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderColor: errors.selectedId ? '#ef4444' : '#d1d5db',
                },
              ]}
            >
              <Text style={{ color: selectedLcp ? '#111827' : '#9ca3af', fontSize: 14 }}>
                {selectedLcp ? selectedLcp.lcp_name : 'Select LCP...'}
              </Text>
              <ChevronDown size={18} color="#6b7280" />
            </TouchableOpacity>
            {errors.selectedId ? (
              <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.selectedId}</Text>
            ) : null}
            <Modal visible={isLcpOpen} transparent animationType="fade" onRequestClose={() => setIsLcpOpen(false)}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
                activeOpacity={1}
                onPress={() => setIsLcpOpen(false)}
              >
                <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: 420 }}>
                  <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                    <TextInput
                      value={lcpSearch}
                      onChangeText={setLcpSearch}
                      placeholder="Search LCP..."
                      placeholderTextColor="#9ca3af"
                      autoFocus
                      style={[inputBase, { marginBottom: 0 }]}
                    />
                  </View>
                  <FlatList
                    data={filteredLcp}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        onPress={() => {
                          handleInputChange('selectedId', item.id);
                          setIsLcpOpen(false);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 13,
                          borderBottomWidth: 1,
                          borderBottomColor: '#f1f5f9',
                          backgroundColor: formData.selectedId === item.id ? '#ede9fe' : '#ffffff',
                        }}
                      >
                        <Text style={{ fontSize: 14, color: formData.selectedId === item.id ? '#7c3aed' : '#111827' }}>
                          {item.lcp_name}
                        </Text>
                      </TouchableOpacity>
                    )}
                    keyboardShouldPersistTaps="handled"
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          </View>
        )}

        {/* Barangay dropdown */}
        {formData.targetType === 'barangay' && (
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
              Select Barangay <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <TouchableOpacity
              onPress={() => { setIsBarangayOpen(true); setBarangaySearch(''); }}
              style={[
                inputBase,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderColor: errors.selectedId ? '#ef4444' : '#d1d5db',
                },
              ]}
            >
              <Text style={{ color: selectedBarangay ? '#111827' : '#9ca3af', fontSize: 14 }}>
                {selectedBarangay ? selectedBarangay.barangay : 'Select Barangay...'}
              </Text>
              <ChevronDown size={18} color="#6b7280" />
            </TouchableOpacity>
            {errors.selectedId ? (
              <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.selectedId}</Text>
            ) : null}
            <Modal visible={isBarangayOpen} transparent animationType="fade" onRequestClose={() => setIsBarangayOpen(false)}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
                activeOpacity={1}
                onPress={() => setIsBarangayOpen(false)}
              >
                <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: 420 }}>
                  <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                    <TextInput
                      value={barangaySearch}
                      onChangeText={setBarangaySearch}
                      placeholder="Search Barangay..."
                      placeholderTextColor="#9ca3af"
                      autoFocus
                      style={[inputBase, { marginBottom: 0 }]}
                    />
                  </View>
                  <FlatList
                    data={filteredBarangay}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        onPress={() => {
                          handleInputChange('selectedId', item.id);
                          setIsBarangayOpen(false);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 13,
                          borderBottomWidth: 1,
                          borderBottomColor: '#f1f5f9',
                          backgroundColor: formData.selectedId === item.id ? '#ede9fe' : '#ffffff',
                        }}
                      >
                        <Text style={{ fontSize: 14, color: formData.selectedId === item.id ? '#7c3aed' : '#111827' }}>
                          {item.barangay}
                        </Text>
                      </TouchableOpacity>
                    )}
                    keyboardShouldPersistTaps="handled"
                  />
                </View>
              </TouchableOpacity>
            </Modal>
          </View>
        )}

        {/* Billing day */}
        {formData.targetType === 'billing_day' && (
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
              Billing Day <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={String(formData.billingDay)}
                onChangeText={(v) => handleInputChange('billingDay', parseInt(v) || 0)}
                keyboardType="numeric"
                style={[
                  inputBase,
                  {
                    flex: 1,
                    borderColor: errors.billingDay ? '#ef4444' : formData.billingDay ? primaryColor : '#d1d5db',
                  },
                ]}
              />
              <View style={{ gap: 4 }}>
                <TouchableOpacity
                  onPress={() => handleInputChange('billingDay', (formData.billingDay || 0) + 1)}
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: '#e5e7eb',
                    borderRadius: 6,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Plus size={16} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleInputChange('billingDay', Math.max(0, (formData.billingDay || 0) - 1))}
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: '#e5e7eb',
                    borderRadius: 6,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Minus size={16} color="#374151" />
                </TouchableOpacity>
              </View>
            </View>
            {errors.billingDay ? (
              <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.billingDay}</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Modal>
  );
};

export default AddSMSBlastModal;

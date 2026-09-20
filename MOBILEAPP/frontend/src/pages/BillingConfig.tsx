import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Receipt, Hash, Edit2, Trash2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { customAccountNumberService, CustomAccountNumber } from '../services/customAccountNumberService';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface BillingConfigData {
  advance_generation_day: number;
  due_date_day: number;
  disconnection_day: number;
  overdue_day: number;
  disconnection_notice: number;
  disconnection_fee: number;
  pullout_day: number;
  agent_commission: number;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  created_by?: string;
}

interface BillingConfigResponse {
  success: boolean;
  data: BillingConfigData | null;
  message?: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
}

const EMPTY_CONFIG: BillingConfigData = {
  advance_generation_day: 0,
  due_date_day: 0,
  disconnection_day: 0,
  overdue_day: 0,
  disconnection_notice: 0,
  disconnection_fee: 0,
  pullout_day: 0,
  agent_commission: 0,
};

const BILLING_FIELDS: { key: keyof BillingConfigData; label: string; isFloat?: boolean }[] = [
  { key: 'advance_generation_day', label: 'Advance Generation Day' },
  { key: 'due_date_day', label: 'Due Date Day' },
  { key: 'disconnection_day', label: 'Disconnection Day' },
  { key: 'overdue_day', label: 'Overdue Day' },
  { key: 'disconnection_notice', label: 'Disconnection Notice' },
  { key: 'disconnection_fee', label: 'Disconnection Fee (₱)', isFloat: true },
  { key: 'pullout_day', label: 'Pullout Day' },
  { key: 'agent_commission', label: 'Agent Commission (%)', isFloat: true },
];

const BillingConfig: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [customAccountNumber, setCustomAccountNumber] = useState<CustomAccountNumber | null>(null);
  const [isEditingAccountNumber, setIsEditingAccountNumber] = useState(false);
  const [accountNumberInput, setAccountNumberInput] = useState('');
  const [loadingAccountNumber, setLoadingAccountNumber] = useState(false);

  const [billingConfig, setBillingConfig] = useState<BillingConfigData | null>(null);
  const [isEditingBillingConfig, setIsEditingBillingConfig] = useState(false);
  const [billingConfigInput, setBillingConfigInput] = useState<BillingConfigData>(EMPTY_CONFIG);
  const [loadingBillingConfig, setLoadingBillingConfig] = useState(false);

  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, type: 'success', title: '', message: '' });
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const fetchCustomAccountNumber = async () => {
    try {
      setLoadingAccountNumber(true);
      const response = await customAccountNumberService.get();
      if (response.success && response.data) {
        setCustomAccountNumber(response.data);
        setAccountNumberInput(response.data.starting_number);
      } else {
        setCustomAccountNumber(null);
        setAccountNumberInput('');
      }
    } catch (error) {
      console.error('Error fetching custom account number:', error);
    } finally {
      setLoadingAccountNumber(false);
    }
  };

  const fetchBillingConfig = async () => {
    try {
      setLoadingBillingConfig(true);
      const response = await apiClient.get<BillingConfigResponse>('/billing-config');
      if (response.data.success && response.data.data) {
        setBillingConfig(response.data.data);
        setBillingConfigInput(response.data.data);
      } else {
        setBillingConfig(null);
      }
    } catch (error) {
      console.error('Error fetching billing config:', error);
    } finally {
      setLoadingBillingConfig(false);
    }
  };

  useEffect(() => {
    fetchCustomAccountNumber();
    fetchBillingConfig();
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

  const closeModal = () => setModal((prev) => ({ ...prev, isOpen: false }));

  const handleSaveAccountNumber = async () => {
    try {
      setLoadingAccountNumber(true);
      const trimmedInput = accountNumberInput.trim();

      if (trimmedInput !== '' && trimmedInput.length > 7) {
        setModal({ isOpen: true, type: 'error', title: 'Validation Error', message: 'Starting number must not exceed 7 characters' });
        setLoadingAccountNumber(false);
        return;
      }

      if (customAccountNumber) {
        await customAccountNumberService.update(trimmedInput);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Starting account number updated successfully' });
      } else {
        await customAccountNumberService.create(trimmedInput);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Starting account number created successfully' });
      }
      await fetchCustomAccountNumber();
      setIsEditingAccountNumber(false);
    } catch (error: any) {
      console.error('Error saving custom account number:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to save: ${errorMessage}` });
    } finally {
      setLoadingAccountNumber(false);
    }
  };

  const handleDeleteAccountNumber = () => {
    if (!customAccountNumber) return;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirm Deletion',
      message: 'Are you sure you want to delete the starting account number?',
      onConfirm: async () => {
        try {
          setLoadingAccountNumber(true);
          await customAccountNumberService.delete();
          setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Starting account number deleted successfully' });
          setCustomAccountNumber(null);
          setAccountNumberInput('');
          setIsEditingAccountNumber(false);
        } catch (error: any) {
          console.error('Error deleting custom account number:', error);
          setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to delete: ${error.response?.data?.message || error.message}` });
        } finally {
          setLoadingAccountNumber(false);
        }
      },
    });
  };

  const handleCancelEdit = () => {
    setAccountNumberInput(customAccountNumber ? customAccountNumber.starting_number : '');
    setIsEditingAccountNumber(false);
  };

  const handleSaveBillingConfig = async () => {
    try {
      setLoadingBillingConfig(true);

      let userEmail = '';
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.user?.email || '';
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }

      const payload: any = { user_email: userEmail };
      BILLING_FIELDS.forEach(({ key }) => {
        const v = billingConfigInput[key];
        if (v !== undefined && v !== null && (v as any) !== '') payload[key] = v;
      });

      if (billingConfig) {
        await apiClient.put('/billing-config', payload);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Billing configuration updated successfully' });
      } else {
        await apiClient.post('/billing-config', payload);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Billing configuration created successfully' });
      }
      await fetchBillingConfig();
      setIsEditingBillingConfig(false);
    } catch (error: any) {
      console.error('Error saving billing config:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to save: ${errorMessage}` });
    } finally {
      setLoadingBillingConfig(false);
    }
  };

  const handleDeleteBillingConfig = () => {
    if (!billingConfig) return;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirm Deletion',
      message: 'Are you sure you want to delete the billing configuration?',
      onConfirm: async () => {
        try {
          setLoadingBillingConfig(true);
          await apiClient.delete('/billing-config');
          setModal({ isOpen: true, type: 'success', title: 'Success', message: 'Billing configuration deleted successfully' });
          setBillingConfig(null);
          setBillingConfigInput(EMPTY_CONFIG);
          setIsEditingBillingConfig(false);
        } catch (error: any) {
          console.error('Error deleting billing config:', error);
          setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to delete: ${error.response?.data?.message || error.message}` });
        } finally {
          setLoadingBillingConfig(false);
        }
      },
    });
  };

  const handleCancelBillingConfigEdit = () => {
    setBillingConfigInput(billingConfig || EMPTY_CONFIG);
    setIsEditingBillingConfig(false);
  };

  const handleBillingConfigInputChange = (field: keyof BillingConfigData, value: string, isFloat?: boolean) => {
    if (value === '') {
      setBillingConfigInput((prev) => ({ ...prev, [field]: '' as any }));
      return;
    }
    if (isFloat) {
      const floatValue = parseFloat(value);
      if (!isNaN(floatValue) && floatValue >= 0) {
        setBillingConfigInput((prev) => ({ ...prev, [field]: floatValue }));
      }
      return;
    }
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 31) {
      setBillingConfigInput((prev) => ({ ...prev, [field]: numValue }));
    }
  };

  const inputStyle = {
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    color: '#111827',
  };

  const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode }> = ({ icon, title, subtitle, right }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
        <View style={{ padding: 8, borderRadius: 10, backgroundColor: primaryColor + '1a' }}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>{title}</Text>
          {!!subtitle && <Text style={{ fontSize: 12, color: '#6b7280' }}>{subtitle}</Text>}
        </View>
      </View>
      {right}
    </View>
  );

  const EditDeleteButtons: React.FC<{ onEdit: () => void; onDelete: () => void; canDelete: boolean }> = ({ onEdit, onDelete, canDelete }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <TouchableOpacity onPress={onEdit} style={{ padding: 8 }}>
        <Edit2 size={16} color="#2563eb" />
      </TouchableOpacity>
      {canDelete && (
        <TouchableOpacity onPress={onDelete} style={{ padding: 8 }}>
          <Trash2 size={16} color="#dc2626" />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: isTablet ? 16 : 56, gap: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827', marginBottom: 4 }}>Billing Configuration</Text>

        {/* Custom Account Number */}
        <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
          <SectionHeader
            icon={<Hash size={20} color={primaryColor} />}
            title="Starting Account Number"
            subtitle="Custom starting number for new accounts (max 7 chars)"
            right={!isEditingAccountNumber ? <EditDeleteButtons onEdit={() => setIsEditingAccountNumber(true)} onDelete={handleDeleteAccountNumber} canDelete={!!customAccountNumber} /> : undefined}
          />
          {loadingAccountNumber ? (
            <ActivityIndicator color={primaryColor} />
          ) : isEditingAccountNumber ? (
            <View style={{ gap: 12 }}>
              <TextInput
                value={accountNumberInput}
                onChangeText={setAccountNumberInput}
                placeholder="e.g. 1000000"
                placeholderTextColor="#9ca3af"
                maxLength={7}
                keyboardType="numeric"
                style={inputStyle}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={handleSaveAccountNumber} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: primaryColor }}>
                  <Text style={{ color: '#ffffff', fontWeight: '500' }}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCancelEdit} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
                  <Text style={{ color: '#111827' }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827', fontFamily: 'monospace' }}>
              {customAccountNumber?.starting_number || 'Not set'}
            </Text>
          )}
        </View>

        {/* Billing Config */}
        <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
          <SectionHeader
            icon={<Receipt size={20} color={primaryColor} />}
            title="Billing Rules"
            subtitle="Generation, due dates, disconnection & commission"
            right={!isEditingBillingConfig ? <EditDeleteButtons onEdit={() => setIsEditingBillingConfig(true)} onDelete={handleDeleteBillingConfig} canDelete={!!billingConfig} /> : undefined}
          />
          {loadingBillingConfig ? (
            <ActivityIndicator color={primaryColor} />
          ) : isEditingBillingConfig ? (
            <View style={{ gap: 12 }}>
              {BILLING_FIELDS.map(({ key, label, isFloat }) => (
                <View key={key}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 4 }}>{label}</Text>
                  <TextInput
                    value={String(billingConfigInput[key] ?? '')}
                    onChangeText={(t) => handleBillingConfigInputChange(key, t, isFloat)}
                    keyboardType="numeric"
                    placeholderTextColor="#9ca3af"
                    style={inputStyle}
                  />
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity onPress={handleSaveBillingConfig} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: primaryColor }}>
                  <Text style={{ color: '#ffffff', fontWeight: '500' }}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCancelBillingConfigEdit} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
                  <Text style={{ color: '#111827' }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : billingConfig ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {BILLING_FIELDS.map(({ key, label }) => (
                <View key={key} style={{ flexBasis: '48%', flexGrow: 1, padding: 10, borderRadius: 8, backgroundColor: '#f3f4f6' }}>
                  <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>{String(billingConfig[key] ?? 0)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ color: '#9ca3af', paddingVertical: 8 }}>No billing configuration set. Tap edit to create one.</Text>
          )}
        </View>
      </ScrollView>

      <LoadingModalGlobal
        isOpen={modal.isOpen}
        type={modal.type}
        title={modal.title}
        message={modal.message}
        onConfirm={() => {
          if (modal.type === 'confirm' && modal.onConfirm) {
            modal.onConfirm();
          } else {
            closeModal();
          }
        }}
        onCancel={closeModal}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />
    </View>
  );
};

export default BillingConfig;

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface SmsConfigData {
  id: number;
  provider?: string;
  code: string;
  email: string;
  password: string;
  sender: string;
  updated_by: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SmsConfigResponse {
  success: boolean;
  data: SmsConfigData[];
  count: number;
  message?: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
}

const SmsConfig: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [smsConfigs, setSmsConfigs] = useState<SmsConfigData[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [operationLoading, setOperationLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
  const [formPwVisible, setFormPwVisible] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [formData, setFormData] = useState({ provider: 'itexmo', code: '', email: '', password: '', sender: '' });
  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, type: 'success', title: '', message: '' });

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<number | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const fetchSmsConfigs = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<SmsConfigResponse>('/sms-config');
      if (response.data.success && response.data.data) {
        setSmsConfigs(response.data.data);
      } else {
        setSmsConfigs([]);
      }
    } catch (error) {
      console.error('Error fetching SMS configs:', error);
      setSmsConfigs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSmsConfigs();
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

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => setFormData({ provider: 'itexmo', code: '', email: '', password: '', sender: '' });

  const handleStartCreate = () => {
    resetForm();
    setFormPwVisible(false);
    setIsCreating(true);
  };

  const handleStartEdit = (config: SmsConfigData) => {
    setFormData({
      provider: config.provider || 'itexmo',
      code: config.code || '',
      email: config.email || '',
      password: config.password || '',
      sender: config.sender || '',
    });
    setFormPwVisible(false);
    setEditingId(config.id);
  };

  const handleSave = async () => {
    try {
      setOperationLoading(true);

      let userEmail = '';
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || '';
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }

      if (!userEmail) {
        setModal({ isOpen: true, type: 'error', title: 'Authentication Required', message: 'Your user session has expired or is invalid. Please re-login to perform this action.' });
        setOperationLoading(false);
        return;
      }

      const payload = { ...formData, updated_by: userEmail };

      if (isCreating) {
        await apiClient.post('/sms-config', payload);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'SMS configuration created successfully' });
        setIsCreating(false);
      } else if (editingId !== null) {
        await apiClient.put(`/sms-config/${editingId}`, payload);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'SMS configuration updated successfully' });
        setEditingId(null);
      }

      await fetchSmsConfigs();
      resetForm();
      setShowPassword({});
    } catch (error: any) {
      console.error('Error saving SMS config:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to save: ${errorMessage}` });
    } finally {
      setOperationLoading(false);
    }
  };

  const handleDelete = (id: number) => {
    setIdToDelete(id);
    setConfirmInput('');
    setIsDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (confirmInput.toLowerCase() !== 'confirm' || !idToDelete) return;

    try {
      setIsDeleteModalOpen(false);
      setOperationLoading(true);
      await apiClient.delete(`/sms-config/${idToDelete}`);
      setModal({ isOpen: true, type: 'success', title: 'Success', message: 'SMS configuration deleted successfully' });
      await fetchSmsConfigs();
    } catch (error: any) {
      console.error('Error deleting SMS config:', error);
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to delete: ${error.response?.data?.message || error.message}` });
    } finally {
      setOperationLoading(false);
      setIdToDelete(null);
      setConfirmInput('');
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsCreating(false);
    setEditingId(null);
    setShowPassword({});
  };

  const togglePasswordVisibility = (id: number) => {
    setShowPassword((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const closeModal = () => setModal((prev) => ({ ...prev, isOpen: false }));

  const formatTs = (value?: string) => {
    if (!value) return '';
    try {
      return new Date(value)
        .toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
        .replace(',', '');
    } catch {
      return value;
    }
  };

  const canCreateNew = smsConfigs.length < 2;

  const inputStyle = {
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    color: '#111827',
  };
  const labelStyle = { fontSize: 12, fontWeight: '500' as const, color: '#374151', marginBottom: 4 };

  const renderFormFields = () => (
    <View style={{ gap: 12 }}>
      <View>
        <Text style={labelStyle}>Provider</Text>
        <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', backgroundColor: '#ffffff' }}>
          <Picker enabled={!operationLoading} selectedValue={formData.provider} onValueChange={(v) => handleInputChange('provider', v)} style={{ color: '#111827' }} dropdownIconColor="#6b7280">
            <Picker.Item label="Itexmo" value="itexmo" />
            <Picker.Item label="Semaphore" value="semaphore" />
          </Picker>
        </View>
      </View>
      <View>
        <Text style={labelStyle}>{formData.provider === 'semaphore' ? 'API Key' : 'API Code'}</Text>
        <TextInput value={formData.code} onChangeText={(t) => handleInputChange('code', t)} placeholder={formData.provider === 'semaphore' ? 'Enter API Key' : 'Enter API code'} placeholderTextColor="#9ca3af" autoCapitalize="none" style={inputStyle} />
      </View>
      {formData.provider === 'itexmo' && (
        <>
          <View>
            <Text style={labelStyle}>Email</Text>
            <TextInput value={formData.email} onChangeText={(t) => handleInputChange('email', t)} placeholder="Enter email" placeholderTextColor="#9ca3af" keyboardType="email-address" autoCapitalize="none" style={inputStyle} />
          </View>
          <View>
            <Text style={labelStyle}>Password</Text>
            <View style={{ position: 'relative', justifyContent: 'center' }}>
              <TextInput value={formData.password} onChangeText={(t) => handleInputChange('password', t)} placeholder="Enter password" placeholderTextColor="#9ca3af" secureTextEntry={!formPwVisible} autoCapitalize="none" style={{ ...inputStyle, paddingRight: 56 }} />
              <TouchableOpacity onPress={() => setFormPwVisible((v) => !v)} style={{ position: 'absolute', right: 10, padding: 4 }}>
                <Text style={{ fontSize: 12, color: '#6b7280' }}>{formPwVisible ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
      <View>
        <Text style={labelStyle}>Sender Name</Text>
        <TextInput value={formData.sender} onChangeText={(t) => handleInputChange('sender', t)} placeholder="Enter sender name" placeholderTextColor="#9ca3af" style={inputStyle} />
      </View>
    </View>
  );

  const FormButtons: React.FC<{ saveLabel: string }> = ({ saveLabel }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
      <TouchableOpacity onPress={handleSave} disabled={operationLoading} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: operationLoading ? '#9ca3af' : primaryColor }}>
        <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '500' }}>{saveLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleCancel} disabled={operationLoading} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e5e7eb' }}>
        <Text style={{ color: '#111827', fontSize: 14 }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const InfoCell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <View style={{ flexBasis: '48%', flexGrow: 1, padding: 10, borderRadius: 6, backgroundColor: '#f3f4f6' }}>
      <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>{label}</Text>
      {children}
    </View>
  );

  const renderConfigCard = (config: SmsConfigData) => {
    const isItexmo = !config.provider || config.provider === 'itexmo';
    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>Configuration #{config.id}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => handleStartEdit(config)} style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ fontSize: 14, color: '#2563eb' }}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(config.id)} style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ fontSize: 14, color: '#dc2626' }}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <InfoCell label="Provider"><Text style={{ fontSize: 14, fontWeight: '500', textTransform: 'capitalize', color: '#111827' }}>{config.provider || 'itexmo'}</Text></InfoCell>
          <InfoCell label={config.provider === 'semaphore' ? 'API Key' : 'API Code'}><Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{config.code || 'Not set'}</Text></InfoCell>
          {isItexmo && (
            <>
              <InfoCell label="Email"><Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{config.email || 'Not set'}</Text></InfoCell>
              <InfoCell label="Password">
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{showPassword[config.id] ? config.password : '••••••••'}</Text>
                <TouchableOpacity onPress={() => togglePasswordVisibility(config.id)}>
                  <Text style={{ fontSize: 12, color: primaryColor }}>{showPassword[config.id] ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </InfoCell>
            </>
          )}
          <InfoCell label="Sender Name"><Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }}>{config.sender || 'Not set'}</Text></InfoCell>
          <InfoCell label="Last Updated By">
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{config.updated_by || 'Unknown'}</Text>
            <Text style={{ fontSize: 10, color: '#9ca3af' }}>{formatTs(config.updated_at)}</Text>
          </InfoCell>
          <InfoCell label="Created By">
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{config.created_by || 'System'}</Text>
            <Text style={{ fontSize: 10, color: '#9ca3af' }}>{formatTs(config.created_at)}</Text>
          </InfoCell>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: isTablet ? 16 : 56 }}>
        {/* Header */}
        <View style={{ paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#d1d5db', marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827' }}>SMS Configuration</Text>
          {canCreateNew && !isCreating && editingId === null && (
            <TouchableOpacity onPress={handleStartCreate} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: primaryColor }}>
              <Text style={{ color: '#ffffff', fontSize: 14 }}>Create New</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && smsConfigs.length === 0 && !isCreating ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={primaryColor} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {smsConfigs.map((config) => (
              <View key={config.id} style={{ borderRadius: 8, padding: 16, borderWidth: 1, backgroundColor: '#ffffff', borderColor: '#d1d5db' }}>
                {editingId === config.id ? (
                  <View style={{ gap: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>Edit Configuration #{config.id}</Text>
                    {renderFormFields()}
                    <FormButtons saveLabel="Update" />
                  </View>
                ) : (
                  renderConfigCard(config)
                )}
              </View>
            ))}

            {isCreating && (
              <View style={{ borderRadius: 8, padding: 16, borderWidth: 1, backgroundColor: '#ffffff', borderColor: '#d1d5db' }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 }}>Create New Configuration</Text>
                {renderFormFields()}
                <View style={{ marginTop: 12 }}>
                  <FormButtons saveLabel="Create" />
                </View>
              </View>
            )}

            {smsConfigs.length === 0 && !isCreating && (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Text style={{ fontSize: 16, color: '#6b7280' }}>No SMS configurations found</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Operation loading overlay */}
      <Modal visible={operationLoading} transparent animationType="fade" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ borderWidth: 1, borderRadius: 12, padding: 24, maxWidth: 320, width: '85%', backgroundColor: '#ffffff', borderColor: '#d1d5db', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={primaryColor} style={{ marginBottom: 12 }} />
            <Text style={{ fontSize: 16, fontWeight: '500', color: '#111827' }}>Processing...</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Please wait</Text>
          </View>
        </View>
      </Modal>

      {/* Safe Delete Confirmation Modal */}
      <Modal visible={isDeleteModalOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setIsDeleteModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <View style={{ borderWidth: 1, borderRadius: 12, padding: 24, maxWidth: 384, width: '100%', backgroundColor: '#ffffff', borderColor: '#f3f4f6' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 16 }}>Sensitive Operation</Text>
            <Text style={{ fontSize: 14, color: '#4b5563', marginBottom: 16, lineHeight: 20 }}>
              This will permanently delete the SMS configuration. This action cannot be undone. Please type{' '}
              <Text style={{ fontWeight: 'bold', color: '#ef4444' }}>confirm</Text> to proceed.
            </Text>
            <TextInput
              value={confirmInput}
              onChangeText={setConfirmInput}
              placeholder="Type 'confirm' here..."
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              style={{ width: '100%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', color: '#111827', marginBottom: 24 }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={() => { setIsDeleteModalOpen(false); setConfirmInput(''); setIdToDelete(null); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f3f4f6', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#4b5563' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={executeDelete}
                disabled={confirmInput.toLowerCase() !== 'confirm'}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: confirmInput.toLowerCase() === 'confirm' ? (colorPalette?.primary || '#ef4444') : '#9ca3af', opacity: confirmInput.toLowerCase() === 'confirm' ? 1 : 0.5 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

export default SmsConfig;

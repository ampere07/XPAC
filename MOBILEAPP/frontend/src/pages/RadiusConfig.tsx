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

interface RadiusConfigData {
  id: number;
  ssl_type: string;
  ip: string;
  port: string;
  username: string;
  password: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  is_online?: boolean;
  latency?: number;
  public_ip?: string;
  loss?: number;
  anti_radi?: number;
  checked_at?: string;
}

interface RadiusConfigResponse {
  success: boolean;
  data: RadiusConfigData[];
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

const RadiusConfig: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [radiusConfigs, setRadiusConfigs] = useState<RadiusConfigData[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
  const [formPwVisible, setFormPwVisible] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [formData, setFormData] = useState({ ssl_type: '', ip: '', port: '', username: '', password: '' });
  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, type: 'success', title: '', message: '' });

  // Safe delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<number | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const fetchRadiusConfigs = async (isSilent: boolean = false) => {
    try {
      if (!isSilent) setLoading(true);
      const response = await apiClient.get<RadiusConfigResponse>('/radius-config');
      if (response.data.success && response.data.data) {
        setRadiusConfigs(response.data.data);
      } else {
        setRadiusConfigs([]);
      }
    } catch (error) {
      console.error('Error fetching radius configs:', error);
      setRadiusConfigs([]);
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

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
    fetchRadiusConfigs();
    const pollingInterval = setInterval(() => fetchRadiusConfigs(true), 120000);
    return () => clearInterval(pollingInterval);
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => setFormData({ ssl_type: '', ip: '', port: '', username: '', password: '' });

  const handleStartCreate = () => {
    resetForm();
    setFormPwVisible(false);
    setIsCreating(true);
  };

  const handleStartEdit = (config: RadiusConfigData) => {
    setFormData({
      ssl_type: config.ssl_type || '',
      ip: config.ip || '',
      port: config.port || '',
      username: config.username || '',
      password: config.password || '',
    });
    setFormPwVisible(false);
    setEditingId(config.id);
  };

  const handleSave = async () => {
    try {
      setLoading(true);

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

      const payload = { ...formData, updated_by: userEmail };

      if (isCreating) {
        await apiClient.post('/radius-config', payload);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'RADIUS configuration created successfully' });
        setIsCreating(false);
      } else if (editingId !== null) {
        await apiClient.put(`/radius-config/${editingId}`, payload);
        setModal({ isOpen: true, type: 'success', title: 'Success', message: 'RADIUS configuration updated successfully' });
        setEditingId(null);
      }

      await fetchRadiusConfigs();
      resetForm();
      setShowPassword({});
    } catch (error: any) {
      console.error('Error saving radius config:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to save: ${errorMessage}` });
    } finally {
      setLoading(false);
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
      setLoading(true);
      await apiClient.delete(`/radius-config/${idToDelete}`);
      setModal({ isOpen: true, type: 'success', title: 'Success', message: 'RADIUS configuration deleted successfully' });
      await fetchRadiusConfigs();
    } catch (error: any) {
      console.error('Error deleting radius config:', error);
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to delete: ${error.response?.data?.message || error.message}` });
    } finally {
      setLoading(false);
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

  const formatSync = (value?: string) => {
    if (!value) return '';
    try {
      return new Date(value)
        .toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
        .replace(',', '');
    } catch {
      return value;
    }
  };

  const canCreateNew = radiusConfigs.length < 2;

  // ── Reusable input row ──────────────────────────────────────────────────────
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
        <Text style={labelStyle}>Connection Type</Text>
        <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', backgroundColor: '#ffffff' }}>
          <Picker
            enabled={!loading}
            selectedValue={formData.ssl_type}
            onValueChange={(v) => handleInputChange('ssl_type', v)}
            style={{ color: '#111827' }}
            dropdownIconColor="#6b7280"
          >
            <Picker.Item label="Select Connection Type" value="" />
            <Picker.Item label="HTTPS" value="https" />
            <Picker.Item label="HTTP" value="http" />
          </Picker>
        </View>
      </View>
      <View>
        <Text style={labelStyle}>IP Address</Text>
        <TextInput value={formData.ip} onChangeText={(t) => handleInputChange('ip', t)} placeholder="e.g., 192.168.1.1" placeholderTextColor="#9ca3af" editable={!loading} autoCapitalize="none" style={inputStyle} />
      </View>
      <View>
        <Text style={labelStyle}>Port</Text>
        <TextInput value={formData.port} onChangeText={(t) => handleInputChange('port', t)} placeholder="e.g., 1812" placeholderTextColor="#9ca3af" editable={!loading} keyboardType="numeric" style={inputStyle} />
      </View>
      <View>
        <Text style={labelStyle}>Username</Text>
        <TextInput value={formData.username} onChangeText={(t) => handleInputChange('username', t)} placeholder="Enter username" placeholderTextColor="#9ca3af" editable={!loading} autoCapitalize="none" style={inputStyle} />
      </View>
      <View>
        <Text style={labelStyle}>Password</Text>
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <TextInput
            value={formData.password}
            onChangeText={(t) => handleInputChange('password', t)}
            placeholder="Enter password"
            placeholderTextColor="#9ca3af"
            editable={!loading}
            secureTextEntry={!formPwVisible}
            autoCapitalize="none"
            style={{ ...inputStyle, paddingRight: 56 }}
          />
          <TouchableOpacity onPress={() => setFormPwVisible((v) => !v)} style={{ position: 'absolute', right: 10, padding: 4 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>{formPwVisible ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const FormButtons: React.FC<{ saveLabel: string }> = ({ saveLabel }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
      <TouchableOpacity onPress={handleSave} disabled={loading} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: loading ? '#9ca3af' : primaryColor }}>
        <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '500' }}>{saveLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleCancel} disabled={loading} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: '#e5e7eb' }}>
        <Text style={{ color: '#111827', fontSize: 14 }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const Metric: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
    <View style={{ minWidth: 70 }}>
      <Text style={{ fontSize: 10, fontWeight: '600', color: '#9ca3af', marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 12, color: color || '#374151', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );

  const InfoCell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <View style={{ flexBasis: '48%', flexGrow: 1, padding: 10, borderRadius: 6, backgroundColor: '#f3f4f6' }}>
      <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>{label}</Text>
      {children}
    </View>
  );

  const renderConfigCard = (config: RadiusConfigData) => (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>Configuration #{config.id}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, backgroundColor: config.is_online ? '#f0fdf4' : '#fef2f2', borderColor: config.is_online ? '#bbf7d0' : '#fecaca' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: config.is_online ? '#22c55e' : '#ef4444' }} />
            <Text style={{ fontSize: 10, fontWeight: '500', color: config.is_online ? '#16a34a' : '#dc2626' }}>{config.is_online ? 'ONLINE' : 'OFFLINE'}</Text>
          </View>
        </View>
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
        <InfoCell label="Connection Type"><Text style={{ fontSize: 14, fontWeight: '500', textTransform: 'uppercase', color: '#111827' }}>{config.ssl_type || 'Not set'}</Text></InfoCell>
        <InfoCell label="IP Address"><Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }}>{config.ip || 'Not set'}</Text></InfoCell>
        <InfoCell label="Port"><Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }}>{config.port || 'Not set'}</Text></InfoCell>
        <InfoCell label="Username"><Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }}>{config.username || 'Not set'}</Text></InfoCell>
        <InfoCell label="Password">
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{showPassword[config.id] ? config.password : '••••••••'}</Text>
          <TouchableOpacity onPress={() => togglePasswordVisibility(config.id)}>
            <Text style={{ fontSize: 12, color: primaryColor }}>{showPassword[config.id] ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </InfoCell>
        <InfoCell label="Last Updated By">
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }} numberOfLines={1}>{config.updated_by || 'Unknown'}</Text>
          <Text style={{ fontSize: 10, color: '#9ca3af' }}>{formatSync(config.updated_at)}</Text>
        </InfoCell>
      </View>

      {/* Connection Metrics */}
      <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
        <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#9ca3af', marginBottom: 8 }}>Connection Metrics</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 12, borderRadius: 8, backgroundColor: '#f9fafb' }}>
          <Metric label="ANTI-RADI" value={String(config.anti_radi ?? 1)} color="#2563eb" />
          <Metric label="PUBLIC IP" value={config.public_ip || config.ip || '0.0.0.0'} />
          <Metric label="PING" value={config.is_online ? `${config.latency}ms` : 'TIMEOUT'} color={config.is_online ? '#16a34a' : '#dc2626'} />
          <Metric label="LOSS" value={`${config.loss ?? (config.is_online ? '0%' : '100%')}${typeof config.loss === 'number' ? '%' : ''}`} color={config.is_online ? '#16a34a' : '#dc2626'} />
          <Metric label="API PORT" value={config.port || '8728'} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: isTablet ? 16 : 56 }}>
        {/* Header */}
        <View style={{ paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#d1d5db', marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827' }}>RADIUS Configuration</Text>
          {canCreateNew && !isCreating && editingId === null && (
            <TouchableOpacity onPress={handleStartCreate} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: primaryColor }}>
              <Text style={{ color: '#ffffff', fontSize: 14 }}>Create New</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && radiusConfigs.length === 0 && !isCreating ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={primaryColor} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {radiusConfigs.map((config) => (
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

            {radiusConfigs.length === 0 && !isCreating && (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Text style={{ fontSize: 16, color: '#6b7280' }}>No RADIUS configurations found</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Safe Delete Confirmation Modal */}
      <Modal visible={isDeleteModalOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setIsDeleteModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <View style={{ borderWidth: 1, borderRadius: 12, padding: 24, maxWidth: 384, width: '100%', backgroundColor: '#ffffff', borderColor: '#f3f4f6' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 16 }}>Sensitive Operation</Text>
            <Text style={{ fontSize: 14, color: '#4b5563', marginBottom: 16, lineHeight: 20 }}>
              This will permanently delete the RADIUS configuration. This action cannot be undone. Please type{' '}
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
              <TouchableOpacity
                onPress={() => {
                  setIsDeleteModalOpen(false);
                  setConfirmInput('');
                  setIdToDelete(null);
                }}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f3f4f6', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#4b5563' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={executeDelete}
                disabled={confirmInput.toLowerCase() !== 'confirm'}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  alignItems: 'center',
                  backgroundColor: confirmInput.toLowerCase() === 'confirm' ? (colorPalette?.primary || '#ef4444') : '#9ca3af',
                  opacity: confirmInput.toLowerCase() === 'confirm' ? 1 : 0.5,
                }}
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

export default RadiusConfig;

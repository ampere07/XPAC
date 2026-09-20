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
import { Server, Pencil, Trash2, Eye, EyeOff, Zap, Clock } from 'lucide-react-native';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface SmartOltData {
  id: number;
  sub_domain: string;
  token: string;
  created_at: string;
  updated_at: string;
}

interface SmartOltResponse {
  success: boolean;
  data: SmartOltData[];
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

const SmartOltConfig: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [configs, setConfigs] = useState<SmartOltData[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showToken, setShowToken] = useState<Record<number, boolean>>({});
  const [tokenFieldVisible, setTokenFieldVisible] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [formData, setFormData] = useState({ sub_domain: '', token: '' });
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: '',
  });

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<SmartOltResponse>('/smart-olt');
      if (response.data.success && response.data.data) {
        setConfigs(response.data.data);
      } else {
        setConfigs([]);
      }
    } catch (error) {
      console.error('Error fetching SmartOLT configs:', error);
      setConfigs([]);
    } finally {
      setLoading(false);
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
    fetchConfigs();
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => setFormData({ sub_domain: '', token: '' });

  const handleStartCreate = () => {
    resetForm();
    setTokenFieldVisible(false);
    setIsCreating(true);
  };

  const handleStartEdit = (config: SmartOltData) => {
    setFormData({ sub_domain: config.sub_domain || '', token: config.token || '' });
    setTokenFieldVisible(false);
    setEditingId(config.id);
  };

  const handleSave = async () => {
    if (!formData.sub_domain || !formData.token) {
      setModal({ isOpen: true, type: 'error', title: 'Validation Error', message: 'Sub-domain and Token are required' });
      return;
    }

    try {
      setLoading(true);
      const payload = { ...formData };

      if (editingId) {
        await apiClient.put(`/smart-olt/${editingId}`, payload);
      } else {
        await apiClient.post('/smart-olt', payload);
      }

      setModal({ isOpen: true, type: 'success', title: 'Success', message: 'SmartOLT configuration saved successfully' });
      setIsCreating(false);
      setEditingId(null);
      await fetchConfigs();
      resetForm();
      setShowToken({});
    } catch (error: any) {
      console.error('Error saving SmartOLT config:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to save: ${errorMessage}` });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: number) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Delete Configuration',
      message: 'Are you sure you want to delete this configuration?',
      onConfirm: async () => {
        try {
          setLoading(true);
          await apiClient.delete(`/smart-olt/${id}`);
          setModal({ isOpen: true, type: 'success', title: 'Deleted', message: 'SmartOLT configuration deleted successfully' });
          await fetchConfigs();
        } catch (error: any) {
          console.error('Error deleting SmartOLT config:', error);
          setModal({ isOpen: true, type: 'error', title: 'Error', message: `Failed to delete: ${error.message}` });
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleCancel = () => {
    resetForm();
    setIsCreating(false);
    setEditingId(null);
    setShowToken({});
  };

  const toggleTokenVisibility = (id: number) => {
    setShowToken((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const closeModal = () => setModal((prev) => ({ ...prev, isOpen: false }));

  // ── Reusable field ────────────────────────────────────────────────────────
  const Field: React.FC<{
    label: string;
    value: string;
    onChangeText: (t: string) => void;
    placeholder?: string;
    secure?: boolean;
    onToggleSecure?: () => void;
    secureShown?: boolean;
    suffix?: string;
  }> = ({ label, value, onChangeText, placeholder, secure, onToggleSecure, secureShown, suffix }) => (
    <View style={{ gap: 8, flex: 1 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>{label}</Text>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          secureTextEntry={secure && !secureShown}
          autoCapitalize="none"
          style={{
            width: '100%',
            paddingHorizontal: 16,
            paddingVertical: 12,
            paddingRight: suffix ? 110 : onToggleSecure ? 60 : 16,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#d1d5db',
            backgroundColor: '#ffffff',
            color: '#111827',
          }}
        />
        {!!suffix && (
          <Text style={{ position: 'absolute', right: 16, color: '#9ca3af', fontSize: 13 }}>{suffix}</Text>
        )}
        {!!onToggleSecure && (
          <TouchableOpacity onPress={onToggleSecure} style={{ position: 'absolute', right: 12, padding: 4 }}>
            {secureShown ? <EyeOff size={18} color="#6b7280" /> : <Eye size={18} color="#6b7280" />}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderEditForm = (config: SmartOltData) => (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>Edit Configuration</Text>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>ID: {config.id}</Text>
      </View>
      <View style={{ gap: 16 }}>
        <Field label="Sub-domain" value={formData.sub_domain} onChangeText={(t) => handleInputChange('sub_domain', t)} placeholder="your-subdomain" suffix=".smartolt.com" />
        <Field
          label="API Token"
          value={formData.token}
          onChangeText={(t) => handleInputChange('token', t)}
          placeholder="Enter your API token"
          secure
          secureShown={tokenFieldVisible}
          onToggleSecure={() => setTokenFieldVisible((v) => !v)}
        />
      </View>
      <FormActions />
    </View>
  );

  const FormActions: React.FC = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
      <TouchableOpacity onPress={handleCancel} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f3f4f6' }}>
        <Text style={{ fontWeight: '500', color: '#374151' }}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleSave} disabled={loading} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: primaryColor, opacity: loading ? 0.5 : 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {loading && <ActivityIndicator size="small" color="#ffffff" />}
        <Text style={{ color: '#ffffff', fontWeight: '600' }}>{loading ? 'Saving...' : 'Save Changes'}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderConfigCard = (config: SmartOltData) => (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ padding: 8, borderRadius: 10, backgroundColor: primaryColor + '1a' }}>
            <Server size={22} color={primaryColor} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Active Configuration</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={() => handleStartEdit(config)} style={{ padding: 8, borderRadius: 999 }}>
            <Pencil size={18} color="#2563eb" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(config.id)} style={{ padding: 8, borderRadius: 999 }}>
            <Trash2 size={18} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <View style={{ padding: 16, borderRadius: 12, borderWidth: 1, backgroundColor: '#f9fafb', borderColor: '#f3f4f6' }}>
          <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 4 }}>Sub-domain</Text>
          <Text style={{ fontSize: 16, color: '#111827' }}>
            {config.sub_domain}
            <Text style={{ color: '#9ca3af', fontSize: 14 }}> .smartolt.com</Text>
          </Text>
        </View>
        <View style={{ padding: 16, borderRadius: 12, borderWidth: 1, backgroundColor: '#f9fafb', borderColor: '#f3f4f6' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' }}>API Token</Text>
            <TouchableOpacity onPress={() => toggleTokenVisibility(config.id)}>
              <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: primaryColor }}>
                {showToken[config.id] ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#111827' }} numberOfLines={1}>
            {showToken[config.id] ? config.token : '••••••••••••••••••••••••••••••••'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <Clock size={14} color="#9ca3af" />
        <Text style={{ fontSize: 12, color: '#6b7280' }}>Last updated: {new Date(config.updated_at).toLocaleString()}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: isTablet ? 16 : 56 }}>
        {/* Header */}
        <View style={{ paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#111827' }}>SmartOLT Configuration</Text>
          <Text style={{ color: '#6b7280', marginTop: 2 }}>Manage your SmartOLT API credentials</Text>
          {configs.length === 0 && !isCreating && !loading && (
            <TouchableOpacity onPress={handleStartCreate} style={{ marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: primaryColor }}>
              <Text style={{ color: '#ffffff', fontWeight: '500' }}>Configure SmartOLT</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && configs.length === 0 && !isCreating ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 48 }}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 12 }}>Loading configurations...</Text>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {configs.map((config) => (
              <View key={config.id} style={{ borderRadius: 14, padding: 20, borderWidth: 1, backgroundColor: '#ffffff', borderColor: '#e5e7eb' }}>
                {editingId === config.id ? renderEditForm(config) : renderConfigCard(config)}
              </View>
            ))}

            {isCreating && (
              <View style={{ borderRadius: 14, padding: 24, borderWidth: 1, backgroundColor: '#ffffff', borderColor: '#e5e7eb' }}>
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <View style={{ padding: 12, borderRadius: 16, marginBottom: 12, backgroundColor: primaryColor + '1a' }}>
                    <Zap size={28} color={primaryColor} />
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>Initial Setup</Text>
                  <Text style={{ fontSize: 13, color: '#6b7280' }}>Connect your SmartOLT instance to the system</Text>
                </View>

                <View style={{ gap: 16 }}>
                  <Field label="Sub-domain" value={formData.sub_domain} onChangeText={(t) => handleInputChange('sub_domain', t)} placeholder="e.g. myisp" suffix=".smartolt.com" />
                  <Field
                    label="API Token"
                    value={formData.token}
                    onChangeText={(t) => handleInputChange('token', t)}
                    placeholder="Enter your unique SmartOLT API token"
                    secure
                    secureShown={tokenFieldVisible}
                    onToggleSecure={() => setTokenFieldVisible((v) => !v)}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 }}>
                    <TouchableOpacity onPress={handleSave} disabled={loading} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: primaryColor, alignItems: 'center', opacity: loading ? 0.5 : 1 }}>
                      <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>{loading ? 'Processing...' : 'Complete Connection'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleCancel} style={{ paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, backgroundColor: '#f3f4f6' }}>
                      <Text style={{ color: '#4b5563', fontWeight: 'bold' }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {configs.length === 0 && !isCreating && !loading && (
              <View style={{ alignItems: 'center', paddingVertical: 64, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }}>
                <View style={{ padding: 16, borderRadius: 999, marginBottom: 16, backgroundColor: primaryColor + '1a' }}>
                  <Zap size={40} color={primaryColor} />
                </View>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 8 }}>No SmartOLT Connection</Text>
                <Text style={{ color: '#6b7280', textAlign: 'center', maxWidth: 320, marginBottom: 24, paddingHorizontal: 16 }}>
                  Get started by connecting your SmartOLT account to automate ONU registration and management.
                </Text>
                <TouchableOpacity onPress={handleStartCreate} style={{ paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12, backgroundColor: primaryColor }}>
                  <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>Start Integration</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
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

export default SmartOltConfig;

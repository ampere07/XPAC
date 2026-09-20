import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Switch,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  MessageSquare,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SMSTemplateData {
  id: number;
  template_name: string;
  template_type: string;
  message_content: string;
  variables: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

interface SMSTemplateResponse {
  success: boolean;
  data: SMSTemplateData[];
  count: number;
  message?: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const templateTypes = [
  'Overdue',
  'DCNotice',
  'StatementofAccount',
  'Disconnected',
  'Reconnect',
  'Application',
  'Welcome',
  'Paid',
  'Due',
];

const availableVariables = [
  '{{account_no}}',
  '{{customer_name}}',
  '{{amount}}',
  '{{due_date}}',
  '{{balance}}',
  '{{plan_name}}',
  '{{payment_date}}',
  '{{installation_date}}',
  '{{mobile_number}}',
  '{{soa_date}}',
  '{{portal_url}}',
  '{{company_name}}',
];

const formatDate = (dateString?: string): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date
      .toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
      .replace(',', '');
  } catch {
    return dateString;
  }
};

// ── Main Component ────────────────────────────────────────────────────────────

const SMSTemplate: React.FC = () => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const [templates, setTemplates] = useState<SMSTemplateData[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [showFormModal, setShowFormModal] = useState(false);

  const [formData, setFormData] = useState({
    template_name: '',
    template_type: '',
    message_content: '',
    is_active: true,
  });

  const [resultModal, setResultModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: '',
  });

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    init();
    fetchTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data ────────────────────────────────────────────────────────────────────

  const fetchTemplates = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await apiClient.get<SMSTemplateResponse>('/sms-templates');
      if (response.data.success && response.data.data) {
        setTemplates(response.data.data);
      } else {
        setTemplates([]);
      }
    } catch (error) {
      console.error('Error fetching SMS templates:', error);
      setTemplates([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTemplates(true);
    setRefreshing(false);
  };

  const getCurrentUserEmail = async (): Promise<string> => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        const userData = JSON.parse(authData);
        return userData.email || userData.user?.email || '';
      }
    } catch (err) {
      console.error('Error reading auth data:', err);
    }
    return '';
  };

  const resetForm = () => {
    setFormData({ template_name: '', template_type: '', message_content: '', is_active: true });
    setEditingId(null);
    setIsCreating(false);
    setShowFormModal(false);
  };

  const handleCreate = () => {
    setFormData({ template_name: '', template_type: '', message_content: '', is_active: true });
    setEditingId(null);
    setIsCreating(true);
    setShowFormModal(true);
  };

  const handleEdit = (template: SMSTemplateData) => {
    setFormData({
      template_name: template.template_name,
      template_type: template.template_type,
      message_content: template.message_content,
      is_active: template.is_active,
    });
    setEditingId(template.id);
    setIsCreating(false);
    setShowFormModal(true);
  };

  const handleSave = async () => {
    if (!formData.template_name.trim()) {
      Alert.alert('Validation', 'Template name is required.');
      return;
    }
    if (!formData.template_type) {
      Alert.alert('Validation', 'Please select a template type.');
      return;
    }

    const userEmail = await getCurrentUserEmail();
    const variablesInMessage = formData.message_content.match(/\{\{[^}]+\}\}/g) || [];
    const uniqueVariables = Array.from(new Set(variablesInMessage));

    const dataToSave: any = {
      ...formData,
      variables: uniqueVariables,
      updated_by: userEmail,
    };

    try {
      if (isCreating) {
        dataToSave.created_by = userEmail;
        await apiClient.post('/sms-templates', dataToSave);
        resetForm();
        await fetchTemplates(true);
        setResultModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'SMS template created successfully.',
        });
      } else if (editingId) {
        await apiClient.put(`/sms-templates/${editingId}`, dataToSave);
        resetForm();
        await fetchTemplates(true);
        setResultModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'SMS template updated successfully.',
        });
      }
    } catch (error: any) {
      setResultModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error.response?.data?.message || 'Failed to save SMS template.',
      });
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this SMS template?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/sms-templates/${id}`);
              await fetchTemplates(true);
              setResultModal({
                isOpen: true,
                type: 'success',
                title: 'Deleted',
                message: 'SMS template deleted successfully.',
              });
            } catch (error: any) {
              setResultModal({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: error.response?.data?.message || 'Failed to delete SMS template.',
              });
            }
          },
        },
      ]
    );
  };

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const insertVariable = (variable: string) => {
    setFormData(prev => {
      const current = prev.message_content;
      const needsSpace = current.length > 0 && current[current.length - 1] !== ' ';
      return { ...prev, message_content: current + (needsSpace ? ' ' : '') + variable };
    });
  };

  // ── Available type options (filter already-used types unless editing that template) ──

  const availableTypes = templateTypes.filter(
    type =>
      formData.template_type === type ||
      !templates.some(t => t.template_type === type)
  );

  // ── Render list item ────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: SMSTemplateData }) => {
    const expanded = !!expandedIds[item.id];
    return (
      <View style={{
        backgroundColor: '#ffffff',
        borderRadius: 10,
        marginHorizontal: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        overflow: 'hidden',
      }}>
        {/* Card header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
          {/* Expand/collapse toggle */}
          <TouchableOpacity onPress={() => toggleExpand(item.id)} style={{ marginRight: 10 }}>
            {expanded
              ? <EyeOff size={16} color="#6b7280" />
              : <Eye size={16} color="#6b7280" />}
          </TouchableOpacity>

          {/* Name + type */}
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>
              {item.template_name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 6 }}>
              <View style={{ backgroundColor: '#f3f4f6', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, color: '#374151' }}>{item.template_type}</Text>
              </View>
              <View style={{
                backgroundColor: item.is_active ? '#dcfce7' : '#fee2e2',
                borderRadius: 4,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: item.is_active ? '#16a34a' : '#dc2626' }}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>
          </View>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <TouchableOpacity
              onPress={() => handleEdit(item)}
              style={{ padding: 8, borderRadius: 6, backgroundColor: '#eff6ff' }}
            >
              <Edit2 size={14} color="#2563eb" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item.id)}
              style={{ padding: 8, borderRadius: 6, backgroundColor: '#fef2f2' }}
            >
              <Trash2 size={14} color="#dc2626" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Expanded detail */}
        {expanded && (
          <View style={{
            borderTopWidth: 1,
            borderTopColor: '#f1f5f9',
            backgroundColor: '#f9fafb',
            padding: 14,
            gap: 10,
          }}>
            <View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 }}>
                Message Content:
              </Text>
              <Text style={{ fontSize: 13, color: '#4b5563', lineHeight: 20 }}>
                {item.message_content}
              </Text>
            </View>

            {item.variables && item.variables.length > 0 && (
              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 }}>
                  Variables:
                </Text>
                <Text style={{ fontSize: 12, color: '#6b7280' }}>
                  {Array.isArray(item.variables) ? item.variables.join(', ') : item.variables}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: isTablet ? 'row' : 'column', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151', marginBottom: 2 }}>
                  Created By
                </Text>
                <Text style={{ fontSize: 12, color: '#4b5563' }}>{item.created_by || 'Unknown'}</Text>
                <Text style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(item.created_at)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#374151', marginBottom: 2 }}>
                  Last Updated By
                </Text>
                <Text style={{ fontSize: 12, color: '#4b5563' }}>{item.updated_by || 'Unknown'}</Text>
                <Text style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(item.updated_at)}</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  // ── Form Modal ────────────────────────────────────────────────────────────

  const renderFormModal = () => (
    <Modal
      visible={showFormModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={resetForm}
    >
      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        {/* Modal header */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
        }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827' }}>
            {isCreating ? 'Create New Template' : 'Edit Template'}
          </Text>
          <TouchableOpacity onPress={resetForm} style={{ padding: 4 }}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Available Variables */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>Available Variables</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {availableVariables.map(variable => (
                <TouchableOpacity
                  key={variable}
                  onPress={() => insertVariable(variable)}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 4,
                    backgroundColor: '#f3f4f6',
                    borderLeftWidth: 2,
                    borderLeftColor: primaryColor,
                    marginBottom: 4,
                  }}
                >
                  <Text style={{ fontSize: 11, color: primaryColor, fontFamily: 'monospace' }}>
                    {variable}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Template Name */}
          <View style={{ marginBottom: 14 }}>
            <Text style={labelStyle}>Template Name</Text>
            <TextInput
              value={formData.template_name}
              onChangeText={v => setFormData(prev => ({ ...prev, template_name: v }))}
              placeholder="Enter template name"
              placeholderTextColor="#9ca3af"
              style={fieldStyle}
            />
          </View>

          {/* Template Type */}
          <View style={{ marginBottom: 14 }}>
            <Text style={labelStyle}>Template Type</Text>
            <View style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 8,
              overflow: 'hidden',
              backgroundColor: '#ffffff',
            }}>
              <Picker
                selectedValue={formData.template_type}
                onValueChange={v => setFormData(prev => ({ ...prev, template_type: v }))}
                style={{ color: '#111827' }}
              >
                <Picker.Item label="Select type..." value="" />
                {availableTypes.map(type => (
                  <Picker.Item key={type} label={type} value={type} />
                ))}
              </Picker>
            </View>
          </View>

          {/* Message Content */}
          <View style={{ marginBottom: 14 }}>
            <Text style={labelStyle}>Message Content</Text>
            <TextInput
              value={formData.message_content}
              onChangeText={v => setFormData(prev => ({ ...prev, message_content: v }))}
              placeholder="Enter message content. Tap variables above to insert them."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              style={[fieldStyle, { minHeight: 100, paddingTop: 12 }]}
            />
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Tap on the variable buttons above to insert them into your message.
            </Text>
          </View>

          {/* Active toggle */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#ffffff',
            padding: 14,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#e5e7eb',
            marginBottom: 14,
          }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Active</Text>
            <Switch
              value={formData.is_active}
              onValueChange={v => setFormData(prev => ({ ...prev, is_active: v }))}
              trackColor={{ false: '#d1d5db', true: `${primaryColor}66` }}
              thumbColor={formData.is_active ? primaryColor : '#9ca3af'}
            />
          </View>
        </ScrollView>

        {/* Footer actions */}
        <View style={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
        }}>
          <TouchableOpacity
            onPress={resetForm}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: '#f3f4f6',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            style={{
              flex: 2,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: primaryColor,
            }}
          >
            <Save size={14} color="#ffffff" />
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>
              {isCreating ? 'Create Template' : 'Save Changes'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ── Root Layout ────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Page header */}
      <View style={{
        paddingHorizontal: 16,
        paddingTop: isTablet ? 16 : 60,
        paddingBottom: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={20} color={primaryColor} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>SMS Templates</Text>
        </View>
        <TouchableOpacity
          onPress={handleCreate}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: primaryColor,
          }}
        >
          <Plus size={16} color="#ffffff" />
          <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>New</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      {loading && templates.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading templates...</Text>
        </View>
      ) : (
        <FlatList
          data={templates}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={primaryColor}
              colors={[primaryColor]}
            />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <MessageSquare size={40} color="#d1d5db" />
              <Text style={{ color: '#9ca3af', marginTop: 12, fontSize: 14 }}>
                No SMS templates found
              </Text>
              <TouchableOpacity
                onPress={handleCreate}
                style={{
                  marginTop: 16,
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: primaryColor,
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Create First Template</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Form modal */}
      {renderFormModal()}

      {/* Result modal */}
      <LoadingModalGlobal
        isOpen={resultModal.isOpen}
        type={resultModal.type}
        title={resultModal.title}
        message={resultModal.message}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        onConfirm={resultModal.onConfirm ?? (() => setResultModal(m => ({ ...m, isOpen: false })))}
        onCancel={resultModal.onCancel ?? (() => setResultModal(m => ({ ...m, isOpen: false })))}
      />
    </View>
  );
};

// ── Style constants ───────────────────────────────────────────────────────────

const labelStyle = {
  fontSize: 12,
  fontWeight: '600' as const,
  color: '#374151',
  marginBottom: 6,
};

const fieldStyle = {
  backgroundColor: '#ffffff',
  borderWidth: 1,
  borderColor: '#d1d5db',
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  color: '#111827',
};

export default SMSTemplate;

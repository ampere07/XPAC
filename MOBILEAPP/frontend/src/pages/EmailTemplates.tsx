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
  Dimensions,
  Switch,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Plus, Edit2, Trash2, Check, X, ChevronDown, ChevronUp, Mail, RefreshCw } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

// ── Types ────────────────────────────────────────────────────────────────────

interface EmailTemplateData {
  Template_Code: string;
  Subject_Line: string;
  Body_HTML: string;
  Description: string;
  Is_Active: boolean;
  email_body: string;
  cc: string;
  bcc: string;
  email_sender: string;
  sender_name: string;
  reply_to: string;
  Page_Margin?: string;
  Image_Margin?: string;
  modified_by?: string;
  modifiet_at?: string;
}

interface EmailTemplateResponse {
  success: boolean;
  data: EmailTemplateData[];
  count: number;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const TEMPLATE_CODES = [
  'WELCOME',
  'SOA_TEMPLATE',
  'RECONNECT',
  'PAID',
  'OVERDUE_DESIGN',
  'DISCONNECTED',
  'DCNOTICE_DESIGN',
  'APPLICATION',
];

const CUSTOMER_TAGS = ['Full_Name', 'Address', 'Account_No', 'Contact_No', 'Email', 'Plan'];
const FINANCIAL_TAGS = ['Prev_Balance', 'Monthly_Fee', 'VAT', 'Amount_Due', 'Total_Due'];
const SMART_ROW_TAGS = ['Row_Discounts', 'Row_Rebates', 'Row_Service', 'Row_Staggered', 'Row_Install'];
const LABEL_TAGS = ['Label_Discounts', 'Label_Rebates', 'Label_Service', 'Label_Staggered'];
const AMOUNT_TAGS = ['Amount_Discounts', 'Amount_Rebates', 'Amount_Service', 'Amount_Install'];

const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
};

// ── Main Component ────────────────────────────────────────────────────────────

const EmailTemplates: React.FC = () => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const [templates, setTemplates] = useState<EmailTemplateData[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showVariablePanel, setShowVariablePanel] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: '',
  });

  const emptyForm = {
    Template_Code: '',
    Subject_Line: '',
    cc: '',
    bcc: '',
    email_sender: '',
    sender_name: '',
    reply_to: '',
    Body_HTML: '',
    Description: '',
    Is_Active: true,
    email_body: '',
    Page_Margin: '1in',
    Image_Margin: '0px',
  };

  const [formData, setFormData] = useState({ ...emptyForm });

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
      const response = await apiClient.get<EmailTemplateResponse>('/email-templates');
      if (response.data.success && response.data.data) {
        setTemplates(response.data.data);
        // Auto-select first template if none selected
        if (response.data.data.length > 0 && !selectedTemplate) {
          selectTemplate(response.data.data[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching email templates:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTemplates(true);
    setRefreshing(false);
  };

  const selectTemplate = (template: EmailTemplateData) => {
    setSelectedTemplate(template);
    setFormData({
      Template_Code: template.Template_Code,
      Subject_Line: template.Subject_Line,
      cc: template.cc || '',
      bcc: template.bcc || '',
      email_sender: template.email_sender || '',
      sender_name: template.sender_name || '',
      reply_to: template.reply_to || '',
      Body_HTML: template.Body_HTML || '',
      Description: template.Description || '',
      Is_Active: template.Is_Active,
      email_body: template.email_body || '',
      Page_Margin: template.Page_Margin || '1in',
      Image_Margin: template.Image_Margin || '0px',
    });
    setIsEditing(false);
    setIsCreating(false);
  };

  const getCurrentUserEmail = async (): Promise<string> => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        const userData = JSON.parse(authData);
        return userData.email || userData.email_address || '';
      }
    } catch (err) {
      console.error('Error reading auth data:', err);
    }
    return '';
  };

  const handleSave = async () => {
    const currentUserEmail = await getCurrentUserEmail();
    if (!currentUserEmail) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Authentication Required',
        message: 'Your session has expired. Please re-login.',
      });
      return;
    }

    setModal({ isOpen: true, type: 'loading', title: 'Saving...', message: 'Please wait' });

    try {
      const payload = {
        ...formData,
        modified_by: currentUserEmail,
      };

      if (isCreating) {
        await apiClient.post('/email-templates', payload);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Email template created successfully.',
          onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
        });
        setIsCreating(false);
        setShowFormModal(false);
      } else if (selectedTemplate) {
        await apiClient.put(`/email-templates/${selectedTemplate.Template_Code}`, payload);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Email template updated successfully.',
          onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
        });
        setIsEditing(false);
        setShowFormModal(false);
      }

      await fetchTemplates(true);
    } catch (error: any) {
      let errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      if (error.response?.data?.errors) {
        const valErrors = Object.values(error.response.data.errors).flat().join('\n');
        errorMessage += `\n${valErrors}`;
      }
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to save: ${errorMessage}`,
        onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
      });
    }
  };

  const handleDelete = (templateCode: string) => {
    Alert.alert(
      'Confirm Deletion',
      'Are you sure you want to delete this email template? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setModal({ isOpen: true, type: 'loading', title: 'Deleting...', message: 'Please wait' });
            try {
              await apiClient.delete(`/email-templates/${templateCode}`);
              setSelectedTemplate(null);
              await fetchTemplates(true);
              setModal({
                isOpen: true,
                type: 'success',
                title: 'Deleted',
                message: 'Email template deleted successfully.',
                onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
              });
            } catch (error: any) {
              setModal({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: `Failed to delete: ${error.response?.data?.message || error.message}`,
                onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
              });
            }
          },
        },
      ]
    );
  };

  const handleToggleActive = async (template: EmailTemplateData) => {
    const userEmail = await getCurrentUserEmail();
    setModal({ isOpen: true, type: 'loading', title: 'Updating...', message: 'Please wait' });
    try {
      await apiClient.post(`/email-templates/${template.Template_Code}/toggle-active`, {
        modified_by: userEmail,
      });
      await fetchTemplates(true);
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Updated',
        message: 'Template status updated successfully.',
        onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
      });
    } catch (error: any) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to update status: ${error.response?.data?.message || error.message}`,
        onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
      });
    }
  };

  const handleStartCreate = () => {
    setFormData({ ...emptyForm });
    setIsCreating(true);
    setIsEditing(false);
    setShowFormModal(true);
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setIsCreating(false);
    setShowFormModal(true);
  };

  const handleCancelEdit = () => {
    if (selectedTemplate) {
      selectTemplate(selectedTemplate);
    }
    setIsEditing(false);
    setIsCreating(false);
    setShowFormModal(false);
  };

  const insertVariable = (variable: string) => {
    setFormData(prev => {
      const current = prev.email_body || '';
      const needsSpace = current.length > 0 && current[current.length - 1] !== ' ';
      return { ...prev, email_body: current + (needsSpace ? ' ' : '') + variable };
    });
  };

  const handleField = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // ── Template List ─────────────────────────────────────────────────────────

  const renderTemplateItem = ({ item }: { item: EmailTemplateData }) => {
    const isSelected = selectedTemplate?.Template_Code === item.Template_Code;
    return (
      <TouchableOpacity
        onPress={() => selectTemplate(item)}
        style={{
          backgroundColor: isSelected ? `${primaryColor}18` : '#ffffff',
          borderLeftWidth: isSelected ? 3 : 0,
          borderLeftColor: primaryColor,
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: isSelected ? primaryColor : '#111827' }}>
              {item.Template_Code}
            </Text>
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }} numberOfLines={1}>
              {item.Subject_Line || 'No subject'}
            </Text>
            {item.modified_by ? (
              <Text style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }} numberOfLines={1}>
                {item.modified_by}
                {item.modifiet_at ? `  •  ${formatDateTime(item.modifiet_at)}` : ''}
              </Text>
            ) : null}
          </View>
          <View style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: item.Is_Active ? '#22c55e' : '#9ca3af',
          }} />
        </View>
      </TouchableOpacity>
    );
  };

  // ── Variable Tag Button ──────────────────────────────────────────────────

  const TagButton: React.FC<{ tag: string; color?: string; onPress: () => void }> = ({
    tag, color, onPress,
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: '#f3f4f6',
        borderLeftWidth: 2,
        borderLeftColor: color || primaryColor,
        marginBottom: 4,
        marginRight: 4,
      }}
    >
      <Text style={{ fontSize: 11, color: color || primaryColor, fontFamily: 'monospace' }}>{`{{${tag}}}`}</Text>
    </TouchableOpacity>
  );

  // ── Detail View (read-only) ───────────────────────────────────────────────

  const renderDetailView = () => {
    if (!selectedTemplate) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
          <Mail size={40} color="#d1d5db" />
          <Text style={{ color: '#9ca3af', marginTop: 12, fontSize: 15 }}>Select a template to view</Text>
        </View>
      );
    }

    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* Header card */}
        <View style={{
          backgroundColor: '#ffffff',
          borderRadius: 10,
          padding: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: '#e5e7eb',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', flex: 1 }}>
              {selectedTemplate.Template_Code}
            </Text>
            <View style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 12,
              backgroundColor: selectedTemplate.Is_Active ? '#dcfce7' : '#f3f4f6',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: selectedTemplate.Is_Active ? '#16a34a' : '#6b7280' }}>
                {selectedTemplate.Is_Active ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>

          {!!selectedTemplate.Subject_Line && (
            <InfoRow label="Subject" value={selectedTemplate.Subject_Line} />
          )}
          {!!selectedTemplate.Description && (
            <InfoRow label="Description" value={selectedTemplate.Description} />
          )}
          {(!!selectedTemplate.sender_name || !!selectedTemplate.email_sender) && (
            <InfoRow
              label="From"
              value={
                selectedTemplate.sender_name
                  ? `${selectedTemplate.sender_name} <${selectedTemplate.email_sender}>`
                  : selectedTemplate.email_sender
              }
            />
          )}
          {!!selectedTemplate.reply_to && (
            <InfoRow label="Reply To" value={selectedTemplate.reply_to} />
          )}
          {!!selectedTemplate.cc && <InfoRow label="CC" value={selectedTemplate.cc} />}
          {!!selectedTemplate.bcc && <InfoRow label="BCC" value={selectedTemplate.bcc} />}

          {selectedTemplate.modified_by ? (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
              <Text style={{ fontSize: 10, color: '#9ca3af' }}>
                Last modified by{' '}
                <Text style={{ color: '#6b7280', fontWeight: '600' }}>{selectedTemplate.modified_by}</Text>
                {selectedTemplate.modifiet_at ? `  •  ${formatDateTime(selectedTemplate.modifiet_at)}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Email body preview */}
        <View style={{
          backgroundColor: '#ffffff',
          borderRadius: 10,
          padding: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: '#e5e7eb',
        }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Email Body
          </Text>
          <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20, fontFamily: 'monospace' }}>
            {selectedTemplate.email_body || 'No body content defined.'}
          </Text>
        </View>

        {/* HTML preview note for SOA templates */}
        {selectedTemplate.Template_Code === 'SOA_TEMPLATE' && selectedTemplate.Body_HTML ? (
          <View style={{
            backgroundColor: '#fefce8',
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: '#fef08a',
          }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#854d0e', marginBottom: 4 }}>SOA HTML Template</Text>
            <Text style={{ fontSize: 11, color: '#713f12', lineHeight: 18 }}>
              This template has an HTML body for PDF/print rendering. Edit the HTML content below when in edit mode.
            </Text>
          </View>
        ) : null}

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 24 }}>
          <TouchableOpacity
            onPress={handleStartEdit}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Edit2 size={14} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Edit Template</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleToggleActive(selectedTemplate)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8,
              backgroundColor: selectedTemplate.Is_Active ? '#f59e0b' : '#22c55e',
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>
              {selectedTemplate.Is_Active ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleDelete(selectedTemplate.Template_Code)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#ef4444' }}
          >
            <Trash2 size={14} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Delete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  // ── Edit / Create Form Modal ─────────────────────────────────────────────

  const renderFormModal = () => {
    const isSoa = formData.Template_Code === 'SOA_TEMPLATE';
    const availableCodes = TEMPLATE_CODES.filter(code =>
      isEditing
        ? true
        : !templates.some(t => t.Template_Code === code)
    );

    return (
      <Modal
        visible={showFormModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCancelEdit}
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
              {isCreating ? 'New Template' : `Edit: ${formData.Template_Code}`}
            </Text>
            <TouchableOpacity onPress={handleCancelEdit} style={{ padding: 4 }}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {/* Template Code */}
            <FormSection title="Template Code">
              {isCreating ? (
                <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff' }}>
                  <Picker
                    selectedValue={formData.Template_Code}
                    onValueChange={v => handleField('Template_Code', v)}
                    style={{ color: '#111827' }}
                  >
                    <Picker.Item label="Select Template Code..." value="" />
                    {availableCodes.map(code => (
                      <Picker.Item key={code} label={code} value={code} />
                    ))}
                  </Picker>
                </View>
              ) : (
                <View style={{ backgroundColor: '#f3f4f6', borderRadius: 8, padding: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>{formData.Template_Code}</Text>
                  <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Template code cannot be changed after creation</Text>
                </View>
              )}
            </FormSection>

            {/* Subject + Sender Name */}
            <FormSection title="Subject Line">
              <TextInput
                value={formData.Subject_Line}
                onChangeText={v => handleField('Subject_Line', v)}
                placeholder="Subject Line"
                placeholderTextColor="#9ca3af"
                style={fieldStyle}
              />
            </FormSection>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Sender Name</Text>
                <TextInput
                  value={formData.sender_name}
                  onChangeText={v => handleField('sender_name', v)}
                  placeholder="Sender Name"
                  placeholderTextColor="#9ca3af"
                  style={fieldStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Email Sender</Text>
                <TextInput
                  value={formData.email_sender}
                  onChangeText={v => handleField('email_sender', v)}
                  placeholder="sender@email.com"
                  placeholderTextColor="#9ca3af"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={fieldStyle}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Reply To</Text>
                <TextInput
                  value={formData.reply_to}
                  onChangeText={v => handleField('reply_to', v)}
                  placeholder="reply@email.com"
                  placeholderTextColor="#9ca3af"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={fieldStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>CC</Text>
                <TextInput
                  value={formData.cc}
                  onChangeText={v => handleField('cc', v)}
                  placeholder="cc@email.com"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  style={fieldStyle}
                />
              </View>
            </View>

            <FormSection title="BCC">
              <TextInput
                value={formData.bcc}
                onChangeText={v => handleField('bcc', v)}
                placeholder="bcc@email.com"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                style={fieldStyle}
              />
            </FormSection>

            <FormSection title="Description">
              <TextInput
                value={formData.Description}
                onChangeText={v => handleField('Description', v)}
                placeholder="Template description..."
                placeholderTextColor="#9ca3af"
                style={fieldStyle}
              />
            </FormSection>

            {/* Active toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, backgroundColor: '#ffffff', padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Active</Text>
              <Switch
                value={formData.Is_Active}
                onValueChange={v => handleField('Is_Active', v)}
                trackColor={{ false: '#d1d5db', true: `${primaryColor}66` }}
                thumbColor={formData.Is_Active ? primaryColor : '#9ca3af'}
              />
            </View>

            {/* Variable insertion panel */}
            <View style={{ marginBottom: 14 }}>
              <TouchableOpacity
                onPress={() => setShowVariablePanel(p => !p)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: '#ffffff', padding: 14, borderRadius: 8,
                  borderWidth: 1, borderColor: '#e5e7eb',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151' }}>Insert Variables</Text>
                {showVariablePanel ? <ChevronUp size={16} color="#6b7280" /> : <ChevronDown size={16} color="#6b7280" />}
              </TouchableOpacity>

              {showVariablePanel && (
                <View style={{ backgroundColor: '#ffffff', borderWidth: 1, borderTopWidth: 0, borderColor: '#e5e7eb', borderBottomLeftRadius: 8, borderBottomRightRadius: 8, padding: 12 }}>
                  {isSoa && (
                    <>
                      <Text style={varGroupLabel}>Smart Rows (SOA)</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {SMART_ROW_TAGS.map(tag => (
                          <TagButton key={tag} tag={tag} color="#16a34a" onPress={() => insertVariable(`{{${tag}}}`)} />
                        ))}
                      </View>

                      <Text style={varGroupLabel}>Labels (SOA)</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {LABEL_TAGS.map(tag => (
                          <TagButton key={tag} tag={tag} color="#7c3aed" onPress={() => insertVariable(`{{${tag}}}`)} />
                        ))}
                      </View>

                      <Text style={varGroupLabel}>Amounts (SOA)</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {AMOUNT_TAGS.map(tag => (
                          <TagButton key={tag} tag={tag} color="#d97706" onPress={() => insertVariable(`{{${tag}}}`)} />
                        ))}
                      </View>
                    </>
                  )}

                  <Text style={varGroupLabel}>Customer</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {CUSTOMER_TAGS.map(tag => (
                      <TagButton key={tag} tag={tag} color={primaryColor} onPress={() => insertVariable(`{{${tag}}}`)} />
                    ))}
                  </View>

                  <Text style={varGroupLabel}>Financials</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {FINANCIAL_TAGS.map(tag => (
                      <TagButton key={tag} tag={tag} color={primaryColor} onPress={() => insertVariable(`{{${tag}}}`)} />
                    ))}
                  </View>

                  <Text style={varGroupLabel}>Global</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <TagButton tag="portal_url" color={primaryColor} onPress={() => insertVariable('{{portal_url}}')} />
                    <TagButton tag="company_name" color={primaryColor} onPress={() => insertVariable('{{company_name}}')} />
                  </View>
                </View>
              )}
            </View>

            {/* Email body */}
            <FormSection title="Email Body">
              <TextInput
                value={formData.email_body}
                onChangeText={v => handleField('email_body', v)}
                placeholder="Email body content. Tap variables above to insert them."
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={8}
                textAlignVertical="top"
                style={[fieldStyle, { minHeight: 160, paddingTop: 12 }]}
              />
            </FormSection>

            {/* HTML body (SOA only) */}
            {isSoa && (
              <FormSection title="HTML Body (SOA Template)">
                <TextInput
                  value={formData.Body_HTML}
                  onChangeText={v => handleField('Body_HTML', v)}
                  placeholder="Raw HTML content for PDF/print rendering..."
                  placeholderTextColor="#9ca3af"
                  multiline
                  numberOfLines={12}
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[fieldStyle, { minHeight: 220, paddingTop: 12, fontFamily: 'monospace', fontSize: 12 }]}
                />
              </FormSection>
            )}
          </ScrollView>

          {/* Modal footer actions */}
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
              onPress={handleCancelEdit}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 8, backgroundColor: '#f3f4f6' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              style={{ flex: 2, alignItems: 'center', paddingVertical: 12, borderRadius: 8, backgroundColor: primaryColor }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>
                {isCreating ? 'Create Template' : 'Save Changes'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Root Layout ───────────────────────────────────────────────────────────

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
          <Mail size={20} color={primaryColor} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Email Templates</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => fetchTemplates()}
            style={{ padding: 10, borderRadius: 8, backgroundColor: '#f3f4f6' }}
          >
            <RefreshCw size={16} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleStartCreate}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
          >
            <Plus size={16} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      {loading && templates.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading templates...</Text>
        </View>
      ) : isTablet ? (
        /* Tablet: side-by-side layout */
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* Left sidebar — template list */}
          <View style={{ width: 280, borderRightWidth: 1, borderRightColor: '#e5e7eb', backgroundColor: '#ffffff' }}>
            <FlatList
              data={templates}
              keyExtractor={item => item.Template_Code}
              renderItem={renderTemplateItem}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
              ListEmptyComponent={
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Text style={{ color: '#9ca3af', fontSize: 13 }}>No templates found</Text>
                </View>
              }
            />
          </View>
          {/* Right — detail view */}
          <View style={{ flex: 1 }}>
            {renderDetailView()}
          </View>
        </View>
      ) : (
        /* Phone: stacked layout — list then detail */
        <FlatList
          data={templates}
          keyExtractor={item => item.Template_Code}
          renderItem={renderTemplateItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListHeaderComponent={
            selectedTemplate ? (
              <View style={{ backgroundColor: '#f9fafb' }}>
                {renderDetailView()}
                <View style={{ height: 1, backgroundColor: '#e5e7eb', marginVertical: 8 }} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#9ca3af', paddingHorizontal: 16, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  All Templates
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <Mail size={36} color="#d1d5db" />
              <Text style={{ color: '#9ca3af', marginTop: 12, fontSize: 14 }}>No templates found</Text>
              <TouchableOpacity
                onPress={handleStartCreate}
                style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600' }}>Create First Template</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Edit/Create form modal */}
      {renderFormModal()}

      {/* Global result/confirm modal */}
      <LoadingModalGlobal
        isOpen={modal.isOpen}
        type={modal.type}
        title={modal.title}
        message={modal.message}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        onConfirm={modal.onConfirm ?? (() => setModal(m => ({ ...m, isOpen: false })))}
        onCancel={modal.onCancel ?? (() => setModal(m => ({ ...m, isOpen: false })))}
      />
    </View>
  );
};

// ── Small helpers ─────────────────────────────────────────────────────────────

const InfoRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: '#6b7280', width: 80 }}>{label}:</Text>
      <Text style={{ fontSize: 12, color: '#374151', flex: 1 }}>{value}</Text>
    </View>
  );
};

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={{ marginBottom: 14 }}>
    <Text style={labelStyle}>{title}</Text>
    {children}
  </View>
);

const labelStyle = {
  fontSize: 12,
  fontWeight: '600' as const,
  color: '#374151',
  marginBottom: 6,
};

const varGroupLabel = {
  fontSize: 11,
  fontWeight: '700' as const,
  color: '#9ca3af',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginTop: 8,
  marginBottom: 4,
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

export default EmailTemplates;

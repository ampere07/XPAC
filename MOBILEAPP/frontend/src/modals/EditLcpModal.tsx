import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface LcpItem {
  id: number;
  lcp_name: string;
  created_at?: string;
  updated_at?: string;
  organization_id?: number | null;
}

interface LcpFormData {
  name: string;
}

interface EditLcpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (lcpData: LcpFormData) => void;
  lcpItem: LcpItem | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const EditLcpModal: React.FC<EditLcpModalProps> = ({ isOpen, onClose, onSave, lcpItem }) => {
  const [formData, setFormData] = useState<LcpFormData>({ name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');
  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, type: 'loading', title: '', message: '' });

  const formatDateTime = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';

    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = String(hours).padStart(2, '0');

    return `${month}/${day}/${year} ${strHours}:${minutes}:${seconds} ${ampm}`;
  };

  useEffect(() => {
    const init = async () => {
      let userEmail = 'Unknown User';
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || 'Unknown User';
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
      setModifiedBy(userEmail);

      if (isOpen) {
        setFormData({ name: lcpItem ? lcpItem.lcp_name : '' });
        setModifiedDate(formatDateTime(new Date()));
      }
    };
    init();
  }, [isOpen, lcpItem]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'LCP Name is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setModal({ isOpen: true, type: 'warning', title: 'Validation Error', message: 'LCP Name is required.' });
      return;
    }

    setLoading(true);
    try {
      await onSave(formData);
      setLoading(false);
      handleClose();
    } catch (error: any) {
      console.error('Error saving LCP:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to save LCP. Please try again.';
      setModal({ isOpen: true, type: 'error', title: 'Error', message: errorMessage });
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '' });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={lcpItem ? 'Edit LCP Details' : 'Add New LCP'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSave, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <EditLcpContent formData={formData} setFormData={setFormData} errors={errors} modifiedDate={modifiedDate} modifiedBy={modifiedBy} />
    </ModalUITemplate>
  );
};

const EditLcpContent: React.FC<{
  formData: LcpFormData;
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#1f2937';
  const readOnlyLabelColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const inputBorder = errors.name
    ? '#ef4444'
    : isFocused
      ? (colorPalette?.primary || '#7c3aed')
      : (isDarkMode ? '#374151' : '#d1d5db');

  const readOnlyStyle = {
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    opacity: 0.6,
    borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
          LCP Name<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={formData.name}
          onChangeText={(text) => setFormData({ ...formData, name: text })}
          placeholder="Enter LCP instance name"
          placeholderTextColor="#9ca3af"
          autoFocus
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: '100%',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: inputBorder,
            color: isDarkMode ? '#ffffff' : '#000000',
          }}
        />
        {!!errors.name && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.name}</Text>}
      </View>

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified Date
          </Text>
          <TextInput value={modifiedDate} editable={false} style={readOnlyStyle} />
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified By
          </Text>
          <TextInput value={modifiedBy} editable={false} style={readOnlyStyle} />
        </View>
      </View>
    </View>
  );
};

export default EditLcpModal;

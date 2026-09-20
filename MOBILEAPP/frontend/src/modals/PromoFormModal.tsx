import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface Promo {
  id: number;
  name: string;
  promo_name?: string;
  description?: string;
  status?: string;
  organization_id?: number | null;
  created_at?: string;
  updated_at?: string;
  creator_email?: string;
  updater_email?: string;
}

interface PromoFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingPromo: Promo | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const PromoFormModal: React.FC<PromoFormModalProps> = ({ isOpen, onClose, onSave, editingPromo }) => {
  const [formData, setFormData] = useState({ name: '', status: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: '',
  });

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
      if (!isOpen) return;
      if (editingPromo) {
        setFormData({ name: editingPromo.name, status: editingPromo.status || '' });
        setModifiedDate(formatDateTime(new Date(editingPromo.updated_at || editingPromo.created_at || new Date())));
        setModifiedBy(editingPromo.updater_email || editingPromo.creator_email || 'N/A');
      } else {
        setFormData({ name: '', status: '' });
        setErrors({});
        setModifiedDate(formatDateTime(new Date()));
        try {
          const authData = await AsyncStorage.getItem('authData');
          if (authData) {
            const userData = JSON.parse(authData);
            setModifiedBy(userData.email || userData.email_address || 'Unknown User');
          }
        } catch (e) {
          setModifiedBy('Unknown User');
        }
      }
    };
    init();
  }, [isOpen, editingPromo]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Promo name is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Please fill in all required fields.',
      });
      return;
    }

    setLoading(true);

    try {
      let userEmail = '';
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || '';
        } catch (e) {
          console.error('Error parsing authData:', e);
        }
      }

      const payload = {
        name: formData.name.trim(),
        status: formData.status.trim(),
        email_address: userEmail,
      };

      const response = editingPromo
        ? await apiClient.put(`/promos/${editingPromo.id}`, payload)
        : await apiClient.post('/promos', payload);

      const data = response.data;

      if (data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: data.message || `Promo ${editingPromo ? 'updated' : 'added'} successfully`,
          onConfirm: () => {
            onSave();
            handleClose();
            setModal((prev) => ({ ...prev, isOpen: false }));
          },
        });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: data.message || `Failed to ${editingPromo ? 'update' : 'add'} promo`,
        });
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const data = error?.response?.data;
      if (data?.errors) {
        const errorMessages = Object.values(data.errors).flat().join('\n');
        setModal({ isOpen: true, type: 'error', title: 'Validation Errors', message: errorMessages });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: `Failed to ${editingPromo ? 'update' : 'add'} promo: ${data?.message || error.message}`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', status: '' });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingPromo ? 'Edit Promo' : 'Add Promo'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <PromoFormContent
        formData={formData}
        setFormData={setFormData}
        errors={errors}
        modifiedDate={modifiedDate}
        modifiedBy={modifiedBy}
      />
    </ModalUITemplate>
  );
};

const PromoFormContent: React.FC<{
  formData: { name: string; status: string };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#374151';
  const readOnlyLabelColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const nameBorder = errors.name
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
          Promo Name<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={formData.name}
          onChangeText={(text) => setFormData({ ...formData, name: text })}
          placeholder="Enter promo name"
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
            borderColor: nameBorder,
            color: isDarkMode ? '#ffffff' : '#000000',
          }}
        />
        {!!errors.name && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.name}</Text>}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>Status</Text>
        <View style={{ borderWidth: 1, borderRadius: 6, borderColor: isDarkMode ? '#374151' : '#d1d5db', overflow: 'hidden' }}>
          <Picker
            selectedValue={formData.status}
            onValueChange={(v) => setFormData({ ...formData, status: v })}
            style={{ color: isDarkMode ? '#ffffff' : '#111827' }}
            dropdownIconColor={isDarkMode ? '#9ca3af' : '#6b7280'}
          >
            <Picker.Item label="Select Status" value="" />
            <Picker.Item label="Active" value="Active" />
            <Picker.Item label="Inactive" value="Inactive" />
          </Picker>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified Date
          </Text>
          <TextInput value={modifiedDate} editable={false} style={readOnlyStyle} />
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified By
          </Text>
          <TextInput value={modifiedBy} editable={false} style={readOnlyStyle} />
        </View>
      </View>
    </View>
  );
};

export default PromoFormModal;

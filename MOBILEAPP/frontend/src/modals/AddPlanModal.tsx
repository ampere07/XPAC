import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Plus, Minus } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface Plan {
  id: number;
  name: string;
  description?: string;
  price: number;
  is_active?: boolean;
  organization_id?: number | null;
  modified_date?: string;
  modified_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface AddPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingPlan?: Plan | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AddPlanModal: React.FC<AddPlanModalProps> = ({ isOpen, onClose, onSave, editingPlan }) => {
  const [formData, setFormData] = useState({ name: '', description: '', price: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');
  const [loading, setLoading] = useState(false);
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
      if (editingPlan) {
        setFormData({
          name: editingPlan.name,
          description: editingPlan.description || '',
          price: editingPlan.price || 0,
        });
        setModifiedDate(formatDateTime(new Date(editingPlan.modified_date || editingPlan.updated_at || new Date())));
        setModifiedBy(editingPlan.modified_by || 'N/A');
      } else {
        setFormData({ name: '', description: '', price: 0 });
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
  }, [isOpen, editingPlan]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Plan name is required';
    }
    if (formData.price < 0) {
      newErrors.price = 'Price cannot be negative';
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
      const authData = await AsyncStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      const userEmail = currentUser?.email || currentUser?.email_address || '';

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        price: formData.price,
        email_address: userEmail,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };

      const response = editingPlan
        ? await apiClient.put(`/plans/${editingPlan.id}`, payload)
        : await apiClient.post('/plans', payload);

      const data = response.data;

      if (data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: data.message || `Plan ${editingPlan ? 'updated' : 'added'} successfully`,
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
          message: data.message || `Failed to ${editingPlan ? 'update' : 'add'} plan`,
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
          message: `Failed to ${editingPlan ? 'update' : 'add'} plan: ${data?.message || error.message}`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '', description: '', price: 0 });
    setErrors({});
    onClose();
  };

  const incrementPrice = () => setFormData((p) => ({ ...p, price: p.price + 1 }));
  const decrementPrice = () => setFormData((p) => ({ ...p, price: p.price > 0 ? p.price - 1 : 0 }));

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingPlan ? 'Edit Plan' : 'Add Plan'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <PlanFormContent
        formData={formData}
        setFormData={setFormData}
        errors={errors}
        incrementPrice={incrementPrice}
        decrementPrice={decrementPrice}
        modifiedDate={modifiedDate}
        modifiedBy={modifiedBy}
      />
    </ModalUITemplate>
  );
};

const PlanFormContent: React.FC<{
  formData: { name: string; description: string; price: number };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  incrementPrice: () => void;
  decrementPrice: () => void;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, incrementPrice, decrementPrice, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const labelColor = isDarkMode ? '#d1d5db' : '#374151';
  const readOnlyLabelColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const subtleBg = isDarkMode ? '#1f2937' : '#f3f4f6';
  const subtleBorder = isDarkMode ? '#374151' : '#d1d5db';
  const primary = colorPalette?.primary || '#7c3aed';

  const borderFor = (field: string, hasError?: boolean) =>
    hasError ? '#ef4444' : focusedField === field ? primary : subtleBorder;

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
          Plan Name<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={formData.name}
          onChangeText={(text) => setFormData({ ...formData, name: text })}
          placeholder="Enter plan name"
          placeholderTextColor="#9ca3af"
          autoFocus
          onFocus={() => setFocusedField('name')}
          onBlur={() => setFocusedField(null)}
          style={{
            width: '100%',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: borderFor('name', !!errors.name),
            color: isDarkMode ? '#ffffff' : '#000000',
          }}
        />
        {!!errors.name && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.name}</Text>}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>Description</Text>
        <TextInput
          value={formData.description}
          onChangeText={(text) => setFormData({ ...formData, description: text })}
          placeholder="Enter plan description"
          placeholderTextColor="#9ca3af"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          onFocus={() => setFocusedField('description')}
          onBlur={() => setFocusedField(null)}
          style={{
            width: '100%',
            minHeight: 80,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: borderFor('description'),
            color: isDarkMode ? '#ffffff' : '#000000',
          }}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
          Price<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
          <View style={{ justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderRightWidth: 0, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, backgroundColor: subtleBg, borderColor: subtleBorder }}>
            <Text style={{ fontWeight: '500', color: isDarkMode ? '#9ca3af' : '#4b5563' }}>₱</Text>
          </View>
          <TextInput
            value={String(formData.price)}
            onChangeText={(text) => setFormData({ ...formData, price: Number(text) || 0 })}
            keyboardType="numeric"
            onFocus={() => setFocusedField('price')}
            onBlur={() => setFocusedField(null)}
            style={{
              flex: 1,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderLeftWidth: 0,
              borderRightWidth: 0,
              textAlign: 'center',
              borderColor: borderFor('price', !!errors.price),
              backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
              color: isDarkMode ? '#ffffff' : '#111827',
            }}
          />
          <View style={{ borderWidth: 1, borderTopRightRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden', backgroundColor: subtleBg, borderColor: subtleBorder }}>
            <TouchableOpacity onPress={incrementPrice} style={{ flex: 1, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: subtleBorder }}>
              <Plus size={12} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={decrementPrice} style={{ flex: 1, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' }}>
              <Minus size={12} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
            </TouchableOpacity>
          </View>
        </View>
        {!!errors.price && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.price}</Text>}
      </View>

      <View style={{ flexDirection: 'row', gap: 16, paddingTop: 8 }}>
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

export default AddPlanModal;

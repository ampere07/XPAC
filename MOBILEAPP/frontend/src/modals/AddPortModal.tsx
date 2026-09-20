import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import apiClient from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface Port {
  id: number;
  PORT_ID: string;
  Label: string;
  created_at?: string;
  updated_at?: string;
}

interface AddPortModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingPort?: Port | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AddPortModal: React.FC<AddPortModalProps> = ({ isOpen, onClose, onSave, editingPort }) => {
  const [formData, setFormData] = useState({ port_id: '', label: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalConfig>({ isOpen: false, type: 'loading', title: '', message: '' });

  useEffect(() => {
    if (isOpen && editingPort) {
      setFormData({ port_id: editingPort.PORT_ID, label: editingPort.Label });
    } else if (isOpen && !editingPort) {
      resetForm();
    }
  }, [isOpen, editingPort]);

  const resetForm = () => {
    setFormData({ port_id: '', label: '' });
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.port_id.trim()) newErrors.port_id = 'Port ID is required';
    if (!formData.label.trim()) newErrors.label = 'Label is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setModal({ isOpen: true, type: 'warning', title: 'Validation Error', message: 'Port ID and Label are required.' });
      return;
    }

    setLoading(true);
    try {
      const payload = { port_id: formData.port_id.trim(), label: formData.label.trim() };
      const response = editingPort
        ? await apiClient.put(`/ports/${editingPort.id}`, payload)
        : await apiClient.post('/ports', payload);
      const data = response.data;

      if (data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: data.message || `Port ${editingPort ? 'updated' : 'added'} successfully`,
          onConfirm: () => {
            onSave();
            handleClose();
            setModal((prev) => ({ ...prev, isOpen: false }));
          },
        });
      } else {
        setModal({ isOpen: true, type: 'error', title: 'Error', message: data.message || `Failed to ${editingPort ? 'update' : 'add'} port` });
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const data = error?.response?.data;
      if (data?.errors) {
        const errorMessages = Object.values(data.errors).flat().join('\n');
        setModal({ isOpen: true, type: 'error', title: 'Validation errors', message: errorMessages });
      } else {
        setModal({ isOpen: true, type: 'error', title: 'Error', message: data?.message || `Failed to ${editingPort ? 'update' : 'add'} port: ${error.message}` });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingPort ? 'Edit Port' : 'Add Port'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <AddPortContent formData={formData} setFormData={setFormData} errors={errors} />
    </ModalUITemplate>
  );
};

const PortField: React.FC<{ label: string; value: string; onChangeText: (t: string) => void; placeholder: string; error?: string }> = ({ label, value, onChangeText, placeholder, error }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);
  const borderColor = error ? '#ef4444' : isFocused ? (colorPalette?.primary || '#7c3aed') : (isDarkMode ? '#374151' : '#d1d5db');
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>
        {label}<Text style={{ color: '#ef4444' }}> *</Text>
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 6, borderColor, color: isDarkMode ? '#ffffff' : '#111827' }}
      />
      {!!error && <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>}
    </View>
  );
};

const AddPortContent: React.FC<{
  formData: { port_id: string; label: string };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
}> = ({ formData, setFormData, errors }) => {
  const { isDarkMode } = useModalTheme();
  return (
    <View style={{ gap: 24 }}>
      <PortField label="Port ID" value={formData.port_id} onChangeText={(t) => setFormData({ ...formData, port_id: t })} placeholder="Enter port ID" error={errors.port_id} />
      <PortField label="Label" value={formData.label} onChangeText={(t) => setFormData({ ...formData, label: t })} placeholder="Enter label" error={errors.label} />
      <View style={{ padding: 16, borderWidth: 1, borderRadius: 8, backgroundColor: isDarkMode ? 'rgba(30,58,138,0.2)' : '#eff6ff', borderColor: isDarkMode ? 'rgba(29,78,216,0.3)' : '#bfdbfe' }}>
        <Text style={{ fontSize: 13, color: isDarkMode ? '#93c5fd' : '#1d4ed8' }}>
          <Text style={{ fontWeight: '700' }}>Note: </Text>
          Created and updated date information will be set automatically when the port is created or updated.
        </Text>
      </View>
    </View>
  );
};

export default AddPortModal;

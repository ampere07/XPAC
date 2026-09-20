import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Technician } from '../types/api';
import { technicianService } from '../services/technicianService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface TechnicianModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tech: Technician) => void;
  technician?: Technician | null;
}

const TechnicianForm: React.FC<{
  formData: any;
  handleInputChange: (name: string, value: string) => void;
  errors: Record<string, string>;
}> = ({ formData, handleInputChange, errors }) => {
  const { isDarkMode } = useModalTheme();

  const inputStyle = (error?: string) => ({
    width: '100%' as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
    color: isDarkMode ? '#ffffff' : '#111827',
    borderColor: error ? '#ef4444' : isDarkMode ? '#374151' : '#e5e7eb',
  });

  const labelStyle = {
    fontSize: 14,
    fontWeight: '500' as const,
    marginBottom: 6,
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  };

  const placeholderColor = isDarkMode ? '#6b7280' : '#9ca3af';

  return (
    <View style={{ gap: 16 }}>
      {errors.general ? (
        <View
          style={{
            padding: 16,
            borderWidth: 1,
            borderRadius: 12,
            backgroundColor: isDarkMode ? 'rgba(127,29,29,0.2)' : '#fef2f2',
            borderColor: isDarkMode ? 'rgba(153,27,27,0.3)' : '#fecaca',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#f87171' : '#dc2626' }}>
            {errors.general}
          </Text>
        </View>
      ) : null}

      <View>
        <Text style={labelStyle}>First Name</Text>
        <TextInput
          value={formData.first_name}
          onChangeText={(v) => handleInputChange('first_name', v)}
          style={inputStyle(errors.first_name)}
          placeholder="First Name"
          placeholderTextColor={placeholderColor}
        />
        {errors.first_name ? (
          <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6, fontWeight: '500', marginLeft: 4 }}>
            {errors.first_name}
          </Text>
        ) : null}
      </View>

      <View>
        <Text style={labelStyle}>Middle Initial</Text>
        <TextInput
          value={formData.middle_initial}
          onChangeText={(v) => handleInputChange('middle_initial', v)}
          maxLength={1}
          style={inputStyle()}
          placeholder="M"
          placeholderTextColor={placeholderColor}
        />
      </View>

      <View>
        <Text style={labelStyle}>Last Name</Text>
        <TextInput
          value={formData.last_name}
          onChangeText={(v) => handleInputChange('last_name', v)}
          style={inputStyle(errors.last_name)}
          placeholder="Last Name"
          placeholderTextColor={placeholderColor}
        />
        {errors.last_name ? (
          <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6, fontWeight: '500', marginLeft: 4 }}>
            {errors.last_name}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const TechnicianModal: React.FC<TechnicianModalProps> = ({ isOpen, onClose, onSave, technician }) => {
  const isEditMode = !!technician;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    first_name: '',
    middle_initial: '',
    last_name: '',
  });

  useEffect(() => {
    if (isOpen) {
      if (technician) {
        setFormData({
          first_name: technician.first_name || '',
          middle_initial: technician.middle_initial || '',
          last_name: technician.last_name || '',
        });
      } else {
        setFormData({
          first_name: '',
          middle_initial: '',
          last_name: '',
        });
      }
      setErrors({});
    }
  }, [isOpen, technician]);

  const handleInputChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.first_name.trim()) newErrors.first_name = 'Required';
    if (!formData.last_name.trim()) newErrors.last_name = 'Required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getUserEmail = async () => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        const user = JSON.parse(authData);
        return user.email || user.email_address || 'system';
      }
    } catch (e) {
      console.error('Error getting user email:', e);
    }
    return 'system';
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const userEmail = await getUserEmail();
      const payload = {
        ...formData,
        updated_by: userEmail,
      };

      let response: any;
      if (isEditMode && technician) {
        response = await technicianService.updateTechnician(technician.id, payload);
      } else {
        response = await technicianService.createTechnician(payload);
      }

      if (response.success && response.data) {
        onSave(response.data);
        onClose();
      } else {
        setErrors({ general: response.message || 'Action failed' });
      }
    } catch (err: any) {
      setErrors({ general: err.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit' : 'Save'}
      loading={loading}
      maxWidth="max-w-md"
      primaryAction={{
        label: isEditMode ? 'Update' : 'Save',
        onClick: handleSave,
        disabled: loading,
      }}
    >
      <TechnicianForm formData={formData} handleInputChange={handleInputChange} errors={errors} />
    </ModalUITemplate>
  );
};

export default TechnicianModal;

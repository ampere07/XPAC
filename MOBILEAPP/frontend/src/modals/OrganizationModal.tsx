import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Organization } from '../types/api';
import { organizationService } from '../services/userService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface OrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (org: Organization) => void;
  organization?: Organization | null;
}

const OrganizationForm: React.FC<{
  formData: any;
  handleInputChange: (name: string, value: string) => void;
  errors: Record<string, string>;
}> = ({ formData, handleInputChange, errors }) => {
  const { isDarkMode } = useModalTheme();

  const labelColor = isDarkMode ? '#9ca3af' : '#6b7280';
  const textColor = isDarkMode ? '#ffffff' : '#111827';
  const bgColor = isDarkMode ? '#1f2937' : '#ffffff';

  const inputStyle = (error?: string) => ({
    width: '100%' as const,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: error ? '#ef4444' : (isDarkMode ? '#374151' : '#e5e7eb'),
    backgroundColor: bgColor,
    color: textColor,
    fontSize: 14,
  });

  const labelStyle = {
    fontSize: 14,
    fontWeight: '500' as const,
    marginBottom: 6,
    color: labelColor,
  };

  return (
    <View style={{ gap: 20 }}>
      {errors.general && (
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
      )}

      <View style={{ gap: 16 }}>
        <View>
          <Text style={labelStyle}>Organization Name</Text>
          <TextInput
            value={formData.organization_name}
            onChangeText={(v) => handleInputChange('organization_name', v)}
            style={inputStyle(errors.organization_name)}
            placeholder="Organization Name"
            placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
          />
          {errors.organization_name && (
            <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6, marginLeft: 4, fontWeight: '500' }}>
              {errors.organization_name}
            </Text>
          )}
        </View>

        <View>
          <Text style={labelStyle}>Address</Text>
          <TextInput
            value={formData.address}
            onChangeText={(v) => handleInputChange('address', v)}
            style={inputStyle()}
            placeholder="Address"
            placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
          />
        </View>

        <View>
          <Text style={labelStyle}>Contact Number</Text>
          <TextInput
            value={formData.contact_number}
            onChangeText={(v) => handleInputChange('contact_number', v)}
            style={inputStyle()}
            placeholder="Contact Number"
            placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
            keyboardType="phone-pad"
          />
        </View>

        <View>
          <Text style={labelStyle}>Email Address</Text>
          <TextInput
            value={formData.email_address}
            onChangeText={(v) => handleInputChange('email_address', v)}
            style={inputStyle(errors.email_address)}
            placeholder="Email Address"
            placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
      </View>
    </View>
  );
};

const OrganizationModal: React.FC<OrganizationModalProps> = ({ isOpen, onClose, onSave, organization }) => {
  const isEditMode = !!organization;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    organization_name: '',
    address: '',
    contact_number: '',
    email_address: '',
  });

  useEffect(() => {
    if (isOpen) {
      if (organization) {
        setFormData({
          organization_name: organization.organization_name || '',
          address: organization.address || '',
          contact_number: organization.contact_number || '',
          email_address: organization.email_address || '',
        });
      } else {
        setFormData({
          organization_name: '',
          address: '',
          contact_number: '',
          email_address: '',
        });
      }
      setErrors({});
    }
  }, [isOpen, organization]);

  const handleInputChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.organization_name.trim()) newErrors.organization_name = 'Required';

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
    setErrors({});

    try {
      const userEmail = await getUserEmail();
      const payload: any = {
        organization_name: formData.organization_name,
        address: formData.address || null,
        contact_number: formData.contact_number || null,
        email_address: formData.email_address || null,
      };

      if (isEditMode) {
        payload.updated_by_user_id = userEmail;
      } else {
        payload.created_by_user_id = userEmail;
      }

      let response: any;
      if (isEditMode && organization) {
        response = await organizationService.updateOrganization(organization.id, payload);
      } else {
        response = await organizationService.createOrganization(payload);
      }

      if (response.success && response.data) {
        onSave(response.data);
        onClose();
      } else {
        const errorMsg = response.message || response.error || 'Action failed';
        setErrors({ general: errorMsg });
      }
    } catch (err: any) {
      const detailedError = err.response?.data?.message || err.response?.data?.error || err.message;
      setErrors({ general: detailedError || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Organization' : 'Save Organization'}
      loading={loading}
      maxWidth="max-w-md"
      primaryAction={{
        label: isEditMode ? 'Update' : 'Save',
        onClick: handleSave,
        disabled: loading,
      }}
    >
      <OrganizationForm
        formData={formData}
        handleInputChange={handleInputChange}
        errors={errors}
      />
    </ModalUITemplate>
  );
};

export default OrganizationModal;

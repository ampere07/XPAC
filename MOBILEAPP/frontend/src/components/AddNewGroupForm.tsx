import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { ArrowLeft } from 'lucide-react-native';
import { Group, Organization } from '../types/api';
import { groupService, organizationService } from '../services/userService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface AddNewGroupFormProps {
  onCancel: () => void;
  onGroupCreated: (group: Group) => void;
  colorPalette?: ColorPalette | null;
}

const AddNewGroupForm: React.FC<AddNewGroupFormProps> = ({ onCancel, onGroupCreated, colorPalette: paletteProp }) => {
  // App is forced light mode.
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(paletteProp || null);

  const [formData, setFormData] = useState({
    group_name: '',
    fb_page_link: '',
    fb_messenger_link: '',
    template: '',
    company_name: '',
    portal_url: '',
    hotline: '',
    email: '',
    org_id: undefined as number | undefined,
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    if (!paletteProp) {
      const fetchColorPalette = async () => {
        try {
          setColorPalette(await settingsColorPaletteService.getActive());
        } catch (err) {
          console.error('Failed to fetch color palette:', err);
        }
      };
      fetchColorPalette();
    }
  }, [paletteProp]);

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      const response = await organizationService.getAllOrganizations();
      if (response.success && response.data) {
        setOrganizations(response.data);
      }
    } catch (error) {
      console.error('Failed to load organizations:', error);
    }
  };

  const setField = (name: string, value: string) => {
    if (name === 'org_id') {
      const numericValue = value && value !== '' ? parseInt(value, 10) : undefined;
      setFormData((prev) => ({ ...prev, [name]: numericValue }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.group_name?.trim()) {
      newErrors.group_name = 'Affiliate name is required';
    }
    if (formData.email && formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateGroup = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const dataToSend = {
        group_name: formData.group_name.trim(),
        fb_page_link: formData.fb_page_link.trim() || null,
        fb_messenger_link: formData.fb_messenger_link.trim() || null,
        template: formData.template.trim() || null,
        company_name: formData.company_name.trim() || null,
        portal_url: formData.portal_url.trim() || null,
        hotline: formData.hotline.trim() || null,
        email: formData.email.trim() || null,
        org_id: formData.org_id && formData.org_id > 0 ? formData.org_id : null,
      };

      const response = await groupService.createGroup(dataToSend);

      if (response.success && response.data) {
        onGroupCreated(response.data);
        onCancel();
      } else {
        setErrors({ general: response.message || 'Failed to create Affiliate' });
      }
    } catch (error: any) {
      console.error('Create Affiliate error:', error);
      if (error.response?.status === 422 && error.response?.data?.errors) {
        const backendErrors: Record<string, string> = {};
        const errorData = error.response.data.errors;
        Object.keys(errorData).forEach((key) => {
          backendErrors[key] = Array.isArray(errorData[key]) ? errorData[key][0] : errorData[key];
        });
        setErrors(backendErrors);
      } else {
        setErrors({
          general: error.response?.data?.message || error.message || 'Failed to create Affiliate',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = (fieldName?: string): object => ({
    borderWidth: 1,
    borderColor: fieldName && errors[fieldName] ? '#ef4444' : '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#ffffff',
    marginBottom: 4,
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <TouchableOpacity onPress={onCancel} style={{ padding: 6 }}>
          <ArrowLeft size={22} color="#374151" />
        </TouchableOpacity>
        <View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827' }}>Add New Affiliate</Text>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>Create a new Affiliate in the system</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* General error */}
        {!!errors.general && (
          <View style={{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 12 }}>
            <Text style={{ fontSize: 13, color: '#b91c1c' }}>{errors.general}</Text>
          </View>
        )}

        {/* Affiliate Name */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
            Affiliate Name <Text style={{ color: '#ef4444' }}>*</Text>
          </Text>
          <TextInput
            value={formData.group_name}
            onChangeText={(v) => setField('group_name', v)}
            placeholder="Enter Affiliate name"
            placeholderTextColor="#9ca3af"
            style={inputStyle('group_name')}
          />
          {!!errors.group_name && (
            <Text style={{ fontSize: 11, color: '#ef4444' }}>{errors.group_name}</Text>
          )}
        </View>

        {/* Organization */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
            Organization (Optional)
          </Text>
          <View
            style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 8,
              overflow: 'hidden',
              backgroundColor: '#ffffff',
              height: 44,
              justifyContent: 'center',
            }}
          >
            <Picker
              selectedValue={formData.org_id ?? ''}
              onValueChange={(v) => setField('org_id', String(v))}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              <Picker.Item label="No Organization" value="" />
              {organizations.map((org) => (
                <Picker.Item key={org.id} label={org.organization_name} value={org.id} />
              ))}
            </Picker>
          </View>
        </View>

        {/* Company Name */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Company Name</Text>
          <TextInput
            value={formData.company_name}
            onChangeText={(v) => setField('company_name', v)}
            placeholder="Enter company name"
            placeholderTextColor="#9ca3af"
            style={inputStyle('company_name')}
          />
        </View>

        {/* Email */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Email</Text>
          <TextInput
            value={formData.email}
            onChangeText={(v) => setField('email', v)}
            placeholder="Enter email address"
            placeholderTextColor="#9ca3af"
            keyboardType="email-address"
            autoCapitalize="none"
            style={inputStyle('email')}
          />
          {!!errors.email && (
            <Text style={{ fontSize: 11, color: '#ef4444' }}>{errors.email}</Text>
          )}
        </View>

        {/* Hotline */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Hotline</Text>
          <TextInput
            value={formData.hotline}
            onChangeText={(v) => setField('hotline', v)}
            placeholder="Enter hotline number"
            placeholderTextColor="#9ca3af"
            keyboardType="phone-pad"
            style={inputStyle('hotline')}
          />
        </View>

        {/* Portal URL */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Portal URL</Text>
          <TextInput
            value={formData.portal_url}
            onChangeText={(v) => setField('portal_url', v)}
            placeholder="Enter portal URL"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            style={inputStyle('portal_url')}
          />
        </View>

        {/* Facebook Page Link */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Facebook Page Link</Text>
          <TextInput
            value={formData.fb_page_link}
            onChangeText={(v) => setField('fb_page_link', v)}
            placeholder="Enter Facebook page link"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            style={inputStyle('fb_page_link')}
          />
        </View>

        {/* Facebook Messenger Link */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Facebook Messenger Link</Text>
          <TextInput
            value={formData.fb_messenger_link}
            onChangeText={(v) => setField('fb_messenger_link', v)}
            placeholder="Enter Facebook Messenger link"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            style={inputStyle('fb_messenger_link')}
          />
        </View>

        {/* Template */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Template</Text>
          <TextInput
            value={formData.template}
            onChangeText={(v) => setField('template', v)}
            placeholder="Enter template content"
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={{ ...inputStyle('template'), minHeight: 90 } as object}
          />
        </View>

        {/* Action Buttons */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 }}>
          <TouchableOpacity
            onPress={onCancel}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#d1d5db',
              alignItems: 'center',
              opacity: loading ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCreateGroup}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: loading ? '#9ca3af' : primaryColor,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading && <ActivityIndicator size="small" color="#ffffff" />}
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>
              {loading ? 'Creating...' : 'Create Affiliate'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

export default AddNewGroupForm;

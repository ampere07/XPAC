import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { X } from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import { userService } from '../services/userService';
import { referredByEcho } from '../utils/referredByField';

interface AddApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingApplication?: ApplicationData | null;
}

interface ApplicationData {
  id?: string;
  first_name: string;
  middle_initial?: string;
  last_name: string;
  email_address: string;
  mobile_number: string;
  secondary_mobile_number?: string;
  installation_address: string;
  landmark?: string;
  region?: string;
  city?: string;
  barangay?: string;
  location?: string;
  desired_plan: string;
  promo?: string;
  referred_by?: string;
  status: string;
  terms_and_conditions: boolean;
  government_valid_id?: string;
}

const emptyForm: ApplicationData = {
  first_name: '',
  middle_initial: '',
  last_name: '',
  email_address: '',
  mobile_number: '',
  secondary_mobile_number: '',
  installation_address: '',
  landmark: '',
  region: '',
  city: '',
  barangay: '',
  location: '',
  desired_plan: '',
  promo: '',
  referred_by: '',
  status: 'pending',
  terms_and_conditions: false,
  government_valid_id: '',
};

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'schedule', label: 'Scheduled' },
  { value: 'no facility', label: 'No Facility' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no slot', label: 'No Slot' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'in progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

const AddApplicationModal: React.FC<AddApplicationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingApplication,
}) => {
  const isDarkMode = false;
  const [formData, setFormData] = useState<ApplicationData>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  // The agent roster, so a name typed into the box below can be stored as that
  // agent's id rather than as the text. Free text that matches nobody — a team
  // name, "Walk in" — is stored exactly as typed, which is most of this column.
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const fetchAgents = async () => {
      try {
        const response = await userService.getUsersByRole('agent');
        if (cancelled) return;
        if (response.success && response.data) {
          setAgents(response.data);
          return;
        }
        const byId = await userService.getUsersByRoleId(4);
        if (!cancelled && byId.success && byId.data) setAgents(byId.data);
      } catch {
        // A roster that will not load only costs the name-to-id upgrade; the
        // typed text is still stored, which is what happened before it existed.
        if (!cancelled) setAgents([]);
      }
    };

    fetchAgents();
    return () => { cancelled = true; };
  }, [isOpen]);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  useEffect(() => {
    if (isOpen && editingApplication) {
      setFormData({
        first_name: editingApplication.first_name || '',
        middle_initial: editingApplication.middle_initial || '',
        last_name: editingApplication.last_name || '',
        email_address: editingApplication.email_address || '',
        mobile_number: editingApplication.mobile_number || '',
        secondary_mobile_number: editingApplication.secondary_mobile_number || '',
        installation_address: editingApplication.installation_address || '',
        landmark: editingApplication.landmark || '',
        region: editingApplication.region || '',
        city: editingApplication.city || '',
        barangay: editingApplication.barangay || '',
        location: editingApplication.location || '',
        desired_plan: editingApplication.desired_plan || '',
        promo: editingApplication.promo || '',
        referred_by: editingApplication.referred_by || '',
        status: editingApplication.status || 'pending',
        terms_and_conditions: editingApplication.terms_and_conditions || false,
        government_valid_id: editingApplication.government_valid_id || '',
      });
    } else if (isOpen && !editingApplication) {
      setFormData(emptyForm);
      setErrors({});
    }
  }, [isOpen, editingApplication]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.first_name.trim()) newErrors.first_name = 'First name is required';
    if (!formData.last_name.trim()) newErrors.last_name = 'Last name is required';
    if (!formData.email_address.trim()) {
      newErrors.email_address = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_address)) {
      newErrors.email_address = 'Invalid email address format';
    }
    if (!formData.mobile_number.trim()) {
      newErrors.mobile_number = 'Mobile number is required';
    } else if (!/^[0-9]{10,11}$/.test(formData.mobile_number)) {
      newErrors.mobile_number = 'Mobile number must be 10-11 digits';
    }
    if (formData.secondary_mobile_number && !/^[0-9]{10,11}$/.test(formData.secondary_mobile_number)) {
      newErrors.secondary_mobile_number = 'Secondary mobile number must be 10-11 digits';
    }
    if (!formData.installation_address.trim()) newErrors.installation_address = 'Installation address is required';
    if (!formData.desired_plan.trim()) newErrors.desired_plan = 'Desired plan is required';
    if (!formData.terms_and_conditions) newErrors.terms_and_conditions = 'You must agree to the terms and conditions';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setLoading(true);
    try {
      const authRaw = await AsyncStorage.getItem('authData');
      const currentUser = authRaw ? JSON.parse(authRaw) : null;

      const payload: any = {
        first_name: formData.first_name.trim(),
        middle_initial: formData.middle_initial?.trim() || '',
        last_name: formData.last_name.trim(),
        email_address: formData.email_address.trim(),
        mobile_number: formData.mobile_number.trim(),
        secondary_mobile_number: formData.secondary_mobile_number?.trim() || '',
        installation_address: formData.installation_address.trim(),
        landmark: formData.landmark?.trim() || '',
        region: formData.region?.trim() || '',
        city: formData.city?.trim() || '',
        barangay: formData.barangay?.trim() || '',
        location: formData.location?.trim() || '',
        desired_plan: formData.desired_plan.trim(),
        promo: formData.promo?.trim() || '',
        // Untouched, this writes back the id the record was loaded with; typed
        // over, a name belonging to one agent becomes their id and anything
        // else is stored as it reads.
        referred_by: referredByEcho(editingApplication, formData.referred_by || '', agents) || '',
        status: formData.status,
        terms_and_conditions: formData.terms_and_conditions,
        government_valid_id: formData.government_valid_id?.trim() || '',
      };
      if (currentUser?.organization_id) {
        payload.organization_id = currentUser.organization_id;
      }

      let response: any;
      if (editingApplication?.id) {
        response = await apiClient.put(`/applications/${editingApplication.id}`, payload);
      } else {
        response = await apiClient.post('/applications', payload);
      }

      const data = (response as any).data;
      if (data?.success) {
        Alert.alert('Success', data.message || `Application ${editingApplication ? 'updated' : 'created'} successfully`);
        onSave();
        handleClose();
      } else {
        if (data?.errors) {
          const msgs = Object.values(data.errors).flat().join('\n');
          Alert.alert('Validation Error', msgs);
        } else {
          Alert.alert('Error', data?.message || `Failed to ${editingApplication ? 'update' : 'create'} application`);
        }
      }
    } catch (error: any) {
      Alert.alert('Error', `Failed to ${editingApplication ? 'update' : 'create'} application: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData(emptyForm);
    setErrors({});
    onClose();
  };

  const field = (
    label: string,
    key: keyof ApplicationData,
    opts: {
      required?: boolean;
      placeholder?: string;
      keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
      maxLength?: number;
      multiline?: boolean;
    } = {}
  ) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
        {label}
        {opts.required && <Text style={{ color: '#ef4444' }}> *</Text>}
      </Text>
      <TextInput
        value={String(formData[key] || '')}
        onChangeText={(v) => setFormData((prev) => ({ ...prev, [key]: v }))}
        placeholder={opts.placeholder || ''}
        placeholderTextColor="#9ca3af"
        keyboardType={opts.keyboardType || 'default'}
        maxLength={opts.maxLength}
        multiline={opts.multiline}
        numberOfLines={opts.multiline ? 3 : 1}
        style={{
          borderWidth: 1,
          borderColor: errors[key as string] ? '#ef4444' : '#d1d5db',
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: opts.multiline ? 10 : 8,
          fontSize: 14,
          color: '#111827',
          backgroundColor: '#fff',
          textAlignVertical: opts.multiline ? 'top' : 'center',
          minHeight: opts.multiline ? 72 : undefined,
        }}
      />
      {errors[key as string] && (
        <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors[key as string]}</Text>
      )}
    </View>
  );

  return (
    <Modal visible={isOpen} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: '#fff',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '95%',
            flex: 1,
            marginTop: 60,
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f9fafb',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>
              {editingApplication ? 'Edit Application' : 'New Application'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={loading}
                style={{
                  backgroundColor: primary,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 8,
                  opacity: loading ? 0.5 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {loading && <ActivityIndicator size="small" color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                  {loading ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose}>
                <X size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ flex: 1, paddingHorizontal: 20, paddingTop: 20 }}>
            {/* Status */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
                Status <Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: '#fff',
                }}
              >
                <Picker
                  selectedValue={formData.status}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, status: v }))}
                  style={{ color: '#111827' }}
                >
                  {statusOptions.map((opt) => (
                    <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                  ))}
                </Picker>
              </View>
            </View>

            {/* Name row: First + M.I. */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
                  First Name <Text style={{ color: '#ef4444' }}>*</Text>
                </Text>
                <TextInput
                  value={formData.first_name}
                  onChangeText={(v) => setFormData((p) => ({ ...p, first_name: v }))}
                  placeholder="First name"
                  placeholderTextColor="#9ca3af"
                  style={{
                    borderWidth: 1,
                    borderColor: errors.first_name ? '#ef4444' : '#d1d5db',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 14,
                    color: '#111827',
                    backgroundColor: '#fff',
                  }}
                />
                {errors.first_name && (
                  <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{errors.first_name}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>M.I.</Text>
                <TextInput
                  value={formData.middle_initial || ''}
                  onChangeText={(v) => setFormData((p) => ({ ...p, middle_initial: v }))}
                  placeholder="M.I."
                  placeholderTextColor="#9ca3af"
                  maxLength={2}
                  style={{
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 14,
                    color: '#111827',
                    backgroundColor: '#fff',
                  }}
                />
              </View>
            </View>

            {field('Last Name', 'last_name', { required: true, placeholder: 'Enter last name' })}
            {field('Email Address', 'email_address', { required: true, placeholder: 'example@email.com', keyboardType: 'email-address' })}
            {field('Mobile Number', 'mobile_number', { required: true, placeholder: '09123456789', keyboardType: 'phone-pad', maxLength: 11 })}
            {field('Second Mobile Number', 'secondary_mobile_number', { placeholder: '09123456789', keyboardType: 'phone-pad', maxLength: 11 })}
            {field('Installation Address', 'installation_address', { required: true, placeholder: 'Enter full installation address', multiline: true })}
            {field('Landmark', 'landmark', { placeholder: 'Nearby landmark' })}

            {/* Region + City */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                {field('Region', 'region', { placeholder: 'Region' })}
              </View>
              <View style={{ flex: 1 }}>
                {field('City', 'city', { placeholder: 'City' })}
              </View>
            </View>

            {/* Barangay + Location */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                {field('Barangay', 'barangay', { placeholder: 'Barangay' })}
              </View>
              <View style={{ flex: 1 }}>
                {field('Location', 'location', { placeholder: 'Specific location' })}
              </View>
            </View>

            {field('Desired Plan', 'desired_plan', { required: true, placeholder: 'e.g., FLASH, TURBO, etc.' })}
            {field('Promo', 'promo', { placeholder: 'Promo code (if any)' })}
            {field('Referred By', 'referred_by', { placeholder: 'Name of referrer (if any)' })}
            {field('Government Valid ID', 'government_valid_id', { placeholder: 'Google Drive link or ID number' })}
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: -10, marginBottom: 16 }}>
              Upload to Google Drive and paste the link here
            </Text>

            {/* Terms and Conditions */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginBottom: 20,
                gap: 12,
              }}
            >
              <Switch
                value={formData.terms_and_conditions}
                onValueChange={(v) => setFormData((p) => ({ ...p, terms_and_conditions: v }))}
                trackColor={{ false: '#d1d5db', true: primary }}
                thumbColor="#fff"
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: '#374151', fontWeight: '500' }}>
                  I agree to the Terms and Conditions
                  <Text style={{ color: '#ef4444' }}> *</Text>
                </Text>
                <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  By checking this box, you confirm that you have read and agree to our terms and conditions.
                </Text>
                {errors.terms_and_conditions && (
                  <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>
                    {errors.terms_and_conditions}
                  </Text>
                )}
              </View>
            </View>

            {/* Note */}
            <View
              style={{
                padding: 14,
                borderRadius: 8,
                backgroundColor: '#eff6ff',
                borderWidth: 1,
                borderColor: '#bfdbfe',
                marginBottom: 32,
              }}
            >
              <Text style={{ fontSize: 13, color: '#1d4ed8' }}>
                <Text style={{ fontWeight: '700' }}>Note: </Text>
                Timestamp will be automatically recorded when the application is created.
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default AddApplicationModal;

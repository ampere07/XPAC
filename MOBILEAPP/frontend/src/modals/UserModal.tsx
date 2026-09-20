import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { X, Eye, EyeOff } from 'lucide-react-native';
import { User, CreateUserRequest, UpdateUserRequest, Role, Organization, Agent } from '../types/api';
import { userService, roleService, organizationService } from '../services/userService';
import { agentService } from '../services/agentService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  user?: User | null;
  agentOnly?: boolean;
}

const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, user, agentOnly = false }) => {
  // FORCED LIGHT MODE
  const isDarkMode = false;
  const isEditMode = !!user;

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingModal, setLoadingModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error';
    title: string;
    message: string;
  }>({ isOpen: false, type: 'loading', title: '', message: '' });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const [formData, setFormData] = useState<CreateUserRequest>({
    first_name: '',
    middle_initial: '',
    last_name: '',
    username: '',
    email_address: '',
    contact_number: '',
    password: '',
    role_id: undefined,
    agent_id: undefined,
    organization_id: undefined,
  });

  useEffect(() => {
    const init = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch {
        /* ignore */
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const loadData = async () => {
      try {
        const [rolesRes, agentsRes, organizationsRes] = await Promise.all([
          roleService.getAllRoles(),
          agentService.getAllAgents(),
          organizationService.getAllOrganizations(),
        ]);
        if (rolesRes.success) setRoles(rolesRes.data || []);
        if (agentsRes.success) setAgents(agentsRes.data || []);
        if (organizationsRes.success) setOrganizations(organizationsRes.data || []);
      } catch (err) {
        console.error('Failed to load modal data:', err);
      }
    };
    loadData();
  }, [isOpen]);

  // Auto-set role_id to Agent when agentOnly
  useEffect(() => {
    if (isOpen && agentOnly && roles.length > 0) {
      const agentRole = roles.find((r) => r.role_name.toLowerCase() === 'agent');
      if (agentRole) {
        setFormData((prev) => ({ ...prev, role_id: agentRole.id }));
      }
    }
  }, [isOpen, agentOnly, roles]);

  // Populate form when user prop changes
  useEffect(() => {
    if (!isOpen) return;
    if (user) {
      setFormData({
        first_name: user.first_name || '',
        middle_initial: user.middle_initial || '',
        last_name: user.last_name || '',
        username: user.username || '',
        email_address: user.email_address || '',
        contact_number: (user as any).contact_number || '',
        password: '',
        role_id: user.role_id ?? undefined,
        agent_id: (user as any).agent_id ?? undefined,
        organization_id: (user as any).organization_id ?? undefined,
      });
    } else {
      setFormData({
        first_name: '',
        middle_initial: '',
        last_name: '',
        username: '',
        email_address: '',
        contact_number: '',
        password: '',
        role_id: undefined,
        agent_id: undefined,
        organization_id: undefined,
      });
    }
    setConfirmPassword('');
    setErrors({});
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [isOpen, user]);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const setField = (name: keyof CreateUserRequest, value: string) => {
    if (name === 'role_id' || name === 'agent_id' || name === 'organization_id') {
      const val = value ? parseInt(value) : undefined;
      setFormData((prev) => ({ ...prev, [name]: val }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (name === 'password') {
      if (value && value.length < 8) {
        setErrors((prev) => ({ ...prev, password: 'Min 8 chars' }));
      } else {
        setErrors((prev) => ({ ...prev, password: '' }));
      }
    } else if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.first_name?.trim()) newErrors.first_name = 'Required';
    if (!formData.last_name?.trim()) newErrors.last_name = 'Required';
    if (!formData.username?.trim()) newErrors.username = 'Required';
    if (!formData.email_address?.trim()) newErrors.email_address = 'Required';
    if (!isEditMode) {
      if (!formData.password) newErrors.password = 'Required';
      else if (formData.password.length < 8) newErrors.password = 'Min 8 chars';
      if (formData.password !== confirmPassword) newErrors.confirmPassword = 'Mismatch';
    } else if (formData.password && formData.password.length < 8) {
      newErrors.password = 'Min 8 chars';
    }
    if (!formData.role_id) newErrors.role_id = 'Required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoadingModal({ isOpen: true, type: 'loading', title: isEditMode ? 'Updating User' : 'Creating User', message: 'Please wait while we process the request...' });
    setLoading(true);
    try {
      let response: any;
      if (isEditMode && user) {
        const updateData: UpdateUserRequest = {
          first_name: formData.first_name,
          middle_initial: formData.middle_initial,
          last_name: formData.last_name,
          username: formData.username,
          email_address: formData.email_address,
          contact_number: formData.contact_number,
          role_id: formData.role_id,
          agent_id: formData.agent_id,
          organization_id: formData.organization_id,
        };
        if (formData.password) updateData.password = formData.password;
        response = await userService.updateUser(user.id, updateData);
      } else {
        response = await userService.createUser({ ...formData, active: 1 } as any);
      }

      if (response.success && response.data) {
        setLoadingModal({ isOpen: true, type: 'success', title: 'Success!', message: isEditMode ? 'User profile has been updated successfully.' : 'New user has been created successfully.' });
        setTimeout(() => {
          onSave(response.data!);
          setFormData({ first_name: '', middle_initial: '', last_name: '', username: '', email_address: '', contact_number: '', password: '', role_id: undefined, agent_id: undefined, organization_id: undefined });
          setConfirmPassword('');
          setLoadingModal((prev) => ({ ...prev, isOpen: false }));
          onClose();
        }, 1500);
      } else {
        setLoadingModal({ isOpen: true, type: 'error', title: 'Action Failed', message: response.message || 'We could not complete the request.' });
      }
    } catch (err: any) {
      if (err.response && err.response.status === 422) {
        const backendErrors = err.response.data.errors;
        const newErrors: Record<string, string> = {};
        if (backendErrors) {
          Object.keys(backendErrors).forEach((key) => {
            const msg = backendErrors[key][0];
            if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
              newErrors[key] = 'already existed';
            } else {
              newErrors[key] = msg;
            }
          });
        }
        setErrors(newErrors);
        setLoadingModal((prev) => ({ ...prev, isOpen: false }));
      } else {
        setLoadingModal({ isOpen: true, type: 'error', title: 'System Error', message: err.message || 'An unexpected error occurred.' });
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedRoleIsAgent = roles.find((r) => r.id === formData.role_id)?.role_name.toLowerCase() === 'agent';

  const inputStyle = {
    height: 44,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#ffffff',
  };
  const errorInputStyle = { borderColor: '#ef4444' };
  const labelStyle = { fontSize: 14, fontWeight: '500' as const, color: '#374151', marginBottom: 6 };
  const errorStyle = { fontSize: 11, color: '#ef4444', marginTop: 3 };

  return (
    <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingVertical: 16,
            paddingTop: 56,
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
            {isEditMode ? 'Edit User' : 'Add New User'}
          </Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
            <X size={22} color="#6b7280" />
          </TouchableOpacity>
        </View>

        {/* Body */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
          {errors.general && (
            <View style={{ padding: 12, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8 }}>
              <Text style={{ fontSize: 14, color: '#ef4444' }}>{errors.general}</Text>
            </View>
          )}

          {/* First name + Last name */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>First Name*</Text>
              <TextInput
                style={[inputStyle, errors.first_name ? errorInputStyle : {}]}
                value={formData.first_name}
                onChangeText={(v) => setField('first_name', v)}
                placeholder="First name"
                placeholderTextColor="#9ca3af"
              />
              {errors.first_name && <Text style={errorStyle}>{errors.first_name}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Last Name*</Text>
              <TextInput
                style={[inputStyle, errors.last_name ? errorInputStyle : {}]}
                value={formData.last_name}
                onChangeText={(v) => setField('last_name', v)}
                placeholder="Last name"
                placeholderTextColor="#9ca3af"
              />
              {errors.last_name && <Text style={errorStyle}>{errors.last_name}</Text>}
            </View>
          </View>

          {/* Middle initial + Username */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Middle Initial</Text>
              <TextInput
                style={inputStyle}
                value={formData.middle_initial}
                onChangeText={(v) => setField('middle_initial', v)}
                placeholder="M (Optional)"
                placeholderTextColor="#9ca3af"
                maxLength={1}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Username*</Text>
              <TextInput
                style={[inputStyle, errors.username ? errorInputStyle : {}]}
                value={formData.username}
                onChangeText={(v) => setField('username', v)}
                placeholder="Username"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
              {errors.username && <Text style={errorStyle}>{errors.username}</Text>}
            </View>
          </View>

          {/* Email */}
          <View>
            <Text style={labelStyle}>Email Address*</Text>
            <TextInput
              style={[inputStyle, errors.email_address ? errorInputStyle : {}]}
              value={formData.email_address}
              onChangeText={(v) => setField('email_address', v)}
              placeholder="example@email.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {errors.email_address && <Text style={errorStyle}>{errors.email_address}</Text>}
          </View>

          {/* Contact + Organization */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Contact Number</Text>
              <TextInput
                style={inputStyle}
                value={formData.contact_number}
                onChangeText={(v) => setField('contact_number', v)}
                placeholder="Contact"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
              />
            </View>
            {!agentOnly && (
              <View style={{ flex: 1 }}>
                <Text style={labelStyle}>Organization</Text>
                <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff' }}>
                  <Picker
                    selectedValue={String(formData.organization_id || '')}
                    onValueChange={(v) => setField('organization_id', v)}
                    style={{ height: 44 }}
                  >
                    <Picker.Item label="Select Organization" value="" />
                    {organizations.map((org) => (
                      <Picker.Item key={org.id} label={org.organization_name} value={String(org.id)} />
                    ))}
                  </Picker>
                </View>
              </View>
            )}
          </View>

          {/* Role */}
          <View>
            <Text style={labelStyle}>Role*</Text>
            {agentOnly ? (
              <View style={[inputStyle, { justifyContent: 'center', backgroundColor: '#f9fafb' }]}>
                <Text style={{ fontSize: 14, color: '#6b7280' }}>Agent</Text>
              </View>
            ) : (
              <View style={{ borderWidth: 1, borderColor: errors.role_id ? '#ef4444' : '#d1d5db', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff' }}>
                <Picker
                  selectedValue={String(formData.role_id || '')}
                  onValueChange={(v) => setField('role_id', v)}
                  style={{ height: 44 }}
                >
                  <Picker.Item label="Select Role" value="" />
                  {roles.map((r) => (
                    <Picker.Item key={r.id} label={r.role_name} value={String(r.id)} />
                  ))}
                </Picker>
              </View>
            )}
            {errors.role_id && <Text style={errorStyle}>{errors.role_id}</Text>}
          </View>

          {/* Team (agents only) */}
          {selectedRoleIsAgent && (
            <View>
              <Text style={labelStyle}>Team</Text>
              <View style={{ borderWidth: 1, borderColor: errors.agent_id ? '#ef4444' : '#d1d5db', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff' }}>
                <Picker
                  selectedValue={String(formData.agent_id || '')}
                  onValueChange={(v) => setField('agent_id', v)}
                  style={{ height: 44 }}
                >
                  <Picker.Item label="Select Team" value="" />
                  {agents.map((a) => (
                    <Picker.Item key={a.id} label={(a as any).team_name || String(a.id)} value={String(a.id)} />
                  ))}
                </Picker>
              </View>
              {errors.agent_id && <Text style={errorStyle}>{errors.agent_id}</Text>}
            </View>
          )}

          {/* Password */}
          <View>
            <Text style={labelStyle}>{isEditMode ? 'New Password (Optional)' : 'Password*'}</Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                style={[inputStyle, errors.password ? errorInputStyle : {}, { paddingRight: 44 }]}
                value={formData.password}
                onChangeText={(v) => setField('password', v)}
                placeholder={isEditMode ? 'Leave blank to keep current' : 'At least 8 characters'}
                placeholderTextColor="#9ca3af"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: 12 }}
              >
                {showPassword ? <EyeOff size={18} color="#6b7280" /> : <Eye size={18} color="#6b7280" />}
              </TouchableOpacity>
            </View>
            {errors.password && <Text style={errorStyle}>{errors.password}</Text>}
          </View>

          {/* Confirm password (create mode only) */}
          {!isEditMode && (
            <View>
              <Text style={labelStyle}>Confirm Password*</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  style={[inputStyle, errors.confirmPassword ? errorInputStyle : {}, { paddingRight: 44 }]}
                  value={confirmPassword}
                  onChangeText={(v) => {
                    setConfirmPassword(v);
                    if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: '' }));
                  }}
                  placeholder="Repeat password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{ position: 'absolute', right: 12, top: 12 }}
                >
                  {showConfirmPassword ? <EyeOff size={18} color="#6b7280" /> : <Eye size={18} color="#6b7280" />}
                </TouchableOpacity>
              </View>
              {errors.confirmPassword && <Text style={errorStyle}>{errors.confirmPassword}</Text>}
            </View>
          )}

          {/* bottom padding */}
          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Footer */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingHorizontal: 20,
            paddingVertical: 16,
            borderTopWidth: 1,
            borderTopColor: '#e5e7eb',
            gap: 12,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            disabled={loading}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}
          >
            {loading && <ActivityIndicator size="small" color="#ffffff" />}
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>
              {isEditMode ? 'Update User' : 'Create User'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <LoadingModalGlobal
        isOpen={loadingModal.isOpen}
        type={loadingModal.type}
        title={loadingModal.title}
        message={loadingModal.message}
        isDarkMode={false}
        colorPalette={colorPalette}
        onConfirm={() => setLoadingModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </Modal>
  );
};

export default UserModal;

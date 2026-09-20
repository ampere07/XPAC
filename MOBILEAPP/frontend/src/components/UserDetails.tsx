import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import {
  X,
  Settings,
  Edit2,
  Trash2,
  Loader2,
  UserCheck,
  UserMinus,
  DollarSign,
} from 'lucide-react-native';
import { User as UserType } from '../types/api';
import { ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { useUserStore } from '../store/userStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoadingModalGlobal from './common/LoadingModalGlobal';

interface UserDetailsProps {
  user: UserType;
  onClose: () => void;
  onEdit?: (user: UserType) => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  // isMobile kept for API compat but ignored — always full-screen on RN
  isMobile?: boolean;
}

const FIELD_VISIBILITY_KEY = 'userDetailsFieldVisibility';

const defaultFields = [
  'fullName',
  'username',
  'email',
  'contactNumber',
  'role',
  'organization',
  'activeStatus',
  'memberSince',
];

const getFieldLabel = (fieldKey: string): string => {
  const labels: Record<string, string> = {
    fullName: 'Full Name',
    username: 'Username',
    email: 'Email Address',
    contactNumber: 'Contact Number',
    role: 'System Role',
    organization: 'Organization',
    activeStatus: 'Account Status',
    memberSince: 'Member Since',
    commissionRate: 'Commission Rate',
  };
  return labels[fieldKey] || fieldKey;
};

const UserDetails: React.FC<UserDetailsProps> = ({
  user,
  onClose,
  onEdit,
  isDarkMode,
  colorPalette,
}) => {
  // FORCED LIGHT MODE
  const primaryColor = colorPalette?.primary || '#7c3aed';
  const accentColor = colorPalette?.accent || '#f59e0b';

  const { users, removeUser, updateUser: updateStoreUser } = useUserStore();
  const displayUser = users.find((u) => u.id === user.id) || user;

  const isAgent =
    (displayUser as any).role_id === 4 ||
    displayUser.role?.id === 4 ||
    displayUser.role?.role_name?.toLowerCase() === 'agent';

  const allFields = isAgent ? [...defaultFields, 'commissionRate'] : defaultFields;

  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>({});
  const [showFieldSettings, setShowFieldSettings] = useState(false);

  const [loadingState, setLoadingState] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error';
    title: string;
    message: string;
    loadingPercentage?: number;
  }>({ isOpen: false, type: 'loading', title: '', message: '' });

  const [isEditingCommission, setIsEditingCommission] = useState(false);
  const [commissionInput, setCommissionInput] = useState('');
  const [commissionSaving, setCommissionSaving] = useState(false);

  // Load field visibility from AsyncStorage
  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(FIELD_VISIBILITY_KEY);
        const defaults = allFields.reduce(
          (acc: Record<string, boolean>, f) => ({ ...acc, [f]: true }),
          {}
        );
        if (raw) {
          setFieldVisibility({ ...defaults, ...JSON.parse(raw) });
        } else {
          setFieldVisibility(defaults);
        }
      } catch {
        const defaults = allFields.reduce(
          (acc: Record<string, boolean>, f) => ({ ...acc, [f]: true }),
          {}
        );
        setFieldVisibility(defaults);
      }
    };
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFieldVisibility = async (vis: Record<string, boolean>) => {
    setFieldVisibility(vis);
    try {
      await AsyncStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(vis));
    } catch {
      /* ignore */
    }
  };

  const toggleFieldVisibility = (field: string) => {
    saveFieldVisibility({ ...fieldVisibility, [field]: !fieldVisibility[field] });
  };

  const selectAllFields = () => {
    const all = allFields.reduce((acc: Record<string, boolean>, f) => ({ ...acc, [f]: true }), {});
    saveFieldVisibility(all);
  };

  const deselectAllFields = () => {
    const none = allFields.reduce((acc: Record<string, boolean>, f) => ({ ...acc, [f]: false }), {});
    saveFieldVisibility(none);
  };

  const getFullName = (u: UserType): string => {
    const parts = [u.first_name, u.middle_initial, u.last_name].filter(Boolean);
    return parts.join(' ');
  };

  const formatDate = (val?: string) => {
    if (!val) return 'N/A';
    const date = new Date(val);
    if (isNaN(date.getTime())) return val;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${date.getFullYear()}`;
  };

  const handleToggleActive = () => {
    const isDeactivating = (displayUser as any).active !== false;
    Alert.alert(
      isDeactivating ? 'Deactivate User' : 'Activate User',
      `Are you sure you want to ${isDeactivating ? 'deactivate' : 'activate'} user "${getFullName(displayUser)}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: performToggleActive },
      ]
    );
  };

  const performToggleActive = async () => {
    setLoadingState({ isOpen: true, type: 'loading', title: 'Updating Status', message: 'Please wait...' });
    try {
      const newActiveStatus = !(displayUser as any).active;
      const res = await userService.updateUser(displayUser.id, { active: newActiveStatus } as any);
      if (res.success && res.data) {
        updateStoreUser(res.data);
        setLoadingState({
          isOpen: true,
          type: 'success',
          title: 'Status Updated',
          message: `User "${getFullName(displayUser)}" has been ${newActiveStatus ? 'activated' : 'deactivated'}.`,
        });
      } else {
        setLoadingState({ isOpen: true, type: 'error', title: 'Update Failed', message: res.message || 'Failed to update user status' });
      }
    } catch (err: any) {
      setLoadingState({ isOpen: true, type: 'error', title: 'Error', message: err.message || 'Error updating user status' });
    }
  };

  const handleDeleteUser = () => {
    Alert.alert(
      'Delete User',
      `Are you sure you want to delete user "${getFullName(displayUser)}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDeleteUser },
      ]
    );
  };

  const performDeleteUser = async () => {
    setLoadingState({ isOpen: true, type: 'loading', title: 'Deleting User', message: 'Please wait...' });
    try {
      const res = await userService.deleteUser(user.id);
      if (res.success) {
        removeUser(user.id);
        setLoadingState({
          isOpen: true,
          type: 'success',
          title: 'Deleted Successfully',
          message: `User "${getFullName(user)}" has been deleted.`,
        });
        // onClose called after confirm in LoadingModalGlobal
      } else {
        setLoadingState({ isOpen: true, type: 'error', title: 'Delete Failed', message: res.message || 'Failed to delete user' });
      }
    } catch (err: any) {
      setLoadingState({ isOpen: true, type: 'error', title: 'Error', message: err.message || 'Error deleting user' });
    }
  };

  const handleSaveCommission = async () => {
    setCommissionSaving(true);
    try {
      const commissionVal = parseFloat(commissionInput);
      const res = await userService.updateUser(displayUser.id, {
        commission: isNaN(commissionVal) ? 0 : commissionVal,
      } as any);
      if (res.success && res.data) {
        updateStoreUser(res.data);
        setIsEditingCommission(false);
        setLoadingState({ isOpen: true, type: 'success', title: 'Success', message: 'Commission rate updated successfully.' });
      } else {
        setLoadingState({ isOpen: true, type: 'error', title: 'Error', message: res.message || 'Failed to update commission rate.' });
      }
    } catch (err: any) {
      setLoadingState({ isOpen: true, type: 'error', title: 'Error', message: err.message || 'Error updating commission rate.' });
    } finally {
      setCommissionSaving(false);
    }
  };

  const rowStyle = {
    flexDirection: 'row' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  };
  const labelStyle = { width: 140, fontSize: 14, color: '#6b7280' };
  const valueStyle = { flex: 1, fontSize: 14, color: '#111827' };

  const renderField = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    switch (fieldKey) {
      case 'fullName':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Full Name:</Text>
            <Text style={valueStyle}>{getFullName(displayUser) || 'N/A'}</Text>
          </View>
        );
      case 'username':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Username:</Text>
            <Text style={valueStyle}>{displayUser.username || 'N/A'}</Text>
          </View>
        );
      case 'email':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Email Address:</Text>
            <Text style={[valueStyle, { flexShrink: 1 }]}>{displayUser.email_address || 'N/A'}</Text>
          </View>
        );
      case 'contactNumber':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Contact Number:</Text>
            <Text style={valueStyle}>{(displayUser as any).contact_number || 'N/A'}</Text>
          </View>
        );
      case 'role':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>System Role:</Text>
            <Text style={valueStyle}>{displayUser.role?.role_name || 'N/A'}</Text>
          </View>
        );
      case 'organization':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Organization:</Text>
            <Text style={valueStyle}>{(displayUser as any).organization?.organization_name || 'N/A'}</Text>
          </View>
        );
      case 'activeStatus':
        const isActive = (displayUser as any).active !== false;
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Account Status:</Text>
            <View>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: isActive ? '#dcfce7' : '#fee2e2',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '500', color: isActive ? '#16a34a' : '#dc2626' }}>
                  {isActive ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>
          </View>
        );
      case 'memberSince':
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Member Since:</Text>
            <Text style={valueStyle}>{formatDate(displayUser.created_at)}</Text>
          </View>
        );
      case 'commissionRate':
        if (!isAgent) return null;
        const commission = (displayUser as any).agent_balance?.commission;
        return (
          <View key={fieldKey} style={rowStyle}>
            <Text style={labelStyle}>Commission Rate:</Text>
            <Text style={valueStyle}>
              {commission !== undefined && commission !== null
                ? `₱${Number(commission).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                : '₱0.00'}
            </Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingHorizontal: 12,
          paddingVertical: 10,
          paddingTop: 56,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }} numberOfLines={1}>
            {getFullName(displayUser)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {/* Toggle active */}
          <TouchableOpacity
            onPress={handleToggleActive}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: (displayUser as any).active !== false ? accentColor : '#10b981',
              gap: 4,
            }}
          >
            {(displayUser as any).active !== false ? (
              <UserMinus size={14} color="#ffffff" />
            ) : (
              <UserCheck size={14} color="#ffffff" />
            )}
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#ffffff' }}>
              {(displayUser as any).active !== false ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>

          {/* Commission rate (agents only) */}
          {isAgent && (
            <TouchableOpacity
              onPress={() => {
                const commission = (displayUser as any).agent_balance?.commission;
                setCommissionInput(commission !== undefined && commission !== null ? String(commission) : '');
                setIsEditingCommission(true);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: accentColor,
                gap: 4,
              }}
            >
              <DollarSign size={14} color="#ffffff" />
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#ffffff' }}>Commission</Text>
            </TouchableOpacity>
          )}

          {/* Edit */}
          {onEdit && (
            <TouchableOpacity
              onPress={() => onEdit(displayUser)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: primaryColor,
                gap: 4,
              }}
            >
              <Edit2 size={14} color="#ffffff" />
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#ffffff' }}>Edit</Text>
            </TouchableOpacity>
          )}

          {/* Delete */}
          <TouchableOpacity
            onPress={handleDeleteUser}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#fca5a5',
              gap: 4,
            }}
          >
            <Trash2 size={14} color="#dc2626" />
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#dc2626' }}>Delete</Text>
          </TouchableOpacity>

          {/* Field settings */}
          <TouchableOpacity
            onPress={() => setShowFieldSettings(true)}
            style={{ padding: 6 }}
          >
            <Settings size={16} color="#6b7280" />
          </TouchableOpacity>

          {/* Close */}
          <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
            <X size={18} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Field content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {allFields.map((fieldKey) => renderField(fieldKey))}
      </ScrollView>

      {/* Field settings modal */}
      <Modal visible={showFieldSettings} transparent animationType="slide" onRequestClose={() => setShowFieldSettings(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>Field Visibility</Text>
              <TouchableOpacity onPress={() => setShowFieldSettings(false)}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <TouchableOpacity onPress={selectAllFields}>
                <Text style={{ fontSize: 13, color: '#3b82f6' }}>Show All</Text>
              </TouchableOpacity>
              <Text style={{ color: '#d1d5db' }}>|</Text>
              <TouchableOpacity onPress={deselectAllFields}>
                <Text style={{ fontSize: 13, color: '#3b82f6' }}>Hide All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {allFields.map((fieldKey) => (
                <TouchableOpacity
                  key={fieldKey}
                  onPress={() => toggleFieldVisibility(fieldKey)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f3f4f6',
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      borderWidth: 2,
                      borderColor: fieldVisibility[fieldKey] ? primaryColor : '#d1d5db',
                      backgroundColor: fieldVisibility[fieldKey] ? primaryColor : '#ffffff',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {fieldVisibility[fieldKey] && (
                      <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>✓</Text>
                    )}
                  </View>
                  <Text style={{ fontSize: 14, color: '#374151' }}>{getFieldLabel(fieldKey)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Commission edit modal */}
      <Modal visible={isEditingCommission} transparent animationType="fade" onRequestClose={() => setIsEditingCommission(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 8 }}>Update Commission Rate</Text>
            <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              Set the default commission rate for agent {getFullName(displayUser)}.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, marginBottom: 20 }}>
              <Text style={{ fontSize: 14, color: '#6b7280', marginRight: 4 }}>₱</Text>
              <TextInput
                style={{ flex: 1, height: 44, fontSize: 14, color: '#111827' }}
                keyboardType="decimal-pad"
                value={commissionInput}
                onChangeText={setCommissionInput}
                placeholder="0.00"
                placeholderTextColor="#9ca3af"
                editable={!commissionSaving}
                autoFocus
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setIsEditingCommission(false)}
                disabled={commissionSaving}
                style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f3f4f6' }}
              >
                <Text style={{ fontSize: 14, color: '#374151' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveCommission}
                disabled={commissionSaving}
                style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                {commissionSaving && <ActivityIndicator size="small" color="#ffffff" />}
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Loading / success / error modal */}
      <LoadingModalGlobal
        isOpen={loadingState.isOpen}
        type={loadingState.type}
        title={loadingState.title}
        message={loadingState.message}
        isDarkMode={false}
        colorPalette={colorPalette}
        onConfirm={() => {
          // If user was deleted, also close the details view
          const wasDeleted = loadingState.title === 'Deleted Successfully';
          setLoadingState((prev) => ({ ...prev, isOpen: false }));
          if (wasDeleted) onClose();
        }}
      />
    </View>
  );
};

export default UserDetails;

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Plus,
  RefreshCw,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Shield,
  Trash2,
  Edit2,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Role } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import RoleModal from '../modals/RoleModal';
import { useRoleStore } from '../store/roleStore';
import { roleService } from '../services/userService';

const Roles: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const {
    roles,
    isLoading,
    error,
    fetchRoles,
    addRole,
    updateRoleInStore,
    removeRoleFromStore,
  } = useRoleStore();

  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  useEffect(() => {
    const init = async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
      try {
        const authData = await AsyncStorage.getItem('authData');
        const parsed = authData ? JSON.parse(authData) : {};
        setUserOrgId(parsed.organization_id ?? null);
      } catch (e) {
        // ignore auth parse errors
      }
    };
    init();
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchRoles().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchRoles]);

  const filteredRoles = useMemo(() => {
    return roles.filter((role) => {
      // Organization filter: Allow system roles (ID <= 8) OR roles belonging to the user's organization
      const roleOrgId = (role as any).organization_id;
      if (userOrgId && role.id > 8 && roleOrgId && roleOrgId !== userOrgId) {
        return false;
      }

      const name = (role.role_name || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();
      return name.includes(query);
    });
  }, [roles, searchQuery, userOrgId]);

  const totalPages = Math.ceil(filteredRoles.length / itemsPerPage);
  const paginatedRoles = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredRoles.slice(start, start + itemsPerPage);
  }, [filteredRoles, currentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchRoles();
    setRefreshing(false);
  };

  const handleSaveRole = (savedRole: Role) => {
    if (selectedRole) {
      updateRoleInStore(savedRole);
    } else {
      addRole(savedRole);
    }
  };

  const handleDeleteRole = (id: number) => {
    Alert.alert('Delete Role', 'Are you sure you want to delete this role?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await roleService.deleteRole(id);
            if (res.success) {
              removeRoleFromStore(id);
            } else {
              Alert.alert('Error', res.message || 'Failed to delete role');
            }
          } catch (err: any) {
            Alert.alert('Error', err.message || 'An error occurred');
          }
        },
      },
    ]);
  };

  const showingStart =
    filteredRoles.length === 0 ? 0 : Math.min((currentPage - 1) * itemsPerPage + 1, filteredRoles.length);
  const showingEnd = Math.min(currentPage * itemsPerPage, filteredRoles.length);

  const renderItem = ({ item: role }: { item: Role }) => {
    const isSystem = role.id <= 8;
    return (
      <View
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 10,
                backgroundColor: '#f3f4f6',
              }}
            >
              <Shield size={14} color="#6b7280" />
            </View>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', flexShrink: 1 }} numberOfLines={1}>
              {role.role_name}
            </Text>
            {isSystem && (
              <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#dbeafe' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#2563eb', textTransform: 'uppercase' }}>
                  System
                </Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {!isSystem ? (
              <>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedRole(role);
                    setShowModal(true);
                  }}
                  style={{ padding: 8, borderRadius: 6 }}
                >
                  <Edit2 size={18} color={primaryColor} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDeleteRole(role.id)} style={{ padding: 8, borderRadius: 6 }}>
                  <Trash2 size={18} color="#ef4444" />
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#f3f4f6' }}>
                <Text style={{ fontSize: 10, fontWeight: '500', color: '#9ca3af' }}>Locked</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ marginTop: 8, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Description:</Text>
            <Text style={{ fontSize: 12, color: '#374151', flex: 1, textAlign: 'right' }} numberOfLines={1}>
              {role.description || 'No description provided'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Last Updated:</Text>
            <Text style={{ fontSize: 12, color: '#374151' }}>
              {role.updated_at ? new Date(role.updated_at).toLocaleDateString() : 'N/A'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Role Management</Text>
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Manage user roles and permissions</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => fetchRoles()}
              style={{ padding: 10, borderRadius: 8, backgroundColor: '#f3f4f6' }}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#6b7280" />
              ) : (
                <RefreshCw size={18} color="#6b7280" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setSelectedRole(null);
                setShowModal(true);
              }}
              style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor }}
            >
              <Plus size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search role name..."
        />
        {filteredRoles.length > 0 && (
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            Showing {showingStart}–{showingEnd} of {filteredRoles.length}
          </Text>
        )}
      </View>

      {/* List Content */}
      {isLoading && roles.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading roles...</Text>
        </View>
      ) : error ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={{ color: '#ef4444', fontSize: 14, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={paginatedRoles}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Shield size={48} color="#d1d5db" />
              <Text style={{ color: '#9ca3af', marginTop: 12 }}>No roles found</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && filteredRoles.length > 0 && totalPages > 1 && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: '#e5e7eb',
            padding: 12,
            backgroundColor: '#ffffff',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
            <View
              style={{
                borderWidth: 1,
                borderColor: '#d1d5db',
                borderRadius: 6,
                overflow: 'hidden',
                height: 36,
                justifyContent: 'center',
              }}
            >
              <Picker
                selectedValue={itemsPerPage}
                onValueChange={(v) => setItemsPerPage(Number(v))}
                style={{ width: 90, color: '#111827' }}
                dropdownIconColor="#6b7280"
              >
                {[10, 25, 50, 100].map((v) => (
                  <Picker.Item key={v} label={String(v)} value={v} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PageBtn
              disabled={currentPage === 1}
              onPress={() => handlePageChange(1)}
              icon={<ChevronsLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />}
            />
            <PageBtn
              disabled={currentPage === 1}
              onPress={() => handlePageChange(currentPage - 1)}
              icon={<ChevronLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />}
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827', paddingHorizontal: 6 }}>
              Page {currentPage} of {totalPages}
            </Text>
            <PageBtn
              disabled={currentPage === totalPages}
              onPress={() => handlePageChange(currentPage + 1)}
              icon={<ChevronRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />}
            />
            <PageBtn
              disabled={currentPage === totalPages}
              onPress={() => handlePageChange(totalPages)}
              icon={<ChevronsRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />}
            />
          </View>
        </View>
      )}

      <RoleModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveRole}
        role={selectedRole}
      />
    </View>
  );
};

const PageBtn: React.FC<{ disabled: boolean; onPress: () => void; icon: React.ReactNode }> = ({
  disabled,
  onPress,
  icon,
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={{
      padding: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: disabled ? '#e5e7eb' : '#d1d5db',
      backgroundColor: disabled ? '#f3f4f6' : '#ffffff',
    }}
  >
    {icon}
  </TouchableOpacity>
);

export default Roles;

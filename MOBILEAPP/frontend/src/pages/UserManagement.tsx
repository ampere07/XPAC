import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
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
  User as UserIcon,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { User } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import UserDetails from '../components/UserDetails';
import UserModal from '../modals/UserModal';
import { useUserStore } from '../store/userStore';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

const UserManagement: React.FC<{ agentOnly?: boolean }> = ({ agentOnly = false }) => {
  // FORCED LIGHT MODE
  const isDarkMode = false;

  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const {
    users,
    isLoading,
    error,
    fetchUsers,
    refreshUsers,
    silentRefresh,
    addUser,
    updateUser,
  } = useUserStore();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [userTypeFilter, setUserTypeFilter] = useState<'All' | 'Operations' | 'Customer'>('All');

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Auth data stored async
  const [authData, setAuthData] = useState<any>({});

  useEffect(() => {
    const init = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
      try {
        const raw = await AsyncStorage.getItem('authData');
        setAuthData(raw ? JSON.parse(raw) : {});
      } catch (err) {
        console.error('Failed to load authData:', err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    fetchUsers();
    silentRefresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      silentRefresh().catch((e) => console.error('Idle refresh failed:', e));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [silentRefresh]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshUsers();
    setRefreshing(false);
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const getFullName = (u: User): string => {
    const parts = [u.first_name, u.middle_initial, u.last_name].filter(Boolean);
    return parts.join(' ');
  };

  const filteredUsers = useMemo(() => {
    const userOrgId = authData.organization_id;
    const userRoleId = authData.role_id;
    const userRoleName = (authData.role || '').toLowerCase();
    const isGlobalAdmin =
      (userRoleName === 'superadmin' || String(userRoleId) === '7') && !userOrgId;

    return users.filter((user) => {
      if (isGlobalAdmin) {
        if (
          (user as any).organization_id &&
          !(
            user.role?.role_name?.toLowerCase() === 'superadmin' ||
            String(user.role_id) === '7' ||
            String(user.role?.id) === '7'
          )
        ) {
          return false;
        }
      } else {
        if (userOrgId) {
          if ((user as any).organization_id !== userOrgId) return false;
        } else {
          if (
            (user as any).organization_id !== null &&
            (user as any).organization_id !== undefined
          )
            return false;
        }
      }

      if (agentOnly) {
        const roleName = (user.role?.role_name || '').toLowerCase();
        const isAgent =
          roleName === 'agent' || user.role_id === 4 || String(user.role?.id) === '4';
        if (!isAgent) return false;
      }

      const fullName = getFullName(user).toLowerCase();
      const username = (user.username || '').toLowerCase();
      const email = (user.email_address || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        fullName.includes(query) || username.includes(query) || email.includes(query);

      const isCustomer = user.role_id === 3 || user.role?.id === 3;
      let matchesRole = true;
      if (!agentOnly) {
        if (userTypeFilter === 'Operations') matchesRole = !isCustomer;
        else if (userTypeFilter === 'Customer') matchesRole = isCustomer;
      }

      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, userTypeFilter, agentOnly, authData]);

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredUsers.slice(start, start + itemsPerPage);
  }, [filteredUsers, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleSaveUser = (savedUser: User) => {
    const exists = users.find((u) => u.id === savedUser.id);
    if (exists) {
      updateUser(savedUser);
    } else {
      addUser(savedUser);
    }
    setSelectedUser(savedUser);
  };

  const renderUser = ({ item: user }: { item: User }) => {
    const isSelected = selectedUser?.id === user.id;
    return (
      <TouchableOpacity
        onPress={() => setSelectedUser(user)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: isSelected ? '#f3f4f6' : '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#f3f4f6',
          borderLeftWidth: 4,
          borderLeftColor: isSelected ? primaryColor : 'transparent',
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#f3f4f6',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
          }}
        >
          <UserIcon size={18} color="#6b7280" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text
              style={{ fontSize: 14, fontWeight: '600', color: '#111827', flex: 1 }}
              numberOfLines={1}
            >
              {getFullName(user)}
            </Text>
            <View
              style={{
                backgroundColor: '#f3f4f6',
                borderRadius: 4,
                paddingHorizontal: 6,
                paddingVertical: 2,
                marginLeft: 8,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>
                {user.role?.role_name || 'GUEST'}
              </Text>
            </View>
          </View>
          <Text style={{ fontSize: 12, color: '#9ca3af' }} numberOfLines={1}>
            {user.username} • {user.email_address}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const PaginationControls = () => {
    if (totalPages <= 1) return null;
    const start = Math.min((currentPage - 1) * itemsPerPage + 1, filteredUsers.length);
    const end = Math.min(currentPage * itemsPerPage, filteredUsers.length);
    return (
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          padding: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden', minWidth: 70 }}>
              <Picker
                selectedValue={String(itemsPerPage)}
                onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}
                style={{ height: 36, fontSize: 12 }}
              >
                {[10, 25, 50, 100].map((v) => (
                  <Picker.Item key={v} label={String(v)} value={String(v)} />
                ))}
              </Picker>
            </View>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>
              {start}-{end} of {filteredUsers.length}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity onPress={() => handlePageChange(1)} disabled={currentPage === 1} style={{ padding: 4, opacity: currentPage === 1 ? 0.3 : 1 }}>
              <ChevronsLeft size={16} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} style={{ padding: 4, opacity: currentPage === 1 ? 0.3 : 1 }}>
              <ChevronLeft size={16} color="#374151" />
            </TouchableOpacity>
            <Text style={{ fontSize: 12, color: '#374151', paddingHorizontal: 8 }}>
              Page {currentPage} of {totalPages}
            </Text>
            <TouchableOpacity onPress={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} style={{ padding: 4, opacity: currentPage === totalPages ? 0.3 : 1 }}>
              <ChevronRight size={16} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} style={{ padding: 4, opacity: currentPage === totalPages ? 0.3 : 1 }}>
              <ChevronsRight size={16} color="#374151" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const ListContent = () => {
    if (isLoading && users.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}>Loading users...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={{ fontSize: 14, color: '#ef4444' }}>{error}</Text>
        </View>
      );
    }
    if (filteredUsers.length === 0) {
      return (
        <View style={{ padding: 48, alignItems: 'center', opacity: 0.4 }}>
          <UserIcon size={48} color="#6b7280" />
          <Text style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}>No users found</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingTop: isTablet ? 16 : 60,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>
              {agentOnly ? 'Agent Management' : 'User Management'}
            </Text>
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
              {agentOnly ? 'Manage agent users' : 'Manage system users and permissions'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => refreshUsers()}
              style={{ padding: 8, borderRadius: 8, backgroundColor: '#f3f4f6' }}
            >
              <RefreshCw size={18} color="#6b7280" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setSelectedUser(null); setShowModal(true); }}
              style={{ padding: 8, borderRadius: 8, backgroundColor: primaryColor }}
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
          placeholder="Search name, username, email..."
        />

        {!agentOnly && (
          <View style={{ marginTop: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden', backgroundColor: '#f9fafb' }}>
            <Picker
              selectedValue={userTypeFilter}
              onValueChange={(v) => { setUserTypeFilter(v as any); setCurrentPage(1); }}
              style={{ height: 42 }}
            >
              <Picker.Item label="All Users" value="All" />
              <Picker.Item label="Operations" value="Operations" />
              <Picker.Item label="Customer" value="Customer" />
            </Picker>
          </View>
        )}
      </View>

      {/* List */}
      <View style={{ flex: 1 }}>
        <ListContent />
        {filteredUsers.length > 0 && (
          <FlatList
            data={paginatedUsers}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderUser}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[primaryColor]} />
            }
            contentContainerStyle={{ backgroundColor: '#ffffff' }}
          />
        )}
        {!isLoading && filteredUsers.length > 0 && <PaginationControls />}
      </View>

      {/* User Details Modal (full-screen) */}
      {selectedUser && (
        <Modal visible animationType="slide" onRequestClose={() => setSelectedUser(null)}>
          <UserDetails
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
            onEdit={(u) => { setSelectedUser(u); setShowModal(true); }}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
          />
        </Modal>
      )}

      {/* Add/Edit User Modal */}
      <UserModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveUser}
        user={selectedUser}
        agentOnly={agentOnly}
      />
    </View>
  );
};

export default UserManagement;

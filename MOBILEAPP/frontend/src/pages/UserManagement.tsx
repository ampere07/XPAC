import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plus, User as UserIcon } from 'lucide-react-native';
import { User } from '../types/api';
import { StandardPage, RecordCard } from '../components/common';
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
  const handleSaveUser = (savedUser: User) => {
    const exists = users.find((u) => u.id === savedUser.id);
    if (exists) {
      updateUser(savedUser);
    } else {
      addUser(savedUser);
    }
    setSelectedUser(savedUser);
  };

  // The role picker is the one filter this page has; it sits in the standard
  // left drawer rather than as a third row of chrome above the list.
  const roleDrawer = !agentOnly ? (
    <View style={{ paddingTop: 60, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: '#9ca3af', marginBottom: 8 }}>
        User Type
      </Text>
      <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden', backgroundColor: '#f9fafb' }}>
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
    </View>
  ) : undefined;

  return (
    <StandardPage<User>
      data={filteredUsers}
      keyExtractor={(item) => String(item.id)}
      renderItem={(user) => (
        <RecordCard
          title={getFullName(user)}
          normalizeTitle={false}
          subtitle={`${user.username} • ${user.email_address}`}
          showStatus={false}
          selected={selectedUser?.id === user.id}
          onPress={() => setSelectedUser(user)}
          leading={
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#f3f4f6',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <UserIcon size={18} color="#6b7280" />
            </View>
          }
          right={
            <View style={{ backgroundColor: '#f3f4f6', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>
                {user.role?.role_name || 'GUEST'}
              </Text>
            </View>
          }
        />
      )}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search name, username, email..."
      drawerContent={roleDrawer}
      drawerActive={!agentOnly && userTypeFilter !== 'All'}
      onRefresh={() => refreshUsers()}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading && users.length === 0}
      loadingText="Loading users..."
      error={error}
      onRetry={() => refreshUsers()}
      emptyText="No users found"
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={(n) => { setItemsPerPage(n); setCurrentPage(1); }}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      toolbarActions={
        <TouchableOpacity
          onPress={() => { setSelectedUser(null); setShowModal(true); }}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: primaryColor,
          }}
        >
          <Plus size={20} color="#ffffff" />
        </TouchableOpacity>
      }
    >
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

      <UserModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveUser}
        user={selectedUser}
        agentOnly={agentOnly}
      />
    </StandardPage>
  );
};

export default UserManagement;

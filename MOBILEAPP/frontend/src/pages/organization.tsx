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
  Building as OrganizationIcon,
  Trash2,
  Edit,
} from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Organization } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import OrganizationModal from '../modals/OrganizationModal';
import { useOrganizationStore } from '../store/organizationStore';
import { organizationService } from '../services/userService';

const Organizations: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const {
    organizations,
    isLoading,
    error,
    fetchOrganizations,
    refreshOrganizations,
    addOrganization,
    updateOrganization,
    removeOrganization,
  } = useOrganizationStore();

  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

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
        const authData = raw ? JSON.parse(raw) : {};
        setUserOrgId(authData.organization_id ?? null);
      } catch (err) {
        console.error('Failed to read authData:', err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  // Auto-refresh every 15 minutes (silent).
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshOrganizations().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [refreshOrganizations]);

  const filteredOrgs = useMemo(() => {
    return organizations.filter((org) => {
      // Organization filter
      if (userOrgId && (org as any).organization_id && (org as any).organization_id !== userOrgId) {
        return false;
      }

      const orgName = (org.organization_name || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();
      return orgName.includes(query);
    });
  }, [organizations, searchQuery, userOrgId]);

  const totalItems = filteredOrgs.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrgs = useMemo(() => {
    return filteredOrgs.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredOrgs, startIndex, itemsPerPage]);
  const showingStart = totalItems === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(startIndex + itemsPerPage, totalItems);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshOrganizations();
    setRefreshing(false);
  };

  const handleSaveOrg = (savedOrg: Organization) => {
    const exists = organizations.find((o) => o.id === savedOrg.id);
    if (exists) {
      updateOrganization(savedOrg);
    } else {
      addOrganization(savedOrg);
    }
  };

  const handleDeleteOrg = (id: number) => {
    Alert.alert('Delete Organization', 'Are you sure you want to delete this organization?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await organizationService.deleteOrganization(id);
            if (res.success) {
              removeOrganization(id);
            } else {
              Alert.alert('Error', res.message || 'Failed to delete organization');
            }
          } catch (err: any) {
            Alert.alert('Error', err.message || 'An error occurred');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item: org }: { item: Organization }) => (
    <View
      style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
            backgroundColor: '#f3f4f6',
          }}
        >
          <OrganizationIcon size={16} color="#6b7280" />
        </View>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }} numberOfLines={1}>
            {org.organization_name}
          </Text>
          {!!org.address && (
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }} numberOfLines={2}>
              {org.address}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity
            onPress={() => {
              setSelectedOrg(org);
              setShowModal(true);
            }}
            style={{ padding: 8, borderRadius: 6 }}
          >
            <Edit size={18} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDeleteOrg(org.id)}
            style={{ padding: 8, borderRadius: 6 }}
          >
            <Trash2 size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ marginTop: 8, gap: 4, paddingLeft: 48 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>Email:</Text>
          <Text
            style={{ fontSize: 12, color: org.email_address ? '#374151' : '#9ca3af', flex: 1, textAlign: 'right' }}
            numberOfLines={1}
          >
            {org.email_address || 'No email'}
          </Text>
        </View>
        {!!org.contact_number && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Contact:</Text>
            <Text style={{ fontSize: 12, color: '#374151' }}>{org.contact_number}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>Last Updated:</Text>
          <Text style={{ fontSize: 12, color: '#374151' }}>
            {org.updated_at ? new Date(org.updated_at).toLocaleDateString() : 'N/A'}
          </Text>
        </View>
      </View>
    </View>
  );

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
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Organization Management</Text>
            <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Manage system organizations</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => refreshOrganizations()}
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
                setSelectedOrg(null);
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
          placeholder="Search organization name..."
        />

        {totalItems > 0 && (
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            Showing {showingStart}-{showingEnd} of {totalItems}
          </Text>
        )}
      </View>

      {/* List */}
      {isLoading && organizations.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading organizations...</Text>
        </View>
      ) : error ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Text style={{ color: '#ef4444', fontSize: 14 }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={paginatedOrgs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={primaryColor}
              colors={[primaryColor]}
            />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <OrganizationIcon size={48} color="#d1d5db" />
              <Text style={{ color: '#6b7280', marginTop: 16 }}>No organizations found</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && totalItems > 0 && totalPages > 1 && (
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

      <OrganizationModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveOrg}
        organization={selectedOrg}
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

export default Organizations;

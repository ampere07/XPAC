import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plus, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import AddLocationModal from '../modals/AddLocationModal';
import EditLocationModal from '../modals/EditLocationModal';
import LocationListDetails from '../components/LocationListDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import apiClient from '../config/api';
import {
  getRegions,
  getCities,
  getBoroughs,
  getLocations,
  deleteRegion,
  deleteCity,
  deleteBarangay,
  deleteLocation,
  Region,
  City,
  Borough,
  LocationDetail,
} from '../services/cityService';

interface LocationItem {
  id: number;
  name: string;
  type: 'city' | 'region' | 'borough' | 'location';
  parentId?: number;
  parentName?: string;
  cityId?: number;
  regionId?: number;
  boroughId?: number;
  modifiedBy?: string;
  modifiedAt?: string;
  organization_id?: number | null;
}

interface SidebarFilter {
  type: 'all' | 'region';
  id?: number;
}

interface PropsType {
  onNavigate?: (section: string, extra?: string) => void;
}

const typeLabel = (type: string): string =>
  ({ city: 'City', region: 'Region', borough: 'Barangay', location: 'Location' } as Record<string, string>)[type] || type;

const typeBadge = (type: string): { bg: string; text: string } =>
  ({
    region: { bg: '#dcfce7', text: '#15803d' },
    city: { bg: '#dbeafe', text: '#1d4ed8' },
    borough: { bg: '#f3e8ff', text: '#6b21a8' },
    location: { bg: '#fef9c3', text: '#a16207' },
  } as Record<string, { bg: string; text: string }>)[type] || { bg: '#f3f4f6', text: '#374151' };

const LocationList: React.FC<PropsType> = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>({ type: 'all' });
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [boroughs, setBoroughs] = useState<Borough[]>([]);
  const [locations, setLocations] = useState<LocationDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({ isOpen: false, type: 'loading', title: '', message: '' });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const showGlobalModal = (type: typeof globalModal.type, title: string, message: string, onConfirm?: () => void) => {
    setGlobalModal({ isOpen: true, type, title, message, onConfirm });
  };
  const closeGlobalModal = () => setGlobalModal((prev) => ({ ...prev, isOpen: false }));

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    const loadOrgId = async () => {
      try {
        const authDataStr = await AsyncStorage.getItem('authData');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          setCurrentUserOrgId(
            authData.user?.organization?.id || authData.user?.organization_id || authData.organization?.id || authData.organization_id || null
          );
        }
      } catch (e) {
        // ignore
      }
    };
    loadOrgId();
  }, []);

  useEffect(() => {
    fetchLocationData();
  }, []);

  const fetchLocationData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const [regionsData, citiesData, boroughsData, locationsData] = await Promise.all([
        getRegions(),
        getCities(),
        getBoroughs(),
        getLocations(),
      ]);
      setRegions(regionsData);
      setCities(citiesData);
      setBoroughs(boroughsData);
      setLocations(locationsData);
    } catch (err) {
      console.error('Error fetching location data:', err);
      setError('Failed to load location data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLocationData(true);
    setRefreshing(false);
  };

  const allLocations: LocationItem[] = useMemo(() => {
    const items: LocationItem[] = [];
    cities.forEach((city) =>
      items.push({
        id: city.id,
        name: city.name,
        type: 'city',
        parentId: city.region_id,
        parentName: regions.find((r) => r.id === city.region_id)?.name,
        regionId: city.region_id,
        modifiedBy: (city as any).modified_by,
        modifiedAt: (city as any).modified_at,
        organization_id: (city as any).organization_id,
      })
    );
    regions.forEach((region) =>
      items.push({
        id: region.id,
        name: region.name,
        type: 'region',
        regionId: region.id,
        modifiedBy: (region as any).modified_by,
        modifiedAt: (region as any).modified_at,
        organization_id: (region as any).organization_id,
      })
    );
    boroughs.forEach((borough) => {
      const city = cities.find((c) => c.id === borough.city_id);
      items.push({
        id: borough.id,
        name: borough.name,
        type: 'borough',
        parentId: borough.city_id,
        parentName: city?.name,
        cityId: borough.city_id,
        regionId: city?.region_id,
        modifiedBy: (borough as any).modified_by,
        modifiedAt: (borough as any).modified_at,
        organization_id: (borough as any).organization_id,
      });
    });
    locations.forEach((location) => {
      const borough = boroughs.find((b) => b.id === location.barangay_id);
      const city = cities.find((c) => c.id === borough?.city_id);
      items.push({
        id: location.id,
        name: location.location_name,
        type: 'location',
        parentId: location.barangay_id,
        parentName: borough?.name,
        boroughId: location.barangay_id,
        cityId: borough?.city_id,
        regionId: city?.region_id,
        modifiedBy: (location as any).modified_by,
        modifiedAt: (location as any).modified_at,
        organization_id: (location as any).organization_id || (borough as any)?.organization_id,
      });
    });
    return items;
  }, [cities, regions, boroughs, locations]);

  const filteredLocations = useMemo(() => {
    const filtered = allLocations.filter((location) => {
      const matchesOrg = currentUserOrgId ? location.organization_id === currentUserOrgId : !location.organization_id;
      if (!matchesOrg) return false;

      const q = searchQuery.toLowerCase();
      const matchesSearch =
        q === '' || location.name.toLowerCase().includes(q) || (location.parentName ? location.parentName.toLowerCase().includes(q) : false);

      const matchesSidebar = sidebarFilter.type === 'all' || location.regionId === sidebarFilter.id;
      return matchesSearch && matchesSidebar;
    });

    const typeOrder: Record<string, number> = { region: 1, city: 2, borough: 3, location: 4 };
    return filtered.sort((a, b) => {
      const t = (typeOrder[a.type] || 5) - (typeOrder[b.type] || 5);
      return t !== 0 ? t : a.name.localeCompare(b.name);
    });
  }, [allLocations, searchQuery, sidebarFilter, currentUserOrgId]);

  const totalPages = Math.ceil(filteredLocations.length / itemsPerPage);
  const paginatedLocations = useMemo(
    () => filteredLocations.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredLocations, currentPage, itemsPerPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sidebarFilter, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const handleSaveEdit = async (updatedLocation: LocationItem) => {
    try {
      showGlobalModal('loading', 'Updating Location', `Updating ${updatedLocation.name}...`);
      const authData = await AsyncStorage.getItem('authData');
      let userEmail = '';
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || '';
        } catch (e) {
          // ignore
        }
      }
      // RN cityService has no update* helpers; call the endpoints directly via apiClient.
      const updateData: any = { name: updatedLocation.name, modified_by: userEmail };
      switch (updatedLocation.type) {
        case 'region':
          await apiClient.put(`/regions/${updatedLocation.id}`, updateData);
          break;
        case 'city':
          await apiClient.put(`/cities/${updatedLocation.id}`, updateData);
          break;
        case 'borough':
          await apiClient.put(`/barangays/${updatedLocation.id}`, updateData);
          break;
        case 'location':
          await apiClient.put(`/location-details/${updatedLocation.id}`, { location_name: updatedLocation.name, modified_by: userEmail });
          break;
      }
      await fetchLocationData(true);
      setIsEditModalOpen(false);
      showGlobalModal('success', 'Updated', 'Location updated successfully');
      if (selectedLocation && selectedLocation.id === updatedLocation.id && selectedLocation.type === updatedLocation.type) {
        setSelectedLocation({ ...updatedLocation, modifiedBy: userEmail, modifiedAt: new Date().toISOString() });
      }
    } catch (error: any) {
      console.error('Error updating location:', error);
      showGlobalModal('error', 'Error', error.response?.data?.message || 'Failed to update location. Please try again.');
    }
  };

  const deleteByType = async (location: LocationItem, cascade: boolean) => {
    switch (location.type) {
      case 'region':
        return deleteRegion(location.id, cascade);
      case 'city':
        return deleteCity(location.id, cascade);
      case 'borough':
        return deleteBarangay(location.id, cascade);
      case 'location':
        return deleteLocation(location.id);
    }
  };

  const handleDeleteLocation = (location: LocationItem) => {
    showGlobalModal('confirm', 'Confirm Delete', `Are you sure you want to delete ${location.name}?`, () => executeDelete(location));
  };

  const executeDelete = async (location: LocationItem) => {
    closeGlobalModal();
    showGlobalModal('loading', 'Deleting Location', `Deleting ${location.name}...`);
    try {
      await deleteByType(location, false);
      await fetchLocationData(true);
      showGlobalModal('success', 'Deleted', 'Location deleted successfully');
      setSelectedLocation(null);
    } catch (error: any) {
      console.error('Error deleting location:', error);
      if (error.response?.status === 422 && error.response?.data?.data?.can_cascade) {
        const data = error.response.data.data;
        let msg = `${location.name} contains:\n\n`;
        if (data.type === 'region') {
          msg += `- ${data.city_count} ${data.city_count === 1 ? 'city' : 'cities'}\n- ${data.barangay_count} ${data.barangay_count === 1 ? 'barangay' : 'barangays'}\n\nDeleting this region will also delete all cities and barangays.`;
        } else if (data.type === 'city') {
          msg += `- ${data.barangay_count} ${data.barangay_count === 1 ? 'barangay' : 'barangays'}\n\nDeleting this city will also delete all barangays.`;
        } else if (data.type === 'barangay') {
          msg += `- ${data.location_count} ${data.location_count === 1 ? 'location' : 'locations'}\n\nDeleting this barangay will also delete all locations.`;
        }
        msg += `\n\nDo you want to proceed?`;
        showGlobalModal('warning', 'Cascade Delete Required', msg, async () => {
          closeGlobalModal();
          showGlobalModal('loading', 'Deleting Location', `Deleting ${location.name} and its contents...`);
          try {
            await deleteByType(location, true);
            await fetchLocationData(true);
            showGlobalModal('success', 'Deleted', 'Location and all nested items deleted successfully');
            setSelectedLocation(null);
          } catch (cascadeError) {
            console.error('Error during cascade delete:', cascadeError);
            showGlobalModal('error', 'Error', 'Failed to delete location. Please try again.');
          }
        });
      } else if (error.response?.data?.message) {
        showGlobalModal('error', 'Error', error.response.data.message);
      } else {
        showGlobalModal('error', 'Error', 'Failed to delete location. Please try again.');
      }
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return '-';
    try {
      return new Date(value)
        .toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
        .replace(',', '');
    } catch {
      return value;
    }
  };

  // Region filter chips (mobile replacement for the desktop sidebar tree).
  const regionChips = useMemo(() => {
    const visibleRegionIds = new Set(allLocations.filter((l) => l.type === 'region').map((l) => l.id));
    return regions.filter((r) => visibleRegionIds.has(r.id));
  }, [regions, allLocations]);

  const renderListItem = ({ item: location }: { item: LocationItem }) => {
    const badge = typeBadge(location.type);
    return (
      <TouchableOpacity
        onPress={() => setSelectedLocation(location)}
        activeOpacity={0.7}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: '#f1f5f9',
          backgroundColor: selectedLocation?.id === location.id && selectedLocation?.type === location.type ? '#eff6ff' : '#ffffff',
        }}
      >
        <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 14, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, color: '#111827' }}>{location.name}</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: badge.bg }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: badge.text }}>{typeLabel(location.type)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
            {!!location.parentName && <Text style={{ fontSize: 10, color: '#9ca3af' }}>Parent: {location.parentName}</Text>}
            <Text style={{ fontSize: 10, color: '#9ca3af' }}>By: {location.modifiedBy || '-'}</Text>
          </View>
        </View>
        <ChevronRight size={18} color="#9ca3af" />
      </TouchableOpacity>
    );
  };

  // Detail overlay takes over the screen when a location is selected.
  if (selectedLocation) {
    return (
      <View style={{ flex: 1 }}>
        <LocationListDetails
          location={selectedLocation}
          onClose={() => setSelectedLocation(null)}
          onEdit={(loc) => {
            setSelectedLocation(loc);
            setIsEditModalOpen(true);
          }}
          onDelete={(loc) => handleDeleteLocation(loc)}
          isMobile={!isTablet}
        />
        <EditLocationModal
          isOpen={isEditModalOpen}
          location={selectedLocation}
          onClose={() => setIsEditModalOpen(false)}
          onEdit={handleSaveEdit}
          onDelete={(loc) => handleDeleteLocation(loc)}
        />
        <LoadingModalGlobal
          isOpen={globalModal.isOpen}
          type={globalModal.type}
          title={globalModal.title}
          message={globalModal.message}
          onConfirm={globalModal.onConfirm || closeGlobalModal}
          onCancel={closeGlobalModal}
          colorPalette={colorPalette}
          isDarkMode={isDarkMode}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <GlobalSearch searchQuery={searchQuery} setSearchQuery={setSearchQuery} isDarkMode={isDarkMode} colorPalette={colorPalette} placeholder="Search locations..." />
        <TouchableOpacity onPress={() => setIsAddModalOpen(true)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Plus size={16} color="#ffffff" />
          {isTablet && <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '500' }}>Add Location</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => fetchLocationData()} style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}>
          {isLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
        </TouchableOpacity>
      </View>

      {/* Region filter chips (mobile replacement for desktop sidebar tree) */}
      {!isLoading && !error && regionChips.length > 0 && (
        <View style={{ borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#ffffff' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
            {[{ id: undefined, name: 'All' } as { id?: number; name: string }, ...regionChips].map((chip, idx) => {
              const active = chip.id === undefined ? sidebarFilter.type === 'all' : sidebarFilter.type === 'region' && sidebarFilter.id === chip.id;
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setSidebarFilter(chip.id === undefined ? { type: 'all' } : { type: 'region', id: chip.id })}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: active ? primaryColor : '#f3f4f6',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '500', color: active ? '#ffffff' : '#374151' }}>{chip.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Body */}
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading locations...</Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#ef4444' }}>Error</Text>
          <Text style={{ color: '#6b7280', textAlign: 'center', paddingHorizontal: 24 }}>{error}</Text>
          <TouchableOpacity onPress={() => fetchLocationData()} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedLocations}
          keyExtractor={(item) => `${item.type}-${item.id}`}
          renderItem={renderListItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>No locations found matching your search.</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {!isLoading && !error && filteredLocations.length > 0 && totalPages > 1 && (
        <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb', padding: 12, backgroundColor: '#ffffff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>Show</Text>
            <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, overflow: 'hidden', height: 36, justifyContent: 'center' }}>
              <Picker selectedValue={itemsPerPage} onValueChange={(v) => setItemsPerPage(Number(v))} style={{ width: 90, color: '#111827' }} dropdownIconColor="#6b7280">
                {[10, 25, 50, 100].map((v) => (
                  <Picker.Item key={v} label={String(v)} value={v} />
                ))}
              </Picker>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <PageBtn disabled={currentPage === 1} onPress={() => handlePageChange(1)} icon={<ChevronsLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />} />
            <PageBtn disabled={currentPage === 1} onPress={() => handlePageChange(currentPage - 1)} icon={<ChevronLeft size={14} color={currentPage === 1 ? '#9ca3af' : '#111827'} />} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827', paddingHorizontal: 6 }}>Page {currentPage} of {totalPages}</Text>
            <PageBtn disabled={currentPage === totalPages} onPress={() => handlePageChange(currentPage + 1)} icon={<ChevronRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />} />
            <PageBtn disabled={currentPage === totalPages} onPress={() => handlePageChange(totalPages)} icon={<ChevronsRight size={14} color={currentPage === totalPages ? '#9ca3af' : '#111827'} />} />
          </View>
        </View>
      )}

      <AddLocationModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSave={() => fetchLocationData()} />

      <LoadingModalGlobal
        isOpen={globalModal.isOpen}
        type={globalModal.type}
        title={globalModal.title}
        message={globalModal.message}
        onConfirm={globalModal.onConfirm || closeGlobalModal}
        onCancel={closeGlobalModal}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />
    </View>
  );
};

const PageBtn: React.FC<{ disabled: boolean; onPress: () => void; icon: React.ReactNode }> = ({ disabled, onPress, icon }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={{ padding: 6, borderRadius: 6, borderWidth: 1, borderColor: disabled ? '#e5e7eb' : '#d1d5db', backgroundColor: disabled ? '#f3f4f6' : '#ffffff' }}
  >
    {icon}
  </TouchableOpacity>
);

export default LocationList;

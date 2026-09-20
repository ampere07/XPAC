import React, { useState, useEffect, useMemo } from 'react';
import { Plus, ChevronRight, ChevronDown, RefreshCw, ChevronLeft, ChevronsLeft, ChevronsRight } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import AddLocationModal from '../modals/AddLocationModal';
import EditLocationModal from '../modals/EditLocationModal';
import LocationListDetails from '../components/LocationListDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { usePageActions } from '../hooks/usePageActions';
import {
  getRegions,
  getCities,
  getBoroughs,
  getLocations,
  deleteRegion,
  deleteCity,
  deleteBarangay,
  deleteLocation,
  updateRegion,
  updateCity,
  updateBarangay,
  updateLocationDetail,
  Region,
  City,
  Borough,
  LocationDetail
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
  type: 'all' | 'region' | 'city' | 'borough';
  id?: number;
}

const LocationList: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed. The detail pane is told what it may offer.
  const actions = usePageActions('location-list');

  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>({ type: 'all' });
  const [selectedLocation, setSelectedLocation] = useState<LocationItem | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [boroughs, setBoroughs] = useState<Borough[]>([]);
  const [locations, setLocations] = useState<LocationDetail[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRegions, setExpandedRegions] = useState<Set<number>>(new Set());
  const [expandedCities, setExpandedCities] = useState<Set<number>>(new Set());
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  const showGlobalModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning', 
    title: string, 
    message: string,
    onConfirm?: () => void
  ) => {
    setGlobalModal({
      isOpen: true,
      type,
      title,
      message,
      onConfirm
    });
  };

  const closeGlobalModal = () => {
    setGlobalModal(prev => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };

    fetchColorPalette();
  }, []);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
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
        getLocations()
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

  const allLocations: LocationItem[] = useMemo(() => {
    const locationItems: LocationItem[] = [];

    cities.forEach(city => {
      locationItems.push({
        id: city.id,
        name: city.name,
        type: 'city',
        parentId: city.region_id,
        parentName: regions.find(r => r.id === city.region_id)?.name,
        regionId: city.region_id,
        modifiedBy: city.modified_by,
        modifiedAt: city.modified_at,
        organization_id: city.organization_id
      });
    });

    regions.forEach(region => {
      locationItems.push({
        id: region.id,
        name: region.name,
        type: 'region',
        regionId: region.id,
        modifiedBy: region.modified_by,
        modifiedAt: region.modified_at,
        organization_id: region.organization_id
      });
    });

    boroughs.forEach(borough => {
      const city = cities.find(c => c.id === borough.city_id);
      locationItems.push({
        id: borough.id,
        name: borough.name,
        type: 'borough',
        parentId: borough.city_id,
        parentName: city?.name,
        cityId: borough.city_id,
        regionId: city?.region_id,
        modifiedBy: borough.modified_by,
        modifiedAt: borough.modified_at,
        organization_id: borough.organization_id
      });
    });

    locations.forEach(location => {
      const borough = boroughs.find(b => b.id === location.barangay_id);
      const city = cities.find(c => c.id === borough?.city_id);

      locationItems.push({
        id: location.id,
        name: location.location_name,
        type: 'location',
        parentId: location.barangay_id,
        parentName: borough?.name,
        boroughId: location.barangay_id,
        cityId: borough?.city_id,
        regionId: city?.region_id,
        modifiedBy: location.modified_by,
        modifiedAt: location.modified_at,
        organization_id: location.organization_id || borough?.organization_id
      });
    });

    return locationItems;
  }, [cities, regions, boroughs, locations]);

  const filteredLocations = useMemo(() => {
    const filtered = allLocations.filter(location => {
      // Get current user's organization_id for frontend-side filtering
      let currentUserOrgId: number | null = null;
      const authDataStr = localStorage.getItem('authData');
      if (authDataStr) {
        try {
          const authData = JSON.parse(authDataStr);
          currentUserOrgId = authData.user?.organization?.id || authData.user?.organization_id || authData.organization?.id || authData.organization_id || null;
        } catch (e) {}
      }

      // Organization filter
      if (currentUserOrgId) {
        // User with org: only show locations for that org
        if (location.organization_id !== currentUserOrgId) {
          return false;
        }
      } else {
        // User with NO org: only show locations with NO org
        if (location.organization_id) {
          return false;
        }
      }

      const matchesSearch = searchQuery === '' ||
        location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (location.parentName && location.parentName.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesSidebar = false;
      if (sidebarFilter.type === 'all') {
        matchesSidebar = true;
      } else if (sidebarFilter.type === 'region') {
        matchesSidebar = location.regionId === sidebarFilter.id;
      } else if (sidebarFilter.type === 'city') {
        matchesSidebar = location.cityId === sidebarFilter.id || (location.type === 'city' && location.id === sidebarFilter.id);
      } else if (sidebarFilter.type === 'borough') {
        matchesSidebar = location.boroughId === sidebarFilter.id || (location.type === 'borough' && location.id === sidebarFilter.id);
      }

      return matchesSearch && matchesSidebar;
    });

    return filtered.sort((a, b) => {
      const isASelected =
        (sidebarFilter.type === 'region' && a.type === 'region' && a.id === sidebarFilter.id) ||
        (sidebarFilter.type === 'city' && a.type === 'city' && a.id === sidebarFilter.id) ||
        (sidebarFilter.type === 'borough' && a.type === 'borough' && a.id === sidebarFilter.id);

      const isBSelected =
        (sidebarFilter.type === 'region' && b.type === 'region' && b.id === sidebarFilter.id) ||
        (sidebarFilter.type === 'city' && b.type === 'city' && b.id === sidebarFilter.id) ||
        (sidebarFilter.type === 'borough' && b.type === 'borough' && b.id === sidebarFilter.id);

      if (isASelected && !isBSelected) return -1;
      if (!isASelected && isBSelected) return 1;

      const typeOrder: Record<string, number> = { region: 1, city: 2, borough: 3, location: 4 };
      const typeComparison = (typeOrder[a.type] || 5) - (typeOrder[b.type] || 5);

      if (typeComparison !== 0) {
        return typeComparison;
      }

      return a.name.localeCompare(b.name);
    });
  }, [allLocations, searchQuery, sidebarFilter]);

  const totalPages = Math.ceil(filteredLocations.length / itemsPerPage);
  const paginatedLocations = useMemo(() => {
    return filteredLocations.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
  }, [filteredLocations, currentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sidebarFilter, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleItemsPerPageChange = (newCount: number) => {
    setItemsPerPage(newCount);
    setCurrentPage(1);
  };

  const toggleRegion = (regionId: number) => {
    const newExpanded = new Set(expandedRegions);
    if (newExpanded.has(regionId)) {
      newExpanded.delete(regionId);
    } else {
      newExpanded.add(regionId);
    }
    setExpandedRegions(newExpanded);
  };

  const toggleCity = (cityId: number) => {
    const newExpanded = new Set(expandedCities);
    if (newExpanded.has(cityId)) {
      newExpanded.delete(cityId);
    } else {
      newExpanded.add(cityId);
    }
    setExpandedCities(newExpanded);
  };

  const getCountForRegion = (regionId: number): number => {
    return allLocations.filter(loc => loc.regionId === regionId).length;
  };

  const getCountForCity = (cityId: number): number => {
    return allLocations.filter(loc => loc.cityId === cityId || (loc.type === 'city' && loc.id === cityId)).length;
  };

  const getCountForBarangay = (boroughId: number): number => {
    return allLocations.filter(loc => loc.boroughId === boroughId || (loc.type === 'borough' && loc.id === boroughId)).length;
  };

  const handleAddLocation = (locationData: any) => {
    fetchLocationData();
  };

  const handleLocationClick = (location: LocationItem) => {
    setSelectedLocation(location);
  };

  const handleEditFromDetails = (location: LocationItem) => {
    if (!actions.canEdit) return;
    setSelectedLocation(location);
    setIsEditModalOpen(true);
  };

  const handleDeleteFromDetails = (location: LocationItem) => {
    if (!actions.canDelete) return;
    handleDeleteLocation(location, { stopPropagation: () => { } } as React.MouseEvent);
  };



  const handleSaveEdit = async (updatedLocation: LocationItem) => {
    try {
      showGlobalModal('loading', 'Updating Location', `Updating ${updatedLocation.name}...`);
      
      const authData = localStorage.getItem('authData');
      let userEmail = '';
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || '';
        } catch (e) {
          console.error('Error parsing auth data:', e);
        }
      }

      const updateData = {
        name: updatedLocation.name,
        modified_by: userEmail
      };

      switch (updatedLocation.type) {
        case 'region':
          await updateRegion(updatedLocation.id, updateData);
          break;
        case 'city':
          await updateCity(updatedLocation.id, updateData);
          break;
        case 'borough':
          await updateBarangay(updatedLocation.id, {
            ...updateData
          });
          break;
        case 'location':
          await updateLocationDetail(updatedLocation.id, updateData);
          break;
      }

      await fetchLocationData(true);
      setIsEditModalOpen(false);
      showGlobalModal('success', 'Updated', 'Location updated successfully');
      
      // Refresh the selected location if it was the one being edited
      if (selectedLocation && selectedLocation.id === updatedLocation.id && selectedLocation.type === updatedLocation.type) {
        setSelectedLocation({
          ...updatedLocation,
          modifiedBy: userEmail,
          modifiedAt: new Date().toISOString()
        });
      }
    } catch (error: any) {
      console.error('Error updating location:', error);
      showGlobalModal('error', 'Error', error.response?.data?.message || 'Failed to update location. Please try again.');
    }
  };

  const handleDeleteLocation = (location: LocationItem, event: React.MouseEvent) => {
    if (!actions.canDelete) return;
    event.stopPropagation();
    showGlobalModal(
      'confirm',
      'Confirm Delete',
      `Are you sure you want to delete ${location.name}?`,
      () => executeDelete(location)
    );
  };

  const executeDelete = async (location: LocationItem) => {
    closeGlobalModal();
    showGlobalModal('loading', 'Deleting Location', `Deleting ${location.name}...`);

    try {
      switch (location.type) {
        case 'region':
          await deleteRegion(location.id, false);
          break;
        case 'city':
          await deleteCity(location.id, false);
          break;
        case 'borough':
          await deleteBarangay(location.id, false);
          break;
        case 'location':
          await deleteLocation(location.id);
          break;
        default:
          throw new Error(`Unknown location type: ${location.type}`);
      }

      await fetchLocationData(true);
      showGlobalModal('success', 'Deleted', 'Location deleted successfully');
      setSelectedLocation(null);
    } catch (error: any) {
      console.error('Error deleting location:', error);

      if (error.response?.status === 422 && error.response?.data?.data?.can_cascade) {
        const data = error.response.data.data;
        let cascadeMessage = `${location.name} contains:\n\n`;

        if (data.type === 'region') {
          cascadeMessage += `- ${data.city_count} ${data.city_count === 1 ? 'city' : 'cities'}\n`;
          cascadeMessage += `- ${data.barangay_count} ${data.barangay_count === 1 ? 'barangay' : 'barangays'}\n`;
          cascadeMessage += `\nDeleting this region will also delete all cities and barangays.`;
        } else if (data.type === 'city') {
          cascadeMessage += `- ${data.barangay_count} ${data.barangay_count === 1 ? 'barangay' : 'barangays'}\n`;
          cascadeMessage += `\nDeleting this city will also delete all barangays.`;
        } else if (data.type === 'barangay') {
          cascadeMessage += `- ${data.location_count} ${data.location_count === 1 ? 'location' : 'locations'}\n`;
          cascadeMessage += `\nDeleting this barangay will also delete all locations.`;
        }

        cascadeMessage += `\n\nDo you want to proceed?`;

        showGlobalModal(
          'warning',
          'Cascade Delete Required',
          cascadeMessage,
          async () => {
            closeGlobalModal();
            showGlobalModal('loading', 'Deleting Location', `Deleting ${location.name} and its contents...`);
            try {
              switch (location.type) {
                case 'region':
                  await deleteRegion(location.id, true);
                  break;
                case 'city':
                  await deleteCity(location.id, true);
                  break;
                case 'borough':
                  await deleteBarangay(location.id, true);
                  break;
                case 'location':
                  await deleteLocation(location.id);
                  break;
              }

              await fetchLocationData(true);
              showGlobalModal('success', 'Deleted', 'Location and all nested items deleted successfully');
              setSelectedLocation(null);
            } catch (cascadeError: any) {
              console.error('Error during cascade delete:', cascadeError);
              showGlobalModal('error', 'Error', 'Failed to delete location. Please try again.');
            }
          }
        );
      } else if (error.response?.data?.message) {
        showGlobalModal('error', 'Error', error.response.data.message);
      } else {
        showGlobalModal('error', 'Error', 'Failed to delete location. Please try again.');
      }
    }
  };

  const handleDeleteFromEdit = (location: LocationItem) => {
    if (!actions.canDelete) return;
    handleDeleteLocation(location, { stopPropagation: () => { } } as any);
  };

  const getLocationTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      city: 'City',
      region: 'Region',
      borough: 'Barangay',
      location: 'Location'
    };
    return labels[type] || type;
  };

  const getLocationTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      city: 'text-blue-400',
      region: 'text-green-400',
      borough: 'text-purple-400',
      location: 'text-yellow-400'
    };
    return colors[type] || 'text-gray-400';
  };

  const tableColumns = [
    { id: 'name', label: 'Location Name', width: 'whitespace-nowrap' },
    { id: 'type', label: 'Type', width: 'whitespace-nowrap' },
    { id: 'parent', label: 'Parent Location', width: 'whitespace-nowrap' },
    { id: 'modifiedBy', label: 'Modified By', width: 'whitespace-nowrap' },
    { id: 'modifiedAt', label: 'Modified At', width: 'whitespace-nowrap' }
  ];

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
        <div className="flex flex-col items-center">
          <div
            className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 mb-3"
            style={{ borderTopColor: colorPalette?.primary || '#7c3aed', borderBottomColor: colorPalette?.primary || '#7c3aed' }}
          ></div>
          <p className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>Loading locations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
        <div className={`rounded-md p-6 max-w-lg ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
          }`}>
          <h3 className="text-red-500 text-lg font-medium mb-2">Error</h3>
          <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>{error}</p>
          <button
            onClick={() => fetchLocationData()}
            className="text-white py-2 px-4 rounded transition-colors"
            style={{
              backgroundColor: colorPalette?.primary || '#7c3aed'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {/* Sidebar - Desktop / Bottom Navbar - Mobile */}
      <div className={`md:w-64 md:border-r border-t md:border-t-0 flex-shrink-0 flex flex-col order-2 md:order-1 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        } ${selectedLocation ? 'hidden md:flex' : 'flex'}`}>
        <div className={`p-4 border-b flex-shrink-0 hidden md:block ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="flex items-center mb-1">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Locations</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto md:block overflow-x-auto">
          <div className="flex md:flex-col md:space-y-0 space-x-2 md:space-x-0 p-2 md:p-0">
            <button
              onClick={() => setSidebarFilter({ type: 'all' })}
              className={`md:w-full flex-shrink-0 flex flex-col md:flex-row items-center md:justify-between px-4 py-3 text-sm transition-colors rounded-md md:rounded-none ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                }`}
              style={sidebarFilter.type === 'all' ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                color: colorPalette?.primary || '#7c3aed'
              } : {
                color: isDarkMode ? '#d1d5db' : '#374151'
              }}
            >
              <div className="flex flex-col md:flex-row items-center">
                <span className="text-xs md:text-sm whitespace-nowrap">All</span>
              </div>
              {allLocations.length > 0 && (
                <span
                  className="px-2 py-1 rounded-full text-xs mt-1 md:mt-0"
                  style={sidebarFilter.type === 'all' ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    color: 'white'
                  } : {
                    backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                    color: isDarkMode ? '#d1d5db' : '#374151'
                  }}
                >
                  {allLocations.length}
                </span>
              )}
            </button>

            {regions.map(region => {
              const regionCities = cities.filter(city => city.region_id === region.id);
              const isExpanded = expandedRegions.has(region.id);
              const regionCount = getCountForRegion(region.id);
              const isSelected = sidebarFilter.type === 'region' && sidebarFilter.id === region.id;

              return (
                <div key={`region-${region.id}`} className="flex-shrink-0">
                  <div className="flex flex-col md:flex-row items-center">
                    <button
                      onClick={() => toggleRegion(region.id)}
                      className={`p-2 transition-colors hidden md:block ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                        }`}>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    <button
                      onClick={() => setSidebarFilter({ type: 'region', id: region.id })}
                      className={`flex-1 md:flex-1 flex flex-col md:flex-row items-center md:justify-between py-3 px-4 md:pr-4 md:pl-0 text-sm transition-colors rounded-md md:rounded-none ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                        }`}
                      style={isSelected ? {
                        backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                        color: colorPalette?.primary || '#7c3aed'
                      } : {
                        color: isDarkMode ? '#d1d5db' : '#374151'
                      }}
                    >
                      <span className="text-xs md:text-sm whitespace-nowrap">{region.name}</span>
                      {regionCount > 0 && (
                        <span
                          className="px-2 py-1 rounded-full text-xs mt-1 md:mt-0"
                          style={isSelected ? {
                            backgroundColor: colorPalette?.primary || '#7c3aed',
                            color: 'white'
                          } : {
                            backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                            color: isDarkMode ? '#d1d5db' : '#374151'
                          }}
                        >
                          {regionCount}
                        </span>
                      )}
                    </button>
                  </div>

                  {isExpanded && regionCities.map(city => {
                    const cityBarangays = boroughs.filter(borough => borough.city_id === city.id);
                    const isCityExpanded = expandedCities.has(city.id);
                    const cityCount = getCountForCity(city.id);
                    const isCitySelected = sidebarFilter.type === 'city' && sidebarFilter.id === city.id;

                    return (
                      <div key={`city-${city.id}`} className="ml-6 hidden md:block">
                        <div className="flex items-center">
                          <button
                            onClick={() => toggleCity(city.id)}
                            className={`p-2 transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                              }`}>
                            {isCityExpanded ? (
                              <ChevronDown className="h-3 w-3 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-gray-400" />
                            )}
                          </button>
                          <button
                            onClick={() => setSidebarFilter({ type: 'city', id: city.id })}
                            className={`flex-1 flex items-center justify-between py-2 pr-4 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                              }`}
                            style={isCitySelected ? {
                              backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                              color: colorPalette?.primary || '#7c3aed'
                            } : {
                              color: isDarkMode ? '#d1d5db' : '#374151'
                            }}
                          >
                            <span className="text-xs">{city.name}</span>
                            {cityCount > 0 && (
                              <span
                                className="px-2 py-0.5 rounded-full text-xs"
                                style={isCitySelected ? {
                                  backgroundColor: colorPalette?.primary || '#7c3aed',
                                  color: 'white'
                                } : {
                                  backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                                  color: isDarkMode ? '#d1d5db' : '#374151'
                                }}
                              >
                                {cityCount}
                              </span>
                            )}
                          </button>
                        </div>

                        {isCityExpanded && cityBarangays.map(barangay => {
                          const barangayCount = getCountForBarangay(barangay.id);
                          const isBarangaySelected = sidebarFilter.type === 'borough' && sidebarFilter.id === barangay.id;

                          return (
                            <button
                              key={`barangay-${barangay.id}`}
                              onClick={() => setSidebarFilter({ type: 'borough', id: barangay.id })}
                              className={`w-full flex items-center justify-between py-2 pl-12 pr-4 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                }`}
                              style={isBarangaySelected ? {
                                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                color: colorPalette?.primary || '#7c3aed'
                              } : {
                                color: isDarkMode ? '#d1d5db' : '#374151'
                              }}
                            >
                              <span className="text-xs">{barangay.name}</span>
                              {barangayCount > 0 && (
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs"
                                  style={isBarangaySelected ? {
                                    backgroundColor: colorPalette?.primary || '#7c3aed',
                                    color: 'white'
                                  } : {
                                    backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                                    color: isDarkMode ? '#d1d5db' : '#374151'
                                  }}
                                >
                                  {barangayCount}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`overflow-hidden flex-1 order-1 md:order-2 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'
        } ${selectedLocation ? 'hidden min-[900px]:block' : 'block'}`}>
        <div className="flex flex-col h-full">
          <div className={`sticky top-0 z-10 p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center space-x-3">
              <GlobalSearch 
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                placeholder="Search locations..."
              />
              {actions.canCreate && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="text-white px-4 py-2.5 rounded-lg text-xs transition-all flex items-center space-x-2 font-medium active:scale-95 shadow-sm"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">Add Location</span>
              </button>
              )}
              <button
                onClick={() => fetchLocationData()}
                className="p-2.5 rounded-lg flex items-center justify-center transition-colors shadow-sm active:rotate-180 duration-500"
                title="Refresh List"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
              >
                <RefreshCw 
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                  style={{
                    color: '#ffffff'
                  }}
                />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="h-full overflow-x-auto overflow-y-auto pb-4">
              <table className={`min-w-full divide-y text-sm ${isDarkMode ? 'divide-gray-700' : 'divide-gray-200'
                }`}>
                <thead className={`sticky top-0 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
                  }`}>
                  <tr>
                    {tableColumns.map(column => (
                      <th
                        key={column.id}
                        scope="col"
                        className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${column.width} ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkMode ? 'bg-gray-900 divide-gray-800' : 'bg-white divide-gray-200'
                  }`}>
                  {paginatedLocations.map((location) => (
                    <tr
                      key={`${location.type}-${location.id}`}
                      className={`cursor-pointer group transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                        } ${selectedLocation?.id === location.id && selectedLocation?.type === location.type ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''}`}
                      onClick={() => handleLocationClick(location)}
                    >
                      <td className={`px-4 py-3 whitespace-nowrap text-xs uppercase font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                        }`}>
                        {location.name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        <span className={getLocationTypeColor(location.type)}>
                          {getLocationTypeLabel(location.type)}
                        </span>
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-900'
                        }`}>
                        {location.parentName || '-'}
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {location.modifiedBy || '-'}
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {location.modifiedAt ? new Date(location.modifiedAt).toLocaleString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        }).replace(',', '') : '-'}
                      </td>
                    </tr>
                  ))}
                  {filteredLocations.length === 0 && (
                    <tr>
                      <td colSpan={6} className={`px-4 py-10 text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                        No locations found matching your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination Controls */}
          {!isLoading && filteredLocations.length > 0 && totalPages > 1 && (
            <div className={`border-t p-4 flex items-center justify-between ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200 shadow-lg'}`}>
              <div className={`flex items-center gap-4 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="flex items-center gap-2">
                  <span>Show</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                    className={`px-2 py-1 rounded border focus:outline-none text-xs transition-colors ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white focus:border-orange-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
                      }`}
                  >
                    {[10, 25, 50, 100].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <span>entries</span>
                </div>
                <div>
                  Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredLocations.length)}</span> of <span className="font-medium">{filteredLocations.length}</span> results
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                  className={`p-1.5 rounded transition-colors ${currentPage === 1
                    ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                    : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                    }`}
                  title="First Page"
                >
                  <ChevronsLeft size={14} />
                </button>

                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`p-1.5 rounded transition-colors ${currentPage === 1
                    ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                    : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                    }`}
                >
                  <ChevronLeft size={14} />
                </button>

                <div className="flex items-center space-x-1">
                  <span className={`px-2 text-xs font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    Page {currentPage} of {totalPages}
                  </span>
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`p-1.5 rounded transition-colors ${currentPage === totalPages
                    ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                    : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                    }`}
                >
                  <ChevronRight size={14} />
                </button>

                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                  className={`p-1.5 rounded transition-colors ${currentPage === totalPages
                    ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                    : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                    }`}
                  title="Last Page"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AddLocationModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddLocation}
      />

      <EditLocationModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        location={selectedLocation}
        onEdit={handleSaveEdit}
        onDelete={handleDeleteFromEdit}
      />

      {selectedLocation && (
        <div className="flex-shrink-0 w-full min-[900px]:w-auto border-l h-full order-3" style={{ zIndex: 40, borderColor: isDarkMode ? '#374151' : '#e5e7eb' }}>
          <LocationListDetails
            location={selectedLocation}
            onClose={() => setSelectedLocation(null)}
            onEdit={handleEditFromDetails}
            onDelete={handleDeleteFromDetails}
            canEdit={actions.canEdit}
            canDelete={actions.canDelete}
            isMobile={typeof window !== 'undefined' ? window.innerWidth < 900 : false}
          />
        </div>
      )}

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
    </div>
  );
};

export default LocationList;

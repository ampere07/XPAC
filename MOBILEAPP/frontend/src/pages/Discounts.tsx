import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import {
  ChevronRight,
  Tag,
  ChevronDown,
  RefreshCw,
  Plus,
  Download,
  Filter,
  X,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import DiscountDetails from '../components/DiscountDetails';
import DiscountFormModal from '../modals/DiscountFormModal';
import * as discountService from '../services/discountService';
import barangayService from '../services/barangayService';
import { getRegions, Region } from '../services/regionService';
import { getCities, City } from '../services/cityService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';
import { usePermissions } from '../hooks/usePermissions';

const isDarkMode = false;

// Colors
const BG = '#f9fafb';
const CARD = '#ffffff';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

const formatDate = (dateStr?: string, includeTime: boolean = false): string => {
  if (!dateStr) return 'No date';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    if (includeTime) {
      let hours = date.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hours}:${minutes}:${seconds} ${ampm}`;
    }
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateStr;
  }
};

interface DiscountRecord {
  id: string;
  fullName: string;
  accountNo: string;
  contactNumber: string;
  emailAddress: string;
  address: string;
  plan: string;
  provider: string;
  discountId: string;
  discountAmount: number;
  discountStatus: string;
  dateCreated: string;
  processedBy: string;
  processedDate: string;
  approvedBy: string;
  approvedByEmail?: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  remarks: string;
  cityId?: number;
  barangay?: string;
  city?: string;
  region?: string;
  created_at?: string;
  completeAddress?: string;
  onlineStatus?: string;
  organization_id?: number | null;
}

const getDiscountRecords = async (userOrgId: number | null): Promise<DiscountRecord[]> => {
  try {
    const response = await discountService.getAll();
    if (response.success && response.data) {
      return response.data.map((discount: any) => {
        const customer = discount.billing_account?.customer;
        const plan = discount.billing_account?.plan;
        return {
          id: String(discount.id),
          fullName:
            customer?.full_name ||
            [customer?.first_name, customer?.middle_initial, customer?.last_name]
              .filter(Boolean)
              .join(' ') ||
            'N/A',
          accountNo: discount.account_no || 'N/A',
          contactNumber: customer?.contact_number_primary || 'N/A',
          emailAddress: customer?.email_address || 'N/A',
          address: customer?.address || 'N/A',
          completeAddress:
            [
              customer?.address,
              customer?.location,
              customer?.barangay,
              customer?.city,
              customer?.region,
            ]
              .filter(Boolean)
              .join(', ') || 'N/A',
          plan: plan?.plan_name || 'N/A',
          provider: 'N/A',
          discountId: String(discount.id),
          discountAmount: parseFloat(discount.discount_amount) || 0,
          discountStatus: discount.status || 'Unknown',
          dateCreated: discount.created_at ? formatDate(discount.created_at) : 'N/A',
          processedBy:
            discount.processed_by_user?.full_name ||
            discount.processed_by_user?.username ||
            'N/A',
          processedDate: discount.processed_date
            ? formatDate(discount.processed_date)
            : 'N/A',
          approvedBy:
            discount.approved_by_user?.full_name ||
            discount.approved_by_user?.username ||
            'N/A',
          approvedByEmail:
            discount.approved_by_user?.email_address || discount.approved_by_user?.email,
          modifiedBy:
            discount.updated_by_user?.full_name ||
            discount.updated_by_user?.username ||
            'N/A',
          modifiedDate: discount.updated_at
            ? formatDate(discount.updated_at, true)
            : 'N/A',
          userEmail:
            discount.processed_by_user?.email_address ||
            discount.processed_by_user?.email ||
            'N/A',
          remarks: discount.remarks || '',
          cityId: customer?.city_id || undefined,
          barangay: customer?.barangay,
          city: customer?.city,
          region: customer?.region,
          created_at: discount.created_at,
          onlineStatus: undefined,
          organization_id: discount.organization_id,
        };
      });
    }
    return [];
  } catch (error) {
    console.error('Error fetching discount records:', error);
    throw error;
  }
};

const discountColumns = [
  { key: 'id', label: 'ID' },
  { key: 'fullName', label: 'Customer Name' },
  { key: 'accountNo', label: 'Account No' },
  { key: 'contactNumber', label: 'Contact Number' },
  { key: 'emailAddress', label: 'Email Address' },
  { key: 'address', label: 'Address' },
  { key: 'plan', label: 'Plan' },
  { key: 'discountAmount', label: 'Discount Amount' },
  { key: 'discountStatus', label: 'Status' },
  { key: 'dateCreated', label: 'Date Created' },
  { key: 'processedBy', label: 'Processed By' },
  { key: 'processedDate', label: 'Processed Date' },
  { key: 'approvedBy', label: 'Approved By' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'barangay', label: 'Barangay' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'Region' },
];

const Discounts: React.FC = () => {
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDiscount, setSelectedDiscount] = useState<DiscountRecord | null>(null);
  const selectedDiscountRef = useRef<DiscountRecord | null>(null);
  const [discountRecords, setDiscountRecords] = useState<DiscountRecord[]>([]);
  const [createdDateFrom, setCreatedDateFrom] = useState<string>('');
  const [createdDateTo, setCreatedDateTo] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isDiscountFormModalOpen, setIsDiscountFormModalOpen] = useState<boolean>(false);
  const [barangays, setBarangays] = useState<any[]>([]);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  // Filter sidebar modal
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Detail modal (for non-tablet)
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    selectedDiscountRef.current = selectedDiscount;
  }, [selectedDiscount]);

  // Auto-update selectedDiscount when records refresh
  useEffect(() => {
    if (selectedDiscountRef.current && discountRecords.length > 0) {
      const updatedMatch = discountRecords.find(
        r => r.id === selectedDiscountRef.current?.id
      );
      if (
        updatedMatch &&
        JSON.stringify(updatedMatch) !== JSON.stringify(selectedDiscountRef.current)
      ) {
        setSelectedDiscount(updatedMatch);
      }
    }
  }, [discountRecords]);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          setUserRole(userData.role || '');
          setRoleId(userData.role_id || null);
          const orgId =
            userData.organization_id ||
            userData.user?.organization_id ||
            userData.organization?.id ||
            userData.user?.organization?.id ||
            null;
          setUserOrgId(orgId);

        }
      } catch (error) {
        console.error('Error parsing auth data in Discounts:', error);
      }
    };
    loadAuth();
  }, []);

  // Resolved centrally (hooks/usePermissions): a seeded role answers from the
  // permission table, a custom role from the keys the server resolved for it.
  const { can: hasPermission } = usePermissions();

  useEffect(() => {
    const fetchLocationData = async () => {
      try {
        const [citiesData, regionsData, barangaysRes] = await Promise.all([
          getCities(),
          getRegions(),
          barangayService.getAll(),
        ]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
        setBarangays(barangaysRes.success ? barangaysRes.data : []);
      } catch (err) {
        console.error('Failed to fetch location data:', err);
      }
    };
    fetchLocationData();
  }, []);

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

  const loadDiscounts = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getDiscountRecords(userOrgId);
      setDiscountRecords(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch discount records:', err);
      setError('Failed to load discount records. Please try again.');
      setDiscountRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, [userOrgId]);

  useEffect(() => {
    loadDiscounts();
  }, [loadDiscounts]);

  // Auto silent-refresh every 15 minutes
  useEffect(() => {
    const intervalId = setInterval(() => {
      getDiscountRecords(userOrgId)
        .then(data => {
          setDiscountRecords(data);
        })
        .catch(err => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [userOrgId]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const data = await getDiscountRecords(userOrgId);
      setDiscountRecords(data);
      setError(null);
    } catch (err) {
      console.error('Failed to refresh discount records:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleLocationExpansion = (locationId: string) => {
    setExpandedLocations(prev => {
      const next = new Set(prev);
      if (next.has(locationId)) {
        next.delete(locationId);
      } else {
        next.add(locationId);
      }
      return next;
    });
  };

  const searchFilteredRecords = useMemo(() => {
    return discountRecords.filter(record => {
      if (userOrgId) {
        if (record.organization_id !== userOrgId) return false;
      } else {
        if (record.organization_id) return false;
      }

      const matchesSearch =
        searchQuery === '' ||
        record.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.accountNo.includes(searchQuery);

      if (!matchesSearch) return false;

      if (createdDateFrom || createdDateTo) {
        const recordDate = record.created_at ? new Date(record.created_at) : null;
        if (!recordDate) return false;
        recordDate.setHours(0, 0, 0, 0);
        if (createdDateFrom) {
          const fromDate = new Date(createdDateFrom);
          if (recordDate < fromDate) return false;
        }
        if (createdDateTo) {
          const toDate = new Date(createdDateTo);
          if (recordDate > toDate) return false;
        }
      }
      return true;
    });
  }, [discountRecords, searchQuery, createdDateFrom, createdDateTo, userOrgId]);

  const locationItems = useMemo(() => {
    const regionCounts: Record<string, number> = {};
    const cityCounts: Record<string, number> = {};
    const barangayCounts: Record<string, number> = {};

    searchFilteredRecords.forEach(record => {
      const region = record.region;
      const city = record.city;
      const barangay = record.barangay;

      if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;

      if (city) {
        const matchedCity = cities.find(c => c.name === city);
        if (matchedCity) {
          cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] =
            (cityCounts[`${matchedCity.region_id}_${matchedCity.name}`] || 0) + 1;
        }
      }

      if (barangay) {
        const matchedBarangay = barangays.find(
          b =>
            b.barangay === barangay &&
            (!city || cities.find(c => c.id === b.city_id)?.name === city)
        );
        if (matchedBarangay) {
          barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] =
            (barangayCounts[`${matchedBarangay.city_id}_${matchedBarangay.barangay}`] || 0) + 1;
        }
      }
    });

    return {
      regions: regions.map(r => ({
        id: `reg:${r.name}`,
        name: r.name,
        count: regionCounts[r.name] || 0,
        cities: cities
          .filter(c => c.region_id === r.id)
          .map(c => ({
            id: `city:${c.name}`,
            name: c.name,
            regionName: r.name,
            count: cityCounts[`${r.id}_${c.name}`] || 0,
            barangays: barangays
              .filter(b => b.city_id === c.id)
              .map(b => ({
                id: `brgy:${b.barangay}`,
                name: b.barangay,
                cityName: c.name,
                regionName: r.name,
                count: barangayCounts[`${c.id}_${b.barangay}`] || 0,
              })),
          })),
      })),
      total: searchFilteredRecords.length,
    };
  }, [regions, cities, barangays, searchFilteredRecords]);

  const filteredDiscountRecords = useMemo(() => {
    return searchFilteredRecords.filter(record => {
      if (selectedLocation === 'all') return true;
      if (selectedLocation.startsWith('reg:'))
        return record.region === selectedLocation.replace('reg:', '');
      if (selectedLocation.startsWith('city:'))
        return record.city === selectedLocation.replace('city:', '');
      if (selectedLocation.startsWith('brgy:'))
        return record.barangay === selectedLocation.replace('brgy:', '');
      return record.cityId === Number(selectedLocation);
    });
  }, [searchFilteredRecords, selectedLocation]);

  const currentDiscountIndex = useMemo(() => {
    if (!selectedDiscount || !filteredDiscountRecords) return -1;
    return filteredDiscountRecords.findIndex(r => r.id === selectedDiscount.id);
  }, [filteredDiscountRecords, selectedDiscount]);

  const handlePreviousRecord = () => {
    if (currentDiscountIndex > 0) {
      setSelectedDiscount(filteredDiscountRecords[currentDiscountIndex - 1]);
    }
  };

  const handleNextRecord = () => {
    if (currentDiscountIndex >= 0 && currentDiscountIndex < filteredDiscountRecords.length - 1) {
      setSelectedDiscount(filteredDiscountRecords[currentDiscountIndex + 1]);
    }
  };

  const handleRecordClick = (record: DiscountRecord) => {
    setSelectedDiscount(record);
    if (!isTablet) {
      setDetailModalOpen(true);
    }
  };

  const handleExport = () => {
    if (!filteredDiscountRecords || filteredDiscountRecords.length === 0) return;
    const getExportValue = (record: DiscountRecord, columnKey: string) => {
      switch (columnKey) {
        case 'id': return record.id;
        case 'fullName': return record.fullName || '-';
        case 'accountNo': return record.accountNo || '-';
        case 'contactNumber': return record.contactNumber || '-';
        case 'emailAddress': return record.emailAddress || '-';
        case 'address': return record.address || '-';
        case 'plan': return record.plan || '-';
        case 'discountAmount': return `₱ ${(record.discountAmount ?? 0).toFixed(2)}`;
        case 'discountStatus': return record.discountStatus || '-';
        case 'dateCreated': return formatDate(record.dateCreated);
        case 'processedBy': return record.processedBy || '-';
        case 'processedDate': return formatDate(record.processedDate);
        case 'approvedBy': return record.approvedBy || '-';
        case 'remarks': return record.remarks || '-';
        case 'barangay': return record.barangay || '-';
        case 'city': return record.city || '-';
        case 'region': return record.region || '-';
        default: return '-';
      }
    };
    exportToCSV('discounts_export', discountColumns, filteredDiscountRecords, getExportValue);
  };

  // --- Filter Sidebar Content ---
  const renderFilterSidebar = () => (
    <ScrollView style={{ flex: 1 }}>
      {/* Date Range */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: BORDER,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 1 }}>
            Created Date Range
          </Text>
          {(createdDateFrom || createdDateTo) && (
            <TouchableOpacity
              onPress={() => { setCreatedDateFrom(''); setCreatedDateTo(''); }}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: primary, textTransform: 'uppercase' }}>
                Clear
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>From</Text>
        <TextInput
          value={createdDateFrom}
          onChangeText={setCreatedDateFrom}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1,
            borderColor: createdDateFrom ? primary : BORDER,
            borderRadius: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            fontSize: 13,
            color: TEXT,
            backgroundColor: CARD,
            marginBottom: 8,
          }}
        />
        <Text style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>To</Text>
        <TextInput
          value={createdDateTo}
          onChangeText={setCreatedDateTo}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1,
            borderColor: createdDateTo ? primary : BORDER,
            borderRadius: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            fontSize: 13,
            color: TEXT,
            backgroundColor: CARD,
          }}
        />
      </View>

      {/* All Discounts */}
      <TouchableOpacity
        onPress={() => setSelectedLocation('all')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: selectedLocation === 'all' ? `${primary}22` : 'transparent',
        }}
      >
        <Text style={{ fontSize: 14, color: selectedLocation === 'all' ? primary : TEXT }}>
          All Discounts
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 99,
            backgroundColor: selectedLocation === 'all' ? primary : '#e5e7eb',
          }}
        >
          <Text
            style={{
              fontSize: 11,
              color: selectedLocation === 'all' ? '#ffffff' : MUTED,
            }}
          >
            {locationItems.total}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Regions */}
      {locationItems.regions.map((region: any) => (
        <View key={region.id}>
          <TouchableOpacity
            onPress={() => setSelectedLocation(region.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 12,
              backgroundColor: selectedLocation === region.id ? `${primary}22` : 'transparent',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <TouchableOpacity
                onPress={() => toggleLocationExpansion(region.id)}
                style={{ padding: 4, marginRight: 4 }}
              >
                {expandedLocations.has(region.id) ? (
                  <ChevronDown size={14} color={selectedLocation === region.id ? primary : MUTED} />
                ) : (
                  <ChevronRight size={14} color={selectedLocation === region.id ? primary : MUTED} />
                )}
              </TouchableOpacity>
              <Tag size={14} color={selectedLocation === region.id ? primary : MUTED} style={{ marginRight: 6 }} />
              <Text style={{ fontSize: 13, color: selectedLocation === region.id ? primary : TEXT }}>
                {region.name}
              </Text>
            </View>
            {region.count > 0 && (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 99,
                  backgroundColor: selectedLocation === region.id ? primary : '#e5e7eb',
                }}
              >
                <Text style={{ fontSize: 10, color: selectedLocation === region.id ? '#ffffff' : MUTED }}>
                  {region.count}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Cities */}
          {expandedLocations.has(region.id) &&
            region.cities.map((city: any) => (
              <View key={city.id}>
                <TouchableOpacity
                  onPress={() => setSelectedLocation(city.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingLeft: 40,
                    paddingRight: 16,
                    paddingVertical: 8,
                    backgroundColor: selectedLocation === city.id ? `${primary}15` : 'transparent',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <TouchableOpacity
                      onPress={() => toggleLocationExpansion(city.id)}
                      style={{ padding: 4, marginRight: 4 }}
                    >
                      {expandedLocations.has(city.id) ? (
                        <ChevronDown size={12} color={selectedLocation === city.id ? primary : MUTED} />
                      ) : (
                        <ChevronRight size={12} color={selectedLocation === city.id ? primary : MUTED} />
                      )}
                    </TouchableOpacity>
                    <Text style={{ fontSize: 13, color: selectedLocation === city.id ? primary : MUTED }}>
                      {city.name}
                    </Text>
                  </View>
                  {city.count > 0 && (
                    <Text style={{ fontSize: 10, color: selectedLocation === city.id ? primary : '#9ca3af' }}>
                      {city.count}
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Barangays */}
                {expandedLocations.has(city.id) &&
                  city.barangays.map((barangay: any) => (
                    <TouchableOpacity
                      key={barangay.id}
                      onPress={() => setSelectedLocation(barangay.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingLeft: 64,
                        paddingRight: 16,
                        paddingVertical: 6,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <View
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 3,
                            backgroundColor: selectedLocation === barangay.id ? primary : '#9ca3af',
                            marginRight: 8,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 12,
                            color: selectedLocation === barangay.id ? primary : '#9ca3af',
                            fontWeight: selectedLocation === barangay.id ? '600' : '400',
                          }}
                        >
                          {barangay.name}
                        </Text>
                      </View>
                      {barangay.count > 0 && (
                        <Text style={{ fontSize: 10, color: selectedLocation === barangay.id ? primary : '#9ca3af' }}>
                          {barangay.count}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
              </View>
            ))}
        </View>
      ))}
    </ScrollView>
  );

  const renderItem = ({ item }: { item: DiscountRecord }) => {
    const isSelected = selectedDiscount?.id === item.id;
    const statusLower = item.discountStatus?.toLowerCase();
    const statusColor = statusLower === 'approved' ? '#22c55e' : '#f59e0b';

    return (
      <TouchableOpacity
        onPress={() => handleRecordClick(item)}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: BORDER,
          backgroundColor: isSelected ? '#f3f4f6' : CARD,
        }}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: TEXT }} numberOfLines={1}>
              {item.fullName}
            </Text>
            <Text style={{ fontSize: 12, color: '#ef4444', marginTop: 2 }} numberOfLines={1}>
              {item.accountNo} | {item.address}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }}>
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 99,
                  backgroundColor: `${statusColor}15`,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor, textTransform: 'uppercase' }}>
                  {item.discountStatus}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: MUTED }}>{item.dateCreated}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 15, fontWeight: '600', color: TEXT }}>
            ₱{item.discountAmount.toFixed(2)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG, flexDirection: isTablet ? 'row' : 'column' }}>
      {/* Tablet: Sidebar always visible */}
      {isTablet && (
        <View
          style={{
            width: 260,
            backgroundColor: CARD,
            borderRightWidth: 1,
            borderRightColor: BORDER,
          }}
        >
          <View
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: BORDER,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: TEXT }}>Discounts</Text>
          </View>
          {renderFilterSidebar()}
        </View>
      )}

      {/* Main list area */}
      <View style={{ flex: 1, flexDirection: isTablet ? 'row' : 'column' }}>
        <View style={{ flex: isTablet && selectedDiscount ? 0.45 : 1 }}>
          {/* Header */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              paddingTop: isTablet ? 12 : 60,
              backgroundColor: CARD,
              borderBottomWidth: 1,
              borderBottomColor: BORDER,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {/* Filter button (phone only) */}
            {!isTablet && (
              <TouchableOpacity
                onPress={() => setFilterModalOpen(true)}
                style={{
                  padding: 8,
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderRadius: 8,
                  backgroundColor: CARD,
                }}
              >
                <Filter size={18} color={MUTED} />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <GlobalSearch
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                placeholder="Search Discount records..."
              />
            </View>
            {hasPermission('discounts.add') && (
              <TouchableOpacity
                onPress={() => setIsDiscountFormModalOpen(true)}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: primary,
                }}
              >
                <Plus size={18} color="#ffffff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleExport}
              disabled={isLoading || filteredDiscountRecords.length === 0}
              style={{
                padding: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: primary,
                backgroundColor: CARD,
                opacity: isLoading || filteredDiscountRecords.length === 0 ? 0.4 : 1,
              }}
            >
              <Download size={18} color={primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRefresh}
              disabled={isLoading}
              style={{
                padding: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: primary,
                backgroundColor: CARD,
                opacity: isLoading ? 0.4 : 1,
              }}
            >
              <RefreshCw size={18} color={primary} />
            </TouchableOpacity>
          </View>

          {/* Active filter indicator */}
          {(selectedLocation !== 'all' || createdDateFrom || createdDateTo) && (
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 6,
                backgroundColor: `${primary}15`,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontSize: 12, color: primary }}>
                {selectedLocation !== 'all'
                  ? `Filter: ${selectedLocation.replace(/^(reg:|city:|brgy:)/, '')}`
                  : 'Date filter active'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setSelectedLocation('all');
                  setCreatedDateFrom('');
                  setCreatedDateTo('');
                }}
              >
                <Text style={{ fontSize: 12, color: primary, fontWeight: '700' }}>Clear</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* List */}
          {isLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={primary} />
              <Text style={{ color: MUTED, marginTop: 12 }}>Loading discount records...</Text>
            </View>
          ) : error ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <Text style={{ color: '#ef4444', textAlign: 'center', marginBottom: 16 }}>{error}</Text>
              <TouchableOpacity
                onPress={handleRefresh}
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  backgroundColor: '#e5e7eb',
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: TEXT, fontWeight: '500' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={filteredDiscountRecords}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={primary}
                />
              }
              ListEmptyComponent={
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: MUTED, textAlign: 'center' }}>
                    No discount records found matching your filters
                  </Text>
                </View>
              }
              contentContainerStyle={filteredDiscountRecords.length === 0 ? { flex: 1 } : undefined}
            />
          )}
        </View>

        {/* Tablet inline details panel */}
        {isTablet && selectedDiscount && (
          <View style={{ flex: 0.55, borderLeftWidth: 1, borderLeftColor: BORDER }}>
            <DiscountDetails
              discountRecord={selectedDiscount}
              onClose={() => setSelectedDiscount(null)}
              onApproveSuccess={handleRefresh}
              onPrevious={currentDiscountIndex > 0 ? handlePreviousRecord : undefined}
              onNext={
                currentDiscountIndex < filteredDiscountRecords.length - 1
                  ? handleNextRecord
                  : undefined
              }
            />
          </View>
        )}
      </View>

      {/* Phone: Detail Modal */}
      {!isTablet && (
        <Modal visible={detailModalOpen && !!selectedDiscount} animationType="slide">
          <View style={{ flex: 1, backgroundColor: CARD }}>
            {selectedDiscount && (
              <DiscountDetails
                discountRecord={selectedDiscount}
                onClose={() => {
                  setDetailModalOpen(false);
                  setSelectedDiscount(null);
                }}
                onApproveSuccess={() => {
                  handleRefresh();
                  setDetailModalOpen(false);
                }}
                onPrevious={currentDiscountIndex > 0 ? handlePreviousRecord : undefined}
                onNext={
                  currentDiscountIndex < filteredDiscountRecords.length - 1
                    ? handleNextRecord
                    : undefined
                }
              />
            )}
          </View>
        </Modal>
      )}

      {/* Phone: Filter Modal */}
      {!isTablet && (
        <Modal visible={filterModalOpen} animationType="slide" transparent>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View
              style={{
                height: '80%',
                backgroundColor: CARD,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: BORDER,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '600', color: TEXT }}>
                  Discounts
                </Text>
                <TouchableOpacity onPress={() => setFilterModalOpen(false)}>
                  <X size={20} color={MUTED} />
                </TouchableOpacity>
              </View>
              {renderFilterSidebar()}
              <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: BORDER }}>
                <TouchableOpacity
                  onPress={() => setFilterModalOpen(false)}
                  style={{
                    paddingVertical: 12,
                    borderRadius: 8,
                    backgroundColor: primary,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '600' }}>View Records</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Discount Form Modal */}
      <DiscountFormModal
        isOpen={isDiscountFormModalOpen}
        onClose={() => setIsDiscountFormModalOpen(false)}
        onSave={async () => {
          await handleRefresh();
          setIsDiscountFormModalOpen(false);
        }}
      />
    </View>
  );
};

export default Discounts;

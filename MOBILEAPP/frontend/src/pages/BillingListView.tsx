import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { CreditCard, Search, Circle } from 'lucide-react-native';
import BillingDetails from '../components/CustomerDetails';
import { useBillingStore } from '../store/billingStore';
import { BillingRecord } from '../services/billingService';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { BillingDetailRecord } from '../types/billing';
import { getCities, City } from '../services/cityService';
import { getRegions, Region } from '../services/regionService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

// ─── Converter ────────────────────────────────────────────────────────────────

const convertCustomerDataToBillingDetail = (customerData: CustomerDetailData): BillingDetailRecord => {
  return {
    id: customerData.billingAccount?.accountNo || '',
    applicationId: customerData.billingAccount?.accountNo || '',
    customerName: customerData.fullName,
    address: customerData.address,
    status: customerData.billingAccount?.billingStatusId === 2 ? 'Active' : 'Inactive',
    balance: customerData.billingAccount?.accountBalance || 0,
    onlineStatus: customerData.billingAccount?.billingStatusId === 2 ? 'Online' : 'Offline',
    cityId: null,
    regionId: null,
    timestamp: customerData.updatedAt || '',
    billingStatus: customerData.billingAccount?.billingStatusId
      ? (({ 1: 'In Progress', 2: 'Active', 3: 'Suspended', 4: 'Cancelled', 5: 'Overdue', 6: 'Service Account' } as Record<number, string>)[customerData.billingAccount.billingStatusId] || `Status ${customerData.billingAccount.billingStatusId}`)
      : '',
    dateInstalled: customerData.billingAccount?.dateInstalled || '',
    contactNumber: customerData.contactNumberPrimary,
    secondContactNumber: customerData.contactNumberSecondary || '',
    emailAddress: customerData.emailAddress || '',
    plan: customerData.desiredPlan || '',
    username: customerData.technicalDetails?.username || '',
    connectionType: customerData.technicalDetails?.connectionType || '',
    routerModel: customerData.technicalDetails?.routerModel || '',
    routerModemSN: customerData.technicalDetails?.routerModemSn || '',
    lcpnap: customerData.technicalDetails?.lcpnap || '',
    port: customerData.technicalDetails?.port || '',
    vlan: customerData.technicalDetails?.vlan || '',
    billingDay: customerData.billingAccount?.billingDay || 0,
    totalPaid: 0,
    provider: '',
    lcp: customerData.technicalDetails?.lcp || '',
    nap: customerData.technicalDetails?.nap || '',
    modifiedBy: '',
    modifiedDate: customerData.updatedAt || '',
    barangay: customerData.barangay || '',
    city: customerData.city || '',
    region: customerData.region || '',
    usageType: customerData.technicalDetails?.usageType || '',
    referredBy: customerData.referredBy || '',
    referredByAgentId: customerData.referredByAgentId ?? null,
    referralContactNo: '',
    groupName: customerData.groupName || '',
    mikrotikId: '',
    sessionIp: customerData.technicalDetails?.ipAddress || '',
    houseFrontPicture: customerData.houseFrontPictureUrl || '',
    accountBalance: customerData.billingAccount?.accountBalance || 0,
    housingStatus: customerData.housingStatus || '',
    addressCoordinates: customerData.addressCoordinates || '',
    vip_expiration: (customerData.billingAccount as any)?.vip_expiration || '',
    vip_remarks: (customerData.billingAccount as any)?.vip_remarks || '',
  };
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const BillingListView: React.FC = () => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetailData | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [locationSidebarVisible, setLocationSidebarVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);

  const {
    billingRecords,
    isLoading,
    error,
    fetchBillingRecords,
    refreshLatestData,
    silentRefresh,
  } = useBillingStore();

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadPalette = async () => {
      try {
        setColorPalette(await settingsColorPaletteService.getActive());
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    loadPalette();
  }, []);

  useEffect(() => {
    const fetchLocationData = async () => {
      try {
        const [citiesData, regionsData] = await Promise.all([getCities(), getRegions()]);
        setCities(citiesData || []);
        setRegions(regionsData || []);
      } catch (err) {
        console.error('Failed to fetch location data:', err);
      }
    };
    fetchLocationData();
  }, []);

  useEffect(() => {
    fetchBillingRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      silentRefresh().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [silentRefresh]);

  // ─── Memos ───────────────────────────────────────────────────────────────────

  const locationItems: LocationItem[] = useMemo(() => {
    const items: LocationItem[] = [{ id: 'all', name: 'All', count: billingRecords.length }];
    cities.forEach((city) => {
      const cityCount = billingRecords.filter((r) => r.cityId === city.id).length;
      items.push({ id: String(city.id), name: city.name, count: cityCount });
    });
    return items;
  }, [cities, billingRecords]);

  const filteredBillingRecords = useMemo(() => {
    return billingRecords.filter((record) => {
      const matchesLocation =
        selectedLocation === 'all' || record.cityId === Number(selectedLocation);
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        record.customerName.toLowerCase().includes(q) ||
        record.address.toLowerCase().includes(q) ||
        record.applicationId.includes(searchQuery);
      return matchesLocation && matchesSearch;
    });
  }, [billingRecords, selectedLocation, searchQuery]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleRowPress = async (record: BillingRecord) => {
    try {
      setIsLoadingDetails(true);
      setDetailsModalVisible(true);
      const customerData = await getCustomerDetail(record.applicationId);
      setSelectedCustomer(customerData);
    } catch (err) {
      console.error('Failed to fetch customer details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCloseDetails = () => {
    setDetailsModalVisible(false);
    setSelectedCustomer(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshLatestData();
    } finally {
      setRefreshing(false);
    }
  };

  const handleLocationSelect = (locationId: string) => {
    setSelectedLocation(locationId);
    setLocationSidebarVisible(false);
  };

  // ─── Render Helpers ───────────────────────────────────────────────────────────

  const getBillingStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'Active': return '#16a34a';
      case 'Overdue': return '#dc2626';
      case 'Suspended': return '#d97706';
      case 'Cancelled': return '#6b7280';
      case 'In Progress': return '#2563eb';
      default: return '#6b7280';
    }
  };

  const renderBillingCard = ({ item }: { item: BillingRecord }) => {
    const isOnline = item.onlineStatus === 'Online';
    const isSelected =
      selectedCustomer?.billingAccount?.accountNo === item.applicationId;

    return (
      <TouchableOpacity
        onPress={() => handleRowPress(item)}
        style={[
          styles.card,
          isSelected && { borderColor: primaryColor, borderWidth: 2 },
        ]}
        activeOpacity={0.75}
      >
        {/* Card Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.onlineRow}>
              <Circle
                size={10}
                color={isOnline ? '#16a34a' : '#9ca3af'}
                fill={isOnline ? '#16a34a' : '#9ca3af'}
              />
              <Text style={[styles.onlineLabel, { color: isOnline ? '#16a34a' : '#9ca3af' }]}>
                {item.onlineStatus}
              </Text>
            </View>
            <Text style={styles.accountNo}>{item.applicationId}</Text>
          </View>
          <View>
            <Text
              style={[
                styles.billingStatusBadge,
                { color: getBillingStatusColor(item.billingStatus) },
              ]}
            >
              {item.billingStatus || 'Active'}
            </Text>
          </View>
        </View>

        {/* Name and Plan */}
        <Text style={styles.customerName}>{item.customerName}</Text>
        {item.plan ? (
          <Text style={styles.planLabel}>{item.plan}</Text>
        ) : null}

        {/* Balance row */}
        <View style={styles.cardFooter}>
          <Text style={styles.cardBalance}>
            Balance: <Text style={{ fontWeight: '700' }}>₱{item.balance?.toFixed(2) ?? '0.00'}</Text>
          </Text>
          {item.dateInstalled ? (
            <Text style={styles.cardDate}>Installed: {item.dateInstalled}</Text>
          ) : null}
        </View>

        {/* Address */}
        {item.address ? (
          <Text style={styles.cardAddress} numberOfLines={1}>
            {item.address}
          </Text>
        ) : null}

        {/* Contact */}
        {item.contactNumber ? (
          <Text style={styles.cardMuted}>{item.contactNumber}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  // ─── Location Sidebar Modal ───────────────────────────────────────────────────

  const selectedLocationName =
    locationItems.find((l) => l.id === selectedLocation)?.name || 'All';

  const renderLocationSidebar = () => (
    <Modal
      visible={locationSidebarVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setLocationSidebarVisible(false)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setLocationSidebarVisible(false)}
      >
        <View style={styles.sidebarContainer}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>Filter by City</Text>
            <TouchableOpacity onPress={() => setLocationSidebarVisible(false)}>
              <Text style={styles.sidebarClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {locationItems.map((location) => {
              const isActive = selectedLocation === location.id;
              return (
                <TouchableOpacity
                  key={location.id}
                  onPress={() => handleLocationSelect(location.id)}
                  style={[
                    styles.sidebarItem,
                    isActive && { backgroundColor: `${primaryColor}22` },
                  ]}
                >
                  <View style={styles.sidebarItemLeft}>
                    <CreditCard size={16} color={isActive ? primaryColor : '#6b7280'} />
                    <Text
                      style={[
                        styles.sidebarItemLabel,
                        { color: isActive ? primaryColor : '#374151' },
                      ]}
                    >
                      {location.name}
                    </Text>
                  </View>
                  {location.count > 0 && (
                    <View
                      style={[
                        styles.countBadge,
                        { backgroundColor: isActive ? primaryColor : '#e5e7eb' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.countBadgeText,
                          { color: isActive ? '#ffffff' : '#374151' },
                        ]}
                      >
                        {location.count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  // ─── Details Modal ────────────────────────────────────────────────────────────

  const renderDetailsModal = () => (
    <Modal
      visible={detailsModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCloseDetails}
    >
      {isLoadingDetails ? (
        <View style={styles.detailsLoading}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.detailsLoadingText}>Loading details...</Text>
        </View>
      ) : selectedCustomer ? (
        <BillingDetails
          billingRecord={convertCustomerDataToBillingDetail(selectedCustomer)}
          onlineStatusRecords={[]}
          onClose={handleCloseDetails}
        />
      ) : (
        <View style={styles.detailsLoading}>
          <Text style={{ color: '#6b7280' }}>No data available.</Text>
          <TouchableOpacity onPress={handleCloseDetails} style={styles.closeBtn}>
            <Text style={{ color: primaryColor, fontWeight: '600' }}>Close</Text>
          </TouchableOpacity>
        </View>
      )}
    </Modal>
  );

  // ─── Empty / Error States ─────────────────────────────────────────────────────

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      {isLoading ? (
        <>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.emptyText}>Loading billing records...</Text>
        </>
      ) : error ? (
        <>
          <Text style={[styles.emptyText, { color: '#dc2626' }]}>{error}</Text>
          <TouchableOpacity onPress={handleRefresh} style={[styles.retryBtn, { borderColor: primaryColor }]}>
            <Text style={{ color: primaryColor, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.emptyText}>No billing records found matching your filters</Text>
      )}
    </View>
  );

  // ─── Main Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: isTablet ? 16 : 60 }]}>
        <Text style={styles.headerTitle}>Billing List View</Text>
        <Text style={styles.headerSubtitle}>
          {filteredBillingRecords.length} record{filteredBillingRecords.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Search + Controls Row */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Search size={16} color="#9ca3af" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search billing records..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity
          onPress={() => setLocationSidebarVisible(true)}
          style={[styles.filterBtn, { borderColor: primaryColor }]}
        >
          <CreditCard size={14} color={primaryColor} />
          <Text style={[styles.filterBtnText, { color: primaryColor }]} numberOfLines={1}>
            {selectedLocationName}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleRefresh}
          disabled={isLoading || refreshing}
          style={[styles.refreshBtn, { backgroundColor: primaryColor, opacity: isLoading || refreshing ? 0.6 : 1 }]}
        >
          <Text style={styles.refreshBtnText}>
            {isLoading || refreshing ? 'Loading...' : 'Refresh'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      <FlatList
        data={filteredBillingRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderBillingCard}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[primaryColor]}
            tintColor={primaryColor}
          />
        }
        contentContainerStyle={
          filteredBillingRecords.length === 0
            ? styles.flatListEmpty
            : styles.flatListContent
        }
      />

      {/* Modals */}
      {renderLocationSidebar()}
      {renderDetailsModal()}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    maxWidth: 110,
  },
  filterBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  refreshBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  flatListContent: {
    padding: 12,
    gap: 10,
  },
  flatListEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  cardHeaderLeft: {
    flexDirection: 'column',
    gap: 4,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  accountNo: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '600',
  },
  billingStatusBadge: {
    fontSize: 12,
    fontWeight: '700',
  },
  customerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  planLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 4,
  },
  cardBalance: {
    fontSize: 13,
    color: '#374151',
  },
  cardDate: {
    fontSize: 11,
    color: '#9ca3af',
  },
  cardAddress: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  cardMuted: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 12,
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: 8,
  },
  // Location sidebar modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sidebarContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '75%',
    paddingBottom: 24,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  sidebarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  sidebarClose: {
    fontSize: 15,
    fontWeight: '600',
    color: '#7c3aed',
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  sidebarItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sidebarItemLabel: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  countBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // Details modal
  detailsLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
    gap: 12,
  },
  detailsLoadingText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
  closeBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
});

export default BillingListView;

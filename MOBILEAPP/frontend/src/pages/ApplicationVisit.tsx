import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Dimensions,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FileText, Filter, RefreshCw, ArrowUp, ArrowDown, X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ApplicationVisitDetails from '../components/ApplicationVisitDetails';
import ApplicationVisitFunnelFilter, { FilterValues } from '../filter/ApplicationVisitFunnelFilter';
import { useApplicationVisitContext, type ApplicationVisit } from '../contexts/ApplicationVisitContext';
import { getApplication } from '../services/applicationService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { applyFilters } from '../utils/filterUtils';

interface LocationItem {
  id: string;
  name: string;
  count: number;
}

const formatDate = (dateStr?: string): string => {
  if (!dateStr || dateStr === 'Not scheduled') return dateStr || 'Not scheduled';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return dateStr;
  }
};

const getVisitStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'scheduled':
      return '#16a34a';
    case 'pending':
      return '#ea580c';
    case 'cancelled':
      return '#dc2626';
    default:
      return '#6b7280';
  }
};

const getAppStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'approved':
    case 'done':
    case 'schedule':
    case 'completed':
      return '#16a34a';
    case 'pending':
      return '#ea580c';
    case 'under review':
    case 'in progress':
      return '#2563eb';
    case 'rejected':
    case 'failed':
    case 'cancelled':
      return '#dc2626';
    case 'no facility':
      return '#f87171';
    case 'no slot':
      return '#9333ea';
    case 'duplicate':
      return '#ec4899';
    default:
      return '#6b7280';
  }
};

const isDarkMode = false;
const ITEMS_PER_PAGE = 50;

type SortDir = 'asc' | 'desc';

const SORT_FIELDS = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'visitStatus', label: 'Visit Status' },
  { key: 'applicationStatus', label: 'Application Status' },
  { key: 'createdAt', label: 'Created At' },
];

const getSortValue = (visit: ApplicationVisit, key: string): string => {
  switch (key) {
    case 'timestamp': return visit.timestamp || '';
    case 'fullName': return visit.full_name || '';
    case 'assignedEmail': return visit.assigned_email || '';
    case 'visitStatus': return visit.visit_status || '';
    case 'applicationStatus': return visit.application_status || '';
    case 'referredBy': return visit.referred_by || '';
    case 'visitBy': return visit.visit_by || '';
    case 'createdAt': return visit.created_at || '';
    default: return '';
  }
};

const ApplicationVisitPage: React.FC = () => {
  const { applicationVisits, isLoading, error, refreshApplicationVisits, silentRefresh } = useApplicationVisitContext();

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedVisit, setSelectedVisit] = useState<ApplicationVisit | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterValues>({});
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDir>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  useEffect(() => {
    silentRefresh();
  }, [silentRefresh]);

  // 15-minute auto refresh
  useEffect(() => {
    const intervalId = setInterval(() => {
      silentRefresh().catch((err: any) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [silentRefresh]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLocation, searchQuery, activeFilters, sortColumn, sortDirection]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshApplicationVisits();
    setIsRefreshing(false);
  };

  const handleVisitUpdate = async () => {
    await silentRefresh();
  };

  // Build location items
  const locationItems: LocationItem[] = useMemo(() => {
    const items: LocationItem[] = [{ id: 'all', name: 'All', count: applicationVisits.length }];
    const locationSet = new Set<string>();
    applicationVisits.forEach(visit => {
      const parts = (visit.full_address || '').split(',');
      const city = parts.length > 3 ? parts[3].trim() : '';
      if (city) locationSet.add(city.toLowerCase());
    });
    Array.from(locationSet).sort().forEach(location => {
      items.push({
        id: location,
        name: location.charAt(0).toUpperCase() + location.slice(1),
        count: applicationVisits.filter(v => {
          const parts = (v.full_address || '').split(',');
          const city = parts.length > 3 ? parts[3].trim() : '';
          return city.toLowerCase() === location;
        }).length,
      });
    });
    return items;
  }, [applicationVisits]);

  // Filter + sort pipeline
  const sortedVisits = useMemo(() => {
    let filtered = applicationVisits.filter(visit => {
      const parts = (visit.full_address || '').split(',');
      const city = parts.length > 3 ? parts[3].trim().toLowerCase() : '';
      const matchesLocation = selectedLocation === 'all' || city === selectedLocation;
      const q = searchQuery.toLowerCase();
      const matchesSearch = q === '' ||
        (visit.full_name || '').toLowerCase().includes(q) ||
        (visit.full_address || '').toLowerCase().includes(q) ||
        (visit.assigned_email || '').toLowerCase().includes(q);
      return matchesLocation && matchesSearch;
    });

    filtered = applyFilters(filtered, activeFilters);

    // Pre-sort by id desc
    filtered = [...filtered].sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0));

    if (sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = getSortValue(a, sortColumn).toLowerCase();
        const bVal = getSortValue(b, sortColumn).toLowerCase();
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
  }, [applicationVisits, selectedLocation, searchQuery, activeFilters, sortColumn, sortDirection]);

  const totalPages = Math.ceil(sortedVisits.length / ITEMS_PER_PAGE);

  const paginatedVisits = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedVisits.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedVisits, currentPage]);

  const handleRowPress = async (visit: ApplicationVisit) => {
    try {
      if (!visit.application_status) {
        try {
          const applicationData = await getApplication(visit.application_id);
          setSelectedVisit({ ...visit, application_status: applicationData.status || 'Pending' });
        } catch {
          setSelectedVisit(visit);
        }
      } else {
        setSelectedVisit(visit);
      }
      setDetailsVisible(true);
    } catch (err: any) {
      console.error('Failed to select visit:', err);
    }
  };

  const handleSort = (key: string) => {
    if (sortColumn === key) {
      if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection('asc');
      } else {
        setSortDirection('desc');
      }
    } else {
      setSortColumn(key);
      setSortDirection('asc');
    }
    setSortModalOpen(false);
  };

  const selectedLocationLabel = locationItems.find(l => l.id === selectedLocation)?.name || 'All';
  const activeFilterCount = Object.keys(activeFilters).filter(k => {
    const f = activeFilters[k];
    if (f.type === 'text') return f.value && f.value.trim() !== '';
    if (f.type === 'checklist') return (f.selectedOptions || []).length > 0;
    return f.from !== undefined || f.to !== undefined;
  }).length;

  const renderVisitCard = ({ item }: { item: ApplicationVisit }) => {
    const isSelected = selectedVisit?.id === item.id;
    return (
      <TouchableOpacity
        onPress={() => handleRowPress(item)}
        style={{
          backgroundColor: isSelected ? `${primaryColor}15` : '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 }}>
              {item.full_name}
            </Text>
            <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>
              {formatDate(item.timestamp)}
            </Text>
            <Text style={{ fontSize: 12, color: '#6b7280' }} numberOfLines={2}>
              {item.full_address}
            </Text>
            {item.assigned_email ? (
              <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                {item.assigned_email}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={{
              fontSize: 11,
              fontWeight: '700',
              color: getVisitStatusColor(item.visit_status || 'Scheduled'),
              textTransform: 'uppercase',
            }}>
              {item.visit_status || 'Scheduled'}
            </Text>
            {item.application_status ? (
              <Text style={{
                fontSize: 11,
                fontWeight: '700',
                color: getAppStatusColor(item.application_status),
                textTransform: 'uppercase',
              }}>
                {item.application_status}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb', paddingTop: isTablet ? 16 : 60 }}>
      {/* Header bar */}
      <View style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
      }}>
        {/* Search row */}
        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search visits..."
        />

        {/* Filter controls row */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {/* Location picker button */}
          <TouchableOpacity
            onPress={() => setLocationModalOpen(true)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderWidth: 1,
              borderColor: '#e5e7eb',
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: '#f9fafb',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <FileText size={15} color="#6b7280" />
              <Text style={{ fontSize: 13, color: '#374151' }} numberOfLines={1}>
                {selectedLocationLabel}
              </Text>
            </View>
            <ChevronRight size={14} color="#9ca3af" />
          </TouchableOpacity>

          {/* Sort button */}
          <TouchableOpacity
            onPress={() => setSortModalOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: sortColumn ? `${primaryColor}15` : '#f9fafb',
            }}
          >
            {sortDirection === 'asc' ? (
              <ArrowUp size={15} color={sortColumn ? primaryColor : '#6b7280'} />
            ) : (
              <ArrowDown size={15} color={sortColumn ? primaryColor : '#6b7280'} />
            )}
            <Text style={{ fontSize: 13, color: sortColumn ? primaryColor : '#374151' }}>Sort</Text>
          </TouchableOpacity>

          {/* Funnel filter button */}
          <TouchableOpacity
            onPress={() => setIsFunnelFilterOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              borderWidth: 1,
              borderColor: activeFilterCount > 0 ? primaryColor : '#e5e7eb',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: activeFilterCount > 0 ? `${primaryColor}15` : '#f9fafb',
            }}
          >
            <Filter size={15} color={activeFilterCount > 0 ? primaryColor : '#6b7280'} />
            {activeFilterCount > 0 && (
              <Text style={{ fontSize: 12, color: primaryColor, fontWeight: '600' }}>{activeFilterCount}</Text>
            )}
          </TouchableOpacity>

          {/* Refresh button */}
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={isRefreshing}
            style={{
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: isRefreshing ? '#6b7280' : primaryColor,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RefreshCw size={15} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Stats bar */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>
            {sortedVisits.length} visit{sortedVisits.length !== 1 ? 's' : ''}
            {selectedLocation !== 'all' ? ` in ${selectedLocationLabel}` : ''}
          </Text>
          {totalPages > 1 && (
            <Text style={{ fontSize: 12, color: '#6b7280' }}>
              Page {currentPage} of {totalPages}
            </Text>
          )}
        </View>
      </View>

      {/* List */}
      {isLoading && !isRefreshing ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>Loading application visits...</Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{ backgroundColor: primaryColor, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={paginatedVisits}
          keyExtractor={(item) => item.id}
          renderItem={renderVisitCard}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[primaryColor]}
              tintColor={primaryColor}
            />
          }
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: 'center' }}>
              <FileText size={40} color="#d1d5db" />
              <Text style={{ color: '#6b7280', textAlign: 'center', marginTop: 12, fontSize: 14 }}>
                {applicationVisits.length > 0
                  ? 'No application visits match your filters'
                  : 'No application visits found. Schedule a visit from the Applications page.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 12,
                backgroundColor: '#ffffff',
                borderTopWidth: 1,
                borderTopColor: '#e5e7eb',
              }}>
                <TouchableOpacity
                  onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: currentPage === 1 ? '#f3f4f6' : '#ffffff',
                    borderWidth: 1,
                    borderColor: currentPage === 1 ? '#e5e7eb' : '#d1d5db',
                  }}
                >
                  <ChevronLeft size={16} color={currentPage === 1 ? '#9ca3af' : '#374151'} />
                  <Text style={{ fontSize: 13, color: currentPage === 1 ? '#9ca3af' : '#374151' }}>Prev</Text>
                </TouchableOpacity>

                <Text style={{ fontSize: 13, color: '#374151' }}>
                  {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, sortedVisits.length)} of {sortedVisits.length}
                </Text>

                <TouchableOpacity
                  onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: currentPage === totalPages ? '#f3f4f6' : '#ffffff',
                    borderWidth: 1,
                    borderColor: currentPage === totalPages ? '#e5e7eb' : '#d1d5db',
                  }}
                >
                  <Text style={{ fontSize: 13, color: currentPage === totalPages ? '#9ca3af' : '#374151' }}>Next</Text>
                  <ChevronRight size={16} color={currentPage === totalPages ? '#9ca3af' : '#374151'} />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Location picker modal */}
      <Modal visible={locationModalOpen} animationType="slide" transparent onRequestClose={() => setLocationModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' }}>
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
            }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827' }}>Filter by Location</Text>
              <TouchableOpacity onPress={() => setLocationModalOpen(false)}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {locationItems.map((loc) => {
                const isActive = selectedLocation === loc.id;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    onPress={() => { setSelectedLocation(loc.id); setLocationModalOpen(false); }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 20,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: '#f3f4f6',
                      backgroundColor: isActive ? `${primaryColor}10` : 'transparent',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <FileText size={16} color={isActive ? primaryColor : '#6b7280'} />
                      <Text style={{ fontSize: 15, color: isActive ? primaryColor : '#111827', fontWeight: isActive ? '600' : '400', textTransform: 'capitalize' }}>
                        {loc.name}
                      </Text>
                    </View>
                    <View style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 12,
                      backgroundColor: isActive ? primaryColor : '#f3f4f6',
                    }}>
                      <Text style={{ fontSize: 12, color: isActive ? '#ffffff' : '#6b7280', fontWeight: '500' }}>
                        {loc.count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Sort modal */}
      <Modal visible={sortModalOpen} animationType="slide" transparent onRequestClose={() => setSortModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
            }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827' }}>Sort By</Text>
              <TouchableOpacity onPress={() => setSortModalOpen(false)}>
                <X size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>
            {SORT_FIELDS.map((field) => {
              const isActive = sortColumn === field.key;
              return (
                <TouchableOpacity
                  key={field.key}
                  onPress={() => handleSort(field.key)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 20,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f3f4f6',
                    backgroundColor: isActive ? `${primaryColor}10` : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 15, color: isActive ? primaryColor : '#111827', fontWeight: isActive ? '600' : '400' }}>
                    {field.label}
                  </Text>
                  {isActive && (
                    sortDirection === 'asc'
                      ? <ArrowUp size={16} color={primaryColor} />
                      : <ArrowDown size={16} color={primaryColor} />
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => { setSortColumn(null); setSortDirection('asc'); setSortModalOpen(false); }}
              style={{ paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, color: '#6b7280' }}>Clear Sort</Text>
            </TouchableOpacity>
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* Details modal */}
      <Modal
        visible={detailsVisible && selectedVisit !== null}
        animationType="slide"
        onRequestClose={() => { setDetailsVisible(false); setSelectedVisit(null); }}
      >
        {selectedVisit && (
          <ApplicationVisitDetails
            applicationVisit={selectedVisit}
            onClose={() => { setDetailsVisible(false); setSelectedVisit(null); }}
            onUpdate={handleVisitUpdate}
            isMobile={true}
          />
        )}
      </Modal>

      {/* Funnel filter */}
      <ApplicationVisitFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          setActiveFilters(filters);
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={activeFilters}
      />
    </View>
  );
};

export default ApplicationVisitPage;

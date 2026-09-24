import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, useWindowDimensions, RefreshControl, StyleSheet, DeviceEventEmitter, Linking, Platform } from 'react-native';
import { CircleDollarSign, Calendar, FileText, ArrowLeft, RefreshCw, Landmark, ChevronDown, X } from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { fetchAgentCommissionHistory, fetchAgentIncentiveHistory } from '../services/api';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { JobOrder } from '../types/jobOrder';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAgentReferralMatcher, getOnsiteStatus, isDoneOnsiteStatus, storedReferralOf } from '../utils/agentReferral';

/**
 * A status word in the colour its state calls for.
 *
 * At module scope on purpose. Declared inside the component, every render built
 * a new component type, so React could not match it against the previous one
 * and tore down and rebuilt every status in the list instead of leaving it
 * alone — React.memo around it was worth nothing, because the memo was new too.
 */
const StatusText = React.memo(({ status }: { status?: string | null; type: 'onsite' | 'billing' }) => {
  if (!status) return <Text style={{ color: '#9ca3af' }}>-</Text>;

  let textColor = '';
  switch (status.toLowerCase().trim()) {
    case 'done':
    case 'active':
    case 'completed':
    case 'paid':
    case 'collected':
      textColor = '#4ade80';
      break;
    case 'pending':
    case 'in progress':
    case 'reschedule':
    case 'rescheduled':
      textColor = '#fb923c';
      break;
    case 'suspended':
    case 'overdue':
    case 'unpaid':
    case 'not collected':
    case 'cancelled':
      textColor = '#ef4444';
      break;
    default:
      textColor = '#9ca3af';
  }

  return (
    <Text style={{ fontWeight: 'bold', textTransform: 'capitalize', color: textColor }}>
      {status}
    </Text>
  );
});

// Pure of everything on the screen — they read their arguments and nothing
// else — so they are built once rather than rebuilt on every render.
const checkIsStarted = (time?: string | null) => {
  if (!time) return false;
  const lowerTime = String(time).toLowerCase().trim();
  return !['0000-00-00 00:00:00', 'not set', '-', 'none', '', 'null', 'undefined'].includes(lowerTime);
};

const isWorkStarted = (item: JobOrder) => {
  const hasStart = checkIsStarted(item.start_time) || checkIsStarted(item.StartTimeStamp) || checkIsStarted(item.start_timestamp);
  const hasEnd = checkIsStarted(item.end_time) || checkIsStarted(item.EndTimeStamp) || checkIsStarted(item.end_timestamp);
  return hasStart && !hasEnd;
};

const getClientFullName = (jobOrder: JobOrder): string => {
  return [
    jobOrder.First_Name || jobOrder.first_name || '',
    jobOrder.Middle_Initial || jobOrder.middle_initial ? (jobOrder.Middle_Initial || jobOrder.middle_initial) + '.' : '',
    jobOrder.Last_Name || jobOrder.last_name || ''
  ].filter(Boolean).join(' ').trim() || '-';
};

const getClientFullAddress = (jobOrder: JobOrder): string => {
  const addressParts = [
    jobOrder.Installation_Address || jobOrder.installation_address || jobOrder.Address || jobOrder.address,
    jobOrder.Barangay || jobOrder.barangay,
    jobOrder.City || jobOrder.city,
    jobOrder.Region || jobOrder.region
  ].filter(Boolean);
  return addressParts.length > 0 ? addressParts.join(', ') : '-';
};

const formatDateVal = (dateStr?: string | null): string => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const datePart = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${datePart} ${timePart}`;
  } catch (e) {
    return '-';
  }
};

const AgentHistory: React.FC = () => {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [incentiveHistory, setIncentiveHistory] = useState<any[]>([]);
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [listMode, setListMode] = useState<'all' | 'incentives'>('all');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isListModeOpen, setIsListModeOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());

  const { jobOrders, refreshJobOrders } = useJobOrderContext();
  const [userFullName, setUserFullName] = useState<string>('');
  // A referral made through the picker is stored as this id and holds none of
  // the agent's name, so the id is what finds their own history.
  const [userId, setUserId] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    AsyncStorage.getItem('authData').then(data => {
      if (data) {
        try {
          const ud = JSON.parse(data);
          setUserFullName(ud.full_name || '');
          setUserId(ud.id ?? ud.user_id ?? null);
          setUserEmail(ud.email || '');
        } catch (e) { }
      }
    });
  }, []);

  const agentJobOrders = useMemo(() => {
    // Everything that does not vary per job order is worked out here rather than
    // inside the filter: the agent's own half of the ownership test (see
    // createAgentReferralMatcher), and the two day boundaries, which were being
    // rebuilt through dayjs on every row the filter looked at.
    const ownsReferral = createAgentReferralMatcher(userFullName, userEmail, userId);
    const from = dateFrom ? dayjs(dateFrom).startOf('day').valueOf() : null;
    const to = dateTo ? dayjs(dateTo).endOf('day').valueOf() : null;

    return jobOrders.filter(jo => {
      // The stored value (an agent id for picker-made referrals), not the
      // display name the API resolved it to.
      if (!ownsReferral(storedReferralOf(jo))) return false;

      // Only completed ("done") job orders belong in Agent History.
      if (!isDoneOnsiteStatus(getOnsiteStatus(jo))) return false;

      if (filterType !== 'all') {
        const cStatus = (!jo.commission_status || String(jo.commission_status).toLowerCase() === 'null' ? 'unpaid' : String(jo.commission_status).toLowerCase().trim());
        if (filterType === 'unpaid' && cStatus !== 'unpaid') return false;
        if (filterType === 'paid' && cStatus !== 'paid' && cStatus !== 'done') return false;
      }

      if (from !== null || to !== null) {
        const raw = jo.created_at || (jo as any).Created_At || jo.Timestamp || jo.timestamp;
        const stamp = raw ? new Date(raw).getTime() : NaN;
        if (isNaN(stamp)) return false;
        if (from !== null && stamp < from) return false;
        if (to !== null && stamp > to) return false;
      }
      return true;
    }).sort((a, b) => (parseInt(String(b.id)) || 0) - (parseInt(String(a.id)) || 0));
  }, [jobOrders, userId, userFullName, userEmail, filterType, dateFrom, dateTo]);

  const incentivesBatches = useMemo(() => {
    // Group by processed_at
    const groups: { [key: string]: any[] } = {};
    incentiveHistory.forEach(item => {
      const key = item.processed_at;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    // The job orders indexed by id, once.
    //
    // Each incentive names the job order it was earned on, and every one of them
    // used to be resolved with a `jobOrders.find(...)` — a fresh walk of the
    // whole set per incentive, so an agent with a long history paid for their
    // incentive count times their job order count. Keyed by String(id) because
    // the ids arrive as numbers from one source and strings from the other, and
    // the lookup this replaces compared them loosely.
    const jobOrderById = new Map<string, any>();
    for (const jo of jobOrders) jobOrderById.set(String(jo.id), jo);

    const batches = [];
    let batchIndex = 1;
    // Sort groups by processed_at descending
    const sortedKeys = Object.keys(groups).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    for (const key of sortedKeys) {
      const items = groups[key];
      const customers = items.map((incItem: any) => {
        // match job order by id
        const jo = jobOrderById.get(String(incItem.job_order_id));
        if (jo) return jo;
        // fallback if job order not in context
        return {
          id: incItem.job_order_id,
          First_Name: 'Unknown',
          Last_Name: 'Customer',
          Timestamp: incItem.processed_at
        };
      });

      const quota = items[0]?.quota_reached || 10;

      batches.push({
        id: `batch-${key}-${batchIndex}`,
        batchNumber: batchIndex++,
        customers,
        isComplete: customers.length >= quota,
        quota,
        incentiveValue: items[0]?.incentive_value || 0,
        processedAt: key
      });
    }

    return batches;
  }, [incentiveHistory, jobOrders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [listMode, filterType, dateFrom, dateTo]);

  const fetchHistoryData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      // Fetch all commission history to populate the top stats correctly
      const response = await fetchAgentCommissionHistory('all');
      if (response.success) {
        setCurrentPage(1);
      } else {
        setError(response.message || 'Failed to fetch commission history');
      }

      // Fetch incentive history
      const incResponse = await fetchAgentIncentiveHistory();
      let incData = [];
      if (incResponse.success) {
        incData = incResponse.data || [];
      }

      setIncentiveHistory(incData);
    } catch (err: any) {
      console.error('Error fetching commission history:', err);
      setError(err.message || 'Error connecting to server. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHistoryData();
  }, [fetchHistoryData]);

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

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => paletteSub.remove();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistoryData(true);
    refreshJobOrders();
  }, [fetchHistoryData, refreshJobOrders]);

  const formatCurrency = useCallback((amount: number | string) => {
    const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numericAmount)) return '₱0.00';
    return `₱${numericAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const totalPages = useMemo(() => {
    if (listMode === 'incentives') {
      return Math.ceil(incentivesBatches.length / 5);
    }
    return Math.ceil(agentJobOrders.length / 5);
  }, [agentJobOrders.length, incentivesBatches.length, listMode]);

  const paginatedJobOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * 5;
    if (listMode === 'incentives') {
      return incentivesBatches.slice(startIndex, startIndex + 5);
    }
    return agentJobOrders.slice(startIndex, startIndex + 5);
  }, [agentJobOrders, incentivesBatches, currentPage, listMode]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  }, [totalPages]);

  const renderFooter = () => {
    if (totalPages <= 1) return null;

    return (
      <View style={styles.paginationContainer}>
        <Pressable
          onPress={() => handlePageChange(currentPage - 1)}
          disabled={currentPage === 1}
          style={[
            styles.pageButton,
            {
              backgroundColor: currentPage === 1 ? '#f1f5f9' : '#ffffff',
              borderColor: currentPage === 1 ? 'transparent' : '#cbd5e1',
            }
          ]}
        >
          <Text style={[styles.pageButtonText, { color: currentPage === 1 ? '#94a3b8' : '#334155' }]}>
            Back
          </Text>
        </Pressable>

        <Text style={styles.pageIndicator}>
          Page {currentPage} of {totalPages}
        </Text>

        <Pressable
          onPress={() => handlePageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          style={[
            styles.pageButton,
            {
              backgroundColor: currentPage === totalPages ? '#f1f5f9' : '#ffffff',
              borderColor: currentPage === totalPages ? 'transparent' : '#cbd5e1',
            }
          ]}
        >
          <Text style={[styles.pageButtonText, { color: currentPage === totalPages ? '#94a3b8' : '#334155' }]}>
            Next
          </Text>
        </Pressable>
      </View>
    );
  };

  const handleOpenProof = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        // Fallback or alert if cannot open
        console.warn('Cannot open proof of payment URL:', url);
      }
    } catch (err) {
      console.error('Failed to open proof of payment link:', err);
    }
  }, []);

  const renderJobOrderItem = useCallback(({ item: jobOrder }: { item: JobOrder }) => {
    const rawStatus = String(jobOrder.commission_status || '').toLowerCase().trim();
    const displayStatus = (!jobOrder.commission_status || rawStatus === 'null' || rawStatus === 'unpaid' ? 'Not Collected' : 'Collected');
    const onsiteStatus = jobOrder.Onsite_Status || jobOrder.onsite_status || null;

    return (
      <View style={[styles.card, { padding: 0 }]}>
        <View style={styles.joCardInner}>
          <View style={styles.joCardLeft}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
              <Text style={[styles.joCardName, { color: '#111827', marginBottom: 0 }]}>
                {getClientFullName(jobOrder)}
              </Text>
              {isWorkStarted(jobOrder) && (
                <View style={{ backgroundColor: '#dcfce7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ color: '#15803d', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' }}>
                    Work Started
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.joCardSub, { color: '#4b5563' }]} numberOfLines={2}>
              {formatDateVal(jobOrder.Timestamp || jobOrder.timestamp)} | {getClientFullAddress(jobOrder)}
            </Text>
            <Text style={[styles.joCardSub, { color: '#6b7280', marginTop: 4 }]}>
              Fee: {formatCurrency(jobOrder.Installation_Fee || jobOrder.installation_fee || 0)}
            </Text>
          </View>
          <View style={styles.joCardRight}>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.joStatusCaption}>Installation Status</Text>
              <StatusText status={onsiteStatus} type="onsite" />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.joStatusCaption}>Commission</Text>
              <StatusText status={displayStatus} type="billing" />
            </View>
          </View>
        </View>
      </View>
    );
  }, [formatCurrency]);

  const toggleBatch = useCallback((batchId: string) => {
    setExpandedBatches(prev => ({
      ...prev,
      [batchId]: !prev[batchId]
    }));
  }, []);

  const renderIncentiveBatch = useCallback(({ item }: { item: any }) => {
    const isExpanded = expandedBatches[item.id] === true; // closed by default

    return (
      <View style={[styles.card, { padding: 16 }]}>
        <Pressable
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? 12 : 0 }}
          onPress={() => toggleBatch(item.id)}
        >
          <View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b' }}>
              Incentive Batch #{item.batchNumber}
            </Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Processed: {formatDateVal(item.processedAt)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6, flexDirection: 'row' }}>
            <View style={{ alignItems: 'flex-end', gap: 6, marginRight: 8 }}>
              <View style={{ backgroundColor: item.isComplete ? '#dcfce7' : '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                <Text style={{ color: item.isComplete ? '#15803d' : '#b45309', fontSize: 12, fontWeight: 'bold' }}>
                  {item.customers.length} / {item.quota}
                </Text>
              </View>
              <Text style={{ color: '#16a34a', fontSize: 14, fontWeight: '800' }}>
                {formatCurrency(item.incentiveValue)}
              </Text>
            </View>
            <ChevronDown
              size={20}
              color="#64748b"
              style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
            />
          </View>
        </Pressable>

        {isExpanded && (
          <View style={{ gap: 8 }}>
            {item.customers.map((customer: JobOrder, idx: number) => (
              <View key={customer.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: (colorPalette?.primary || '#7c3aed') + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colorPalette?.primary || '#7c3aed', fontSize: 12, fontWeight: '600' }}>
                    {idx + 1}
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 12, borderRadius: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#334155' }}>
                    {customer.First_Name || customer.first_name || ''} {customer.Last_Name || customer.last_name || ''}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    ID: {customer.id} • Date: {formatDateVal(customer.Timestamp || customer.created_at || customer.processed_at)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }, [expandedBatches, toggleBatch, formatCurrency, colorPalette]);

  const renderHeader = () => {
    return (
      <View style={styles.headerContainer}>
        <Text style={styles.sectionTitleCentered}>History</Text>
        <View style={styles.filterRow}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', zIndex: 100 }}>
            {/* List Mode Dropdown */}
            <View style={{ position: 'relative', zIndex: 101 }}>
              <Pressable
                onPress={() => { setIsListModeOpen(!isListModeOpen); setIsFilterOpen(false); setIsDateOpen(false); }}
                style={styles.dropdownBtn}
              >
                <Text style={styles.dropdownBtnText}>
                  {listMode === 'all' ? 'All Types' : 'Incentives'}
                </Text>
                <ChevronDown size={14} color="#64748b" />
              </Pressable>

              {isListModeOpen && (
                <View style={styles.dropdownMenu}>
                  {(['all', 'incentives'] as const).map((mode) => (
                    <Pressable
                      key={mode}
                      onPress={() => {
                        setListMode(mode);
                        setIsListModeOpen(false);
                      }}
                      style={[
                        styles.dropdownItem,
                        listMode === mode && { backgroundColor: (colorPalette?.primary || '#7c3aed') + '10' }
                      ]}
                    >
                      <Text style={[
                        styles.dropdownItemText,
                        listMode === mode && { color: colorPalette?.primary || '#7c3aed', fontWeight: '700' }
                      ]}>
                        {mode === 'all' ? 'All Types' : 'Incentives'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Status Filter Dropdown */}
            {listMode === 'all' && (
              <View style={{ position: 'relative', zIndex: 100 }}>
                <Pressable
                  onPress={() => { setIsFilterOpen(!isFilterOpen); setIsListModeOpen(false); setIsDateOpen(false); }}
                  style={styles.dropdownBtn}
                >
                  <Text style={styles.dropdownBtnText}>
                    {filterType === 'all' ? 'All Status' :
                      filterType === 'unpaid' ? 'Not Collected' :
                        filterType === 'paid' ? 'Collected' : 'All Status'}
                  </Text>
                  <ChevronDown size={14} color="#64748b" />
                </Pressable>

                {isFilterOpen && (
                  <View style={styles.dropdownMenu}>
                    {(['all', 'unpaid', 'paid'] as const).map((filter) => (
                      <Pressable
                        key={filter}
                        onPress={() => {
                          setFilterType(filter);
                          setIsFilterOpen(false);
                        }}
                        style={[
                          styles.dropdownItem,
                          filterType === filter && { backgroundColor: (colorPalette?.primary || '#7c3aed') + '10' }
                        ]}
                      >
                        <Text style={[
                          styles.dropdownItemText,
                          filterType === filter && { color: colorPalette?.primary || '#7c3aed', fontWeight: '700' }
                        ]}>
                          {filter === 'all' ? 'All Status' : filter === 'unpaid' ? 'Not Collected' : 'Collected'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Date Range Filter */}
            <View style={{ position: 'relative', zIndex: 99 }}>
              <Pressable
                onPress={() => { setIsDateOpen(!isDateOpen); setIsFilterOpen(false); setIsListModeOpen(false); }}
                style={styles.dropdownBtn}
              >
                <Calendar size={14} color="#64748b" />
                <Text style={styles.dropdownBtnText}>
                  {dateFrom || dateTo
                    ? `${dateFrom ? dayjs(dateFrom).format('MMM D') : 'Any'} - ${dateTo ? dayjs(dateTo).format('MMM D') : 'Any'}`
                    : 'All Dates'}
                </Text>
                <ChevronDown size={14} color="#64748b" />
              </Pressable>

              {isDateOpen && (
                <View style={[styles.dropdownMenu, { minWidth: 200 }]}>
                  <Pressable
                    onPress={() => setShowDatePicker('from')}
                    style={styles.dropdownItem}
                  >
                    <Text style={styles.dropdownItemText}>
                      From: {dateFrom ? dayjs(dateFrom).format('MMM D, YYYY') : 'Any'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setShowDatePicker('to')}
                    style={styles.dropdownItem}
                  >
                    <Text style={styles.dropdownItemText}>
                      To: {dateTo ? dayjs(dateTo).format('MMM D, YYYY') : 'Any'}
                    </Text>
                  </Pressable>
                  {(dateFrom || dateTo) && (
                    <Pressable
                      onPress={() => { setDateFrom(null); setDateTo(null); setIsDateOpen(false); }}
                      style={[styles.dropdownItem, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                    >
                      <X size={14} color="#ef4444" />
                      <Text style={[styles.dropdownItemText, { color: '#ef4444', fontWeight: '700' }]}>Clear</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={(showDatePicker === 'from' ? dateFrom : dateTo) || new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(event, selectedDate) => {
              const picker = showDatePicker;
              setShowDatePicker(null);
              if (event.type === 'set' && selectedDate) {
                if (picker === 'from') setDateFrom(selectedDate);
                else setDateTo(selectedDate);
              }
            }}
          />
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>


      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colorPalette?.primary || '#7c3aed'} />
          <Text style={styles.loadingText}>Fetching commission history...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => fetchHistoryData()}
            style={[styles.retryButton, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={paginatedJobOrders}
          keyExtractor={(item) => String(item.id)}
          renderItem={listMode === 'incentives' ? renderIncentiveBatch : renderJobOrderItem}
          ListHeaderComponent={renderHeader}
          ListHeaderComponentStyle={{ zIndex: 1000, elevation: 1000 }}
          ListFooterComponent={renderFooter}
          contentContainerStyle={[
            styles.listContainer,
            {
              paddingBottom: isMobile ? 120 : 40,
              // A payout card is a name on the left and a figure on the right.
              // Given a tablet's full width the two end up a hand's span apart
              // with nothing between them, so the list is held to a phone-like
              // column and centred instead.
              width: '100%',
              maxWidth: 640,
              alignSelf: 'center',
            }
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colorPalette?.primary || '#7c3aed']}
              tintColor={colorPalette?.primary || '#7c3aed'}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <CircleDollarSign size={48} color="#94a3b8" />
              <Text style={styles.emptyText}>No payout history found</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 15,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  headerContainer: {
    marginBottom: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 16,
    padding: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  statIcon: {
    marginBottom: 8,
    opacity: 0.9,
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 8,
  },
  sectionTitleCentered: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'center',
  },
  filterRow: {
    alignItems: 'center',
    zIndex: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#16a34a',
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 12,
  },
  cardBody: {
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoValue: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  remarksContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  remarksLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  remarksText: {
    fontSize: 13,
    color: '#334155',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#dcfce7',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16803d',
  },
  proofButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  proofButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#94a3b8',
    fontWeight: '500',
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  pageButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  pageButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pageIndicator: {
    fontSize: 14,
    fontWeight: '500',
    color: '#475569',
  },
  sectionHeaderBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, zIndex: 10 },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  dropdownBtnText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  dropdownMenu: { position: 'absolute', top: 38, right: 0, backgroundColor: '#ffffff', borderRadius: 12, padding: 4, minWidth: 120, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5, zIndex: 1000, borderWidth: 1, borderColor: '#f1f5f9' },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  dropdownItemText: { fontSize: 12, color: '#64748b' },
  joCardInner: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 16 },
  joCardLeft: { flex: 1, minWidth: 0 },
  joCardName: { fontWeight: '500', fontSize: 14, marginBottom: 4 },
  joCardSub: { fontSize: 12 },
  joCardRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 8, marginLeft: 16, flexShrink: 0 },
  joStatusCaption: { fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
});

export default AgentHistory;

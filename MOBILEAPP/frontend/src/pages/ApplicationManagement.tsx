import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Animated,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
  ScrollView,
  Linking,
  AppState,
  AppStateStatus,
  Platform,
} from 'react-native';
import {
  Filter,
  Menu,
  Download,
  RefreshCw,
  X,
  ExternalLink,
  ChevronDown,
  LogOut,
  Calendar,
} from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobalSearch from './globalfunctions/GlobalSearch';
import ApplicationDetails from '../components/ApplicationDetails';
import AddApplicationModal from '../modals/AddApplicationModal';
import ApplicationFunnelFilter, {
  allColumns as filterColumns,
  FilterValues,
} from '../filter/ApplicationFunnelFilter';
import { useApplicationStore } from '../store/applicationStore';
import { Application } from '../types/application';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { exportToCSV } from '../utils/exportUtils';
import pusher from '../services/pusherService';
import apiClient from '../config/api';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatDate = (dateString?: string): string => {
  if (!dateString || dateString === '-' || dateString === 'N/A') return dateString || '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${date.getFullYear()}`;
  } catch {
    return dateString;
  }
};

/** `YYYY-MM-DD`, matching the value shape of the web `<input type="date">`. */
const toIsoDay = (date: Date): string => {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

const parseIsoDay = (value: string): Date => {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getStatusColor = (status: string): string => {
  const s = (status || '').toLowerCase();
  if (s === 'schedule' || s === 'scheduled' || s === 'confirmed' || s === 'completed') return '#16a34a';
  if (s === 'no facility' || s === 'cancelled') return '#dc2626';
  if (s === 'no slot') return '#9333ea';
  if (s === 'duplicate') return '#db2777';
  if (s === 'in progress') return '#2563eb';
  if (s === 'pending') return '#ea580c';
  if (s === 'empty') return '#9ca3af';
  return '#6b7280';
};

const getStatusDotColor = (statusId: string): string => {
  const val = statusId.replace('status:', '');
  if (val === 'scheduled' || val === 'confirmed') return '#16a34a';
  if (val === 'no slot') return '#9333ea';
  if (val === 'no facility' || val === 'cancelled') return '#dc2626';
  if (val === 'duplicate') return '#db2777';
  if (val === 'pending') return '#ea580c';
  return '#9ca3af';
};


/**
 * Same columns/labels/order as the web table. `width` is the pixel equivalent of the
 * web `min-w-*` Tailwind class (min-w-28 → 7rem → 112px, …) so the table view lines up
 * with the desktop one.
 */
const allColumns: { key: string; label: string; width: number }[] = [
  { key: 'timestamp', label: 'Timestamp', width: 160 },
  { key: 'status', label: 'Status', width: 112 },
  { key: 'customerName', label: 'Customer Name', width: 192 },
  { key: 'firstName', label: 'First Name', width: 128 },
  { key: 'middleInitial', label: 'Middle Initial', width: 112 },
  { key: 'lastName', label: 'Last Name', width: 128 },
  { key: 'emailAddress', label: 'Email Address', width: 192 },
  { key: 'mobileNumber', label: 'Mobile Number', width: 144 },
  { key: 'secondaryMobileNumber', label: 'Secondary Mobile Number', width: 160 },
  { key: 'installationAddress', label: 'Installation Address', width: 224 },
  { key: 'landmark', label: 'Landmark', width: 128 },
  { key: 'region', label: 'Region', width: 112 },
  { key: 'city', label: 'City', width: 112 },
  { key: 'barangay', label: 'Barangay', width: 128 },
  { key: 'desiredPlan', label: 'Desired Plan', width: 144 },
  { key: 'promo', label: 'Promo', width: 112 },
  { key: 'referredBy', label: 'Referred By', width: 128 },
  { key: 'createDate', label: 'Create Date', width: 128 },
  { key: 'createTime', label: 'Create Time', width: 112 },
];

const STORAGE_KEYS = {
  itemsPerPage: 'applicationManagementItemsPerPage',
  funnelFilters: 'applicationFunnelFilters',
};

const renderCellValue = (application: Application, columnKey: string): string => {
  const app = application as any;
  switch (columnKey) {
    case 'timestamp':
      return app.create_date && app.create_time
        ? `${formatDate(app.create_date)} ${app.create_time}`
        : formatDate(app.timestamp) || '-';
    case 'status': return app.status || '-';
    case 'customerName': return application.customer_name || '-';
    case 'firstName': return app.first_name || '-';
    case 'middleInitial': return app.middle_initial || '-';
    case 'lastName': return app.last_name || '-';
    case 'emailAddress': return app.email_address || '-';
    case 'mobileNumber': return app.mobile_number || '-';
    case 'secondaryMobileNumber': return app.secondary_mobile_number || '-';
    case 'installationAddress': return app.installation_address || app.address || '-';
    case 'landmark': return app.landmark || '-';
    case 'region': return app.region || '-';
    case 'city': return app.city || '-';
    case 'barangay': return app.barangay || '-';
    case 'desiredPlan': return app.desired_plan || '-';
    case 'promo': return app.promo || '-';
    case 'referredBy': return app.referred_by || '-';
    case 'createDate': return formatDate(app.create_date) || '-';
    case 'createTime': return app.create_time || '-';
    default: return '-';
  }
};

// ─── props ────────────────────────────────────────────────────────────────────

interface ApplicationManagementProps {
  onNavigate?: (section: string, extra?: string) => void;
  onLogout?: () => void;
}

// ─── component ────────────────────────────────────────────────────────────────

const ApplicationManagement: React.FC<ApplicationManagementProps> = ({ onNavigate, onLogout }) => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  // ── state ─────────────────────────────────────────────────────────────────
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const [currentUserRoleId, setCurrentUserRoleId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [funnelFilters, setFunnelFilters] = useState<FilterValues>({});
  const [timestampFrom, setTimestampFrom] = useState('');
  const [timestampTo, setTimestampTo] = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);


  const [isSidebarVisible, setIsSidebarVisible] = useState(false);
  const [sidebarRendered, setSidebarRendered] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFunnelFilterOpen, setIsFunnelFilterOpen] = useState(false);
  const [isRefreshingManual, setIsRefreshingManual] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasNewData, setHasNewData] = useState(false);
  const [showSessionExpired, setShowSessionExpired] = useState(false);
  const [viewers, setViewers] = useState<Record<string, string[]>>({});

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const selectedApplicationRef = useRef<Application | null>(null);
  const knownCountRef = useRef<number>(0);
  const hasCountBaselineRef = useRef<boolean>(false);
  const cardListRef = useRef<FlatList<Application>>(null);
  const sidebarSlideX = useRef(new Animated.Value(-width)).current;
  const sidebarBackdrop = useRef(new Animated.Value(0)).current;

  const {
    applications,
    isLoading,
    error,
    fetchApplications,
    refreshApplications,
    silentRefresh,
    isFullyLoaded,
    totalCount,
  } = useApplicationStore();

  const primary = colorPalette?.primary || '#7c3aed';

  // ── bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => { });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('authData').then((raw) => {
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        setCurrentUserOrgId(
          d.organization_id || d.user?.organization_id || d.organization?.id || d.user?.organization?.id || null
        );
        setCurrentUserRoleId(Number(d.role_id) || Number(d.user?.role_id) || null);
        setCurrentUserRole((d.role || d.user?.role || '').toLowerCase());
        setUserEmail(d.email || d.user?.email || '');
      } catch { /* ignore */ }
    });
  }, []);

  // Hydrate persisted view preferences (AsyncStorage is async, unlike web localStorage).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [savedFilters, savedPerPage] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.funnelFilters),
          AsyncStorage.getItem(STORAGE_KEYS.itemsPerPage),
        ]);
        if (!active) return;
        if (savedFilters) setFunnelFilters(JSON.parse(savedFilters));
        if (savedPerPage) {
          const parsed = Number(savedPerPage);
          if ([10, 25, 50, 100].includes(parsed)) setItemsPerPage(parsed);
        }
      } catch (err) {
        console.error('[ApplicationManagement] Failed to load saved view preferences:', err);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (applications.length === 0) fetchApplications();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ref in sync
  useEffect(() => {
    selectedApplicationRef.current = selectedApplication;
  }, [selectedApplication]);

  // Auto-update selected app when store updates (from polling / real-time)
  useEffect(() => {
    if (selectedApplicationRef.current && applications.length > 0) {
      const updated = applications.find((r) => r.id === selectedApplicationRef.current?.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedApplicationRef.current)) {
        setSelectedApplication(updated);
      }
    }
  }, [applications]);

  // Flag newly-arrived records so the refresh button can show the "new data" dot.
  useEffect(() => {
    if (!hasCountBaselineRef.current) {
      hasCountBaselineRef.current = true;
      knownCountRef.current = applications.length;
      return;
    }
    if (applications.length > knownCountRef.current) setHasNewData(true);
    knownCountRef.current = applications.length;
  }, [applications.length]);

  // Session expiry — the store surfaces the auth failure through `error`.
  useEffect(() => {
    if (error && (error.includes('401') || error.toLowerCase().includes('unauthorized'))) {
      setShowSessionExpired(true);
    }
  }, [error]);

  // ── real-time (Soketi/Pusher) ─────────────────────────────────────────────
  // `pusherService` is an RN-safe stub today, so these callbacks never fire and the
  // polling below is what actually keeps the list fresh. The wiring matches the web
  // screen so restoring `pusher-js` in the mobile app turns real-time back on with no
  // change here.

  useEffect(() => {
    const channel = pusher.subscribe('applications');

    channel.bind('new-application', async (data: any) => {
      if (currentUserOrgId) {
        if (data.organization_id !== currentUserOrgId) return;
      } else if (data.organization_id) {
        return;
      }

      setHasNewData(true);

      const appId = data.id || (data.application && data.application.id);
      if (appId) {
        try {
          const { getApplication } = await import('../services/applicationService');
          const fullApp = await getApplication(String(appId));
          useApplicationStore.getState().addNotificationRecord(fullApp);
        } catch (err) {
          console.warn('[ApplicationManagement] Failed to fetch new application, falling back to refresh:', err);
        }
      }

      try {
        await silentRefresh();
      } catch (err) {
        console.error('[ApplicationManagement] Silent refresh failed:', err);
      }
    });

    return () => {
      channel.unbind('new-application');
      pusher.unsubscribe('applications');
    };
  }, [silentRefresh, currentUserOrgId]);

  // Presence channel — who is viewing which application.
  useEffect(() => {
    const presenceChannel = pusher.subscribe('presence-applications-presence');

    presenceChannel.bind('viewing-update', (data: { applicationId: string; username: string; action: string }) => {
      setViewers((prev) => {
        const current = prev[data.applicationId] || [];
        if (data.action === 'started_viewing') {
          if (!current.includes(data.username)) {
            return { ...prev, [data.applicationId]: [...current, data.username] };
          }
        } else if (data.action === 'stopped_viewing') {
          return { ...prev, [data.applicationId]: current.filter((n) => n !== data.username) };
        }
        return prev;
      });
    });

    presenceChannel.bind('pusher:member_removed', (member: any) => {
      const identifier = member?.info?.username || member?.info?.email;
      if (!identifier) return;
      setViewers((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((appId) => {
          next[appId] = (next[appId] || []).filter((n) => n !== identifier);
        });
        return next;
      });
    });

    presenceChannel.bind('pusher:member_added', () => {
      // Re-announce what we are looking at so the joining member sees it.
      if (selectedApplicationRef.current) {
        apiClient
          .post('/applications/broadcast-viewing', {
            application_id: selectedApplicationRef.current.id,
            action: 'started_viewing',
          })
          .catch((err) => console.error('[Presence] Failed to re-broadcast viewing state:', err));
      }
    });

    return () => {
      presenceChannel.unbind();
      pusher.unsubscribe('presence-applications-presence');
    };
  }, []);

  // ── polling + idle refresh ────────────────────────────────────────────────
  // Web polls every 3s unconditionally. Here the timer is gated on AppState so a
  // backgrounded phone is not polling the API on cellular data.

  useEffect(() => {
    const POLLING_INTERVAL = 3000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        silentRefresh().catch((err) => console.error('[ApplicationManagement] Polling failed:', err));
      }, POLLING_INTERVAL);
    };

    const stop = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };

    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        silentRefresh().catch(() => { });
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [silentRefresh]);

  // Idle auto-refresh — a full refresh every 15 minutes of no interaction.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(function tick() {
      silentRefresh()
        .catch((err) => console.error('[ApplicationManagement] Idle refresh failed:', err))
        .finally(() => {
          idleTimerRef.current = setTimeout(tick, 15 * 60 * 1000);
        });
    }, 15 * 60 * 1000);
  }, [silentRefresh]);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  // Slide the status drawer in from the left, out to the left — same motion as
  // ApplicationFunnelFilter, mirrored because this one is anchored to the left edge.
  useEffect(() => {
    if (isSidebarVisible) {
      setSidebarRendered(true);
      Animated.parallel([
        Animated.timing(sidebarSlideX, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(sidebarBackdrop, { toValue: 0.4, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(sidebarSlideX, { toValue: -width, duration: 220, useNativeDriver: true }),
        Animated.timing(sidebarBackdrop, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setSidebarRendered(false);
      });
    }
  }, [isSidebarVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── refresh ───────────────────────────────────────────────────────────────

  // Pull-to-refresh pulls only what changed since the last sync. Re-downloading all
  // ~10k records on every pull is what made this feel like a cold start; `silentRefresh`
  // falls back to a full load on its own when there is nothing cached yet.
  const onRefresh = async () => {
    setRefreshing(true);
    setHasNewData(false);
    try { await silentRefresh(); } finally { setRefreshing(false); }
  };

  const handleManualRefresh = async () => {
    setIsRefreshingManual(true);
    setHasNewData(false);
    try { await refreshApplications(); } finally { setIsRefreshingManual(false); }
  };

  // ── filtering ─────────────────────────────────────────────────────────────

  const isSuperUser = useMemo(
    () =>
      currentUserRoleId === 1 ||
      currentUserRoleId === 7 ||
      currentUserRoleId === 8 ||
      currentUserRole === 'administrator' ||
      currentUserRole === 'superadmin' ||
      currentUserRole === 'headtech',
    [currentUserRoleId, currentUserRole]
  );

  const globalFilteredApplications = useMemo(() => {
    return applications.filter((application) => {
      if (!isSuperUser && currentUserOrgId) {
        if ((application as any).organization_id !== currentUserOrgId) return false;
      } else if (!isSuperUser && !currentUserOrgId) {
        if ((application as any).organization_id) return false;
      }

      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      const checkValue = (val: any): boolean => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return Object.values(val).some((v) => checkValue(v));
        return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
      };
      if (searchQuery !== '' && !checkValue(application)) return false;

      for (const [key, filter] of Object.entries(funnelFilters)) {
        const appValue = (application as any)[key];
        const tf = filter as any;

        if (tf.type === 'text' && tf.value !== undefined && tf.value !== '') {
          if (!String(appValue || '').toLowerCase().includes(String(tf.value).toLowerCase())) return false;
        } else if (tf.type === 'number') {
          const numValue = parseFloat(appValue);
          if (!isNaN(numValue)) {
            if (tf.from !== undefined && tf.from !== '' && numValue < parseFloat(tf.from)) return false;
            if (tf.to !== undefined && tf.to !== '' && numValue > parseFloat(tf.to)) return false;
          } else if ((tf.from !== undefined && tf.from !== '') || (tf.to !== undefined && tf.to !== '')) {
            return false;
          }
        } else if (tf.type === 'date') {
          if (appValue) {
            const dv = new Date(appValue).getTime();
            if (!isNaN(dv)) {
              if (tf.from && dv < new Date(tf.from).getTime()) return false;
              if (tf.to && dv > new Date(tf.to).getTime() + 86400000) return false;
            } else { return false; }
          } else if (tf.from || tf.to) { return false; }
        } else if (tf.type === 'boolean' && tf.value !== undefined && tf.value !== '') {
          const bv = appValue === true || appValue === 'true' || appValue === 1;
          if (bv !== tf.value) return false;
        } else if (tf.type === 'checklist' && tf.selectedOptions && tf.selectedOptions.length > 0) {
          let appVal = (application as any)[key];
          if (key === 'status') {
            let st = String(appVal || '').toLowerCase();
            if (!appVal || String(appVal).trim() === '') st = 'empty';
            appVal = st === 'schedule' ? 'scheduled' : st;
          }
          const normVal = String(appVal || '').toLowerCase().trim();
          const isMatch = tf.selectedOptions.some((opt: string) => {
            const fv = String(opt).toLowerCase().trim();
            if (['status', 'barangay', 'city', 'region', 'terms_agreed', 'desired_plan', 'desiredPlan'].includes(key)) {
              return normVal === fv;
            }
            return normVal.includes(fv);
          });
          if (!isMatch) return false;
        }
      }

      // Timestamp date range filter
      if (timestampFrom || timestampTo) {
        const dateValueStr = (application as any).timestamp;
        if (!dateValueStr) return false;
        const dv = new Date(dateValueStr).getTime();
        if (isNaN(dv)) return false;
        if (timestampFrom) {
          const fd = parseIsoDay(timestampFrom);
          fd.setHours(0, 0, 0, 0);
          if (dv < fd.getTime()) return false;
        }
        if (timestampTo) {
          const td = parseIsoDay(timestampTo);
          td.setHours(23, 59, 59, 999);
          if (dv > td.getTime()) return false;
        }
      }

      return true;
    });
  }, [applications, searchQuery, funnelFilters, timestampFrom, timestampTo, isSuperUser, currentUserOrgId]);

  const statusItems = useMemo(() => {
    const statuses = [
      { name: 'Scheduled', value: 'scheduled' },
      { name: 'No Slot', value: 'no slot' },
      { name: 'No Facility', value: 'no facility' },
      { name: 'Duplicate', value: 'duplicate' },
      { name: 'Cancelled', value: 'cancelled' },
      { name: 'Confirmed', value: 'confirmed' },
      { name: 'Pending', value: 'pending' },
      { name: 'Empty', value: 'empty' },
    ];
    const counts: Record<string, number> = {};
    statuses.forEach((s) => (counts[s.value] = 0));
    globalFilteredApplications.forEach((app) => {
      let st = ((app as any).status || '').toLowerCase();
      if (!(app as any).status || String((app as any).status).trim() === '') st = 'empty';
      const norm = st === 'schedule' ? 'scheduled' : st;
      if (counts[norm] !== undefined) counts[norm]++;
    });
    return {
      items: statuses
        .map((s) => ({ id: `status:${s.value}`, name: s.name, count: counts[s.value] || 0 }))
        .filter((s) => s.count > 0),
      total: globalFilteredApplications.length,
    };
  }, [globalFilteredApplications]);

  const filteredApplications = useMemo(() => {
    let filtered = globalFilteredApplications.filter((application) => {
      if (selectedLocation === 'all') return true;
      if (selectedLocation.startsWith('status:')) {
        const statusValue = selectedLocation.substring(7);
        let appStatus = ((application as any).status || '').toLowerCase();
        if (!(application as any).status || String((application as any).status).trim() === '') appStatus = 'empty';
        const norm = appStatus === 'schedule' ? 'scheduled' : appStatus;
        return norm === statusValue;
      }
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      const dateA = (a as any).created_at || (a as any).timestamp;
      const dateB = (b as any).created_at || (b as any).timestamp;
      const tA = dateA ? new Date(dateA).getTime() : 0;
      const tB = dateB ? new Date(dateB).getTime() : 0;
      if (tA !== tB) return tB - tA;
      return (parseInt(b.id) || 0) - (parseInt(a.id) || 0);
    });

    return filtered;
  }, [globalFilteredApplications, selectedLocation]);

  const persist = (key: string, value: any) => {
    AsyncStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)).catch(() => { });
  };

  // ── pagination ──────────────────────────────────────────────────────────────

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredApplications.length / itemsPerPage)),
    [filteredApplications.length, itemsPerPage]
  );

  const paginatedApplications = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredApplications.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredApplications, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  // Reset to first page whenever the result set changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedLocation, funnelFilters, itemsPerPage, timestampFrom, timestampTo]);

  // Scroll back to the top on page change
  useEffect(() => {
    cardListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [currentPage]);

  // ── actions ───────────────────────────────────────────────────────────────

  const handleApplicationUpdate = () => { silentRefresh().catch(() => { }); };

  const handleExport = () => {
    if (!filteredApplications.length) return;
    exportToCSV('applications_export', allColumns, filteredApplications, renderCellValue);
  };

  const handleApplyFilters = async (filters: FilterValues) => {
    setFunnelFilters(filters);
    try { await AsyncStorage.setItem(STORAGE_KEYS.funnelFilters, JSON.stringify(filters)); } catch { /* ignore */ }
  };

  const handleClearAllFilters = async () => {
    setFunnelFilters({});
    try { await AsyncStorage.removeItem(STORAGE_KEYS.funnelFilters); } catch { /* ignore */ }
  };

  const removeFilter = async (key: string) => {
    const next = { ...funnelFilters };
    delete next[key];
    setFunnelFilters(next);
    try { await AsyncStorage.setItem(STORAGE_KEYS.funnelFilters, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const openApplyForm = () => {
    const url = userEmail
      ? `https://apply.atssfiber.ph?created_by_email=${encodeURIComponent(userEmail)}`
      : 'https://apply.atssfiber.ph';
    Linking.openURL(url).catch(() => { });
  };

  const broadcastViewing = (applicationId: string, action: 'started_viewing' | 'stopped_viewing') =>
    apiClient
      .post('/applications/broadcast-viewing', { application_id: applicationId, action })
      .catch((err) => console.error(`[Viewing] Failed to broadcast ${action}:`, err));

  const handleRowPress = async (application: Application) => {
    const previous = selectedApplicationRef.current;
    if (previous && previous.id !== application.id) {
      await broadcastViewing(previous.id, 'stopped_viewing');
    }
    setSelectedApplication(application);
    resetIdleTimer();
    await broadcastViewing(application.id, 'started_viewing');
  };

  const handleDetailsClose = async () => {
    const previous = selectedApplicationRef.current;
    if (previous) await broadcastViewing(previous.id, 'stopped_viewing');
    setSelectedApplication(null);
  };

  const handleRelogin = () => {
    setShowSessionExpired(false);
    AsyncStorage.removeItem('authData').catch(() => { });
    if (onLogout) onLogout();
  };

  const handleDateChange = (target: 'from' | 'to', event: any, date?: Date) => {
    setDatePickerTarget(null);
    if (event?.type !== 'set' || !date) return;
    if (target === 'from') setTimestampFrom(toIsoDay(date));
    else setTimestampTo(toIsoDay(date));
  };

  // ── filter display helpers ────────────────────────────────────────────────

  const activeFilterKeys = Object.keys(funnelFilters);

  const getFilterDisplayValue = (key: string, filter: any): string => {
    if (filter.type === 'text' || filter.type === 'boolean') return String(filter.value);
    if (filter.type === 'checklist') {
      return Array.isArray(filter.selectedOptions) ? filter.selectedOptions.join(', ') : String(filter.selectedOptions);
    }
    if (filter.type === 'number' || filter.type === 'date') {
      if (filter.from && filter.to) return `${filter.from} - ${filter.to}`;
      if (filter.from) return `> ${filter.from}`;
      if (filter.to) return `< ${filter.to}`;
    }
    return '';
  };

  // ── sidebar ───────────────────────────────────────────────────────────────

  const renderSidebarContent = () => (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingBottom: 12,
          paddingTop: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Applications</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={openApplyForm}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: primary,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
            }}
          >
            <ExternalLink size={13} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Apply</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsSidebarVisible(false)}>
            <X size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {/* Timestamp range */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#9ca3af' }}>TIMESTAMP RANGE</Text>
            {(timestampFrom || timestampTo) && (
              <TouchableOpacity onPress={() => { setTimestampFrom(''); setTimestampTo(''); }}>
                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: primary }}>CLEAR</Text>
              </TouchableOpacity>
            )}
          </View>

          {(['from', 'to'] as const).map((target) => {
            const value = target === 'from' ? timestampFrom : timestampTo;
            return (
              <View key={target}>
                <Text style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>
                  {target === 'from' ? 'From' : 'To'}
                </Text>
                <TouchableOpacity
                  onPress={() => setDatePickerTarget(target)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderWidth: 1,
                    borderColor: value ? primary : '#d1d5db',
                    borderRadius: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor: '#fff',
                  }}
                >
                  <Text style={{ fontSize: 12, color: value ? '#111827' : '#9ca3af' }}>{value || 'Select date'}</Text>
                  <Calendar size={14} color={value ? primary : '#9ca3af'} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* All Applications */}
        <TouchableOpacity
          onPress={() => { setSelectedLocation('all'); setIsSidebarVisible(false); }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: selectedLocation === 'all' ? `${primary}18` : 'transparent',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '500', color: selectedLocation === 'all' ? primary : '#374151' }}>
            All Applications
          </Text>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: selectedLocation === 'all' ? primary : '#f3f4f6',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: selectedLocation === 'all' ? '#fff' : '#6b7280' }}>
              {statusItems.total}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Status items */}
        {statusItems.items.map((status) => {
          const isSelected = selectedLocation === status.id;
          const dotColor = getStatusDotColor(status.id);
          return (
            <TouchableOpacity
              key={status.id}
              onPress={() => { setSelectedLocation(status.id); setIsSidebarVisible(false); }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 12,
                backgroundColor: isSelected ? `${primary}18` : 'transparent',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                <Text style={{ fontSize: 14, fontWeight: '500', color: isSelected ? primary : '#374151' }}>
                  {status.name}
                </Text>
              </View>
              {status.count > 0 && (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
                    backgroundColor: isSelected ? primary : '#f3f4f6',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isSelected ? '#fff' : '#9ca3af' }}>
                    {status.count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
        <TouchableOpacity
          onPress={() => setIsSidebarVisible(false)}
          style={{ backgroundColor: primary, borderRadius: 6, paddingVertical: 10, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>View Records</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── viewer badges ─────────────────────────────────────────────────────────

  const renderViewerBadges = (applicationId: string) => {
    const list = viewers[applicationId] || [];
    if (list.length === 0) return null;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {list.map((username) => (
          <View key={username} style={{ backgroundColor: primary, borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'lowercase' }}>
              {username} is viewing
            </Text>
          </View>
        ))}
      </View>
    );
  };

  // ── card renderer ─────────────────────────────────────────────────────────

  const renderCard = ({ item }: { item: Application }) => {
    const statusRaw = (item as any).status || '';
    const statusDisplay = !statusRaw || String(statusRaw).trim() === '' ? 'Empty' : statusRaw;
    const statusColor = getStatusColor(statusDisplay);
    const isSelected = selectedApplication?.id === item.id;

    return (
      <TouchableOpacity
        onPress={() => handleRowPress(item)}
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: isSelected ? '#f3f4f6' : 'transparent',
        }}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{ fontSize: 14, fontWeight: '500', color: '#111827', marginBottom: 4, textTransform: 'capitalize' }}
              numberOfLines={1}
            >
              {(item.customer_name || '').toLowerCase()}
            </Text>
            {renderViewerBadges(item.id)}
            <Text style={{ fontSize: 12, color: '#4b5563' }} numberOfLines={2}>
              {(item as any).create_date && (item as any).create_time
                ? `${(item as any).create_date} ${(item as any).create_time}`
                : (item as any).timestamp || 'Not specified'}
              {' | '}
              {[
                item.installation_address || (item as any).address,
                (item as any).barangay,
                (item as any).city,
                (item as any).region,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
          </View>
          <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 }}>
            <Text style={{ fontWeight: 'bold', textTransform: 'uppercase', color: statusColor }}>
              {statusDisplay}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const listEmpty = (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
      <Text style={{ color: '#6b7280', fontSize: 14 }}>No applications found matching your filters</Text>
    </View>
  );

  // ── main render ───────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* List view — kept mounted (not unmounted) while the details screen is open so
          scroll position and paging survive the round trip, same as JobOrder. */}
      <View style={{ flex: 1, display: selectedApplication ? 'none' : 'flex' }}>
      {/* Top bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 12,
          backgroundColor: '#fff',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          gap: 8,
        }}
      >
        {/* Status sidebar trigger */}
        <TouchableOpacity
          onPress={() => setIsSidebarVisible(true)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: selectedLocation !== 'all' || timestampFrom || timestampTo ? primary : '#e5e7eb',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selectedLocation !== 'all' || timestampFrom || timestampTo ? `${primary}12` : '#fff',
            flexShrink: 0,
          }}
        >
          <Menu size={18} color={selectedLocation !== 'all' || timestampFrom || timestampTo ? primary : '#374151'} />
        </TouchableOpacity>

        {/* Search */}
        <View style={{ flex: 1 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search applications..."
          />
        </View>

        {/* Funnel filter */}
        <TouchableOpacity
          onPress={() => setIsFunnelFilterOpen(true)}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: activeFilterKeys.length > 0 ? '#ef4444' : '#e5e7eb',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            flexShrink: 0,
          }}
        >
          <Filter size={18} color={activeFilterKeys.length > 0 ? '#ef4444' : '#374151'} />
          {activeFilterKeys.length > 0 && (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: '#ef4444',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>{activeFilterKeys.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Export */}
        <TouchableOpacity
          onPress={handleExport}
          disabled={isLoading || filteredApplications.length === 0}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: primary,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            opacity: isLoading || filteredApplications.length === 0 ? 0.4 : 1,
            flexShrink: 0,
          }}
        >
          <Download size={18} color={primary} />
        </TouchableOpacity>

        {/* Refresh */}
        <TouchableOpacity
          onPress={handleManualRefresh}
          disabled={isLoading || isRefreshingManual || !isFullyLoaded}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: primary,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            opacity: isLoading || isRefreshingManual || !isFullyLoaded ? 0.4 : 1,
            flexShrink: 0,
          }}
        >
          {isRefreshingManual || !isFullyLoaded || (isLoading && applications.length === 0) ? (
            <ActivityIndicator size="small" color={primary} />
          ) : (
            <RefreshCw size={18} color={primary} />
          )}
          {hasNewData && (
            <View
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: '#ef4444',
                borderWidth: 2,
                borderColor: '#fff',
              }}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Loading progress, mirroring the web refresh tooltip */}
      {!isFullyLoaded && applications.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 4, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 10, color: '#9ca3af' }}>
            Loading records… ({applications.length}/{totalCount})
          </Text>
        </View>
      )}

      {/* Timestamp range chips */}
      {(timestampFrom || timestampTo) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: '#fff',
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 1 }}>TIMESTAMP:</Text>
          <Text style={{ fontSize: 11, color: primary }}>
            {timestampFrom || '…'} → {timestampTo || '…'}
          </Text>
          <TouchableOpacity onPress={() => { setTimestampFrom(''); setTimestampTo(''); }}>
            <X size={12} color={primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Active filter chips */}
      {activeFilterKeys.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}
          contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 1 }}>FILTERS:</Text>
          {activeFilterKeys.map((filterKey) => {
            const filter = funnelFilters[filterKey] as any;
            const col = filterColumns.find((c) => (c as any).key === filterKey);
            const label = col?.label || filterKey;
            const displayVal = getFilterDisplayValue(filterKey, filter);
            return (
              <View
                key={filterKey}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: `${primary}15`,
                  borderRadius: 99,
                  paddingLeft: 10,
                  paddingRight: 6,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: `${primary}30`,
                  gap: 4,
                }}
              >
                <Text style={{ fontSize: 11, color: primary }}>
                  <Text style={{ opacity: 0.7 }}>{label}: </Text>
                  {displayVal}
                </Text>
                <TouchableOpacity onPress={() => removeFilter(filterKey)}>
                  <X size={12} color={primary} />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity onPress={handleClearAllFilters} style={{ paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: primary, textDecorationLine: 'underline' }}>
              Clear all
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* List */}
      {isLoading && applications.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={primary} />
          <Text style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>Loading applications...</Text>
        </View>
      ) : error && applications.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
          <TouchableOpacity
            onPress={() => fetchApplications()}
            style={{ backgroundColor: primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            ref={cardListRef}
            style={{ flex: 1 }}
            data={paginatedApplications}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderCard}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primary} />}
            ListEmptyComponent={listEmpty}
            contentContainerStyle={{ flexGrow: 1 }}
          />

          {/* Pagination */}
          {filteredApplications.length > 0 && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: '#e5e7eb',
                backgroundColor: '#fff',
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: isTablet ? 12 : 110,
                gap: 10,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 12, color: '#4b5563' }}>Show</Text>
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 6,
                      overflow: 'hidden',
                      width: 92,
                      height: 36,
                      justifyContent: 'center',
                    }}
                  >
                    <Picker
                      selectedValue={itemsPerPage}
                      onValueChange={(v) => {
                        const next = Number(v);
                        setItemsPerPage(next);
                        persist(STORAGE_KEYS.itemsPerPage, String(next));
                      }}
                      style={{ color: '#111827' }}
                      dropdownIconColor="#6b7280"
                    >
                      {[10, 25, 50, 100].map((v) => (
                        <Picker.Item key={v} label={String(v)} value={v} />
                      ))}
                    </Picker>
                  </View>
                  <Text style={{ fontSize: 12, color: '#4b5563' }}>entries</Text>
                </View>
                <Text style={{ fontSize: 12, color: '#4b5563' }}>
                  Showing <Text style={{ fontWeight: '500' }}>{(currentPage - 1) * itemsPerPage + 1}</Text> to{' '}
                  <Text style={{ fontWeight: '500' }}>{Math.min(currentPage * itemsPerPage, filteredApplications.length)}</Text> of{' '}
                  <Text style={{ fontWeight: '500' }}>{filteredApplications.length}</Text> results
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                {([
                  { label: '«', page: 1, disabled: currentPage === 1 },
                  { label: '‹', page: currentPage - 1, disabled: currentPage === 1 },
                ] as const).map((btn) => (
                  <TouchableOpacity
                    key={btn.label}
                    onPress={() => handlePageChange(btn.page)}
                    disabled={btn.disabled}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 4,
                      minWidth: 40,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: btn.disabled ? '#f3f4f6' : '#fff',
                      borderWidth: btn.disabled ? 0 : 1,
                      borderColor: '#d1d5db',
                    }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: btn.disabled ? '#9ca3af' : '#374151' }}>
                      {btn.label}
                    </Text>
                  </TouchableOpacity>
                ))}

                <Text style={{ paddingHorizontal: 8, fontSize: 14, color: '#111827' }}>
                  Page {currentPage} of {totalPages}
                </Text>

                {([
                  { label: '›', page: currentPage + 1, disabled: currentPage === totalPages },
                  { label: '»', page: totalPages, disabled: currentPage === totalPages },
                ] as const).map((btn) => (
                  <TouchableOpacity
                    key={btn.label}
                    onPress={() => handlePageChange(btn.page)}
                    disabled={btn.disabled}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 4,
                      minWidth: 40,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: btn.disabled ? '#f3f4f6' : '#fff',
                      borderWidth: btn.disabled ? 0 : 1,
                      borderColor: '#d1d5db',
                    }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: 'bold', color: btn.disabled ? '#9ca3af' : '#374151' }}>
                      {btn.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </>
      )}
      </View>

      {/* Application Details — a full-screen inline view, not a modal */}
      {selectedApplication && (
        <View style={{ flex: 1 }}>
          <ApplicationDetails
            application={selectedApplication as any}
            onClose={handleDetailsClose}
            onApplicationUpdate={handleApplicationUpdate}
            isMobile={!isTablet}
          />
        </View>
      )}

      {/* Sidebar Modal */}
      <Modal
        visible={sidebarRendered}
        animationType="none"
        transparent
        onRequestClose={() => setIsSidebarVisible(false)}
      >
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <Animated.View
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: sidebarBackdrop }}
          />
          <Animated.View
            style={{
              width: '85%',
              maxWidth: 520,
              height: '100%',
              backgroundColor: '#fff',
              transform: [{ translateX: sidebarSlideX }],
            }}
          >
            {renderSidebarContent()}
          </Animated.View>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setIsSidebarVisible(false)}
          />
          {/* Rendered inside the sidebar Modal — an Android date dialog mounted outside it
              would be covered by the modal window. */}
          {datePickerTarget && (
            <DateTimePicker
              value={parseIsoDay(datePickerTarget === 'from' ? timestampFrom : timestampTo)}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => handleDateChange(datePickerTarget, event, date)}
            />
          )}
        </View>
      </Modal>

      {/* Add Application Modal */}
      <AddApplicationModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={() => {
          silentRefresh().catch(() => { });
          setIsAddModalOpen(false);
        }}
      />

      {/* Funnel Filter */}
      <ApplicationFunnelFilter
        isOpen={isFunnelFilterOpen}
        onClose={() => setIsFunnelFilterOpen(false)}
        onApplyFilters={(filters) => {
          handleApplyFilters(filters);
          setIsFunnelFilterOpen(false);
        }}
        currentFilters={funnelFilters}
      />

      {/* Session Expired Modal */}
      <Modal visible={showSessionExpired} transparent animationType="fade" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center', gap: 12 }}>
            <LogOut size={44} color="#ef4444" />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Session Expired</Text>
            <Text style={{ fontSize: 13, color: '#4b5563', textAlign: 'center' }}>
              Please re-login to continue using the application.
            </Text>
            <TouchableOpacity
              onPress={handleRelogin}
              style={{ backgroundColor: primary, borderRadius: 8, paddingVertical: 12, width: '100%', alignItems: 'center', marginTop: 4 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Re-login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default ApplicationManagement;

// src/pages/LiveMonitor.tsx  — React Native (Expo) migration
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  Modal,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import {
  Activity,
  BarChart3,
  RefreshCw,
  Settings,
  Save,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  List,
  LayoutGrid,
  Table,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import apiClient from '../config/api';
import { useOrganizationStore } from '../store/organizationStore';
import {
  WidgetConfig,
  WidgetData,
  WidgetState,
  WidgetResponse,
  DashboardTemplate,
  WIDGETS,
  CHART_COLORS,
  DEFAULT_VISIBLE_WIDGETS,
  CURRENCY_WIDGETS,
} from '../types/monitor.types';

// ─── Constants ───────────────────────────────────────────────────────────────
const isDarkMode = false; // FORCED LIGHT MODE
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARLY_LINE_WIDGETS = [
  'invoice_mon_count', 'invoice_mon_amount',
  'transactions_mon_count', 'transactions_mon_amount',
  'portal_mon_count', 'portal_mon_amount',
];

const SCOPE_OPTIONS = [
  { label: 'Overall', value: 'overall' },
  { label: 'Today', value: 'today' },
  { label: '1 Week', value: 'weekly' },
  { label: '3 Weeks', value: '3weeks' },
  { label: '1 Month', value: 'monthly' },
  { label: '3 Months', value: '3months' },
  { label: '1 Year', value: 'yearly' },
];

// ─── Helper ───────────────────────────────────────────────────────────────────
const formatCurrency = (val: number) =>
  '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2 });

const formatDurationFromMs = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

const formatDuration = (startTime: string | null, endTime?: string | null, nowMs?: number): string => {
  if (!startTime || startTime === '-') return '--';
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : (nowMs || Date.now());
  return formatDurationFromMs(Math.max(0, end - start));
};

// ─── Simple bar strip (replaces chart.js) ────────────────────────────────────
interface BarStripProps {
  data: WidgetData[];
  isCurrency: boolean;
  primaryColor: string;
}
const BarStrip: React.FC<BarStripProps> = ({ data, isCurrency, primaryColor }) => {
  if (!data || data.length === 0) return null;
  const values = data.map(d => Number(d.value || 0));
  const max = Math.max(...values, 1);
  return (
    <View style={{ flex: 1 }}>
      {data.map((row, idx) => {
        const val = Number(row.value || 0);
        const pct = (val / max) * 100;
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        return (
          <View key={idx} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={{ fontSize: 11, color: '#374151', flex: 1 }} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={{ fontSize: 11, color: primaryColor, fontWeight: '700', marginLeft: 4 }}>
                {isCurrency ? formatCurrency(val) : val.toLocaleString()}
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: '#e5e7eb', borderRadius: 3 }}>
              <View style={{ height: 6, width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
};

// ─── Series bar strip (multi-series data) ────────────────────────────────────
interface SeriesBarStripProps {
  data: WidgetData[];
  isCurrency: boolean;
  primaryColor: string;
}
const SeriesBarStrip: React.FC<SeriesBarStripProps> = ({ data, isCurrency, primaryColor }) => {
  if (!data || data.length === 0) return null;
  // Collect all series keys
  const allKeys = Array.from(new Set(data.flatMap(d => Object.keys(d.series || {}))));
  return (
    <ScrollView style={{ flex: 1 }}>
      {data.map((row, idx) => (
        <View key={idx} style={{
          marginBottom: 10,
          padding: 8,
          backgroundColor: '#f9fafb',
          borderRadius: 8,
          borderWidth: 1,
          borderColor: '#e5e7eb',
        }}>
          <Text style={{ fontWeight: '700', fontSize: 12, color: '#111827', marginBottom: 6 }}>
            {row.label}
          </Text>
          {allKeys.map((key, kIdx) => {
            const val = Number((row.series || {})[key] || 0);
            return (
              <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                <Text style={{ fontSize: 11, color: '#6b7280' }}>{key}</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: CHART_COLORS[kIdx % CHART_COLORS.length] }}>
                  {isCurrency ? formatCurrency(val) : val.toLocaleString()}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
const LiveMonitor: React.FC = () => {
  const [widgets, setWidgets] = useState<Record<string, any>>({});
  const [widgetStates, setWidgetStates] = useState<Record<string, WidgetState>>({});
  const [lastUpdate, setLastUpdate] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [barangays, setBarangays] = useState<string[]>([]);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | number>('All');
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Modal states
  const [showWidgetModal, setShowWidgetModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<DashboardTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [showOrgPicker, setShowOrgPicker] = useState(false);

  // Per-widget filter panel open state
  const [expandedFilters, setExpandedFilters] = useState<Record<string, boolean>>({});

  const { organizations, fetchOrganizations } = useOrganizationStore();

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // Auth data
  const [authData, setAuthData] = useState<any>({});
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef<((states?: Record<string, WidgetState>) => Promise<void>) | undefined>(undefined);

  // ── Build URL ───────────────────────────────────────────────────────────────
  const buildHandleUrl = useCallback((params: Record<string, string | number | undefined>) => {
    const parts: string[] = [];
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
      }
    });
    if (selectedOrgId !== 'All') {
      parts.push(`organization_id=${encodeURIComponent(String(selectedOrgId))}`);
    }
    return `/monitor/handle?${parts.join('&')}`;
  }, [selectedOrgId]);

  // ── Fetch single widget ─────────────────────────────────────────────────────
  const fetchWidget = useCallback(async (id: string, state: WidgetState) => {
    const config = WIDGETS[id];
    if (!config || !state || !state.visible) return;
    try {
      const url = buildHandleUrl({
        action: config.api,
        param: config.param || '',
        scope: state.scope,
        year: state.year || '',
        bgy: state.bgy || 'All',
        start: state.startDate || '',
        end: state.endDate || '',
        payment_mode: state.paymentMode || '',
        custom_start_time: state.customStartTime || '',
      });
      const response = await apiClient.get(url);
      const data = response.data as WidgetResponse;
      if (data.status === 'success' && data.data) {
        setWidgets(prev => ({ ...prev, [id]: { config, data: data.data } }));
        setBarangays(prev => {
          if (data.barangays && prev.length === 0) {
            return data.barangays.map(b => b.Name);
          }
          return prev;
        });
      }
    } catch (err) {
      console.error(`Error fetching widget ${id}:`, err);
    }
  }, [buildHandleUrl]);

  // ── Fetch all visible widgets ───────────────────────────────────────────────
  const fetchAllWidgets = useCallback(async (states?: Record<string, WidgetState>) => {
    const now = new Date();
    const todayStr = now.toDateString();
    const isResetTime = now.getHours() === 23 && now.getMinutes() >= 59;

    const [lastResetDate, storedDay] = await Promise.all([
      AsyncStorage.getItem('widget_last_reset_date'),
      AsyncStorage.getItem('widget_last_day'),
    ]);

    const shouldReset = (isResetTime && lastResetDate !== todayStr) || (todayStr !== (storedDay || todayStr));

    if (shouldReset) {
      if (isResetTime) await AsyncStorage.setItem('widget_last_reset_date', todayStr);
      await AsyncStorage.setItem('widget_last_day', todayStr);
      setWidgetStates(prev => {
        const ta = prev['tech_availability'];
        if (ta && ta.customStartTime && ta.customStartTime !== '08:00') {
          const nextStates = { ...prev, tech_availability: { ...ta, customStartTime: '08:00' } };
          AsyncStorage.setItem('widget_state_tech_availability', JSON.stringify(nextStates['tech_availability']));
          return nextStates;
        }
        return prev;
      });
    } else {
      await AsyncStorage.setItem('widget_last_day', todayStr);
    }

    setLastUpdate(new Date().toLocaleTimeString());

    const currentStates = states || widgetStates;
    const visibleIds = Object.keys(WIDGETS).filter(id => currentStates[id]?.visible);

    const BATCH_SIZE = 4;
    for (let i = 0; i < visibleIds.length; i += BATCH_SIZE) {
      const batch = visibleIds.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchWidget(id, currentStates[id])));
    }
  }, [fetchWidget, widgetStates]);

  useEffect(() => {
    pollingRef.current = fetchAllWidgets;
  }, [fetchAllWidgets]);

  // ── Update widget state ─────────────────────────────────────────────────────
  const updateWidgetState = useCallback((id: string, updates: Partial<WidgetState>) => {
    setWidgetStates(prev => {
      const updatedState = { ...prev[id], ...updates };
      const newState = { ...prev, [id]: updatedState };
      AsyncStorage.setItem(`widget_state_${id}`, JSON.stringify(updatedState));
      if (updatedState.visible) {
        fetchWidget(id, updatedState);
      }
      return newState;
    });
  }, [fetchWidget]);

  // ── Toggle widget visibility ────────────────────────────────────────────────
  const toggleWidgetVisibility = useCallback((id: string) => {
    setWidgetStates(prev => {
      const isVisible = !prev[id]?.visible;
      const nextStates = { ...prev, [id]: { ...prev[id], visible: isVisible } };
      AsyncStorage.setItem(`widget_state_${id}`, JSON.stringify(nextStates[id]));
      if (isVisible) fetchWidget(id, nextStates[id]);
      return nextStates;
    });
  }, [fetchWidget]);

  // ── Admin time-out ──────────────────────────────────────────────────────────
  const handleAdminTimeOut = (techId: number) => {
    Alert.alert(
      'Confirm',
      'Are you sure you want to manually time out this technician?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Time Out',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await apiClient.post('/tech-in-out/time-out', { tech_id: techId });
              const data = response.data as any;
              if (data.success) {
                fetchAllWidgets();
              } else {
                Alert.alert('Error', data.message || 'Failed to time out technician');
              }
            } catch {
              Alert.alert('Error', 'An error occurred while trying to time out the technician');
            }
          },
        },
      ]
    );
  };

  // ── Templates ───────────────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    try {
      const url = buildHandleUrl({ action: 'list_templates' });
      const response = await apiClient.get(url);
      const data = response.data as any;
      if (data.status === 'success' && Array.isArray(data.data)) {
        setTemplates(data.data);
      }
    } catch (err) {
      console.error('Error loading templates:', err);
    }
  }, [buildHandleUrl]);

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      Alert.alert('Error', 'Please enter a template name');
      return;
    }
    setIsLoading(true);
    try {
      const response = await apiClient.post('/monitor/handle', {
        action: 'save_template',
        name: templateName,
        layout: JSON.stringify(widgetStates),
        styles: JSON.stringify({ darkMode: false }),
      });
      const data = response.data as any;
      if (data.status === 'success') {
        Alert.alert('Success', 'Template saved successfully!');
        setTemplateName('');
        loadTemplates();
        setShowTemplateModal(false);
      } else {
        Alert.alert('Error', data.message || 'Failed to save template');
      }
    } catch {
      Alert.alert('Error', 'Failed to save template');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTemplate = async (templateId: number) => {
    setIsLoading(true);
    try {
      const url = buildHandleUrl({ action: 'load_template', id: templateId });
      const response = await apiClient.get(url);
      const data = response.data as any;
      if (data.status === 'success' && data.data) {
        const template = data.data as DashboardTemplate;
        const layoutData = typeof template.layout_data === 'string'
          ? JSON.parse(template.layout_data)
          : template.layout_data || {};
        setWidgetStates(layoutData);
        for (const [id, state] of Object.entries(layoutData)) {
          await AsyncStorage.setItem(`widget_state_${id}`, JSON.stringify(state));
        }
        fetchAllWidgets(layoutData as any);
        Alert.alert('Success', 'Template loaded successfully!');
        setShowTemplateModal(false);
      } else {
        Alert.alert('Error', data.message || 'Failed to load template');
      }
    } catch {
      Alert.alert('Error', 'Failed to load template');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteTemplate = (templateId: number) => {
    Alert.alert('Confirm', 'Delete this template?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setIsLoading(true);
          try {
            const response = await apiClient.post('/monitor/handle', {
              action: 'delete_template',
              id: templateId,
            });
            const data = response.data as any;
            if (data.status === 'success') {
              Alert.alert('Success', 'Template deleted!');
              loadTemplates();
            } else {
              Alert.alert('Error', data.message || 'Failed to delete template');
            }
          } catch {
            Alert.alert('Error', 'Failed to delete template');
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Auth data
      const raw = await AsyncStorage.getItem('authData');
      let auth: any = {};
      try {
        auth = raw ? JSON.parse(raw) : {};
      } catch (e) {
        console.error('Failed to parse auth data:', e);
      }
      setAuthData(auth);
      const superAdmin = auth.organization_id === null || auth.organization_id === undefined;
      setIsSuperAdmin(superAdmin);
      if (superAdmin) fetchOrganizations();

      // Color palette
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch {}

      // Payment methods
      try {
        const res = await paymentMethodService.getAll();
        if (res.success && Array.isArray(res.data)) setPaymentMethods(res.data);
      } catch {}

      // Widget states
      const initialStates: Record<string, WidgetState> = {};
      for (const id of Object.keys(WIDGETS)) {
        const saved = await AsyncStorage.getItem(`widget_state_${id}`);
        let state: any = null;
        if (saved) {
          try {
            state = JSON.parse(saved);
          } catch (e) {
            console.error(`Failed to parse widget_state_${id}:`, e);
          }
        }
        if (state) {
          if (state.viewType === 'table' && !id.includes('detailed_queue')) state.viewType = 'list';
          if (state.viewType === 'grid' && id !== 'tech_availability') state.viewType = 'list';
          initialStates[id] = state;
        } else {
          initialStates[id] = {
            viewType: id === 'tech_availability' ? 'grid' : (id.includes('detailed_queue') ? 'table' : 'list'),
            scope: 'overall',
            year: new Date().getFullYear().toString(),
            bgy: 'All',
            visible: DEFAULT_VISIBLE_WIDGETS.includes(id),
            fontSize: 12,
            customStartTime: id === 'tech_availability' ? '08:00' : '00:00',
          };
        }
      }
      setWidgetStates(initialStates);
      await fetchAllWidgets(initialStates);
      await loadTemplates();
    })();

    // 15-min polling
    const interval = setInterval(() => {
      if (pollingRef.current) pollingRef.current();
    }, 15 * 60 * 1000);
    refreshIntervalRef.current = interval;

    // 1-second ticker for duration counters
    const ticker = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    tickerIntervalRef.current = ticker;

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (tickerIntervalRef.current) clearInterval(tickerIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pull-to-refresh ─────────────────────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAllWidgets();
    setRefreshing(false);
  };

  // ── Render widget data ──────────────────────────────────────────────────────
  const renderListView = (widgetData: WidgetData[], widgetId: string) => {
    const isCurrency = CURRENCY_WIDGETS.includes(widgetId);
    if (widgetData[0]?.series) {
      return <SeriesBarStrip data={widgetData} isCurrency={isCurrency} primaryColor={primaryColor} />;
    }
    return <BarStrip data={widgetData} isCurrency={isCurrency} primaryColor={primaryColor} />;
  };

  const renderTechGrid = (widgetData: WidgetData[]) => {
    return (
      <ScrollView style={{ flex: 1 }}>
        {widgetData.map((row, idx) => {
          const meta: any = (row as any).meta || {};
          const status = meta.status || 'Unknown';
          const isAvailable = status === 'Available';
          const isOffline = status === 'Offline';

          const borderColor = isAvailable ? '#16a34a' : isOffline ? '#6b7280' : '#f97316';
          const badgeColor = isAvailable ? '#16a34a' : isOffline ? '#6b7280' : '#f97316';
          const timeString = formatDuration(meta.since, meta.time_out || meta.end_time, nowMs);

          return (
            <View key={idx} style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              borderWidth: 2,
              borderColor,
              marginBottom: 10,
              padding: 12,
            }}>
              {/* Header row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <View style={{ backgroundColor: badgeColor, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
                    {status}
                  </Text>
                </View>
                {meta.time_in && !meta.time_out && (
                  <TouchableOpacity
                    onPress={() => handleAdminTimeOut(meta.tech_id)}
                    style={{ backgroundColor: '#ef4444', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Time Out</Text>
                  </TouchableOpacity>
                )}
                {!meta.time_in && !meta.time_out && (
                  <Text style={{ fontSize: 10, color: '#9ca3af', fontStyle: 'italic' }}>no time in/out</Text>
                )}
              </View>

              {/* Name */}
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
                {row.label}
              </Text>

              {/* Details badge */}
              {meta.details && (
                <View style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
                  <Text style={{
                    fontSize: 11,
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    color: meta.is_pullout ? '#ef4444' :
                      meta.details.toLowerCase().includes('job order') ? '#3b82f6' :
                      meta.details.toLowerCase().includes('service order') ? '#8b5cf6' : '#6b7280',
                  }}>
                    {meta.details}
                  </Text>
                </View>
              )}

              {/* Primary time */}
              <Text style={{ fontSize: 28, fontWeight: '900', color: '#111827', textAlign: 'center', marginVertical: 6 }}>
                {meta.primary_time_str || timeString}
              </Text>

              {/* Sub-totals */}
              {meta.total_working_str && (
                <Text style={{ fontSize: 12, color: '#2563eb', fontWeight: '600', textAlign: 'center' }}>
                  Daily Working: {meta.total_working_str}
                </Text>
              )}
              {meta.total_available_str && (
                <Text style={{ fontSize: 12, color: '#16a34a', fontWeight: '600', textAlign: 'center' }}>
                  Daily Available: {meta.total_available_str}
                </Text>
              )}

              {/* Technicians */}
              {meta.technicians && meta.technicians.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', fontWeight: '700', marginBottom: 4 }}>
                    Technicians
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {meta.technicians.map((t: string, i: number) => (
                      <View key={i} style={{ backgroundColor: '#f3f4f6', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#374151' }}>{t}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Since info */}
              {meta.since && (
                <Text style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>
                  {isAvailable ? 'Currently available: ' : isOffline ? 'Offline since: ' : 'Job started: '}
                  <Text style={{ fontWeight: '700' }}>{timeString}</Text>
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderQueueTable = (data: any[], id: string) => {
    if (!Array.isArray(data) || data.length === 0) {
      return <Text style={{ color: '#9ca3af', textAlign: 'center', padding: 16 }}>No Data Available</Text>;
    }
    const isTeamQueue = id === 'team_detailed_queue';
    return (
      <ScrollView style={{ flex: 1 }}>
        {data.map((row, idx) => {
          const s = (row.status || '').toLowerCase();
          const isOngoing = s === 'in progress' && row.start && row.start !== '-';
          const label = isOngoing ? 'On Going' : (row.status || '-');
          const statusColor = s === 'reschedule' ? '#8b5cf6' :
            s === 'done' || s === 'resolved' || s === 'completed' ? '#16a34a' :
            s === 'failed' ? '#ef4444' :
            isOngoing ? '#3b82f6' : '#f97316';
          const typeColor = row.type?.toLowerCase().includes('joborder') ? '#3b82f6' :
            row.type?.toLowerCase().includes('work order') ? '#f97316' : '#8b5cf6';
          const hasEnd = !!row.end;
          const duration = isTeamQueue ? formatDuration(row.start, hasEnd ? row.end : null, nowMs) : null;

          return (
            <View key={idx} style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              marginBottom: 8,
              padding: 12,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontWeight: '700', fontSize: 13, color: '#111827', flex: 1 }}>
                  {row.team_name || row.agent_name || '-'}
                </Text>
                <Text style={{ fontWeight: '700', fontSize: 13, color: statusColor }}>
                  {label}
                </Text>
              </View>
              {row.technicians && Array.isArray(row.technicians) && row.technicians.length > 0 && (
                <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                  {row.technicians.join(', ')}
                </Text>
              )}
              <Text style={{ fontSize: 12, color: typeColor, fontWeight: '700', textTransform: 'uppercase' }}>
                {row.type}
              </Text>
              <Text style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{row.customer}</Text>
              <View style={{ flexDirection: 'row', marginTop: 4, gap: 12 }}>
                <Text style={{ fontSize: 11, color: '#9ca3af' }}>Start: <Text style={{ color: '#374151' }}>{row.start || '-'}</Text></Text>
                {isTeamQueue && (
                  <Text style={{ fontSize: 11, color: '#9ca3af' }}>End: <Text style={{ color: '#374151' }}>{row.end || '-'}</Text></Text>
                )}
                {isTeamQueue && duration && (
                  <Text style={{ fontSize: 11, color: hasEnd ? '#9ca3af' : '#16a34a', fontWeight: '700' }}>
                    {duration}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderWidgetContent = (id: string) => {
    const widget = widgets[id];
    const state = widgetStates[id];

    if (!widget || !state) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <ActivityIndicator color={primaryColor} />
          <Text style={{ color: '#9ca3af', marginTop: 8, fontSize: 12 }}>Loading...</Text>
        </View>
      );
    }

    const hasData = widget.data && (Array.isArray(widget.data) ? widget.data.length > 0 : true);
    if (!hasData) {
      return <Text style={{ color: '#9ca3af', textAlign: 'center', padding: 16, fontSize: 12 }}>No Data Available</Text>;
    }

    // Tech availability
    if (id === 'tech_availability') {
      return renderTechGrid(widget.data);
    }

    // Detailed queues
    if (id === 'team_detailed_queue' || id === 'agent_detailed_queue') {
      return renderQueueTable(widget.data, id);
    }

    // Standard list view
    return renderListView(widget.data, id);
  };

  // ── Render filters for a widget ─────────────────────────────────────────────
  const renderFilters = (id: string, config: WidgetConfig) => {
    const state = widgetStates[id];
    if (!config.hasFilters || !state) return null;

    return (
      <View style={{ gap: 8, marginTop: 8 }}>
        {/* Payment mode filter for pay_method_mon */}
        {id === 'pay_method_mon' && (
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Mode</Text>
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
              <Picker
                selectedValue={state.paymentMode || 'type'}
                onValueChange={val => updateWidgetState(id, { paymentMode: val as any })}
                style={{ height: 40 }}
              >
                <Picker.Item label="Type of Payment" value="type" />
                <Picker.Item label="Months" value="months" />
              </Picker>
            </View>
          </View>
        )}

        {/* Tech start time */}
        {id === 'tech_availability' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, color: '#374151', fontWeight: '700' }}>Start Time:</Text>
            <TextInput
              value={state.customStartTime || '08:00'}
              onChangeText={val => updateWidgetState(id, { customStartTime: val })}
              placeholder="HH:MM"
              style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 4,
                fontSize: 13,
                color: '#111827',
                backgroundColor: '#ffffff',
                width: 80,
              }}
            />
          </View>
        )}

        {/* Scope filter */}
        {(id !== 'pay_method_mon' || state.paymentMode !== 'months') &&
          (config.filterType === 'toggle_today' || config.filterType === 'date' || config.filterType === 'date_bgy') && (
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Scope</Text>
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
              <Picker
                selectedValue={state.scope}
                onValueChange={val => updateWidgetState(id, { scope: val as any })}
                style={{ height: 40 }}
              >
                {SCOPE_OPTIONS.map(opt => (
                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                ))}
              </Picker>
            </View>
          </View>
        )}

        {/* Year filter */}
        {config.filterType === 'year' && (
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Year</Text>
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
              <Picker
                selectedValue={state.year}
                onValueChange={val => updateWidgetState(id, { year: String(val) })}
                style={{ height: 40 }}
              >
                {[0, 1, 2].map(offset => {
                  const y = new Date().getFullYear() - offset;
                  return <Picker.Item key={y} label={String(y)} value={String(y)} />;
                })}
              </Picker>
            </View>
          </View>
        )}

        {/* Barangay filter */}
        {(config.filterType === 'bgy_only' || config.filterType === 'date_bgy') && barangays.length > 0 && (
          <View>
            <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>Barangay</Text>
            <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
              <Picker
                selectedValue={state.bgy || 'All'}
                onValueChange={val => updateWidgetState(id, { bgy: String(val) })}
                style={{ height: 40 }}
              >
                <Picker.Item label="All Brgy" value="All" />
                {barangays.map(b => <Picker.Item key={b} label={b} value={b} />)}
              </Picker>
            </View>
          </View>
        )}
      </View>
    );
  };

  // ── Render widget card ──────────────────────────────────────────────────────
  const renderWidgetCard = (id: string) => {
    const config = WIDGETS[id];
    const state = widgetStates[id];
    if (!state?.visible) return null;

    const isFilterExpanded = expandedFilters[id] || false;

    return (
      <View key={id} style={{
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: primaryColor,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        marginBottom: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}>
        {/* Widget header */}
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: primaryColor, textTransform: 'uppercase', flex: 1 }}>
              {config.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {/* Refresh widget */}
              <TouchableOpacity onPress={() => state && fetchWidget(id, state)} style={{ padding: 4 }}>
                <RefreshCw size={14} color="#9ca3af" />
              </TouchableOpacity>
              {/* Filter toggle (only if has filters) */}
              {config.hasFilters && (
                <TouchableOpacity
                  onPress={() => setExpandedFilters(prev => ({ ...prev, [id]: !prev[id] }))}
                  style={{ padding: 4 }}
                >
                  {isFilterExpanded
                    ? <ChevronUp size={14} color="#9ca3af" />
                    : <ChevronDown size={14} color="#9ca3af" />
                  }
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Filters (collapsible) */}
          {config.hasFilters && isFilterExpanded && (
            <View style={{ marginTop: 8 }}>
              {renderFilters(id, config)}
            </View>
          )}
        </View>

        {/* Widget content */}
        <View style={{ padding: 12, minHeight: 160 }}>
          {renderWidgetContent(id)}
        </View>
      </View>
    );
  };

  const visibleWidgetIds = Object.keys(WIDGETS).filter(id => widgetStates[id]?.visible);
  const allHidden = Object.values(widgetStates).length > 0 && Object.values(widgetStates).every(s => !s.visible);

  // ── Widget visibility modal ─────────────────────────────────────────────────
  const renderWidgetModal = () => (
    <Modal visible={showWidgetModal} animationType="slide" onRequestClose={() => setShowWidgetModal(false)}>
      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        <View style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
          paddingTop: isTablet ? 16 : 60,
        }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>Toggle Widgets</Text>
          <TouchableOpacity onPress={() => setShowWidgetModal(false)}>
            <X size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        {/* Show All / Hide All */}
        <View style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
          <TouchableOpacity
            onPress={() => {
              const nextStates = { ...widgetStates };
              Object.keys(WIDGETS).forEach(id => {
                nextStates[id] = { ...nextStates[id], visible: true };
                AsyncStorage.setItem(`widget_state_${id}`, JSON.stringify(nextStates[id]));
              });
              setWidgetStates(nextStates);
              fetchAllWidgets(nextStates);
            }}
            style={{ flex: 1, backgroundColor: '#16a34a', borderRadius: 8, padding: 10, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Show All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setWidgetStates(prev => {
                const nextStates = { ...prev };
                Object.keys(WIDGETS).forEach(id => {
                  nextStates[id] = { ...nextStates[id], visible: false };
                  AsyncStorage.setItem(`widget_state_${id}`, JSON.stringify(nextStates[id]));
                });
                return nextStates;
              });
            }}
            style={{ flex: 1, backgroundColor: '#ef4444', borderRadius: 8, padding: 10, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Hide All</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={Object.entries(WIDGETS)}
          keyExtractor={([id]) => id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
          renderItem={({ item: [id, config] }) => (
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
            }}>
              <Text style={{ fontSize: 14, color: '#374151', flex: 1 }}>{config.title}</Text>
              <Switch
                value={widgetStates[id]?.visible || false}
                onValueChange={() => toggleWidgetVisibility(id)}
                trackColor={{ false: '#e5e7eb', true: primaryColor + '66' }}
                thumbColor={widgetStates[id]?.visible ? primaryColor : '#9ca3af'}
              />
            </View>
          )}
        />
      </View>
    </Modal>
  );

  // ── Template modal ──────────────────────────────────────────────────────────
  const renderTemplateModal = () => (
    <Modal visible={showTemplateModal} animationType="slide" onRequestClose={() => setShowTemplateModal(false)}>
      <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
        <View style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: 16, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
          paddingTop: isTablet ? 16 : 60,
        }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>Dashboard Templates</Text>
          <TouchableOpacity onPress={() => setShowTemplateModal(false)}>
            <X size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Save new template */}
          <View style={{ backgroundColor: '#ffffff', borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 }}>Save Current Layout</Text>
            <TextInput
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="Template name..."
              placeholderTextColor="#9ca3af"
              style={{
                borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
                padding: 10, fontSize: 14, color: '#111827', backgroundColor: '#f9fafb', marginBottom: 10,
              }}
            />
            <TouchableOpacity
              onPress={saveTemplate}
              disabled={isLoading || !templateName.trim()}
              style={{
                backgroundColor: (isLoading || !templateName.trim()) ? '#9ca3af' : primaryColor,
                borderRadius: 8, padding: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
              }}
            >
              <Save size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Save</Text>
            </TouchableOpacity>
          </View>

          {/* Existing templates */}
          {templates.map(tmpl => (
            <View key={tmpl.id} style={{
              backgroundColor: '#ffffff', borderRadius: 10, padding: 14, marginBottom: 10,
              borderWidth: 1, borderColor: '#e5e7eb', flexDirection: 'row', alignItems: 'center',
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 14, color: '#111827' }}>{tmpl.template_name}</Text>
                <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {new Date(tmpl.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => loadTemplate(tmpl.id)}
                  disabled={isLoading}
                  style={{ padding: 8, borderRadius: 6, backgroundColor: primaryColor + '15' }}
                >
                  <Upload size={16} color={primaryColor} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => deleteTemplate(tmpl.id)}
                  disabled={isLoading}
                  style={{ padding: 8, borderRadius: 6, backgroundColor: '#fee2e2' }}
                >
                  <Trash2 size={16} color="#ef4444" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {templates.length === 0 && (
            <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 16 }}>No templates saved yet.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        paddingTop: isTablet ? 16 : 60,
        paddingHorizontal: 16,
        paddingBottom: 12,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Activity size={22} color={primaryColor} />
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827' }}>Live Monitor</Text>
            </View>
            <Text style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
              Real-time Dashboard Analytics
            </Text>
            {lastUpdate !== '' && (
              <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                Updated: {lastUpdate}
              </Text>
            )}
          </View>

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              onPress={onRefresh}
              style={{ backgroundColor: primaryColor, borderRadius: 8, padding: 8 }}
            >
              <RefreshCw size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { loadTemplates(); setShowTemplateModal(true); }}
              style={{ backgroundColor: '#f3f4f6', borderRadius: 8, padding: 8 }}
            >
              <Save size={16} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowWidgetModal(true)}
              style={{ backgroundColor: '#f3f4f6', borderRadius: 8, padding: 8 }}
            >
              <Settings size={16} color="#374151" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Super Admin org picker */}
        {isSuperAdmin && (
          <View style={{ marginTop: 10, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <Picker
              selectedValue={String(selectedOrgId)}
              onValueChange={val => {
                setSelectedOrgId(val);
                setTimeout(() => fetchAllWidgets(), 100);
              }}
              style={{ height: 44 }}
            >
              <Picker.Item label="All Organizations" value="All" />
              {organizations.map(org => (
                <Picker.Item key={org.id} label={org.organization_name || String(org.id)} value={String(org.id)} />
              ))}
            </Picker>
          </View>
        )}
      </View>

      {/* Widget list */}
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primaryColor} />}
      >
        {allHidden ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Activity size={48} color="#9ca3af" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 }}>No Widgets Visible</Text>
            <Text style={{ fontSize: 13, color: '#9ca3af', marginTop: 4, textAlign: 'center' }}>
              Enable some widgets to start monitoring your system
            </Text>
            <TouchableOpacity
              onPress={() => setShowWidgetModal(true)}
              style={{ backgroundColor: primaryColor, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 16 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Open Widget Settings</Text>
            </TouchableOpacity>
          </View>
        ) : (
          visibleWidgetIds.map(id => renderWidgetCard(id))
        )}
      </ScrollView>

      {/* Modals */}
      {renderWidgetModal()}
      {renderTemplateModal()}
    </View>
  );
};

export default LiveMonitor;

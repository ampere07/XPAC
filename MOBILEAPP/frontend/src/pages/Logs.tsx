import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert,
  ScrollView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Activity, ChevronLeft, ChevronRight, Download, BarChart2 } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { logsService } from '../services/userService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

// Forced light mode
const isDarkMode = false;

interface ActivityLog {
  log_id: number;
  level: 'info' | 'warning' | 'error' | 'debug';
  action: string;
  message: string;
  user_id?: number;
  target_user_id?: number;
  resource_type?: string;
  resource_id?: number;
  ip_address?: string;
  user_agent?: string;
  additional_data?: any;
  organization_id?: number;
  created_at: string;
  updated_at: string;
  user?: {
    user_id: number;
    username: string;
    full_name: string;
  };
  target_user?: {
    user_id: number;
    username: string;
    full_name: string;
  };
}

interface LogStats {
  total_logs: number;
  by_level: {
    info: number;
    warning: number;
    error: number;
    debug: number;
  };
  recent_actions: Array<{ action: string; count: number }>;
  active_users: Array<{
    user_id: number;
    activity_count: number;
    user?: { user_id: number; username: string; full_name: string };
  }>;
}

const LEVEL_COLORS: Record<string, { bg: string; text: string }> = {
  info: { bg: '#dbeafe', text: '#1d4ed8' },
  warning: { bg: '#fef3c7', text: '#b45309' },
  error: { bg: '#fee2e2', text: '#b91c1c' },
  debug: { bg: '#f3f4f6', text: '#4b5563' },
};

const formatDateTime = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    return `${getPart('month')}/${getPart('day')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
  } catch {
    return dateString;
  }
};

const formatAction = (action: string): string =>
  action.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

const LEVEL_OPTIONS = ['all', 'info', 'warning', 'error', 'debug'] as const;

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showStats, setShowStats] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [exporting, setExporting] = useState(false);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  const loadLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        per_page: 20,
      };
      if (searchQuery) params.search = searchQuery;
      if (filterLevel !== 'all') params.level = filterLevel;

      const response = await logsService.getLogs(params);
      if (response.success && response.data) {
        // Apply org filter using AsyncStorage (mirrors web localStorage logic)
        let filtered: ActivityLog[] = response.data;
        try {
          const authStr = await AsyncStorage.getItem('authData');
          if (authStr) {
            const authData = JSON.parse(authStr);
            const userOrgId =
              authData.organization_id ||
              authData.user?.organization_id ||
              authData.organization?.id ||
              authData.user?.organization?.id ||
              null;
            if (userOrgId) {
              filtered = response.data.filter((log: any) => log.organization_id === userOrgId);
            } else {
              filtered = response.data.filter((log: any) => !log.organization_id);
            }
          }
        } catch {
          filtered = response.data;
        }
        setLogs(filtered);
        if (response.pagination) {
          setCurrentPage(response.pagination.current_page);
          setTotalPages(response.pagination.last_page);
        }
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterLevel]);

  const loadStats = useCallback(async () => {
    try {
      const response = await logsService.getStats(7);
      if (response.success && response.data) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }, []);

  useEffect(() => {
    loadLogs(1);
    loadStats();
  }, []);

  // Debounced re-fetch on filter/search change
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      loadLogs(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, filterLevel]);

  // Auto silent-refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      loadLogs(currentPage).catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadLogs, currentPage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadLogs(1);
    await loadStats();
    setRefreshing(false);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    loadLogs(newPage);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await logsService.exportLogs({
        format: 'csv',
        level: filterLevel !== 'all' ? filterLevel : undefined,
        days: 30,
      });
      Alert.alert('Export', 'Activity logs export requested successfully.');
    } catch (error) {
      console.error('Failed to export logs:', error);
      Alert.alert('Export Failed', 'Could not export logs. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const LevelBadge: React.FC<{ level: string }> = ({ level }) => {
    const colors = LEVEL_COLORS[level] || { bg: '#f3f4f6', text: '#4b5563' };
    return (
      <View
        style={{
          backgroundColor: colors.bg,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 12,
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text }}>
          {level.toUpperCase()}
        </Text>
      </View>
    );
  };

  const renderLogItem = ({ item }: { item: ActivityLog }) => (
    <View
      style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      {/* Top row: action + level badge */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', flex: 1 }} numberOfLines={1}>
          {formatAction(item.action)}
        </Text>
        <LevelBadge level={item.level} />
      </View>

      {/* Message */}
      <Text style={{ fontSize: 13, color: '#374151', marginBottom: 6 }} numberOfLines={2}>
        {item.message}
      </Text>

      {/* Meta row */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Text style={{ fontSize: 11, color: '#6b7280' }}>
          <Text style={{ fontWeight: '600' }}>User: </Text>
          {item.user ? item.user.username : 'System'}
        </Text>
        {!!item.ip_address && (
          <Text style={{ fontSize: 11, color: '#6b7280' }}>
            <Text style={{ fontWeight: '600' }}>IP: </Text>
            {item.ip_address}
          </Text>
        )}
        <Text style={{ fontSize: 11, color: '#9ca3af' }}>{formatDateTime(item.created_at)}</Text>
      </View>
    </View>
  );

  const StatsCard: React.FC<{ value: number | string; label: string; valueColor?: string }> = ({
    value,
    label,
    valueColor = '#111827',
  }) => (
    <View
      style={{
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
        minWidth: 80,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: '700', color: valueColor }}>{value}</Text>
      <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2, textAlign: 'center' }}>{label}</Text>
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
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Activity size={20} color={primaryColor} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', flex: 1 }}>
            Activity Logs
          </Text>
          <TouchableOpacity
            onPress={handleExport}
            disabled={exporting}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: '#6b7280',
              opacity: exporting ? 0.5 : 1,
            }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Download size={14} color="#ffffff" />
            )}
            <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '600' }}>Export</Text>
          </TouchableOpacity>
        </View>

        {/* Subtitle */}
        <Text style={{ fontSize: 12, color: '#6b7280' }}>
          Monitor system activities and user actions
        </Text>

        {/* Search */}
        <GlobalSearch
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          placeholder="Search logs by message, action, or user..."
        />

        {/* Level filter + stats toggle */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 6,
              overflow: 'hidden',
              height: 40,
              justifyContent: 'center',
            }}
          >
            <Picker
              selectedValue={filterLevel}
              onValueChange={(v) => setFilterLevel(v)}
              style={{ color: '#111827' }}
              dropdownIconColor="#6b7280"
            >
              {LEVEL_OPTIONS.map((lvl) => (
                <Picker.Item
                  key={lvl}
                  label={lvl === 'all' ? 'All Levels' : lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  value={lvl}
                />
              ))}
            </Picker>
          </View>

          {stats && (
            <TouchableOpacity
              onPress={() => setShowStats((s) => !s)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#d1d5db',
                backgroundColor: showStats ? primaryColor : '#ffffff',
              }}
            >
              <BarChart2 size={14} color={showStats ? '#ffffff' : '#6b7280'} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: showStats ? '#ffffff' : '#6b7280' }}>
                Stats
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Stats cards (collapsible) */}
        {stats && showStats && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          >
            <StatsCard value={stats.total_logs} label="Total" />
            <StatsCard value={stats.by_level.info} label="Info" valueColor="#1d4ed8" />
            <StatsCard value={stats.by_level.warning} label="Warnings" valueColor="#b45309" />
            <StatsCard value={stats.by_level.error} label="Errors" valueColor="#b91c1c" />
            <StatsCard value={stats.by_level.debug} label="Debug" valueColor="#4b5563" />
          </ScrollView>
        )}
      </View>

      {/* List body */}
      {loading && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading logs...</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item, idx) => String(item.log_id ?? idx)}
          renderItem={renderLogItem}
          initialNumToRender={20}
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
              <Text style={{ color: '#6b7280' }}>No logs found</Text>
            </View>
          }
          ListFooterComponent={
            totalPages > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  paddingVertical: 16,
                  borderTopWidth: 1,
                  borderTopColor: '#e5e7eb',
                  backgroundColor: '#f9fafb',
                }}
              >
                <TouchableOpacity
                  onPress={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    opacity: currentPage === 1 ? 0.3 : 1,
                  }}
                >
                  <ChevronLeft size={18} color="#374151" />
                </TouchableOpacity>
                <Text style={{ fontSize: 13, fontWeight: '500', color: '#6b7280' }}>
                  Page {currentPage} of {totalPages}
                </Text>
                <TouchableOpacity
                  onPress={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    opacity: currentPage === totalPages ? 0.3 : 1,
                  }}
                >
                  <ChevronRight size={18} color="#374151" />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
};

export default Logs;

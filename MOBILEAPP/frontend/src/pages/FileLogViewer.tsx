import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import { fileLogService, FileLogEntry, FileLogPagination } from '../services/fileLogService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import GlobalSearch from './globalfunctions/GlobalSearch';

interface FileLogViewerProps {
  type: 'smartolt' | 'radius';
  title: string;
}

const getLevelColor = (level: string) => {
  const l = level.toLowerCase();
  if (l.includes('error')) return '#f87171';
  if (l.includes('warning')) return '#facc15';
  if (l.includes('debug')) return '#9ca3af';
  return '#4ade80';
};

const FileLogViewer: React.FC<FileLogViewerProps> = ({ type, title }) => {
  // App is forced light mode.
  const isDarkMode = false;
  const [logs, setLogs] = useState<FileLogEntry[]>([]);
  const [pagination, setPagination] = useState<FileLogPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

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

  const loadLogs = async (page = 1) => {
    setLoading(true);
    try {
      const params = {
        page,
        per_page: 50,
        search: searchQuery || undefined,
      };

      const response = await fileLogService.getLogs(type, params);
      if (response.success) {
        setLogs(response.data);
        setPagination(response.pagination);
        setCurrentPage(response.pagination.current_page);
      }
    } catch (error) {
      console.error(`Failed to load ${type} logs:`, error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      loadLogs(1);
    }, 500);
    return () => clearTimeout(delayedSearch);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      loadLogs(currentPage);
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadLogs(currentPage);
    setRefreshing(false);
  };

  const handlePageChange = (newPage: number) => {
    loadLogs(newPage);
  };

  const renderItem = ({ item, index }: { item: FileLogEntry; index: number }) => {
    const lineNo = (pagination?.from || 0) + index;
    return (
      <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 4, paddingHorizontal: 12 }}>
        <Text style={{ color: '#6b7280', width: 32, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
          {lineNo}
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#2563eb', fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
            [{item.datetime}]
          </Text>
          <Text style={{ color: getLevelColor(item.level || ''), fontFamily: 'monospace', fontSize: 12, fontWeight: '700' }}>
            {(item.level || '').toUpperCase()}:
          </Text>
          <Text style={{ color: '#374151', fontFamily: 'monospace', fontSize: 12 }}>
            {item.message}
          </Text>
        </View>
      </View>
    );
  };

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
        <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827' }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <GlobalSearch
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            placeholder="Search log messages..."
          />
          <TouchableOpacity
            onPress={() => loadLogs(currentPage)}
            style={{ padding: 10, borderRadius: 8, backgroundColor: primaryColor, alignItems: 'center', justifyContent: 'center' }}
          >
            {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <RefreshCw size={16} color="#ffffff" />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Terminal-style header bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 8,
          backgroundColor: '#1f2937',
          borderBottomWidth: 1,
          borderBottomColor: '#374151',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 6, marginRight: 16 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(239,68,68,0.5)' }} />
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(234,179,8,0.5)' }} />
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(34,197,94,0.5)' }} />
        </View>
        <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: 2 }}>
          {title.toUpperCase()} OUTPUT
        </Text>
      </View>

      {/* Body */}
      {loading && logs.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Attaching to stream...</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(_item, idx) => String(idx)}
          renderItem={renderItem}
          initialNumToRender={30}
          style={{ backgroundColor: '#f9fafb' }}
          contentContainerStyle={{ paddingVertical: 8 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 80, alignItems: 'center' }}>
              <Text style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{'> No logs available'}</Text>
              <Text style={{ color: '#d1d5db', fontFamily: 'monospace', fontSize: 11, marginTop: 4 }}>Ready for data...</Text>
            </View>
          }
        />
      )}

      {/* Pagination */}
      {pagination && pagination.last_page > 1 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: '#e5e7eb',
            backgroundColor: '#ffffff',
          }}
        >
          <Text style={{ fontSize: 11, fontFamily: 'monospace', color: '#6b7280' }}>
            PAGE {pagination.current_page}/{pagination.last_page} TOTAL: {pagination.total}
          </Text>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <TouchableOpacity
              onPress={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || loading}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  letterSpacing: 1,
                  color: currentPage === 1 || loading ? '#d1d5db' : primaryColor,
                }}
              >
                {'<< PREV'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === pagination.last_page || loading}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  letterSpacing: 1,
                  color: currentPage === pagination.last_page || loading ? '#d1d5db' : primaryColor,
                }}
              >
                {'NEXT >>'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

export default FileLogViewer;

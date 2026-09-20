import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plus, Search } from 'lucide-react-native';
import GlobalSearch from './globalfunctions/GlobalSearch';
import SMSBlastDetails from '../components/SMSBlastDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AddSMSBlastModal from '../modals/AddSMSBlastModal';
import apiClient from '../config/api';

interface SMSBlastRecord {
  id: string;
  target_name: string;
  target_type: string;
  barangay: string;
  city: string;
  message: string;
  billing_day: number | null;
  message_count: number | null;
  credit_used: string | null;
  modifiedDate: string;
  modifiedEmail: string;
  userEmail: string;
  organization_id?: number | null;
}

const SMSBlast: React.FC = () => {
  const isDarkMode = false;
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const [smsBlastRecords, setSmsBlastRecords] = useState<SMSBlastRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSMSBlast, setSelectedSMSBlast] = useState<SMSBlastRecord | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    const init = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
      try {
        const raw = await AsyncStorage.getItem('authData');
        if (raw) {
          const authData = JSON.parse(raw);
          const orgId =
            authData.organization_id ||
            authData.user?.organization_id ||
            authData.organization?.id ||
            authData.user?.organization?.id ||
            null;
          setCurrentUserOrgId(orgId);
        }
      } catch {
        // ignore
      }
    };
    init();
  }, []);

  const fetchSMSBlastData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await apiClient.get('/sms-blast');
      const result = response.data;
      if (result.status === 'success') {
        setSmsBlastRecords(Array.isArray(result.data) ? result.data : []);
      } else {
        throw new Error(result.message || 'Failed to fetch records');
      }
    } catch (err: any) {
      console.error('Failed to fetch SMS Blast records:', err);
      setError(err.message || 'Failed to load SMS Blast records. Please try again.');
      setSmsBlastRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSMSBlastData();
  }, [fetchSMSBlastData]);

  // Auto silent-refresh every 15 minutes
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchSMSBlastData().catch((err) => console.error('Idle refresh failed:', err));
    }, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchSMSBlastData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchSMSBlastData();
    setRefreshing(false);
  };

  const filteredRecords = useMemo(() => {
    let filtered = [...smsBlastRecords];

    // Organization filter
    filtered = filtered.filter((record) => {
      if (currentUserOrgId) {
        return record.organization_id === currentUserOrgId;
      } else {
        const recordOrg = record.organization_id === undefined ? null : record.organization_id;
        return recordOrg === null;
      }
    });

    // Search filter
    if (searchQuery) {
      const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
      filtered = filtered.filter((record) => {
        const checkValue = (val: any): boolean => {
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
        };
        return (
          checkValue(record.message) ||
          checkValue(record.modifiedEmail) ||
          checkValue(record.userEmail) ||
          checkValue(record.barangay) ||
          checkValue(record.city)
        );
      });
    }

    return filtered;
  }, [smsBlastRecords, searchQuery, currentUserOrgId]);

  const getTargetLabel = (record: SMSBlastRecord): string => {
    if (record.target_name && record.target_name !== 'N/A') {
      if (record.target_type && record.target_type !== 'N/A') {
        return `${record.target_name} | ${record.target_type}`;
      }
      return record.target_name;
    }
    if (record.target_type && record.target_type !== 'N/A') {
      return record.target_type;
    }
    return 'General Blast';
  };

  const renderItem = ({ item }: { item: SMSBlastRecord }) => (
    <TouchableOpacity
      onPress={() => setSelectedSMSBlast(item)}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: selectedSMSBlast?.id === item.id ? '#f3f4f6' : '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
          <Text
            style={{ fontSize: 13, fontWeight: '700', color: primaryColor, marginBottom: 3 }}
            numberOfLines={1}
          >
            {getTargetLabel(item)}
          </Text>
          <Text style={{ fontSize: 13, color: '#4b5563' }} numberOfLines={1}>
            {item.message}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: primaryColor }}>
            {item.message_count || 0} Sent
          </Text>
          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {item.modifiedDate}
          </Text>
          <Text style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
            by: {item.modifiedEmail}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>SMS Blast</Text>
          <View style={{ flex: 1 }}>
            <GlobalSearch
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search SMS logs..."
            />
          </View>
          <TouchableOpacity
            onPress={() => setIsAddModalOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 8,
              backgroundColor: primaryColor,
            }}
          >
            <Plus size={16} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 13 }}>Add</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 12, color: '#6b7280' }}>{filteredRecords.length} record(s)</Text>
      </View>

      {/* Body */}
      {isLoading && smsBlastRecords.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 }}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={{ color: '#6b7280', marginTop: 12 }}>Loading SMS Blast records...</Text>
        </View>
      ) : error && smsBlastRecords.length === 0 ? (
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 12 }}
        >
          <Text
            style={{
              fontSize: 15,
              fontWeight: '600',
              color: '#ef4444',
              textAlign: 'center',
              paddingHorizontal: 24,
            }}
          >
            {error}
          </Text>
          <TouchableOpacity
            onPress={fetchSMSBlastData}
            style={{
              paddingHorizontal: 24,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: primaryColor,
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
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
            <View style={{ paddingVertical: 80, alignItems: 'center', gap: 8 }}>
              <Search size={48} color="#d1d5db" />
              <Text style={{ fontSize: 16, fontWeight: '500', color: '#6b7280' }}>
                No SMS Blast records found
              </Text>
              <Text style={{ fontSize: 13, color: '#9ca3af' }}>
                Try adjusting your search query
              </Text>
            </View>
          }
        />
      )}

      {/* Details modal */}
      {selectedSMSBlast && (
        <SMSBlastDetails
          smsBlastRecord={selectedSMSBlast}
          onClose={() => setSelectedSMSBlast(null)}
          colorPalette={colorPalette}
        />
      )}

      <AddSMSBlastModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={fetchSMSBlastData}
      />
    </View>
  );
};

export default SMSBlast;

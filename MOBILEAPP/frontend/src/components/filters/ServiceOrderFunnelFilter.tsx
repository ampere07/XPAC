import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal } from 'react-native';
import { X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../../services/settingsColorPaletteService';

interface ServiceOrderFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date';
    value?: string;
    from?: string | number;
    to?: string | number;
  };
}

interface Column {
  key: string;
  label: string;
  table: string;
  dataType: 'varchar' | 'text' | 'int' | 'bigint' | 'decimal' | 'date' | 'datetime' | 'enum';
}

const STORAGE_KEY = 'serviceOrderFunnelFilters';

const allColumns: Column[] = [
  { key: 'id', label: 'ID', table: 'service_orders', dataType: 'bigint' },
  { key: 'ticket_id', label: 'Ticket ID', table: 'service_orders', dataType: 'varchar' },
  { key: 'timestamp', label: 'Timestamp', table: 'service_orders', dataType: 'datetime' },
  { key: 'account_number', label: 'Account Number', table: 'service_orders', dataType: 'varchar' },
  { key: 'full_name', label: 'Full Name', table: 'service_orders', dataType: 'varchar' },
  { key: 'contact_address', label: 'Contact Address', table: 'service_orders', dataType: 'text' },
  { key: 'date_installed', label: 'Date Installed', table: 'service_orders', dataType: 'date' },
  { key: 'contact_number', label: 'Contact Number', table: 'service_orders', dataType: 'varchar' },
  { key: 'full_address', label: 'Full Address', table: 'service_orders', dataType: 'text' },
  { key: 'house_front_picture', label: 'House Front Picture', table: 'service_orders', dataType: 'text' },
  { key: 'email_address', label: 'Email Address', table: 'service_orders', dataType: 'varchar' },
  { key: 'plan', label: 'Plan', table: 'service_orders', dataType: 'varchar' },
  { key: 'provider', label: 'Provider', table: 'service_orders', dataType: 'varchar' },
  { key: 'affiliate', label: 'Affiliate', table: 'service_orders', dataType: 'varchar' },
  { key: 'username', label: 'Username', table: 'service_orders', dataType: 'varchar' },
  { key: 'connection_type', label: 'Connection Type', table: 'service_orders', dataType: 'enum' },
  { key: 'router_modem_sn', label: 'Router Modem SN', table: 'service_orders', dataType: 'varchar' },
  { key: 'lcp', label: 'LCP', table: 'service_orders', dataType: 'varchar' },
  { key: 'nap', label: 'NAP', table: 'service_orders', dataType: 'varchar' },
  { key: 'port', label: 'Port', table: 'service_orders', dataType: 'varchar' },
  { key: 'vlan', label: 'VLAN', table: 'service_orders', dataType: 'varchar' },
  { key: 'concern', label: 'Concern', table: 'service_orders', dataType: 'varchar' },
  { key: 'concern_remarks', label: 'Concern Remarks', table: 'service_orders', dataType: 'text' },
  { key: 'visit_status', label: 'Visit Status', table: 'service_orders', dataType: 'enum' },
  { key: 'visit_by', label: 'Visit By', table: 'service_orders', dataType: 'varchar' },
  { key: 'visit_with', label: 'Visit With', table: 'service_orders', dataType: 'varchar' },
  { key: 'visit_with_other', label: 'Visit With Other', table: 'service_orders', dataType: 'varchar' },
  { key: 'visit_remarks', label: 'Visit Remarks', table: 'service_orders', dataType: 'text' },
  { key: 'modified_by', label: 'Modified By', table: 'service_orders', dataType: 'varchar' },
  { key: 'modified_date', label: 'Modified Date', table: 'service_orders', dataType: 'datetime' },
  { key: 'user_email', label: 'User Email', table: 'service_orders', dataType: 'varchar' },
  { key: 'requested_by', label: 'Requested By', table: 'service_orders', dataType: 'varchar' },
  { key: 'assigned_email', label: 'Assigned Email', table: 'service_orders', dataType: 'varchar' },
  { key: 'support_remarks', label: 'Support Remarks', table: 'service_orders', dataType: 'text' },
  { key: 'service_charge', label: 'Service Charge', table: 'service_orders', dataType: 'decimal' },
  { key: 'repair_category', label: 'Repair Category', table: 'service_orders', dataType: 'varchar' },
  { key: 'support_status', label: 'Support Status', table: 'service_orders', dataType: 'enum' },
  { key: 'priority_level', label: 'Priority Level', table: 'service_orders', dataType: 'enum' },
  { key: 'new_router_sn', label: 'New Router SN', table: 'service_orders', dataType: 'varchar' },
  { key: 'new_lcpnap', label: 'New LCPNAP', table: 'service_orders', dataType: 'varchar' },
  { key: 'new_plan', label: 'New Plan', table: 'service_orders', dataType: 'varchar' },
  { key: 'client_signature_url', label: 'Client Signature URL', table: 'service_orders', dataType: 'text' },
  { key: 'image1_url', label: 'Image 1 URL', table: 'service_orders', dataType: 'text' },
  { key: 'image2_url', label: 'Image 2 URL', table: 'service_orders', dataType: 'text' },
  { key: 'image3_url', label: 'Image 3 URL', table: 'service_orders', dataType: 'text' },
  { key: 'created_at', label: 'Created At', table: 'service_orders', dataType: 'datetime' },
  { key: 'updated_at', label: 'Updated At', table: 'service_orders', dataType: 'datetime' },
  { key: 'created_by_user_email', label: 'Created By User Email', table: 'service_orders', dataType: 'varchar' },
  { key: 'updated_by_user_email', label: 'Updated By User Email', table: 'service_orders', dataType: 'varchar' },
];

const ServiceOrderFunnelFilter: React.FC<ServiceOrderFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters
}) => {
  const isDarkMode = false; // Forced light mode as per user request
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});

  useEffect(() => {
    // Dark mode loading removed as per user request
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

  useEffect(() => {
    if (isOpen) {
      const loadSavedFilters = async () => {
        const savedFilters = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedFilters) {
          try {
            setFilterValues(JSON.parse(savedFilters));
          } catch (err) {
            console.error('Failed to load saved filters:', err);
          }
        } else if (currentFilters) {
          setFilterValues(currentFilters);
        }
      };
      loadSavedFilters();
    }
  }, [isOpen, currentFilters]);

  const handleColumnClick = (column: Column) => {
    setSelectedColumn(column);
  };

  const handleBack = () => {
    setSelectedColumn(null);
  };

  const handleApply = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filterValues));
    onApplyFilters(filterValues);
    onClose();
  };

  const handleReset = async () => {
    setFilterValues({});
    setSelectedColumn(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const isNumericType = (dataType: string) => {
    return ['int', 'bigint', 'decimal'].includes(dataType);
  };

  const isDateType = (dataType: string) => {
    return ['date', 'datetime'].includes(dataType);
  };

  const handleTextChange = (columnKey: string, value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: {
        type: 'text',
        value
      }
    }));
  };

  const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: {
        ...prev[columnKey],
        type: 'number',
        [field]: value
      }
    }));
  };

  const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: {
        ...prev[columnKey],
        type: 'date',
        [field]: value
      }
    }));
  };

  const getActiveFilterCount = () => {
    return Object.keys(filterValues).filter(key => {
      const filter = filterValues[key];
      if (filter.type === 'text') {
        return filter.value && filter.value.trim() !== '';
      }
      return filter.from !== undefined || filter.to !== undefined;
    }).length;
  };

  const groupedColumns = {
    service_orders: allColumns.filter(col => col.table === 'service_orders')
  };

  const renderFilterInput = () => {
    if (!selectedColumn) return null;

    const currentValue = filterValues[selectedColumn.key];

    if (isNumericType(selectedColumn.dataType)) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: '#374151' }}>
              From
            </Text>
            <TextInput
              keyboardType="numeric"
              value={currentValue?.from?.toString() || ''}
              onChangeText={(value) => handleRangeChange(selectedColumn.key, 'from', value)}
              placeholder="Minimum value"
              placeholderTextColor="#9ca3af"
              style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', color: '#111827' }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: '#374151' }}>
              To
            </Text>
            <TextInput
              keyboardType="numeric"
              value={currentValue?.to?.toString() || ''}
              onChangeText={(value) => handleRangeChange(selectedColumn.key, 'to', value)}
              placeholder="Maximum value"
              placeholderTextColor="#9ca3af"
              style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', color: '#111827' }}
            />
          </View>
        </View>
      );
    }

    if (isDateType(selectedColumn.dataType)) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: isDarkMode ? '#d1d5db' : '#374151' }}>
              From
            </Text>
            <TextInput
              value={currentValue?.from?.toString() || ''}
              onChangeText={(value) => handleDateChange(selectedColumn.key, 'from', value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
              style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: isDarkMode ? '#374151' : '#d1d5db', backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', color: isDarkMode ? '#ffffff' : '#111827' }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: isDarkMode ? '#d1d5db' : '#374151' }}>
              To
            </Text>
            <TextInput
              value={currentValue?.to?.toString() || ''}
              onChangeText={(value) => handleDateChange(selectedColumn.key, 'to', value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
              style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: isDarkMode ? '#374151' : '#d1d5db', backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', color: isDarkMode ? '#ffffff' : '#111827' }}
            />
          </View>
        </View>
      );
    }

    return (
      <View>
        <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: '#374151' }}>
          Search Value
        </Text>
        <TextInput
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChangeText={(value) => handleTextChange(selectedColumn.key, value)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          placeholderTextColor="#9ca3af"
          style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', color: '#111827' }}
        />
      </View>
    );
  };

  if (!isOpen) return null;

  const activeFilterCount = getActiveFilterCount();

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
          onPress={onClose}
        />

        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, maxWidth: 448, width: '100%', flexDirection: 'row' }}>
          <View style={{ width: '100%', maxWidth: 448, backgroundColor: '#ffffff' }}>
            <View style={{ height: '100%', flexDirection: 'column' }}>
              <View style={{ paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {selectedColumn && (
                      <Pressable
                        onPress={handleBack}
                        style={{ padding: 8, borderRadius: 8 }}
                      >
                        <ChevronLeft width={20} height={20} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                      </Pressable>
                    )}
                    <View>
                      <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
                        {selectedColumn ? selectedColumn.label : 'Filter'}
                      </Text>
                      {!selectedColumn && activeFilterCount > 0 && (
                        <Text style={{ fontSize: 12, marginTop: 4, color: isDarkMode ? '#9ca3af' : '#4b5563' }}>
                          {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                        </Text>
                      )}
                    </View>
                  </View>
                  <Pressable
                    onPress={onClose}
                    style={{ padding: 8, borderRadius: 8 }}
                  >
                    <X width={20} height={20} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                  </Pressable>
                </View>
              </View>

              <ScrollView style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 16 }} showsVerticalScrollIndicator={false}>
                {selectedColumn ? (
                  renderFilterInput()
                ) : (
                  <View style={{ gap: 24 }}>
                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#4b5563' }}>
                        Service Order Details
                      </Text>
                      <View style={{ flexDirection: 'column', gap: 8, width: '100%' }}>
                        {groupedColumns.service_orders.map(column => {
                          const hasFilter = filterValues[column.key] && (
                            filterValues[column.key].value ||
                            filterValues[column.key].from !== undefined ||
                            filterValues[column.key].to !== undefined
                          );

                          return (
                            <Pressable
                              key={column.key}
                              onPress={() => handleColumnClick(column)}
                              style={{ width: '100%', padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={{ fontSize: 14, fontWeight: '500', color: '#111827' }}>
                                  {column.label}
                                </Text>
                                {hasFilter && (
                                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorPalette?.primary || '#7c3aed' }} />
                                )}
                              </View>
                              <ChevronRight width={16} height={16} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                )}
              </ScrollView>

              <View style={{ paddingHorizontal: 24, paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable
                    onPress={handleReset}
                    style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4, backgroundColor: '#e5e7eb' }}
                  >
                    <Text style={{ color: '#111827', textAlign: 'center', fontWeight: '500' }}>Clear All</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleApply}
                    style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4, backgroundColor: colorPalette?.primary || '#7c3aed' }}
                  >
                    <Text style={{ color: '#ffffff', textAlign: 'center', fontWeight: '500' }}>Apply Filters</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ServiceOrderFunnelFilter;

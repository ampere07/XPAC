import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal } from 'react-native';
import { X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../../services/settingsColorPaletteService';

interface JobOrderFunnelFilterProps {
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

const STORAGE_KEY = 'jobOrderFunnelFilters';

const allColumns: Column[] = [
  { key: 'id', label: 'ID', table: 'job_orders', dataType: 'bigint' },
  { key: 'application_id', label: 'Application ID', table: 'job_orders', dataType: 'bigint' },
  { key: 'timestamp', label: 'Timestamp', table: 'job_orders', dataType: 'datetime' },
  { key: 'date_installed', label: 'Date Installed', table: 'job_orders', dataType: 'date' },
  { key: 'installation_fee', label: 'Installation Fee', table: 'job_orders', dataType: 'decimal' },
  { key: 'billing_day', label: 'Billing Day', table: 'job_orders', dataType: 'int' },
  { key: 'billing_status_id', label: 'Billing Status ID', table: 'job_orders', dataType: 'bigint' },
  { key: 'modem_router_sn', label: 'Modem/Router SN', table: 'job_orders', dataType: 'varchar' },
  { key: 'router_model', label: 'Router Model', table: 'job_orders', dataType: 'varchar' },
  { key: 'group_name', label: 'Group Name', table: 'job_orders', dataType: 'varchar' },
  { key: 'lcpnap', label: 'LCPNAP', table: 'job_orders', dataType: 'varchar' },
  { key: 'port', label: 'PORT', table: 'job_orders', dataType: 'varchar' },
  { key: 'vlan', label: 'VLAN', table: 'job_orders', dataType: 'varchar' },
  { key: 'username', label: 'Username', table: 'job_orders', dataType: 'varchar' },
  { key: 'ip_address', label: 'IP Address', table: 'job_orders', dataType: 'varchar' },
  { key: 'connection_type', label: 'Connection Type', table: 'job_orders', dataType: 'enum' },
  { key: 'usage_type', label: 'Usage Type', table: 'job_orders', dataType: 'varchar' },
  { key: 'username_status', label: 'Username Status', table: 'job_orders', dataType: 'varchar' },
  { key: 'visit_by', label: 'Visit By', table: 'job_orders', dataType: 'varchar' },
  { key: 'visit_with', label: 'Visit With', table: 'job_orders', dataType: 'varchar' },
  { key: 'visit_with_other', label: 'Visit With Other', table: 'job_orders', dataType: 'varchar' },
  { key: 'onsite_status', label: 'Onsite Status', table: 'job_orders', dataType: 'enum' },
  { key: 'onsite_remarks', label: 'Onsite Remarks', table: 'job_orders', dataType: 'text' },
  { key: 'status_remarks', label: 'Status Remarks', table: 'job_orders', dataType: 'text' },
  { key: 'address_coordinates', label: 'Address Coordinates', table: 'job_orders', dataType: 'varchar' },
  { key: 'contract_link', label: 'Contract Link', table: 'job_orders', dataType: 'text' },
  { key: 'client_signature_url', label: 'Client Signature URL', table: 'job_orders', dataType: 'text' },
  { key: 'setup_image_url', label: 'Setup Image URL', table: 'job_orders', dataType: 'text' },
  { key: 'speedtest_image_url', label: 'Speedtest Image URL', table: 'job_orders', dataType: 'text' },
  { key: 'signed_contract_image_url', label: 'Signed Contract Image URL', table: 'job_orders', dataType: 'text' },
  { key: 'box_reading_image_url', label: 'Box Reading Image URL', table: 'job_orders', dataType: 'text' },
  { key: 'router_reading_image_url', label: 'Router Reading Image URL', table: 'job_orders', dataType: 'text' },
  { key: 'port_label_image_url', label: 'Port Label Image URL', table: 'job_orders', dataType: 'text' },
  { key: 'house_front_picture_url', label: 'House Front Picture URL', table: 'job_orders', dataType: 'text' },
  { key: 'created_at', label: 'Created At', table: 'job_orders', dataType: 'datetime' },
  { key: 'created_by_user_email', label: 'Created By User Email', table: 'job_orders', dataType: 'varchar' },
  { key: 'updated_at', label: 'Updated At', table: 'job_orders', dataType: 'datetime' },
  { key: 'updated_by_user_email', label: 'Updated By User Email', table: 'job_orders', dataType: 'varchar' },
  { key: 'assigned_email', label: 'Assigned Email', table: 'job_orders', dataType: 'varchar' },
  { key: 'pppoe_username', label: 'PPPoE Username', table: 'job_orders', dataType: 'varchar' },
  { key: 'pppoe_password', label: 'PPPoE Password', table: 'job_orders', dataType: 'varchar' },
  { key: 'full_name', label: 'Full Name', table: 'job_orders', dataType: 'varchar' },
  { key: 'address', label: 'Address', table: 'job_orders', dataType: 'text' },
  { key: 'contract_template', label: 'Contract Template', table: 'job_orders', dataType: 'varchar' },
  { key: 'first_name', label: 'First Name', table: 'job_orders', dataType: 'varchar' },
  { key: 'middle_initial', label: 'Middle Initial', table: 'job_orders', dataType: 'varchar' },
  { key: 'last_name', label: 'Last Name', table: 'job_orders', dataType: 'varchar' },
  { key: 'contact_number', label: 'Contact Number', table: 'job_orders', dataType: 'varchar' },
  { key: 'second_contact_number', label: 'Second Contact Number', table: 'job_orders', dataType: 'varchar' },
  { key: 'email_address', label: 'Email Address', table: 'job_orders', dataType: 'varchar' },
  { key: 'region', label: 'Region', table: 'job_orders', dataType: 'varchar' },
  { key: 'city', label: 'City', table: 'job_orders', dataType: 'varchar' },
  { key: 'barangay', label: 'Barangay', table: 'job_orders', dataType: 'varchar' },
  { key: 'location', label: 'Location', table: 'job_orders', dataType: 'varchar' },
  { key: 'choose_plan', label: 'Choose Plan', table: 'job_orders', dataType: 'varchar' },
  { key: 'referred_by', label: 'Referred By', table: 'job_orders', dataType: 'varchar' },
  { key: 'start_timestamp', label: 'Start Timestamp', table: 'job_orders', dataType: 'datetime' },
  { key: 'end_timestamp', label: 'End Timestamp', table: 'job_orders', dataType: 'datetime' },
  { key: 'duration', label: 'Duration', table: 'job_orders', dataType: 'varchar' },
];

const JobOrderFunnelFilter: React.FC<JobOrderFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters
}) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});



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
    job_orders: allColumns.filter(col => col.table === 'job_orders')
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
              placeholderTextColor={'#9ca3af'}
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
              placeholderTextColor={'#9ca3af'}
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
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: '#374151' }}>
              From
            </Text>
            <TextInput
              value={currentValue?.from?.toString() || ''}
              onChangeText={(value) => handleDateChange(selectedColumn.key, 'from', value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={'#9ca3af'}
              style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', color: '#111827' }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: '#374151' }}>
              To
            </Text>
            <TextInput
              value={currentValue?.to?.toString() || ''}
              onChangeText={(value) => handleDateChange(selectedColumn.key, 'to', value)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={'#9ca3af'}
              style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', color: '#111827' }}
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
          placeholderTextColor={'#9ca3af'}
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
                        <ChevronLeft width={20} height={20} color={'#4b5563'} />
                      </Pressable>
                    )}
                    <View>
                      <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
                        {selectedColumn ? selectedColumn.label : 'Filter'}
                      </Text>
                      {!selectedColumn && activeFilterCount > 0 && (
                        <Text style={{ fontSize: 12, marginTop: 4, color: '#4b5563' }}>
                          {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                        </Text>
                      )}
                    </View>
                  </View>
                  <Pressable
                    onPress={onClose}
                    style={{ padding: 8, borderRadius: 8 }}
                  >
                    <X width={20} height={20} color={'#4b5563'} />
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
                        Job Order Details
                      </Text>
                      <View style={{ flexDirection: 'column', gap: 8, width: '100%' }}>
                        {groupedColumns.job_orders.map(column => {
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
                              <ChevronRight width={16} height={16} color={'#4b5563'} />
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

export default JobOrderFunnelFilter;

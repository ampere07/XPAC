import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { X, ChevronLeft, ChevronRight, Search, Check, Calendar } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { planService } from '../services/planService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})`
    : hex;
};

interface ApplicationFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist' | 'boolean';
    value?: string | boolean;
    from?: string | number;
    to?: string | number;
    selectedOptions?: string[];
  };
}

interface Column {
  key: string;
  label: string;
  dataType: 'varchar' | 'text' | 'int' | 'decimal' | 'date' | 'datetime' | 'checklist' | 'bigint';
}

const STORAGE_KEY = 'applicationFunnelFilters';

/** `YYYY-MM-DD` — the same value shape the web `<input type="date">` stored. */
const toIsoDay = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const parseIsoDay = (value: string) => {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const allColumns: Column[] = [
  { key: 'id', label: 'ID', dataType: 'int' },
  { key: 'timestamp', label: 'Timestamp', dataType: 'datetime' },
  { key: 'email_address', label: 'Email Address', dataType: 'varchar' },
  { key: 'region', label: 'Region', dataType: 'checklist' },
  { key: 'city', label: 'City', dataType: 'checklist' },
  { key: 'barangay', label: 'Barangay', dataType: 'checklist' },
  { key: 'referred_by', label: 'Referred by:', dataType: 'varchar' },
  { key: 'first_name', label: 'First Name', dataType: 'varchar' },
  { key: 'middle_initial', label: 'Middle Initial', dataType: 'varchar' },
  { key: 'last_name', label: 'Last Name', dataType: 'varchar' },
  { key: 'mobile_number', label: 'Mobile Number', dataType: 'varchar' },
  { key: 'location', label: 'Address Coordinates', dataType: 'varchar' },
  { key: 'landmark', label: 'Landmark', dataType: 'varchar' },
  { key: 'desired_plan', label: 'Desired Plan', dataType: 'checklist' },
  { key: 'usage_type', label: 'Usage Type', dataType: 'varchar' },
  { key: 'ownership', label: 'Ownership', dataType: 'varchar' },
  { key: 'proof_of_billing_url', label: 'Proof of Billing', dataType: 'varchar' },
  { key: 'house_front_picture_url', label: 'House_Front_Image', dataType: 'varchar' },
  { key: 'government_valid_id_url', label: 'Valid ID', dataType: 'varchar' },
  { key: 'terms_agreed', label: 'I agree to the terms and conditions', dataType: 'checklist' },
  { key: 'applying_for', label: 'Applying for :', dataType: 'varchar' },
  { key: 'status', label: 'Status', dataType: 'checklist' },
  { key: 'visit_by', label: 'Visit By', dataType: 'varchar' },
  { key: 'visit_with', label: 'Visit With', dataType: 'varchar' },
  { key: 'visit_with_other', label: 'Visit With(Other)', dataType: 'varchar' },
  { key: 'remarks', label: 'Remarks', dataType: 'text' },
  { key: 'updated_by', label: 'Modified By', dataType: 'varchar' },
  { key: 'user_email', label: 'User Email', dataType: 'varchar' },
  { key: 'computed_time', label: '_ComputedTime', dataType: 'datetime' },
  { key: 'installation_address', label: 'Full Address', dataType: 'varchar' },
];

const ApplicationFunnelFilter: React.FC<ApplicationFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters,
}) => {
  const isDarkMode = false;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = Dimensions.get('window');
  const [rendered, setRendered] = useState(isOpen);
  const slideX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [searchTerm, setSearchTerm] = useState('');

  const [plans, setPlans] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  // Which end of a date range is being picked, if any.
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  // Slide the drawer in from the right on open, out to the right on close.
  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      Animated.parallel([
        Animated.timing(slideX, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0.4, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideX, { toValue: screenWidth, duration: 220, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved) {
          try { setFilterValues(JSON.parse(saved)); } catch { /* ignore */ }
        } else if (currentFilters) {
          setFilterValues(currentFilters);
        }
      })
      .catch(() => {
        if (currentFilters) setFilterValues(currentFilters);
      });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    setLoadingChecklist(true);
    Promise.all([
      planService.getAllPlans(),
      apiClient.get<{ success: boolean; data: { barangays: string[]; cities: string[]; regions: string[] } }>(
        '/lookup/customer-locations'
      ),
    ])
      .then(([planData, locRes]) => {
        if (planData) {
          setPlans(
            planData.map((p) => {
              const name = p.name || (p as any).plan_name || 'Unknown';
              const price = Math.floor(Number(p.price || 0));
              return `${name} ${price}`;
            })
          );
        }
        if ((locRes as any).data?.success) {
          const d = (locRes as any).data.data;
          setBarangays(d.barangays || []);
          setCities(d.cities || []);
          setRegions(d.regions || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingChecklist(false));
  }, [isOpen]);

  const handleColumnClick = (col: Column) => {
    setSelectedColumn(col);
    setSearchTerm('');
  };

  const handleBack = () => {
    setSelectedColumn(null);
    setSearchTerm('');
    setDatePickerTarget(null);
  };

  const handleApply = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filterValues));
    } catch { /* ignore */ }
    onApplyFilters(filterValues);
    onClose();
  };

  const handleReset = async () => {
    setFilterValues({});
    setSelectedColumn(null);
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  const isNumericType = (dt: string) => ['int', 'decimal', 'bigint'].includes(dt);
  const isDateType = (dt: string) => ['date', 'datetime'].includes(dt);

  const handleTextChange = (columnKey: string, value: string) => {
    if (value === '') {
      const next = { ...filterValues };
      delete next[columnKey];
      setFilterValues(next);
    } else {
      setFilterValues((prev) => ({ ...prev, [columnKey]: { type: 'text', value } }));
    }
  };

  const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues((prev) => {
      const current = prev[columnKey] || { type: 'number' };
      const next: any = { ...current, [field]: value };
      if (!next.from && !next.to) {
        const copy = { ...prev };
        delete copy[columnKey];
        return copy;
      }
      return { ...prev, [columnKey]: next };
    });
  };

  const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues((prev) => {
      const current = prev[columnKey] || { type: 'date' };
      const next: any = { ...current, [field]: value };
      if (!next.from && !next.to) {
        const copy = { ...prev };
        delete copy[columnKey];
        return copy;
      }
      return { ...prev, [columnKey]: next };
    });
  };

  const toggleOption = (columnKey: string, option: string) => {
    setFilterValues((prev) => {
      const current = prev[columnKey] || { type: 'checklist', selectedOptions: [] };
      const selected = current.selectedOptions || [];
      const nextOptions = selected.includes(option)
        ? selected.filter((o) => o !== option)
        : [...selected, option];
      if (nextOptions.length === 0) {
        const copy = { ...prev };
        delete copy[columnKey];
        return copy;
      }
      return { ...prev, [columnKey]: { ...current, type: 'checklist', selectedOptions: nextOptions } };
    });
  };

  const renderFilterInput = () => {
    if (!selectedColumn) return null;
    const currentValue = filterValues[selectedColumn.key];

    if (selectedColumn.dataType === 'checklist') {
      let options: { label: string; value: string }[] = [];
      if (selectedColumn.key === 'desired_plan') {
        options = plans.map((p) => ({ label: p, value: p }));
      } else if (selectedColumn.key === 'barangay') {
        options = barangays.map((b) => ({ label: b, value: b }));
      } else if (selectedColumn.key === 'city') {
        options = cities.map((c) => ({ label: c, value: c }));
      } else if (selectedColumn.key === 'region') {
        options = regions.map((r) => ({ label: r, value: r }));
      } else if (selectedColumn.key === 'status') {
        options = [
          { label: 'Scheduled', value: 'scheduled' },
          { label: 'Duplicate', value: 'duplicate' },
          { label: 'No Slot', value: 'no slot' },
          { label: 'Cancelled', value: 'cancelled' },
          { label: 'No Facility', value: 'no facility' },
          { label: 'Pending', value: 'pending' },
          { label: 'Confirmed', value: 'confirmed' },
          { label: 'In Progress', value: 'in progress' },
          { label: 'Completed', value: 'completed' },
        ];
      } else if (selectedColumn.key === 'terms_agreed') {
        options = [{ label: 'Agreed', value: 'true' }];
      }

      // Sort dynamic option lists alphabetically; keep 'status' in its workflow order.
      if (selectedColumn.key !== 'status') {
        options = [...options].sort((a, b) => a.label.localeCompare(b.label));
      }

      const filteredOptions = options.filter((opt) =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
      );

      return (
        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#f3f4f6',
              borderRadius: 8,
              paddingHorizontal: 12,
              marginBottom: 12,
            }}
          >
            <Search size={16} color="#9ca3af" />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search options..."
              placeholderTextColor="#9ca3af"
              style={{ flex: 1, marginLeft: 8, paddingVertical: 8, fontSize: 14, color: '#111827' }}
            />
          </View>
          {loadingChecklist ? (
            <ActivityIndicator color={primary} style={{ marginTop: 16 }} />
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map((option, idx) => {
              const isSelected = currentValue?.selectedOptions?.includes(option.value);
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => toggleOption(selectedColumn.key, option.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    borderRadius: 12,
                    marginBottom: 4,
                    backgroundColor: isSelected ? hexToRgba(primary, 0.08) : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '500', color: isSelected ? primary : '#374151' }}>
                    {option.label}
                  </Text>
                  {isSelected && <Check size={16} color={primary} />}
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={{ textAlign: 'center', color: '#9ca3af', marginTop: 24, fontSize: 14 }}>
              No results found
            </Text>
          )}
        </View>
      );
    }

    if (isNumericType(selectedColumn.dataType)) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>From</Text>
            <TextInput
              keyboardType="numeric"
              value={String(currentValue?.from || '')}
              onChangeText={(v) => handleRangeChange(selectedColumn.key, 'from', v)}
              placeholder="Minimum value"
              placeholderTextColor="#9ca3af"
              style={{
                borderWidth: 1,
                borderColor: '#d1d5db',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 14,
                color: '#111827',
                backgroundColor: '#fff',
              }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>To</Text>
            <TextInput
              keyboardType="numeric"
              value={String(currentValue?.to || '')}
              onChangeText={(v) => handleRangeChange(selectedColumn.key, 'to', v)}
              placeholder="Maximum value"
              placeholderTextColor="#9ca3af"
              style={{
                borderWidth: 1,
                borderColor: '#d1d5db',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 14,
                color: '#111827',
                backgroundColor: '#fff',
              }}
            />
          </View>
        </View>
      );
    }

    if (isDateType(selectedColumn.dataType)) {
      const dateTrigger = (field: 'from' | 'to') => {
        const value = String(currentValue?.[field] || '');
        return (
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>
              {field === 'from' ? 'From' : 'To'}
            </Text>
            <TouchableOpacity
              onPress={() => setDatePickerTarget(field)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: value ? primary : '#d1d5db',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: '#fff',
              }}
            >
              <Text style={{ fontSize: 14, color: value ? '#111827' : '#9ca3af' }}>
                {value || 'Select date'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {!!value && (
                  <TouchableOpacity onPress={() => handleDateChange(selectedColumn.key, field, '')} hitSlop={8}>
                    <X size={14} color="#9ca3af" />
                  </TouchableOpacity>
                )}
                <Calendar size={16} color={value ? primary : '#9ca3af'} />
              </View>
            </TouchableOpacity>
          </View>
        );
      };

      return (
        <View style={{ gap: 16 }}>
          {dateTrigger('from')}
          {dateTrigger('to')}
          {datePickerTarget && (
            <DateTimePicker
              value={parseIsoDay(String(currentValue?.[datePickerTarget] || ''))}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, date) => {
                const target = datePickerTarget;
                setDatePickerTarget(null);
                if (event?.type !== 'set' || !date || !target) return;
                handleDateChange(selectedColumn.key, target, toIsoDay(date));
              }}
            />
          )}
        </View>
      );
    }

    // Default: text
    return (
      <View>
        <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>Search Value</Text>
        <TextInput
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChangeText={(v) => handleTextChange(selectedColumn.key, v)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontSize: 14,
            color: '#111827',
            backgroundColor: '#fff',
          }}
        />
      </View>
    );
  };

  return (
    <Modal visible={rendered} animationType="none" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdropOpacity }}
        />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{ width: '92%', maxWidth: 560, backgroundColor: '#fff', height: '100%', transform: [{ translateX: slideX }] }}>
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#f3f4f6',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {selectedColumn && (
                <TouchableOpacity
                  onPress={handleBack}
                  style={{ padding: 6, borderRadius: 8, backgroundColor: '#f3f4f6' }}
                >
                  <ChevronLeft size={18} color="#374151" />
                </TouchableOpacity>
              )}
              <View>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>
                  {selectedColumn ? selectedColumn.label : 'Application Filters'}
                </Text>
                {!selectedColumn && (
                  <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    Refine your application results
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 6, borderRadius: 8, backgroundColor: '#f3f4f6' }}>
              <X size={18} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={{ flex: 1, paddingHorizontal: 20, paddingVertical: 16 }}>
            {selectedColumn ? (
              renderFilterInput()
            ) : (
              <View style={{ gap: 4 }}>
                {[...allColumns]
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((column) => {
                  const isActive = !!filterValues[column.key];
                  return (
                    <TouchableOpacity
                      key={column.key}
                      onPress={() => handleColumnClick(column)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 14,
                        paddingHorizontal: 12,
                        borderRadius: 16,
                        backgroundColor: isActive ? hexToRgba(primary, 0.05) : 'transparent',
                        borderWidth: 1,
                        borderColor: isActive ? hexToRgba(primary, 0.15) : 'transparent',
                        marginBottom: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: '600',
                          color: isActive ? primary : '#374151',
                        }}
                      >
                        {column.label}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {isActive && (
                          <View
                            style={{
                              backgroundColor: hexToRgba(primary, 0.12),
                              borderRadius: 99,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                            }}
                          >
                            <Text style={{ fontSize: 9, fontWeight: '700', color: primary, letterSpacing: 1 }}>
                              ACTIVE
                            </Text>
                          </View>
                        )}
                        <ChevronRight size={16} color="#d1d5db" />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: insets.bottom + 20,
              borderTopWidth: 1,
              borderTopColor: '#f3f4f6',
              backgroundColor: '#fafafa',
            }}
          >
            <TouchableOpacity
              onPress={handleReset}
              style={{
                flex: 1,
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: '#fff',
                borderWidth: 1,
                borderColor: '#e5e7eb',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#6b7280' }}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              style={{
                flex: 1,
                paddingVertical: 14,
                borderRadius: 16,
                backgroundColor: primary,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default ApplicationFunnelFilter;

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { planService } from '../services/planService';

interface ApplicationVisitFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist';
    value?: string;
    from?: string | number;
    to?: string | number;
    selectedOptions?: string[];
  };
}

interface Column {
  key: string;
  label: string;
  table: string;
  dataType: 'varchar' | 'text' | 'int' | 'bigint' | 'decimal' | 'date' | 'datetime' | 'enum' | 'checklist';
}

const STORAGE_KEY = 'applicationVisitFunnelFilters';

const allColumns: Column[] = [
  { key: 'id', label: 'ID', table: 'application_visits', dataType: 'bigint' },
  { key: 'application_id', label: 'Application ID', table: 'application_visits', dataType: 'bigint' },
  { key: 'timestamp', label: 'Timestamp', table: 'application_visits', dataType: 'datetime' },
  { key: 'assigned_email', label: 'Assigned Email', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_by', label: 'Visit By', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_with', label: 'Visit With', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_with_other', label: 'Visit With (Other)', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_status', label: 'Visit Status', table: 'application_visits', dataType: 'enum' },
  { key: 'visit_remarks', label: 'Visit Remarks', table: 'application_visits', dataType: 'text' },
  { key: 'status_remarks', label: 'Status Remarks', table: 'application_visits', dataType: 'text' },
  { key: 'application_status', label: 'Application Status', table: 'application_visits', dataType: 'varchar' },
  { key: 'full_name', label: 'Full Name', table: 'application_visits', dataType: 'varchar' },
  { key: 'full_address', label: 'Full Address', table: 'application_visits', dataType: 'text' },
  { key: 'referred_by', label: 'Referred By', table: 'application_visits', dataType: 'varchar' },
  { key: 'updated_by_user_email', label: 'Updated By User Email', table: 'application_visits', dataType: 'varchar' },
  { key: 'created_at', label: 'Created At', table: 'application_visits', dataType: 'datetime' },
  { key: 'updated_at', label: 'Updated At', table: 'application_visits', dataType: 'datetime' },
  { key: 'first_name', label: 'First Name', table: 'application_visits', dataType: 'varchar' },
  { key: 'middle_initial', label: 'Middle Initial', table: 'application_visits', dataType: 'varchar' },
  { key: 'last_name', label: 'Last Name', table: 'application_visits', dataType: 'varchar' },
  { key: 'region', label: 'Region', table: 'application_visits', dataType: 'varchar' },
  { key: 'city', label: 'City', table: 'application_visits', dataType: 'varchar' },
  { key: 'barangay', label: 'Barangay', table: 'application_visits', dataType: 'varchar' },
  { key: 'choose_plan', label: 'Choose Plan', table: 'application_visits', dataType: 'checklist' },
  { key: 'promo', label: 'Promo', table: 'application_visits', dataType: 'varchar' },
];

const isDarkMode = false;

const ApplicationVisitFunnelFilter: React.FC<ApplicationVisitFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters,
}) => {
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

  const primaryColor = colorPalette?.primary || '#7c3aed';

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
    if (isOpen) {
      // Load plans
      planService.getAllPlans().then((planData) => {
        if (planData) {
          const formatted = planData.map((p: any) => {
            const name = p.name || p.plan_name || 'Unknown';
            const price = Math.floor(Number(p.price || 0));
            return `${name} ${price}`;
          });
          setPlans(formatted);
        }
      }).catch(() => {});

      // Load saved filters
      AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
        if (saved) {
          try {
            setFilterValues(JSON.parse(saved));
          } catch {}
        } else if (currentFilters) {
          setFilterValues(currentFilters);
        }
      }).catch(() => {});
    }
  }, [isOpen, currentFilters]);

  const handleColumnClick = (column: Column) => {
    setSelectedColumn(column);
    setSearchTerm('');
  };

  const handleBack = () => {
    setSelectedColumn(null);
    setSearchTerm('');
  };

  const handleApply = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filterValues)).catch(() => {});
    onApplyFilters(filterValues);
    onClose();
  };

  const handleReset = async () => {
    setFilterValues({});
    setSelectedColumn(null);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  };

  const isNumericType = (dataType: string) => ['int', 'bigint', 'decimal'].includes(dataType);
  const isDateType = (dataType: string) => ['date', 'datetime'].includes(dataType);

  const handleTextChange = (columnKey: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [columnKey]: { type: 'text', value } }));
  };

  const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: { ...prev[columnKey], type: 'number', [field]: value },
    }));
  };

  const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: { ...prev[columnKey], type: 'date', [field]: value },
    }));
  };

  const toggleOption = (columnKey: string, option: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'checklist', selectedOptions: [] };
      const selectedOptions = current.selectedOptions || [];
      const nextOptions = selectedOptions.includes(option)
        ? selectedOptions.filter((o: string) => o !== option)
        : [...selectedOptions, option];
      if (nextOptions.length === 0) {
        const newFilters = { ...prev };
        delete newFilters[columnKey];
        return newFilters;
      }
      return { ...prev, [columnKey]: { ...current, type: 'checklist', selectedOptions: nextOptions } };
    });
  };

  const getActiveFilterCount = () =>
    Object.keys(filterValues).filter(key => {
      const filter = filterValues[key];
      if (filter.type === 'text') return filter.value && filter.value.trim() !== '';
      return filter.from !== undefined || filter.to !== undefined || (filter.selectedOptions && filter.selectedOptions.length > 0);
    }).length;

  const renderFilterInput = () => {
    if (!selectedColumn) return null;
    const currentValue = filterValues[selectedColumn.key];

    if (isNumericType(selectedColumn.dataType)) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>From</Text>
            <TextInput
              value={String(currentValue?.from || '')}
              onChangeText={(v) => handleRangeChange(selectedColumn.key, 'from', v)}
              placeholder="Minimum value"
              keyboardType="numeric"
              style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 14,
                color: '#111827',
                backgroundColor: '#ffffff',
              }}
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>To</Text>
            <TextInput
              value={String(currentValue?.to || '')}
              onChangeText={(v) => handleRangeChange(selectedColumn.key, 'to', v)}
              placeholder="Maximum value"
              keyboardType="numeric"
              style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 14,
                color: '#111827',
                backgroundColor: '#ffffff',
              }}
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>
      );
    }

    if (isDateType(selectedColumn.dataType)) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>From (YYYY-MM-DD)</Text>
            <TextInput
              value={String(currentValue?.from || '')}
              onChangeText={(v) => handleDateChange(selectedColumn.key, 'from', v)}
              placeholder="e.g. 2024-01-01"
              style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 14,
                color: '#111827',
                backgroundColor: '#ffffff',
              }}
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>To (YYYY-MM-DD)</Text>
            <TextInput
              value={String(currentValue?.to || '')}
              onChangeText={(v) => handleDateChange(selectedColumn.key, 'to', v)}
              placeholder="e.g. 2024-12-31"
              style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 14,
                color: '#111827',
                backgroundColor: '#ffffff',
              }}
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>
      );
    }

    if (selectedColumn.dataType === 'checklist') {
      const options = selectedColumn.key === 'choose_plan'
        ? plans.map(p => ({ label: p, value: p }))
        : [];
      const filteredOptions = options.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
      );

      return (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, backgroundColor: '#f9fafb', paddingHorizontal: 10 }}>
            <Search size={16} color="#9ca3af" />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder={`Search ${selectedColumn.label}...`}
              style={{ flex: 1, paddingVertical: 10, paddingLeft: 8, fontSize: 14, color: '#111827' }}
              placeholderTextColor="#9ca3af"
            />
          </View>
          <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
            {filteredOptions.length > 0 ? filteredOptions.map((option) => {
              const isSelected = currentValue?.selectedOptions?.includes(option.value) || false;
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => toggleOption(selectedColumn.key, option.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    marginBottom: 4,
                    backgroundColor: isSelected ? `${primaryColor}15` : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 14, color: isSelected ? primaryColor : '#374151', fontWeight: isSelected ? '600' : '400' }}>
                    {option.label}
                  </Text>
                  <View style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    borderWidth: 1.5,
                    borderColor: isSelected ? primaryColor : '#d1d5db',
                    backgroundColor: isSelected ? primaryColor : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {isSelected && <Check size={11} color="#ffffff" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>
              );
            }) : (
              <Text style={{ textAlign: 'center', color: '#9ca3af', paddingVertical: 16, fontSize: 13 }}>
                No options found
              </Text>
            )}
          </ScrollView>
        </View>
      );
    }

    // Default: text filter
    return (
      <View>
        <Text style={{ fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Search Value</Text>
        <TextInput
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChangeText={(v) => handleTextChange(selectedColumn.key, v)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          style={{
            borderWidth: 1,
            borderColor: '#e5e7eb',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 14,
            color: '#111827',
            backgroundColor: '#ffffff',
          }}
          placeholderTextColor="#9ca3af"
        />
      </View>
    );
  };

  const activeFilterCount = getActiveFilterCount();

  return (
    <Modal visible={rendered} animationType="none" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdropOpacity }}
        />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{ width: '92%', maxWidth: 560, backgroundColor: '#ffffff', height: '100%', transform: [{ translateX: slideX }] }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: insets.top,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {selectedColumn && (
                <TouchableOpacity onPress={handleBack} style={{ padding: 4, marginRight: 4 }}>
                  <ChevronLeft size={20} color="#6b7280" />
                </TouchableOpacity>
              )}
              <View>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827' }}>
                  {selectedColumn ? selectedColumn.label : 'Filter'}
                </Text>
                {!selectedColumn && activeFilterCount > 0 && (
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16 }} showsVerticalScrollIndicator={false}>
            {selectedColumn ? (
              renderFilterInput()
            ) : (
              <View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
                  Application Visit Details
                </Text>
                {allColumns.map(column => {
                  const hasFilter = filterValues[column.key] && (
                    filterValues[column.key].value ||
                    filterValues[column.key].from !== undefined ||
                    filterValues[column.key].to !== undefined ||
                    (filterValues[column.key].selectedOptions && filterValues[column.key].selectedOptions!.length > 0)
                  );
                  return (
                    <TouchableOpacity
                      key={column.key}
                      onPress={() => handleColumnClick(column)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 14,
                        borderBottomWidth: 1,
                        borderBottomColor: '#f3f4f6',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 14, color: '#111827' }}>{column.label}</Text>
                        {hasFilter && (
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: primaryColor }} />
                        )}
                      </View>
                      <ChevronRight size={16} color="#9ca3af" />
                    </TouchableOpacity>
                  );
                })}
                <View style={{ height: 20 }} />
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={{
            flexDirection: 'row',
            gap: 12,
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: insets.bottom + 16,
            borderTopWidth: 1,
            borderTopColor: '#e5e7eb',
          }}>
            <TouchableOpacity
              onPress={handleReset}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: '#f3f4f6',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: primaryColor,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#ffffff' }}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default ApplicationVisitFunnelFilter;

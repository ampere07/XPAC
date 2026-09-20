import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { planService } from '../services/planService';
import { paymentMethodService } from '../services/paymentMethodService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})`
    : hex;
};

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist';
    value?: string | (string | number)[];
    from?: string | number;
    to?: string | number;
  };
}

interface Column {
  key: string;
  label: string;
  dataType: 'varchar' | 'text' | 'int' | 'decimal' | 'date' | 'datetime' | 'checklist';
}

const STORAGE_KEY = 'paymentPortalFunnelFilters';

export const allColumns: Column[] = [
  { key: 'reference_no', label: 'Reference No', dataType: 'varchar' },
  { key: 'accountNo', label: 'Account Number', dataType: 'varchar' },
  { key: 'date_time', label: 'Date Time', dataType: 'datetime' },
  { key: 'checkout_id', label: 'Checkout ID', dataType: 'varchar' },
  { key: 'status', label: 'Status', dataType: 'checklist' },
  { key: 'transaction_status', label: 'Transaction Status', dataType: 'checklist' },
  { key: 'plan', label: 'Plan', dataType: 'checklist' },
  { key: 'ewallet_type', label: 'E-Wallet Type', dataType: 'varchar' },
  { key: 'payment_method', label: 'Payment Method', dataType: 'checklist' },
  { key: 'payment_channel', label: 'Payment Channel', dataType: 'checklist' },
  { key: 'fullName', label: 'Name', dataType: 'varchar' },
  { key: 'barangay', label: 'Barangay', dataType: 'checklist' },
  { key: 'city', label: 'City', dataType: 'checklist' },
  { key: 'region', label: 'Region', dataType: 'checklist' },
];

interface PaymentPortalFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

const PaymentPortalFunnelFilter: React.FC<PaymentPortalFunnelFilterProps> = ({
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
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);

  const [statuses, setStatuses] = useState<string[]>([]);
  const [transactionStatuses, setTransactionStatuses] = useState<string[]>([]);
  const [plans, setPlans] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<{ id: number; payment_method: string }[]>([]);
  const [paymentChannels, setPaymentChannels] = useState<string[]>([]);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    const loadPalette = async () => {
      try {
        const p = await settingsColorPaletteService.getActive();
        setColorPalette(p);
      } catch {}
    };
    loadPalette();
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
      const loadSaved = async () => {
        try {
          const saved = await AsyncStorage.getItem(STORAGE_KEY);
          if (saved) {
            setFilterValues(JSON.parse(saved));
          } else if (currentFilters) {
            setFilterValues(currentFilters);
          }
        } catch {}
      };
      loadSaved();
    }
  }, [isOpen, currentFilters]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchChecklistData = async () => {
      setIsLoadingOptions(true);
      try {
        const [ppRes, planData, locRes, pmRes] = await Promise.allSettled([
          apiClient.get<{ success: boolean; data: { statuses: string[]; transaction_statuses: string[]; payment_channels: string[] } }>('/lookup/payment-portal'),
          planService.getAllPlans(),
          apiClient.get<{ success: boolean; data: { barangays: string[]; cities: string[]; regions: string[] } }>('/lookup/customer-locations'),
          paymentMethodService.getAll(),
        ]);

        if (ppRes.status === 'fulfilled' && ppRes.value.data.success) {
          setStatuses(ppRes.value.data.data.statuses);
          setTransactionStatuses(ppRes.value.data.data.transaction_statuses);
          setPaymentChannels(ppRes.value.data.data.payment_channels);
        }
        if (planData.status === 'fulfilled' && planData.value) {
          setPlans(planData.value.map((p: any) => {
            const name = p.name || p.plan_name || 'Unknown';
            const price = Math.floor(Number(p.price || 0));
            return `${name} ${price}`;
          }));
        }
        if (locRes.status === 'fulfilled' && locRes.value.data.success) {
          setBarangays(locRes.value.data.data.barangays);
          setCities(locRes.value.data.data.cities);
          setRegions(locRes.value.data.data.regions);
        }
        if (pmRes.status === 'fulfilled' && pmRes.value.success) {
          setPaymentMethods(pmRes.value.data);
        }
      } catch {}
      setIsLoadingOptions(false);
    };
    fetchChecklistData();
  }, [isOpen]);

  const handleColumnClick = (column: Column) => {
    setSelectedColumn(column);
    setSearchTerm('');
  };

  const handleBack = () => {
    setSelectedColumn(null);
    setSearchTerm('');
  };

  const handleApply = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filterValues));
    } catch {}
    onApplyFilters(filterValues);
    onClose();
  };

  const handleReset = async () => {
    setFilterValues({});
    setSelectedColumn(null);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const isNumericType = (dt: string) => ['int', 'decimal'].includes(dt);
  const isDateType = (dt: string) => ['date', 'datetime'].includes(dt);

  const handleTextChange = (key: string, value: string) => {
    if (value === '') {
      const next = { ...filterValues };
      delete next[key];
      setFilterValues(next);
    } else {
      setFilterValues(prev => ({ ...prev, [key]: { type: 'text', value } }));
    }
  };

  const handleRangeChange = (key: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => {
      const current = prev[key] || { type: 'number' };
      const next: any = { ...current, [field]: value };
      if (!next.from && !next.to) {
        const n = { ...prev };
        delete n[key];
        return n;
      }
      return { ...prev, [key]: next };
    });
  };

  const handleDateChange = (key: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => {
      const current = prev[key] || { type: 'date' };
      const next: any = { ...current, [field]: value };
      if (!next.from && !next.to) {
        const n = { ...prev };
        delete n[key];
        return n;
      }
      return { ...prev, [key]: next };
    });
  };

  const toggleOption = (key: string, option: string | number) => {
    setFilterValues(prev => {
      const current = prev[key] || { type: 'checklist', value: [] };
      const selected = ((current.value as (string | number)[]) || []).map(String);
      const optStr = String(option);
      const next = selected.includes(optStr)
        ? selected.filter(o => o !== optStr)
        : [...selected, optStr];
      if (next.length === 0) {
        const n = { ...prev };
        delete n[key];
        return n;
      }
      return { ...prev, [key]: { type: 'checklist', value: next } };
    });
  };

  const renderFilterInput = () => {
    if (!selectedColumn) return null;
    const currentValue = filterValues[selectedColumn.key];

    if (selectedColumn.dataType === 'checklist') {
      let options: { label: string; value: string | number }[] = [];
      if (selectedColumn.key === 'status') {
        options = (statuses.length > 0 ? statuses : ['Pending', 'Success', 'Failed', 'Cancelled']).map(s => ({ label: s, value: s }));
      } else if (selectedColumn.key === 'transaction_status') {
        options = (transactionStatuses.length > 0 ? transactionStatuses : ['Completed', 'Pending', 'Processing', 'Failed']).map(s => ({ label: s, value: s }));
      } else if (selectedColumn.key === 'plan') {
        options = plans.map(p => ({ label: p, value: p }));
      } else if (selectedColumn.key === 'barangay') {
        options = barangays.map(b => ({ label: b, value: b }));
      } else if (selectedColumn.key === 'city') {
        options = cities.map(c => ({ label: c, value: c }));
      } else if (selectedColumn.key === 'payment_method') {
        options = paymentMethods.map(m => ({ label: m.payment_method, value: m.id }));
      } else if (selectedColumn.key === 'payment_channel') {
        options = paymentChannels.map(c => ({ label: c, value: c }));
      } else if (selectedColumn.key === 'region') {
        options = regions.map(r => ({ label: r, value: r }));
      }

      const filtered = options.filter(o => o.label.toLowerCase().includes(searchTerm.toLowerCase()));

      return (
        <View style={{ flex: 1 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', borderWidth: 1,
            borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, marginBottom: 12,
            backgroundColor: '#f9fafb',
          }}>
            <Search size={16} color="#9ca3af" />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search options..."
              placeholderTextColor="#9ca3af"
              style={{ flex: 1, marginLeft: 8, paddingVertical: 8, fontSize: 14, color: '#111827' }}
            />
          </View>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {isLoadingOptions ? (
              <ActivityIndicator size="small" color={primaryColor} style={{ marginTop: 20 }} />
            ) : filtered.length === 0 ? (
              <Text style={{ textAlign: 'center', marginTop: 20, color: '#6b7280', fontSize: 14 }}>No results found</Text>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = ((currentValue?.value as (string | number)[]) || []).map(String).includes(String(opt.value));
                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => toggleOption(selectedColumn.key, opt.value)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      padding: 12, borderRadius: 12, marginBottom: 4,
                      backgroundColor: isSelected ? hexToRgba(primaryColor, 0.1) : '#f9fafb',
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '500', color: isSelected ? primaryColor : '#374151' }}>
                      {opt.label}
                    </Text>
                    {isSelected && <Check size={16} color={primaryColor} />}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      );
    }

    if (isNumericType(selectedColumn.dataType)) {
      const cur = filterValues[selectedColumn.key];
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>From</Text>
            <TextInput
              value={String(cur?.from || '')}
              onChangeText={v => handleRangeChange(selectedColumn.key, 'from', v)}
              placeholder="Minimum value"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#ffffff' }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>To</Text>
            <TextInput
              value={String(cur?.to || '')}
              onChangeText={v => handleRangeChange(selectedColumn.key, 'to', v)}
              placeholder="Maximum value"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#ffffff' }}
            />
          </View>
        </View>
      );
    }

    if (isDateType(selectedColumn.dataType)) {
      const cur = filterValues[selectedColumn.key];
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>From</Text>
            <TextInput
              value={String(cur?.from || '')}
              onChangeText={v => handleDateChange(selectedColumn.key, 'from', v)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#ffffff' }}
            />
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>To</Text>
            <TextInput
              value={String(cur?.to || '')}
              onChangeText={v => handleDateChange(selectedColumn.key, 'to', v)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#ffffff' }}
            />
          </View>
        </View>
      );
    }

    const cur = filterValues[selectedColumn.key];
    return (
      <View>
        <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>Search Value</Text>
        <TextInput
          value={typeof cur?.value === 'string' ? cur.value : ''}
          onChangeText={v => handleTextChange(selectedColumn.key, v)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          placeholderTextColor="#9ca3af"
          style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#ffffff' }}
        />
      </View>
    );
  };

  return (
    <Modal
      visible={rendered}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdropOpacity }}
        />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={{ width: '92%', maxWidth: 560, backgroundColor: '#fff', height: '100%', transform: [{ translateX: slideX }] }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 20, paddingTop: insets.top, paddingBottom: 18,
            borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {selectedColumn && (
                <TouchableOpacity onPress={handleBack} style={{ padding: 6, borderRadius: 10, backgroundColor: '#f3f4f6' }}>
                  <ChevronLeft size={20} color="#374151" />
                </TouchableOpacity>
              )}
              <View>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>
                  {selectedColumn ? selectedColumn.label : 'Payment Portal Filters'}
                </Text>
                {!selectedColumn && (
                  <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Refine your payment logs</Text>
                )}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 6, borderRadius: 10, backgroundColor: '#f3f4f6' }}>
              <X size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16 }}>
            {selectedColumn ? (
              renderFilterInput()
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ gap: 4 }}>
                  {allColumns.map((col) => {
                    const isActive = !!filterValues[col.key];
                    return (
                      <TouchableOpacity
                        key={col.key}
                        onPress={() => handleColumnClick(col)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          padding: 16, borderRadius: 16,
                          backgroundColor: isActive ? hexToRgba(primaryColor, 0.05) : '#f9fafb',
                          borderWidth: 1,
                          borderColor: isActive ? hexToRgba(primaryColor, 0.2) : 'transparent',
                          marginBottom: 4,
                        }}
                      >
                        <Text style={{
                          fontSize: 14, fontWeight: '600',
                          color: isActive ? primaryColor : '#374151',
                        }}>
                          {col.label}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {isActive && (
                            <View style={{
                              paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                              backgroundColor: hexToRgba(primaryColor, 0.1),
                            }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: primaryColor, textTransform: 'uppercase' }}>Active</Text>
                            </View>
                          )}
                          <ChevronRight size={16} color="#9ca3af" />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </View>

          {/* Footer */}
          <View style={{
            flexDirection: 'row', gap: 12,
            paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 20,
            borderTopWidth: 1, borderTopColor: '#f3f4f6',
          }}>
            <TouchableOpacity
              onPress={handleReset}
              style={{
                flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center',
                backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#6b7280' }}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              style={{
                flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center',
                backgroundColor: primaryColor,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#ffffff' }}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default PaymentPortalFunnelFilter;

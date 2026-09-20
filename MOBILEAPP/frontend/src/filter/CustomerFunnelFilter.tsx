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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { planService } from '../services/planService';
import apiClient from '../config/api';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})`
    : hex;
};

/** `YYYY-MM-DD` — the value shape the web `<input type="date">` stored. */
const toIsoDay = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const parseIsoDay = (value: string) => {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

interface CustomerFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist' | 'boolean';
    value?: string | boolean | (string | number)[];
    from?: string | number;
    to?: string | number;
  };
}

export interface Column {
  key: string;
  label: string;
  dataType: 'varchar' | 'text' | 'int' | 'decimal' | 'date' | 'datetime' | 'checklist' | 'bigint' | 'enum';
}

const STORAGE_KEY = 'customerFunnelFilters';

export const allColumns: Column[] = [
  // Customers Table
  { key: 'firstName', label: 'First Name', dataType: 'varchar' },
  { key: 'middleInitial', label: 'Middle Initial', dataType: 'varchar' },
  { key: 'lastName', label: 'Last Name', dataType: 'varchar' },
  { key: 'emailAddress', label: 'Email Address', dataType: 'varchar' },
  { key: 'contactNumber', label: 'Contact Number (Primary)', dataType: 'varchar' },
  { key: 'secondContactNumber', label: 'Contact Number (Secondary)', dataType: 'varchar' },
  { key: 'address', label: 'Address', dataType: 'text' },
  { key: 'location', label: 'Location', dataType: 'varchar' },
  { key: 'barangay', label: 'Barangay', dataType: 'checklist' },
  { key: 'city', label: 'City', dataType: 'checklist' },
  { key: 'region', label: 'Region', dataType: 'checklist' },
  { key: 'addressCoordinates', label: 'Address Coordinates', dataType: 'varchar' },
  { key: 'housingStatus', label: 'Housing Status', dataType: 'checklist' },
  { key: 'referredBy', label: 'Referred By', dataType: 'varchar' },
  { key: 'desiredPlan', label: 'Desired Plan', dataType: 'checklist' },
  { key: 'houseFrontPicture', label: 'House Front Image', dataType: 'varchar' },
  { key: 'accountNo', label: 'Account No', dataType: 'varchar' },
  { key: 'customerCreatedAt', label: 'Customer Created At', dataType: 'datetime' },
  { key: 'customerCreatedBy', label: 'Customer Created By', dataType: 'bigint' },
  { key: 'modifiedBy', label: 'Customer Modified By', dataType: 'varchar' },
  { key: 'modifiedDate', label: 'Customer Modified Date', dataType: 'datetime' },

  // Billing Accounts Table
  { key: 'dateInstalled', label: 'Date Installed', dataType: 'date' },
  { key: 'plan', label: 'Plan', dataType: 'checklist' },
  { key: 'accountBalance', label: 'Account Balance', dataType: 'decimal' },
  { key: 'balanceUpdateDate', label: 'Balance Update Date', dataType: 'datetime' },
  { key: 'billingDay', label: 'Billing Day', dataType: 'int' },
  { key: 'billingStatus', label: 'Billing Status', dataType: 'checklist' },
  { key: 'billingAccountCreatedAt', label: 'Billing Account Created At', dataType: 'datetime' },
  { key: 'billingAccountCreatedBy', label: 'Billing Account Created By', dataType: 'bigint' },
  { key: 'billingAccountUpdatedAt', label: 'Billing Account Updated At', dataType: 'datetime' },
  { key: 'billingAccountUpdatedBy', label: 'Billing Account Updated By', dataType: 'varchar' },
  { key: 'totalPaid', label: 'Total Paid', dataType: 'decimal' },

  // Technical Details Table
  { key: 'username', label: 'Username', dataType: 'varchar' },
  { key: 'usernameStatus', label: 'Username Status', dataType: 'checklist' },
  { key: 'connectionType', label: 'Connection Type', dataType: 'checklist' },
  { key: 'routerModel', label: 'Router Model', dataType: 'checklist' },
  { key: 'routerModemSN', label: 'Router/Modem SN', dataType: 'varchar' },
  { key: 'sessionIP', label: 'IP Address', dataType: 'varchar' },
  { key: 'lcp', label: 'LCP', dataType: 'checklist' },
  { key: 'nap', label: 'NAP', dataType: 'checklist' },
  { key: 'port', label: 'Port', dataType: 'checklist' },
  { key: 'vlan', label: 'VLAN', dataType: 'checklist' },
  { key: 'lcpnap', label: 'LCPNAP', dataType: 'checklist' },
  { key: 'usageType', label: 'Usage Type', dataType: 'checklist' },
  { key: 'techCreatedAt', label: 'Technical Details Created At', dataType: 'datetime' },
  { key: 'techCreatedBy', label: 'Technical Details Created By', dataType: 'bigint' },
  { key: 'techUpdatedAt', label: 'Technical Details Updated At', dataType: 'datetime' },
  { key: 'techUpdatedBy', label: 'Technical Details Updated By', dataType: 'varchar' },
  { key: 'onlineStatus', label: 'Online Status', dataType: 'checklist' },
  { key: 'sessionGroup', label: 'Group', dataType: 'checklist' },
];

const CustomerFunnelFilter: React.FC<CustomerFunnelFilterProps> = ({
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
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);

  // Checklist data states
  const [plans, setPlans] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [lcpNames, setLcpNames] = useState<string[]>([]);
  const [napNames, setNapNames] = useState<string[]>([]);
  const [ports, setPorts] = useState<string[]>([]);
  const [vlans, setVlans] = useState<string[]>([]);
  const [lcpnaps, setLcpnaps] = useState<string[]>([]);
  const [routerModels, setRouterModels] = useState<string[]>([]);
  const [usageTypes, setUsageTypes] = useState<string[]>([]);
  const [connectionTypes, setConnectionTypes] = useState<string[]>([]);
  const [usernameStatuses, setUsernameStatuses] = useState<string[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<string[]>([]);
  const [sessionGroups, setSessionGroups] = useState<string[]>([]);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [billingStatuses, setBillingStatuses] = useState<{ id: number; name: string }[]>([]);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => { });
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
      apiClient.get<{
        success: boolean;
        data: {
          lcp_names: string[];
          nap_names: string[];
          ports: string[];
          vlans: string[];
          lcpnaps: string[];
          router_models: string[];
          usage_types: string[];
          connection_types: string[];
          username_statuses: string[];
          session_statuses: string[];
          session_groups: string[];
          group_names: string[];
          billing_statuses: { id: number; name: string }[];
        };
      }>('/lookup/customers'),
    ])
      .then(([planData, locRes, custRes]) => {
        if (planData) {
          setPlans(
            planData.map((p) => {
              const name = p.name || (p as any).plan_name || 'Unknown';
              const price = Math.floor(Number(p.price || 0));
              return `${name} ${price}`;
            })
          );
        }

        const loc = (locRes as any).data;
        if (loc?.success) {
          setBarangays(loc.data.barangays || []);
          setCities(loc.data.cities || []);
          setRegions(loc.data.regions || []);
        }

        const cust = (custRes as any).data;
        if (cust?.success) {
          setLcpNames(cust.data.lcp_names || []);
          setNapNames(cust.data.nap_names || []);
          setPorts(cust.data.ports || []);
          setVlans(cust.data.vlans || []);
          setLcpnaps(cust.data.lcpnaps || []);
          setRouterModels(cust.data.router_models || []);
          setUsageTypes(cust.data.usage_types || []);
          setConnectionTypes(cust.data.connection_types || []);
          setUsernameStatuses(cust.data.username_statuses || []);
          setSessionStatuses(cust.data.session_statuses || []);
          setSessionGroups(cust.data.session_groups || []);
          setGroupNames(cust.data.group_names || []);
          setBillingStatuses(cust.data.billing_statuses || []);
        }
      })
      .catch((err) => console.error('Failed to fetch checklist data:', err))
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

  const toggleOption = (columnKey: string, option: string | number) => {
    setFilterValues((prev) => {
      const current = prev[columnKey] || { type: 'checklist', value: [] };
      const selectedOptions = ((current.value as (string | number)[]) || []).map(String);
      const optStr = String(option);

      const nextOptions = selectedOptions.includes(optStr)
        ? selectedOptions.filter((o) => o !== optStr)
        : [...selectedOptions, optStr];

      if (nextOptions.length === 0) {
        const copy = { ...prev };
        delete copy[columnKey];
        return copy;
      }

      return { ...prev, [columnKey]: { type: 'checklist', value: nextOptions } };
    });
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#fff',
  } as const;

  const labelStyle = { fontSize: 14, fontWeight: '500' as const, color: '#374151', marginBottom: 8 };

  const renderFilterInput = () => {
    if (!selectedColumn) return null;
    const currentValue = filterValues[selectedColumn.key];

    if (selectedColumn.dataType === 'checklist') {
      let options: { label: string; value: string | number }[] = [];
      if (selectedColumn.key === 'plan' || selectedColumn.key === 'desiredPlan') {
        options = plans.map((p) => ({ label: p, value: p }));
      } else if (selectedColumn.key === 'barangay') {
        options = barangays.map((b) => ({ label: b, value: b }));
      } else if (selectedColumn.key === 'city') {
        options = cities.map((c) => ({ label: c, value: c }));
      } else if (selectedColumn.key === 'region') {
        options = regions.map((r) => ({ label: r, value: r }));
      } else if (selectedColumn.key === 'billingStatus') {
        if (billingStatuses.length > 0) {
          options = billingStatuses.map((s) => ({ label: s.name, value: s.name.toLowerCase() }));
        } else {
          const statusList = ['Active', 'Blacklisted', 'Freeze', 'Inactive', 'Pullout', 'Service Account', 'VIP'];
          options = statusList.map((s) => ({ label: s, value: s.toLowerCase() }));
        }
      } else if (selectedColumn.key === 'lcp') {
        options = lcpNames.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'nap') {
        options = napNames.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'port') {
        options = ports.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'vlan') {
        options = vlans.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'lcpnap') {
        options = lcpnaps.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'routerModel') {
        options = routerModels.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'usageType') {
        options = usageTypes.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'connectionType') {
        options = connectionTypes.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'usernameStatus') {
        options = usernameStatuses.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'groupName') {
        options = groupNames.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'sessionGroup') {
        options = sessionGroups.map((o) => ({ label: o, value: o }));
      } else if (selectedColumn.key === 'onlineStatus') {
        const onlineStatusLabelMap: Record<string, string> = {
          Disconnected: 'Disconnected',
          Restricted: 'Restricted',
        };
        options = sessionStatuses.map((o) => ({ label: onlineStatusLabelMap[o] || o, value: o }));
      } else if (selectedColumn.key === 'housingStatus') {
        options = [
          { label: 'Renter', value: 'renter' },
          { label: 'Owner', value: 'owner' },
        ];
      }

      const filteredOptions = options.filter((opt) =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
      );
      const selectedValues = ((currentValue?.value as (string | number)[]) || []).map(String);

      return (
        <View style={{ flex: 1 }}>
          <View style={{ position: 'relative', marginBottom: 12 }}>
            <View style={{ position: 'absolute', left: 12, top: 12, zIndex: 1 }}>
              <Search size={16} color="#9ca3af" />
            </View>
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search options..."
              placeholderTextColor="#9ca3af"
              style={[inputStyle, { paddingLeft: 36 }]}
            />
          </View>

          {loadingChecklist ? (
            <ActivityIndicator color={primary} style={{ marginTop: 24 }} />
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map((option, idx) => {
              const isSelected = selectedValues.includes(String(option.value));
              return (
                <TouchableOpacity
                  key={`${option.value}-${idx}`}
                  onPress={() => toggleOption(selectedColumn.key, option.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    borderRadius: 8,
                    marginBottom: 4,
                    backgroundColor: isSelected ? hexToRgba(primary, 0.08) : 'transparent',
                  }}
                >
                  <Text
                    style={{ fontSize: 14, fontWeight: '500', color: isSelected ? primary : '#374151', flex: 1 }}
                    numberOfLines={2}
                  >
                    {option.label}
                  </Text>
                  {isSelected && <Check size={16} color={primary} />}
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingVertical: 32 }}>
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
            <Text style={labelStyle}>From</Text>
            <TextInput
              value={String(currentValue?.from ?? '')}
              onChangeText={(v) => handleRangeChange(selectedColumn.key, 'from', v)}
              keyboardType="numeric"
              placeholder="Minimum value"
              placeholderTextColor="#9ca3af"
              style={inputStyle}
            />
          </View>
          <View>
            <Text style={labelStyle}>To</Text>
            <TextInput
              value={String(currentValue?.to ?? '')}
              onChangeText={(v) => handleRangeChange(selectedColumn.key, 'to', v)}
              keyboardType="numeric"
              placeholder="Maximum value"
              placeholderTextColor="#9ca3af"
              style={inputStyle}
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
            <Text style={labelStyle}>{field === 'from' ? 'From' : 'To'}</Text>
            <TouchableOpacity
              onPress={() => setDatePickerTarget(field)}
              style={[inputStyle, {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderColor: value ? primary : '#d1d5db',
              }]}
            >
              <Text style={{ fontSize: 14, color: value ? '#111827' : '#9ca3af' }}>{value || 'Select date'}</Text>
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
        <Text style={labelStyle}>Search Value</Text>
        <TextInput
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChangeText={(v) => handleTextChange(selectedColumn.key, v)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          placeholderTextColor="#9ca3af"
          style={inputStyle}
        />
      </View>
    );
  };

  const activeCount = Object.keys(filterValues).length;

  return (
    <Modal visible={rendered} animationType="none" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdropOpacity }}
        />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />

        <Animated.View
          style={{
            width: '92%',
            maxWidth: 560,
            height: '100%',
            backgroundColor: '#fff',
            transform: [{ translateX: slideX }],
          }}
        >
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              {selectedColumn && (
                <TouchableOpacity onPress={handleBack} style={{ padding: 6, borderRadius: 8, backgroundColor: '#f3f4f6' }}>
                  <ChevronLeft size={18} color="#374151" />
                </TouchableOpacity>
              )}
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', flex: 1 }} numberOfLines={1}>
                {selectedColumn ? selectedColumn.label : 'Filters'}
              </Text>
              {!selectedColumn && activeCount > 0 && (
                <View style={{ backgroundColor: hexToRgba(primary, 0.12), borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: primary }}>{activeCount}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <X size={22} color="#4b5563" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView style={{ flex: 1, paddingHorizontal: 20, paddingVertical: 16 }} keyboardShouldPersistTaps="handled">
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
                          paddingHorizontal: 12,
                          paddingVertical: 14,
                          borderRadius: 10,
                          borderWidth: 1,
                          backgroundColor: isActive ? hexToRgba(primary, 0.05) : 'transparent',
                          borderColor: isActive ? hexToRgba(primary, 0.15) : 'transparent',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ fontSize: 14, fontWeight: '600', color: isActive ? primary : '#374151' }}
                            numberOfLines={1}
                          >
                            {column.label}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {isActive && (
                            <View style={{ backgroundColor: hexToRgba(primary, 0.12), borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: primary }}>Active</Text>
                            </View>
                          )}
                          <ChevronRight size={16} color="#9ca3af" />
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
              paddingTop: 12,
              paddingBottom: insets.bottom + 20,
              borderTopWidth: 1,
              borderTopColor: '#f3f4f6',
            }}
          >
            <TouchableOpacity
              onPress={handleReset}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: '#d1d5db',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              style={{ flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: primary, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default CustomerFunnelFilter;

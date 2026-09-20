import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { planService } from '../services/planService';

// ─── Constants ────────────────────────────────────────────────────────────────
const isDarkMode = false;
const BG = '#f9fafb';
const CARD = '#ffffff';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

const STORAGE_KEY = 'soaFunnelFilters';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist';
    value?: string | string[];
    from?: string | number;
    to?: string | number;
  };
}

interface Column {
  key: string;
  label: string;
  dataType: 'varchar' | 'text' | 'int' | 'decimal' | 'date' | 'datetime' | 'checklist';
}

interface SOAFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
  records?: any[];
}

export const allColumns: Column[] = [
  { key: 'accountNo', label: 'Account No', dataType: 'varchar' },
  { key: 'fullName', label: 'Full Name', dataType: 'varchar' },
  { key: 'contactNumber', label: 'Contact Number', dataType: 'varchar' },
  { key: 'emailAddress', label: 'Email Address', dataType: 'varchar' },
  { key: 'plan', label: 'Plan', dataType: 'checklist' },
  { key: 'remarks', label: 'Remarks', dataType: 'checklist' },
  { key: 'statementDate', label: 'Statement Date', dataType: 'date' },
  { key: 'dateProcessed', label: 'Date Processed', dataType: 'date' },
  { key: 'dueDate', label: 'Due Date', dataType: 'date' },
  { key: 'invoiceStatus', label: 'Invoice Status', dataType: 'checklist' },
  { key: 'barangay', label: 'Barangay', dataType: 'checklist' },
  { key: 'city', label: 'City', dataType: 'checklist' },
  { key: 'region', label: 'Region', dataType: 'checklist' },
  { key: 'referenceNo', label: 'Reference No', dataType: 'varchar' },
  { key: 'orNo', label: 'OR No', dataType: 'varchar' },
  { key: 'modifiedBy', label: 'Modified By', dataType: 'checklist' },
  { key: 'transactionId', label: 'Transaction ID', dataType: 'varchar' },
];

// ─── Component ────────────────────────────────────────────────────────────────
const SOAFunnelFilter: React.FC<SOAFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters,
  records = [],
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
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Checklist data
  const [plans, setPlans] = useState<string[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [modifiedByOptions, setModifiedByOptions] = useState<string[]>([]);
  const [remarksOptions, setRemarksOptions] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);

  const primary = colorPalette?.primary || '#7c3aed';

  // Load palette once
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

  // Load saved filters when opened
  useEffect(() => {
    if (!isOpen) return;
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setFilterValues(JSON.parse(raw)); } catch {}
      } else if (currentFilters) {
        setFilterValues(currentFilters);
      }
    });
  }, [isOpen]);

  // Fetch checklist data when opened
  useEffect(() => {
    if (!isOpen) return;
    setLoadingOptions(true);
    const fetchChecklistData = async () => {
      try {
        const [planData, locRes, soaLookup] = await Promise.all([
          planService.getAllPlans(),
          apiClient.get<{ success: boolean; data: { barangays: string[]; cities: string[]; regions: string[] } }>('/lookup/customer-locations'),
          apiClient.get<{ success: boolean; data: { modified_by: string[]; remarks: string[]; statuses: string[] } }>('/lookup/statements'),
        ]);

        if (planData) {
          setPlans(planData.map(p => {
            const name = p.name || (p as any).plan_name || 'Unknown';
            const price = Math.floor(Number(p.price || 0));
            return `${name} ${price}`;
          }));
        }

        if ((locRes as any).data?.success) {
          const d = (locRes as any).data.data;
          setBarangays(d.barangays || []);
          setCities(d.cities || []);
          setRegions(d.regions || []);
        }

        if ((soaLookup as any).data?.success && (soaLookup as any).data?.data) {
          const d = (soaLookup as any).data.data;
          setModifiedByOptions(d.modified_by || []);
          setRemarksOptions(d.remarks || []);
          setStatusOptions(d.statuses || []);
        }
      } catch {
        // silently fail — lists will be empty
      } finally {
        setLoadingOptions(false);
      }
    };
    fetchChecklistData();
  }, [isOpen]);

  // ── Handlers ──
  const handleColumnClick = (column: Column) => {
    setSelectedColumn(column);
    setSearchTerm('');
  };

  const handleBack = () => {
    setSelectedColumn(null);
    setSearchTerm('');
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

  const handleTextChange = (columnKey: string, value: string) => {
    if (value === '') {
      const next = { ...filterValues };
      delete next[columnKey];
      setFilterValues(next);
    } else {
      setFilterValues(prev => ({ ...prev, [columnKey]: { type: 'text', value } }));
    }
  };

  const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'number' as const };
      const next = { ...current, [field]: value };
      if (next.from === '' && next.to === '') {
        const newFilters = { ...prev };
        delete newFilters[columnKey];
        return newFilters;
      }
      return { ...prev, [columnKey]: next };
    });
  };

  const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'date' as const };
      const next = { ...current, [field]: value };
      if (!next.from && !next.to) {
        const newFilters = { ...prev };
        delete newFilters[columnKey];
        return newFilters;
      }
      return { ...prev, [columnKey]: next };
    });
  };

  const toggleOption = (columnKey: string, option: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'checklist' as const, value: [] };
      const selected = (current.value as string[]) || [];
      const next = selected.includes(option)
        ? selected.filter(o => o !== option)
        : [...selected, option];
      if (next.length === 0) {
        const newFilters = { ...prev };
        delete newFilters[columnKey];
        return newFilters;
      }
      return { ...prev, [columnKey]: { type: 'checklist', value: next } };
    });
  };

  const getOptionCount = (optionValue: string): number => {
    if (!selectedColumn) return 0;
    const key = selectedColumn.key;
    return records.filter(record => {
      const recordVal = key === 'invoiceStatus' ? (record.invoiceStatus ?? record.status) : record[key];
      if (['barangay', 'city', 'region'].includes(key)) {
        const directVal = String(recordVal || '').toLowerCase().trim();
        const address = String(record.address || '').toLowerCase();
        const opt = optionValue.toLowerCase().trim();
        return directVal === opt || address.includes(opt);
      }
      return String(recordVal || '').toLowerCase().trim() === optionValue.toLowerCase().trim();
    }).length;
  };

  // ── Render filter input ──
  const renderFilterInput = () => {
    if (!selectedColumn) return null;
    const currentValue = filterValues[selectedColumn.key];
    const isNumeric = ['int', 'decimal'].includes(selectedColumn.dataType);
    const isDate = ['date', 'datetime'].includes(selectedColumn.dataType);

    if (selectedColumn.dataType === 'checklist') {
      let options: { label: string; value: string }[] = [];
      switch (selectedColumn.key) {
        case 'plan': options = plans.map(p => ({ label: p, value: p })); break;
        case 'invoiceStatus':
          options = statusOptions.length > 0
            ? statusOptions.map(s => ({ label: s, value: s }))
            : [{ label: 'Paid', value: 'Paid' }, { label: 'Unpaid', value: 'Unpaid' }, { label: 'Pending', value: 'Pending' }, { label: 'Partial', value: 'Partial' }];
          break;
        case 'remarks': options = remarksOptions.map(r => ({ label: r, value: r })); break;
        case 'barangay': options = barangays.map(b => ({ label: b, value: b })); break;
        case 'city': options = cities.map(c => ({ label: c, value: c })); break;
        case 'region': options = regions.map(r => ({ label: r, value: r })); break;
        case 'modifiedBy': options = modifiedByOptions.map(m => ({ label: m, value: m })); break;
      }

      const filtered = options.filter(o => o.label.toLowerCase().includes(searchTerm.toLowerCase()));

      return (
        <View style={{ flex: 1 }}>
          {/* Search bar */}
          <View style={styles.searchRow}>
            <Search size={16} color={MUTED} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search options..."
              placeholderTextColor={MUTED}
              value={searchTerm}
              onChangeText={setSearchTerm}
            />
          </View>

          {loadingOptions ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={primary} />
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {filtered.length > 0 ? filtered.map((opt, idx) => {
                const isSelected = (currentValue?.value as string[])?.includes(opt.value);
                const count = getOptionCount(opt.value);
                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => toggleOption(selectedColumn.key, opt.value)}
                    style={[
                      styles.optionRow,
                      isSelected && { backgroundColor: `${primary}1a` },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionLabel, isSelected && { color: primary }]}>
                        {opt.label}
                      </Text>
                      {count > 0 && !isSelected && (
                        <Text style={styles.optionCount}>{count} records</Text>
                      )}
                    </View>
                    {isSelected && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={[styles.optionCount, { color: primary }]}>{count}</Text>
                        <Check size={16} color={primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No results found</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      );
    }

    if (isNumeric) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={styles.fieldLabel}>From</Text>
            <TextInput
              style={styles.fieldInput}
              keyboardType="decimal-pad"
              placeholder="Minimum value"
              placeholderTextColor={MUTED}
              value={String(currentValue?.from || '')}
              onChangeText={v => handleRangeChange(selectedColumn.key, 'from', v)}
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>To</Text>
            <TextInput
              style={styles.fieldInput}
              keyboardType="decimal-pad"
              placeholder="Maximum value"
              placeholderTextColor={MUTED}
              value={String(currentValue?.to || '')}
              onChangeText={v => handleRangeChange(selectedColumn.key, 'to', v)}
            />
          </View>
        </View>
      );
    }

    if (isDate) {
      return (
        <View style={{ gap: 16 }}>
          <View>
            <Text style={styles.fieldLabel}>From (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. 2025-01-01"
              placeholderTextColor={MUTED}
              value={String(currentValue?.from || '')}
              onChangeText={v => handleDateChange(selectedColumn.key, 'from', v)}
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>To (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. 2025-12-31"
              placeholderTextColor={MUTED}
              value={String(currentValue?.to || '')}
              onChangeText={v => handleDateChange(selectedColumn.key, 'to', v)}
            />
          </View>
        </View>
      );
    }

    // Text / varchar
    return (
      <View>
        <Text style={styles.fieldLabel}>Search Value</Text>
        <TextInput
          style={styles.fieldInput}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          placeholderTextColor={MUTED}
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChangeText={v => handleTextChange(selectedColumn.key, v)}
        />
      </View>
    );
  };

  // ── Column list ──
  const renderColumnList = () => (
    <ScrollView style={{ flex: 1 }}>
      {allColumns.map(column => {
        const isActive = !!filterValues[column.key];
        return (
          <TouchableOpacity
            key={column.key}
            onPress={() => handleColumnClick(column)}
            style={styles.columnRow}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.columnLabel, isActive && { color: primary }]}>
                {column.label}
              </Text>
              {isActive && (
                <View style={[styles.activeBadge, { backgroundColor: `${primary}1a` }]}>
                  <Text style={[styles.activeBadgeText, { color: primary }]}>Active</Text>
                </View>
              )}
            </View>
            <ChevronRight size={16} color={MUTED} />
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  return (
    <Modal
      visible={rendered}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        {/* Backdrop */}
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdropOpacity }}
        />
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />

        {/* Drawer */}
        <Animated.View style={[styles.drawer, { transform: [{ translateX: slideX }] }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            {selectedColumn && (
              <TouchableOpacity onPress={handleBack} style={{ marginRight: 8 }}>
                <ChevronLeft size={20} color={TEXT} />
              </TouchableOpacity>
            )}
            <View>
              <Text style={styles.headerTitle}>
                {selectedColumn ? selectedColumn.label : 'SOA Filters'}
              </Text>
              {!selectedColumn && (
                <Text style={styles.headerSub}>Refine your statement results</Text>
              )}
            </View>
          </View>
          <TouchableOpacity onPress={onClose}>
            <X size={20} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
          {selectedColumn ? renderFilterInput() : renderColumnList()}
        </View>

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
            <Text style={styles.resetBtnText}>Clear All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: primary }]}
            onPress={handleApply}
          >
            <Text style={styles.applyBtnText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    width: '92%',
    maxWidth: 560,
    height: '100%',
    backgroundColor: CARD,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT,
  },
  headerSub: {
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: TEXT,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
  },
  optionCount: {
    fontSize: 10,
    color: MUTED,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 13,
    color: MUTED,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 6,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: TEXT,
    backgroundColor: BG,
  },
  columnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  columnLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  activeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 3,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: CARD,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  resetBtnText: {
    fontWeight: '700',
    fontSize: 14,
    color: TEXT,
  },
  applyBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyBtnText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#fff',
  },
});

export default SOAFunnelFilter;

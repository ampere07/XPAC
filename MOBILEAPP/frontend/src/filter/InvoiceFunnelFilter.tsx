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
import { Search, Check, X, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { planService } from '../services/planService';

const isDarkMode = false;

const STORAGE_KEY = 'invoiceFunnelFilters';

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

interface InvoiceFunnelFilterProps {
    isOpen: boolean;
    onClose: () => void;
    onApplyFilters: (filters: FilterValues) => void;
    currentFilters?: FilterValues;
}

export const allColumns: Column[] = [
    { key: 'accountNo', label: 'Account No.', dataType: 'varchar' },
    { key: 'fullName', label: 'Full Name', dataType: 'varchar' },
    { key: 'contactNumber', label: 'Contact Number', dataType: 'varchar' },
    { key: 'emailAddress', label: 'Email Address', dataType: 'varchar' },
    { key: 'address', label: 'Address', dataType: 'varchar' },
    { key: 'plan', label: 'Plan', dataType: 'checklist' },
    { key: 'provider', label: 'Provider', dataType: 'checklist' },
    { key: 'remarks', label: 'Remarks', dataType: 'checklist' },
    { key: 'invoiceDate', label: 'Invoice Date', dataType: 'date' },
    { key: 'dateProcessed', label: 'Date Processed', dataType: 'date' },
    { key: 'processedBy', label: 'Processed By', dataType: 'varchar' },
    { key: 'dueDate', label: 'Due Date', dataType: 'date' },
    { key: 'status', label: 'Invoice Status', dataType: 'checklist' },
    { key: 'paymentPortalLogRef', label: 'Reference No.', dataType: 'varchar' },
    { key: 'invoiceNo', label: 'OR No.', dataType: 'varchar' },
    { key: 'updatedBy', label: 'Modified By', dataType: 'checklist' },
    { key: 'transactionId', label: 'Transaction ID', dataType: 'varchar' },
    { key: 'barangay', label: 'Barangay', dataType: 'checklist' },
    { key: 'city', label: 'City', dataType: 'checklist' },
    { key: 'region', label: 'Region', dataType: 'checklist' },
];

const InvoiceFunnelFilter: React.FC<InvoiceFunnelFilterProps> = ({
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
    const [isLoadingOptions, setIsLoadingOptions] = useState(false);

    const [barangays, setBarangays] = useState<string[]>([]);
    const [cities, setCities] = useState<string[]>([]);
    const [regions, setRegions] = useState<string[]>([]);
    const [plans, setPlans] = useState<string[]>([]);
    const [providers, setProviders] = useState<string[]>([]);
    const [remarksOptions, setRemarksOptions] = useState<string[]>([]);
    const [modifiedByOptions, setModifiedByOptions] = useState<string[]>([]);

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

        (async () => {
            const saved = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
            if (saved) {
                try {
                    setFilterValues(JSON.parse(saved));
                } catch {}
            } else if (currentFilters) {
                setFilterValues(currentFilters);
            }
        })();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setIsLoadingOptions(true);

        (async () => {
            try {
                const [locRes, planData, portalLookup, invoiceLookup] = await Promise.all([
                    apiClient.get<{ success: boolean; data: { barangays: string[]; cities: string[]; regions: string[] } }>('/lookup/customer-locations'),
                    planService.getAllPlans(),
                    apiClient.get<{ success: boolean; data: { payment_channels: string[] } }>('/lookup/payment-portal'),
                    apiClient.get<{ success: boolean; data: { remarks: string[]; modified_by: string[] } }>('/lookup/invoices'),
                ]);

                if ((locRes.data as any).success) {
                    setBarangays((locRes.data as any).data.barangays || []);
                    setCities((locRes.data as any).data.cities || []);
                    setRegions((locRes.data as any).data.regions || []);
                }
                if (planData) {
                    setPlans(
                        planData.map((p: any) => {
                            const name = p.name || p.plan_name || 'Unknown';
                            const price = Math.floor(Number(p.price || 0));
                            return `${name} ${price}`;
                        })
                    );
                }
                if ((portalLookup.data as any).success) {
                    setProviders((portalLookup.data as any).data.payment_channels || []);
                }
                if ((invoiceLookup.data as any).success) {
                    setRemarksOptions((invoiceLookup.data as any).data.remarks || []);
                    setModifiedByOptions((invoiceLookup.data as any).data.modified_by || []);
                }
            } catch {}
            setIsLoadingOptions(false);
        })();
    }, [isOpen]);

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

    const toggleOption = (columnKey: string, option: string | number) => {
        setFilterValues(prev => {
            const current = prev[columnKey] || { type: 'checklist', value: [] };
            const selected = ((current.value as (string | number)[]) || []).map(String);
            const optStr = String(option);
            const next = selected.includes(optStr)
                ? selected.filter(o => o !== optStr)
                : [...selected, optStr];

            if (next.length === 0) {
                const copy = { ...prev };
                delete copy[columnKey];
                return copy;
            }
            return { ...prev, [columnKey]: { type: 'checklist', value: next } };
        });
    };

    const getOptionsForColumn = (col: Column): { label: string; value: string }[] => {
        switch (col.key) {
            case 'status':
                return ['Paid', 'Unpaid', 'Partial', 'Overdue', 'Cancelled'].map(v => ({ label: v, value: v }));
            case 'barangay':
                return barangays.map(v => ({ label: v, value: v }));
            case 'city':
                return cities.map(v => ({ label: v, value: v }));
            case 'region':
                return regions.map(v => ({ label: v, value: v }));
            case 'plan':
                return plans.map(v => ({ label: v, value: v }));
            case 'provider':
                return (providers.length > 0 ? providers : ['SWITCH', 'Xendit', 'PayMaya', 'GCash']).map(v => ({
                    label: v,
                    value: v,
                }));
            case 'remarks':
                return remarksOptions.map(v => ({ label: v, value: v }));
            case 'updatedBy':
                return modifiedByOptions.map(v => ({ label: v, value: v }));
            default:
                return [];
        }
    };

    const renderFilterInput = () => {
        if (!selectedColumn) return null;
        const col = selectedColumn;
        const current = filterValues[col.key];

        if (col.dataType === 'checklist') {
            const options = getOptionsForColumn(col).filter(opt =>
                opt.label.toLowerCase().includes(searchTerm.toLowerCase())
            );
            const selectedVals = ((current?.value as string[]) || []).map(String);

            return (
                <View style={{ flex: 1 }}>
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#f3f4f6',
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            marginBottom: 12,
                        }}
                    >
                        <Search size={16} color="#9ca3af" />
                        <TextInput
                            placeholder="Search options..."
                            placeholderTextColor="#9ca3af"
                            value={searchTerm}
                            onChangeText={setSearchTerm}
                            style={{ flex: 1, marginLeft: 8, paddingVertical: 8, fontSize: 14, color: '#111827' }}
                        />
                    </View>
                    <ScrollView style={{ flex: 1 }}>
                        {isLoadingOptions ? (
                            <ActivityIndicator size="small" color={primary} style={{ marginTop: 16 }} />
                        ) : options.length === 0 ? (
                            <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 16, fontSize: 13 }}>
                                No options found
                            </Text>
                        ) : (
                            options.map((opt, idx) => {
                                const isSelected = selectedVals.includes(opt.value);
                                return (
                                    <TouchableOpacity
                                        key={idx}
                                        onPress={() => toggleOption(col.key, opt.value)}
                                        style={{
                                            flexDirection: 'row',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: 12,
                                            borderRadius: 10,
                                            marginBottom: 4,
                                            backgroundColor: isSelected ? `${primary}18` : '#f9fafb',
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 14,
                                                fontWeight: '500',
                                                color: isSelected ? primary : '#374151',
                                            }}
                                        >
                                            {opt.label}
                                        </Text>
                                        {isSelected && <Check size={16} color={primary} />}
                                    </TouchableOpacity>
                                );
                            })
                        )}
                    </ScrollView>
                </View>
            );
        }

        if (col.dataType === 'int' || col.dataType === 'decimal') {
            return (
                <View>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>From</Text>
                    <TextInput
                        keyboardType="numeric"
                        placeholder="Minimum value"
                        placeholderTextColor="#9ca3af"
                        value={String(current?.from || '')}
                        onChangeText={v => handleRangeChange(col.key, 'from', v)}
                        style={{
                            borderWidth: 1,
                            borderColor: '#e5e7eb',
                            borderRadius: 8,
                            padding: 10,
                            fontSize: 14,
                            color: '#111827',
                            marginBottom: 12,
                        }}
                    />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>To</Text>
                    <TextInput
                        keyboardType="numeric"
                        placeholder="Maximum value"
                        placeholderTextColor="#9ca3af"
                        value={String(current?.to || '')}
                        onChangeText={v => handleRangeChange(col.key, 'to', v)}
                        style={{
                            borderWidth: 1,
                            borderColor: '#e5e7eb',
                            borderRadius: 8,
                            padding: 10,
                            fontSize: 14,
                            color: '#111827',
                        }}
                    />
                </View>
            );
        }

        if (col.dataType === 'date' || col.dataType === 'datetime') {
            return (
                <View>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>From (YYYY-MM-DD)</Text>
                    <TextInput
                        placeholder="e.g. 2024-01-01"
                        placeholderTextColor="#9ca3af"
                        value={String(current?.from || '')}
                        onChangeText={v => handleDateChange(col.key, 'from', v)}
                        style={{
                            borderWidth: 1,
                            borderColor: '#e5e7eb',
                            borderRadius: 8,
                            padding: 10,
                            fontSize: 14,
                            color: '#111827',
                            marginBottom: 12,
                        }}
                    />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>To (YYYY-MM-DD)</Text>
                    <TextInput
                        placeholder="e.g. 2024-12-31"
                        placeholderTextColor="#9ca3af"
                        value={String(current?.to || '')}
                        onChangeText={v => handleDateChange(col.key, 'to', v)}
                        style={{
                            borderWidth: 1,
                            borderColor: '#e5e7eb',
                            borderRadius: 8,
                            padding: 10,
                            fontSize: 14,
                            color: '#111827',
                        }}
                    />
                </View>
            );
        }

        // text / varchar
        return (
            <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>
                    Search Value
                </Text>
                <TextInput
                    placeholder={`Enter ${col.label.toLowerCase()}`}
                    placeholderTextColor="#9ca3af"
                    value={typeof current?.value === 'string' ? current.value : ''}
                    onChangeText={v => handleTextChange(col.key, v)}
                    style={{
                        borderWidth: 1,
                        borderColor: '#e5e7eb',
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 14,
                        color: '#111827',
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
                <Animated.View
                    style={{
                        width: '92%',
                        maxWidth: 560,
                        backgroundColor: '#fff',
                        height: '100%',
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
                            paddingTop: insets.top,
                            paddingBottom: 16,
                            borderBottomWidth: 1,
                            borderBottomColor: '#f3f4f6',
                        }}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {selectedColumn && (
                                <TouchableOpacity
                                    onPress={() => { setSelectedColumn(null); setSearchTerm(''); }}
                                    style={{ padding: 4 }}
                                >
                                    <ChevronLeft size={20} color="#374151" />
                                </TouchableOpacity>
                            )}
                            <View>
                                <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>
                                    {selectedColumn ? selectedColumn.label : 'Invoice Filter'}
                                </Text>
                                {!selectedColumn && (
                                    <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                                        Refine your invoice results
                                    </Text>
                                )}
                            </View>
                        </View>
                        <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
                            <X size={20} color="#6b7280" />
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ padding: 20 }}
                        keyboardShouldPersistTaps="handled"
                    >
                        {selectedColumn ? (
                            renderFilterInput()
                        ) : (
                            <View>
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: '700',
                                        color: '#6b7280',
                                        textTransform: 'uppercase',
                                        letterSpacing: 1,
                                        marginBottom: 10,
                                    }}
                                >
                                    Invoice Details
                                </Text>
                                {allColumns.map(column => {
                                    const isActive = !!filterValues[column.key];
                                    return (
                                        <TouchableOpacity
                                            key={column.key}
                                            onPress={() => { setSelectedColumn(column); setSearchTerm(''); }}
                                            style={{
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: 14,
                                                borderRadius: 12,
                                                marginBottom: 4,
                                                backgroundColor: isActive ? `${primary}10` : '#f9fafb',
                                                borderWidth: 1,
                                                borderColor: isActive ? `${primary}30` : 'transparent',
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
                                                            backgroundColor: `${primary}18`,
                                                            borderRadius: 10,
                                                            paddingHorizontal: 8,
                                                            paddingVertical: 2,
                                                        }}
                                                    >
                                                        <Text
                                                            style={{
                                                                fontSize: 10,
                                                                fontWeight: '700',
                                                                color: primary,
                                                                textTransform: 'uppercase',
                                                            }}
                                                        >
                                                            Active
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
                                padding: 14,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: '#e5e7eb',
                                backgroundColor: '#ffffff',
                                alignItems: 'center',
                            }}
                        >
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#6b7280' }}>Clear All</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={handleApply}
                            style={{
                                flex: 1,
                                padding: 14,
                                borderRadius: 12,
                                backgroundColor: primary,
                                alignItems: 'center',
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

export default InvoiceFunnelFilter;

import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { planService } from '../services/planService';
import { paymentMethodService } from '../services/paymentMethodService';

const hexToRgba = (hex: string, opacity: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface PaymentPortalFunnelFilterProps {
    isOpen: boolean;
    onClose: () => void;
    onApplyFilters: (filters: FilterValues) => void;
    currentFilters?: FilterValues;
}

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

const PaymentPortalFunnelFilter: React.FC<PaymentPortalFunnelFilterProps> = ({
    isOpen,
    onClose,
    onApplyFilters,
    currentFilters
}) => {
    const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
    const [filterValues, setFilterValues] = useState<FilterValues>({});
    const [searchTerm, setSearchTerm] = useState('');

    // Checklist data states
    const [statuses, setStatuses] = useState<string[]>([]);
    const [transactionStatuses, setTransactionStatuses] = useState<string[]>([]);
    const [plans, setPlans] = useState<string[]>([]);
    const [barangays, setBarangays] = useState<string[]>([]);
    const [cities, setCities] = useState<string[]>([]);
    const [regions, setRegions] = useState<string[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<{ id: number; payment_method: string }[]>([]);
    const [paymentChannels, setPaymentChannels] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            const savedFilters = localStorage.getItem(STORAGE_KEY);
            if (savedFilters) {
                try {
                    setFilterValues(JSON.parse(savedFilters));
                } catch (err) {
                    console.error('Failed to load saved filters:', err);
                }
            } else if (currentFilters) {
                setFilterValues(currentFilters);
            }
        }
    }, [isOpen, currentFilters]);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDarkMode(localStorage.getItem('theme') === 'dark');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
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
            const fetchChecklistData = async () => {
                try {
                    // Start all fetches
                    const ppPromise = apiClient.get<{ success: boolean; data: { statuses: string[], transaction_statuses: string[], payment_channels: string[] } }>('/lookup/payment-portal');
                    const plansPromise = planService.getAllPlans();
                    const locPromise = apiClient.get<{ success: boolean; data: { barangays: string[], cities: string[], regions: string[] } }>('/lookup/customer-locations');
                    const pmPromise = paymentMethodService.getAll();

                    // Wait for all with individual handling to be safe
                    const [ppRes, planData, locRes, pmRes] = await Promise.allSettled([
                        ppPromise, plansPromise, locPromise, pmPromise
                    ]);

                    if (ppRes.status === 'fulfilled' && ppRes.value.data.success) {
                        setStatuses([...ppRes.value.data.data.statuses].sort((a, b) => String(a).localeCompare(String(b))));
                        setTransactionStatuses([...ppRes.value.data.data.transaction_statuses].sort((a, b) => String(a).localeCompare(String(b))));
                        setPaymentChannels([...ppRes.value.data.data.payment_channels].sort((a, b) => String(a).localeCompare(String(b))));
                    }

                    if (planData.status === 'fulfilled' && planData.value) {
                        const formattedPlans = planData.value.map(p => {
                            const name = (p as any).name || (p as any).plan_name || 'Unknown';
                            const price = Math.floor(Number((p as any).price || 0));
                            return `${name} ${price}`;
                        });
                        setPlans([...formattedPlans].sort((a, b) => String(a).localeCompare(String(b))));
                    }

                    if (locRes.status === 'fulfilled' && locRes.value.data.success) {
                        setBarangays([...locRes.value.data.data.barangays].sort((a, b) => String(a).localeCompare(String(b))));
                        setCities([...locRes.value.data.data.cities].sort((a, b) => String(a).localeCompare(String(b))));
                        setRegions([...locRes.value.data.data.regions].sort((a, b) => String(a).localeCompare(String(b))));
                    }


                    if (pmRes.status === 'fulfilled' && pmRes.value.success) {
                        setPaymentMethods([...pmRes.value.data].sort((a, b) => String(a.payment_method).localeCompare(String(b.payment_method))));
                    }
                } catch (err) {
                    console.error('Failed to fetch checklist data:', err);
                }
            };
            fetchChecklistData();
        }
    }, [isOpen]);

    const handleColumnClick = (column: Column) => {
        setSelectedColumn(column);
        setSearchTerm('');
    };

    const handleBack = () => {
        setSelectedColumn(null);
        setSearchTerm('');
    };

    const handleApply = () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filterValues));
        onApplyFilters(filterValues);
        onClose();
    };

    const handleReset = () => {
        setFilterValues({});
        setSelectedColumn(null);
        localStorage.removeItem(STORAGE_KEY);
    };

    const isNumericType = (dataType: string) => {
        return ['int', 'decimal'].includes(dataType);
    };

    const isDateType = (dataType: string) => {
        return ['date', 'datetime'].includes(dataType);
    };

    const handleTextChange = (columnKey: string, value: string) => {
        if (value === '') {
            const newFilters = { ...filterValues };
            delete newFilters[columnKey];
            setFilterValues(newFilters);
        } else {
            setFilterValues(prev => ({
                ...prev,
                [columnKey]: {
                    type: 'text',
                    value
                }
            }));
        }
    };

    const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
        setFilterValues(prev => {
            const current = prev[columnKey] || { type: 'number' };
            const next = { ...current, [field]: value };

            if (next.from === '' && next.to === '') {
                const newFilters = { ...prev };
                delete newFilters[columnKey];
                return newFilters;
            }

            return {
                ...prev,
                [columnKey]: next
            };
        });
    };

    const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
        setFilterValues(prev => {
            const current = prev[columnKey] || { type: 'date' };
            const next = { ...current, [field]: value };

            if (!next.from && !next.to) {
                const newFilters = { ...prev };
                delete newFilters[columnKey];
                return newFilters;
            }

            return {
                ...prev,
                [columnKey]: next
            };
        });
    };

    const toggleOption = (columnKey: string, option: string | number) => {
        setFilterValues(prev => {
            const current = prev[columnKey] || { type: 'checklist', value: [] };
            const selectedOptions = ((current.value as (string | number)[]) || []).map(String);
            const optStr = String(option);

            const nextOptions = selectedOptions.includes(optStr)
                ? selectedOptions.filter(o => o !== optStr)
                : [...selectedOptions, optStr];

            if (nextOptions.length === 0) {
                const newFilters = { ...prev };
                delete newFilters[columnKey];
                return newFilters;
            }

            return {
                ...prev,
                [columnKey]: {
                    type: 'checklist',
                    value: nextOptions
                }
            };
        });
    };

    const renderFilterInput = () => {
        if (!selectedColumn) return null;

        const currentValue = filterValues[selectedColumn.key];

        if (selectedColumn.dataType === 'checklist') {
            let options: { label: string, value: string | number }[] = [];
            if (selectedColumn.key === 'status') {
                options = statuses.length > 0 ? statuses.map(s => ({ label: s, value: s })) : [
                    { label: 'Pending', value: 'Pending' },
                    { label: 'Success', value: 'Success' },
                    { label: 'Failed', value: 'Failed' },
                    { label: 'Cancelled', value: 'Cancelled' }
                ];
            } else if (selectedColumn.key === 'transaction_status') {
                options = transactionStatuses.length > 0 ? transactionStatuses.map(s => ({ label: s, value: s })) : [
                    { label: 'Completed', value: 'Completed' },
                    { label: 'Pending', value: 'Pending' },
                    { label: 'Processing', value: 'Processing' },
                    { label: 'Failed', value: 'Failed' }
                ];
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

            const filteredOptions = options.filter(opt =>
                opt.label.toLowerCase().includes(searchTerm.toLowerCase())
            );

            return (
                <div className="flex flex-col h-full overflow-hidden">
                    <div className="relative mb-4">
                        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                        <input
                            type="text"
                            placeholder="Search options..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={`w-full pl-10 pr-4 py-2 rounded-lg border text-sm focus:outline-none transition-all ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-white'
                                : 'bg-gray-50 border-gray-200 text-gray-900'
                                }`}
                            style={{ borderColor: 'transparent' }}
                            onFocus={(e) => {
                                if (colorPalette?.primary) {
                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                }
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'transparent';
                            }}
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto pr-2 space-y-1 custom-scrollbar">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, idx) => {
                                const isSelected = (currentValue?.value as (string | number)[])?.map(String).includes(String(option.value));
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => toggleOption(selectedColumn.key, option.value)}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${isSelected
                                            ? ''
                                            : (isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                                            }`}
                                        style={isSelected ? {
                                            backgroundColor: hexToRgba(colorPalette?.primary || '#7c3aed', 0.1),
                                            color: colorPalette?.primary || '#7c3aed'
                                        } : {}}
                                    >
                                        <span className="text-sm font-medium">{option.label}</span>
                                        {isSelected && <Check className="h-4 w-4" />}
                                    </button>
                                );
                            })
                        ) : (
                            <div className="text-center py-8">
                                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>No results found</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        if (isNumericType(selectedColumn.dataType)) {
            return (
                <div className="space-y-4">
                    <div>
                        <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            From
                        </label>
                        <input
                            type="number"
                            value={currentValue?.from || ''}
                            onChange={(e) => handleRangeChange(selectedColumn.key, 'from', e.target.value)}
                            placeholder="Minimum value"
                            className={`w-full px-3 py-2 rounded border focus:outline-none transition-all ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-white'
                                : 'bg-white border-gray-300 text-gray-900'
                                }`}
                            style={{ borderColor: 'transparent' }}
                            onFocus={(e) => {
                                if (colorPalette?.primary) {
                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                }
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'transparent';
                            }}
                        />
                    </div>
                    <div>
                        <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            To
                        </label>
                        <input
                            type="number"
                            value={currentValue?.to || ''}
                            onChange={(e) => handleRangeChange(selectedColumn.key, 'to', e.target.value)}
                            placeholder="Maximum value"
                            className={`w-full px-3 py-2 rounded border focus:outline-none transition-all ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-white'
                                : 'bg-white border-gray-300 text-gray-900'
                                }`}
                            style={{ borderColor: 'transparent' }}
                            onFocus={(e) => {
                                if (colorPalette?.primary) {
                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                }
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'transparent';
                            }}
                        />
                    </div>
                </div>
            );
        }

        if (isDateType(selectedColumn.dataType)) {
            return (
                <div className="space-y-4">
                    <div>
                        <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            From
                        </label>
                        <input
                            type={selectedColumn.dataType === 'datetime' ? 'datetime-local' : 'date'}
                            value={currentValue?.from || ''}
                            onChange={(e) => handleDateChange(selectedColumn.key, 'from', e.target.value)}
                            className={`w-full px-3 py-2 rounded border focus:outline-none transition-all ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-white'
                                : 'bg-white border-gray-300 text-gray-900'
                                }`}
                            style={{ borderColor: 'transparent' }}
                            onFocus={(e) => {
                                if (colorPalette?.primary) {
                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                }
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'transparent';
                            }}
                        />
                    </div>
                    <div>
                        <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                            To
                        </label>
                        <input
                            type={selectedColumn.dataType === 'datetime' ? 'datetime-local' : 'date'}
                            value={currentValue?.to || ''}
                            onChange={(e) => handleDateChange(selectedColumn.key, 'to', e.target.value)}
                            className={`w-full px-3 py-2 rounded border focus:outline-none transition-all ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-white'
                                : 'bg-white border-gray-300 text-gray-900'
                                }`}
                            style={{ borderColor: 'transparent' }}
                            onFocus={(e) => {
                                if (colorPalette?.primary) {
                                    e.currentTarget.style.borderColor = colorPalette.primary;
                                }
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'transparent';
                            }}
                        />
                    </div>
                </div>
            );
        }

        return (
            <div>
                <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Search Value
                </label>
                <input
                    type="text"
                    value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
                    onChange={(e) => handleTextChange(selectedColumn.key, e.target.value)}
                    placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
                    className={`w-full px-3 py-2 rounded border ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    style={{ borderColor: 'transparent' }}
                    onFocus={(e) => {
                        if (colorPalette?.primary) {
                            e.currentTarget.style.borderColor = colorPalette.primary;
                        }
                    }}
                    onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'transparent';
                    }}
                />
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-hidden text-left">
            <div className="absolute inset-0 overflow-hidden">
                <div
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
                    onClick={onClose}
                />

                <div className="fixed inset-y-0 right-0 max-w-full flex">
                    <div className={`w-screen max-w-md transform transition-transform duration-300 flex flex-col ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 shadow-2xl'
                        }`}>
                        {/* Header */}
                        <div className={`px-6 py-5 flex items-center justify-between border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-100'
                            }`}>
                            <div className="flex items-center space-x-4">
                                {selectedColumn && (
                                    <button
                                        onClick={handleBack}
                                        className={`p-2 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                            }`}
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </button>
                                )}
                                <div>
                                    <h2 className="text-xl font-bold tracking-tight">
                                        {selectedColumn ? selectedColumn.label : 'Payment Portal Filters'}
                                    </h2>
                                    {!selectedColumn && (
                                        <p className={`text-xs mt-0.5 font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                            Refine your payment logs
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className={`p-2 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                                    }`}
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth">
                            {selectedColumn ? (
                                renderFilterInput()
                            ) : (
                                <div className="space-y-1">
                                    {[...allColumns].sort((a, b) => a.label.localeCompare(b.label)).map((column) => {
                                        const isActive = !!filterValues[column.key];
                                        return (
                                            <button
                                                key={column.key}
                                                onClick={() => handleColumnClick(column)}
                                                className={`w-full group flex items-center justify-between p-4 rounded-2xl transition-all duration-200 ${isDarkMode
                                                    ? 'hover:bg-gray-800'
                                                    : 'hover:bg-gray-50 border border-transparent hover:border-gray-200'
                                                    }`}
                                            >
                                                <div className="flex items-center space-x-4">
                                                    <div className="relative">
                                                        <div className={`text-sm font-semibold transition-colors ${isActive ? '' : (isDarkMode ? 'text-gray-200' : 'text-gray-700')
                                                            }`}
                                                            style={isActive ? { color: colorPalette?.primary || '#7c3aed' } : {}}
                                                        >
                                                            {column.label}
                                                        </div>
                                                        {isActive && (
                                                            <div
                                                                className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                                                                style={{
                                                                    backgroundColor: colorPalette?.primary || '#7c3aed',
                                                                    boxShadow: `0 0 8px ${hexToRgba(colorPalette?.primary || '#7c3aed', 0.6)}`
                                                                }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center space-x-3">
                                                    {isActive && (
                                                        <span
                                                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider`}
                                                            style={{
                                                                backgroundColor: hexToRgba(colorPalette?.primary || '#7c3aed', isDarkMode ? 0.2 : 0.1),
                                                                color: colorPalette?.primary || '#7c3aed'
                                                            }}
                                                        >
                                                            Active
                                                        </span>
                                                    )}
                                                    <ChevronRight className={`h-4 w-4 transition-transform group-hover:translate-x-0.5 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'
                                                        }`} />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className={`px-6 py-6 border-t ${isDarkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-100 bg-gray-50/50'}`}>
                            <div className="flex space-x-3">
                                <button
                                    onClick={handleReset}
                                    className={`flex-1 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-200 ${isDarkMode
                                        ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                                        : 'bg-white border border-gray-200 hover:border-gray-300 text-gray-600 shadow-sm'
                                        }`}
                                >
                                    Clear All
                                </button>
                                <button
                                    onClick={handleApply}
                                    className="flex-1 px-4 py-3 rounded-2xl font-bold text-sm text-white transition-all duration-200 active:scale-[0.98]"
                                    style={{
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        boxShadow: `0 4px 12px ${hexToRgba(colorPalette?.primary || '#7c3aed', 0.2)}`
                                    }}
                                >
                                    Apply Filters
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentPortalFunnelFilter;

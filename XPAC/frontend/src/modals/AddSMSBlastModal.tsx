import React, { useState, useEffect, useRef } from 'react';
import { X, Minus, Plus, ChevronDown, Search, Loader2 } from 'lucide-react';
import * as lcpnapService from '../services/lcpnapService';
import * as lcpService from '../services/lcpService';
import { barangayService, Barangay } from '../services/barangayService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';

interface ModalConfig {
    isOpen: boolean;
    type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

interface AddSMSBlastModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
}

type TargetType = 'all' | 'lcpnap' | 'lcp' | 'barangay' | 'billing_day' | null;

const AddSMSBlastModal: React.FC<AddSMSBlastModalProps> = ({
    isOpen,
    onClose,
    onSave
}) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const messageRef = useRef<HTMLTextAreaElement>(null);

    const [formData, setFormData] = useState({
        message: '',
        targetType: null as TargetType,
        selectedId: null as number | null,
        billingDay: 0,
    });

    const [lcpnapList, setLcpnapList] = useState<lcpnapService.LCPNAP[]>([]);
    const [lcpList, setLcpList] = useState<lcpService.LCP[]>([]);
    const [barangayList, setBarangayList] = useState<Barangay[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [modal, setModal] = useState<ModalConfig>({
        isOpen: false,
        type: 'success',
        title: '',
        message: ''
    });

    const [lcpnapSearch, setLcpnapSearch] = useState('');
    const [isLcpnapOpen, setIsLcpnapOpen] = useState(false);
    const [lcpSearch, setLcpSearch] = useState('');
    const [isLcpOpen, setIsLcpOpen] = useState(false);
    const [barangaySearch, setBarangaySearch] = useState('');
    const [isBarangayOpen, setIsBarangayOpen] = useState(false);

    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };

        checkDarkMode();

        const observer = new MutationObserver(() => {
            checkDarkMode();
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });

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
            loadAllData();
        }
    }, [isOpen]);

    const loadAllData = async () => {
        try {
            const [lcpnapResponse, lcpResponse, barangayResponse] = await Promise.all([
                lcpnapService.getAllLCPNAPs(),
                lcpService.getAllLCPs(),
                barangayService.getAll(),
            ]);

            if (lcpnapResponse.success) {
                setLcpnapList(lcpnapResponse.data);
            }

            if (lcpResponse.success) {
                setLcpList(lcpResponse.data);
            }

            if (barangayResponse.success) {
                setBarangayList(barangayResponse.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    };

    const handleInputChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    // Insert a message variable (e.g. {{account_no}}) at the caret position.
    // The backend replaces it with each recipient's real value when sending.
    const insertVariable = (token: string) => {
        const el = messageRef.current;
        const current = formData.message || '';
        if (el && typeof el.selectionStart === 'number') {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const next = current.slice(0, start) + token + current.slice(end);
            handleInputChange('message', next);
            requestAnimationFrame(() => {
                el.focus();
                const pos = start + token.length;
                el.setSelectionRange(pos, pos);
            });
        } else {
            handleInputChange('message', current + token);
        }
    };



    const handleTargetTypeChange = (type: TargetType) => {
        setFormData(prev => ({ ...prev, targetType: type, selectedId: null }));
        if (errors.targetType) {
            setErrors(prev => ({ ...prev, targetType: '' }));
        }
        if (errors.selectedId) {
            setErrors(prev => ({ ...prev, selectedId: '' }));
        }
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.message || formData.message.trim() === '') {
            newErrors.message = 'Message is required';
        }

        if (!formData.targetType) {
            newErrors.targetType = 'Please select a target type';
        }

        if (formData.targetType && formData.targetType !== 'billing_day' && formData.targetType !== 'all' && !formData.selectedId) {
            newErrors.selectedId = 'Please select an item from the dropdown';
        }

        if (formData.targetType === 'billing_day' && (!formData.billingDay || formData.billingDay <= 0)) {
            newErrors.billingDay = 'Please enter a valid billing day';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = async () => {
        if (!validateForm()) {
            setModal({
                isOpen: true,
                type: 'warning',
                title: 'Validation Error',
                message: 'Please fill in all required fields correctly.'
            });
            return;
        }

        setLoading(true);
        setLoadingPercentage(0);

        const progressInterval = setInterval(() => {
            setLoadingPercentage(prev => {
                if (prev >= 99) return 99;
                if (prev >= 90) return prev + 1;
                if (prev >= 70) return prev + 2;
                return prev + 5;
            });
        }, 300);

        try {
            const authData = localStorage.getItem('authData');
            const currentUser = authData ? JSON.parse(authData) : null;

            const payload: any = {
                message: formData.message,
                ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
            };

            if (formData.targetType === 'lcpnap') {
                payload.lcpnap_id = formData.selectedId;
            } else if (formData.targetType === 'lcp') {
                payload.lcp_id = formData.selectedId;
            } else if (formData.targetType === 'barangay') {
                payload.barangay_id = formData.selectedId;
            } else if (formData.targetType === 'billing_day') {
                payload.billing_day = formData.billingDay;
            } else if (formData.targetType === 'all') {
                payload.send_all = true;
            }

            const response = await apiClient.post('/sms-blast', payload);

            clearInterval(progressInterval);
            setLoadingPercentage(100);

            await new Promise(resolve => setTimeout(resolve, 500));

            const resp: any = response?.data || {};
            const summary = resp.summary;
            // Treat "saved but nothing actually sent" as a warning, not a success.
            const nothingSent = summary && summary.recipients > 0 && summary.sent === 0;
            const noRecipients = summary && summary.recipients === 0;
            const isProblem = resp.status === 'error' || nothingSent || noRecipients;

            setModal({
                isOpen: true,
                type: isProblem ? 'warning' : 'success',
                title: isProblem ? 'SMS Blast Saved (Not Sent)' : 'Success',
                message: resp.message || 'SMS Blast created successfully!',
                onConfirm: () => {
                    onSave();
                    onClose();
                    setModal(prev => ({ ...prev, isOpen: false }));
                }
            });
        } catch (error: any) {
            let errorMessage = 'Unknown error occurred';

            if (error.response?.data?.errors) {
                const validationErrors = error.response.data.errors;
                const errorDetails = Object.entries(validationErrors)
                    .map(([field, messages]: [string, any]) => {
                        const messageArray = Array.isArray(messages) ? messages : [messages];
                        return `${field}: ${messageArray.join(', ')}`;
                    })
                    .join('\n');
                errorMessage = `Validation failed:\n${errorDetails}`;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            } else if (error.response?.data?.message) {
                errorMessage = error.response.data.message;
            } else if (error.response?.data?.error) {
                errorMessage = error.response.data.error;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            clearInterval(progressInterval);
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: `Failed to save SMS blast: ${errorMessage}`
            });
        } finally {
            setLoading(false);
            setLoadingPercentage(0);
        }
    };

    const handleCancel = () => {
        setFormData({
            message: '',
            targetType: null,
            selectedId: null,
            billingDay: 0,
        });
        setErrors({});
        onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            {loading && (
                <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
                    <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
                        }`}>
                        <Loader2
                            className="w-20 h-20 animate-spin"
                            style={{ color: colorPalette?.primary || '#7c3aed' }}
                        />
                        <div className="text-center">
                            <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>{loadingPercentage}%</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal state moved to the end of the fragment to ensure it's on top */}

            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
                <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
                    }`}>
                    <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
                        }`}>
                        <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>Add SMS Blast</h2>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleCancel}
                                className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode
                                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                                    }`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={loading}
                                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center transition-colors"
                                style={{
                                    backgroundColor: colorPalette?.primary || '#7c3aed'
                                }}
                                onMouseEnter={(e) => {
                                    if (colorPalette?.accent && !loading) {
                                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                                }}
                            >
                                {loading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                onClick={onClose}
                                className={`transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                <X size={24} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <div>
                            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                }`}>
                                Message<span className="text-red-500">*</span>
                            </label>

                            {/* Insertable message variables */}
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Insert variable:</span>
                                <button
                                    type="button"
                                    onClick={() => insertVariable('{{account_no}}')}
                                    className={`text-xs font-medium px-2 py-1 rounded border transition-colors ${isDarkMode
                                        ? 'border-gray-700 text-gray-200 hover:bg-gray-800'
                                        : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                                    style={{ borderColor: colorPalette?.primary || undefined, color: colorPalette?.primary || undefined }}
                                >
                                    + Account No
                                </button>
                            </div>

                            <textarea
                                ref={messageRef}
                                value={formData.message}
                                onChange={(e) => handleInputChange('message', e.target.value)}
                                placeholder="Type your message here... Use {{account_no}} to insert each recipient's account number."
                                rows={4}
                                className={`w-full px-3 py-2 border rounded focus:outline-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                                    } ${errors.message ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                                style={{
                                    borderColor: errors.message ? '#ef4444' : (colorPalette && formData.message ? colorPalette.primary : '')
                                }}
                            />
                            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                <code
                                    className={`px-1 py-0.5 rounded font-mono text-[11px] ${isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
                                    style={{ color: colorPalette?.primary || undefined }}
                                >{'{{account_no}}'}</code> is replaced with each recipient's account number when the blast is sent.
                            </p>
                            {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message}</p>}
                        </div>

                        <div>
                            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                }`}>
                                Target Type<span className="text-red-500">*</span>
                            </label>
                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleTargetTypeChange('all')}
                                    className={`flex-1 min-w-[100px] px-4 py-2 rounded border transition-colors ${formData.targetType === 'all'
                                        ? 'text-white'
                                        : isDarkMode
                                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                                            : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                                        }`}
                                    style={formData.targetType === 'all' ? {
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        borderColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}
                                >
                                    All Customers
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTargetTypeChange('lcpnap')}
                                    className={`flex-1 min-w-[100px] px-4 py-2 rounded border transition-colors ${formData.targetType === 'lcpnap'
                                        ? 'text-white'
                                        : isDarkMode
                                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                                            : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                                        }`}
                                    style={formData.targetType === 'lcpnap' ? {
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        borderColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}
                                >
                                    LCPNAP
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTargetTypeChange('lcp')}
                                    className={`flex-1 px-4 py-2 rounded border transition-colors ${formData.targetType === 'lcp'
                                        ? 'text-white'
                                        : isDarkMode
                                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                                            : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                                        }`}
                                    style={formData.targetType === 'lcp' ? {
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        borderColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}
                                >
                                    LCP
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTargetTypeChange('barangay')}
                                    className={`flex-1 px-4 py-2 rounded border transition-colors ${formData.targetType === 'barangay'
                                        ? 'text-white'
                                        : isDarkMode
                                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                                            : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                                        }`}
                                    style={formData.targetType === 'barangay' ? {
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        borderColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}
                                >
                                    Barangay
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTargetTypeChange('billing_day')}
                                    className={`flex-1 px-4 py-2 rounded border transition-colors ${formData.targetType === 'billing_day'
                                        ? 'text-white'
                                        : isDarkMode
                                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                                            : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                                        }`}
                                    style={formData.targetType === 'billing_day' ? {
                                        backgroundColor: colorPalette?.primary || '#7c3aed',
                                        borderColor: colorPalette?.primary || '#7c3aed'
                                    } : {}}
                                >
                                    Billing Day
                                </button>
                            </div>
                            {errors.targetType && <p className="text-red-500 text-xs mt-1">{errors.targetType}</p>}
                        </div>

                        {formData.targetType === 'lcpnap' && (
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    Select LCPNAP<span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                                        } ${errors.selectedId ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                                        <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                                        <input
                                            type="text"
                                            placeholder="Type to search LCP-NAP..."
                                            value={isLcpnapOpen ? lcpnapSearch : (lcpnapList.find(i => i.id === formData.selectedId)?.lcpnap_name || lcpnapSearch)}
                                            onChange={(e) => {
                                                setLcpnapSearch(e.target.value);
                                                if (!isLcpnapOpen) setIsLcpnapOpen(true);
                                            }}
                                            onFocus={() => setIsLcpnapOpen(true)}
                                            className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isLcpnapOpen) {
                                                    setIsLcpnapOpen(false);
                                                    setLcpnapSearch('');
                                                } else {
                                                    handleInputChange('selectedId', null);
                                                    setLcpnapSearch('');
                                                }
                                            }}
                                            className="ml-2"
                                        >
                                            {isLcpnapOpen || formData.selectedId ? (
                                                <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                                            ) : (
                                                <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                                            )}
                                        </button>
                                    </div>

                                    {isLcpnapOpen && (
                                        <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                {lcpnapList
                                                    .filter(item => item.lcpnap_name.toLowerCase().includes(lcpnapSearch.toLowerCase()))
                                                    .map((item) => (
                                                        <div
                                                            key={item.id}
                                                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.selectedId === item.id ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                                                            onClick={() => {
                                                                handleInputChange('selectedId', item.id);
                                                                setLcpnapSearch('');
                                                                setIsLcpnapOpen(false);
                                                            }}
                                                        >
                                                            {item.lcpnap_name}
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                    {isLcpnapOpen && (
                                        <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setIsLcpnapOpen(false); setLcpnapSearch(''); }} />
                                    )}
                                </div>
                                {errors.selectedId && <p className="text-red-500 text-xs mt-1">{errors.selectedId}</p>}
                            </div>
                        )}

                        {formData.targetType === 'lcp' && (
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    Select LCP<span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                                        } ${errors.selectedId ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                                        <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                                        <input
                                            type="text"
                                            placeholder="Type to search LCP..."
                                            value={isLcpOpen ? lcpSearch : (lcpList.find(i => i.id === formData.selectedId)?.lcp_name || lcpSearch)}
                                            onChange={(e) => {
                                                setLcpSearch(e.target.value);
                                                if (!isLcpOpen) setIsLcpOpen(true);
                                            }}
                                            onFocus={() => setIsLcpOpen(true)}
                                            className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isLcpOpen) {
                                                    setIsLcpOpen(false);
                                                    setLcpSearch('');
                                                } else {
                                                    handleInputChange('selectedId', null);
                                                    setLcpSearch('');
                                                }
                                            }}
                                            className="ml-2"
                                        >
                                            {isLcpOpen || formData.selectedId ? (
                                                <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                                            ) : (
                                                <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                                            )}
                                        </button>
                                    </div>

                                    {isLcpOpen && (
                                        <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                {lcpList
                                                    .filter(item => item.lcp_name.toLowerCase().includes(lcpSearch.toLowerCase()))
                                                    .map((item) => (
                                                        <div
                                                            key={item.id}
                                                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.selectedId === item.id ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                                                            onClick={() => {
                                                                handleInputChange('selectedId', item.id);
                                                                setLcpSearch('');
                                                                setIsLcpOpen(false);
                                                            }}
                                                        >
                                                            {item.lcp_name}
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                    {isLcpOpen && (
                                        <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setIsLcpOpen(false); setLcpSearch(''); }} />
                                    )}
                                </div>
                                {errors.selectedId && <p className="text-red-500 text-xs mt-1">{errors.selectedId}</p>}
                            </div>
                        )}

                        {formData.targetType === 'barangay' && (
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    Select Barangay<span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                                        } ${errors.selectedId ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                                        <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                                        <input
                                            type="text"
                                            placeholder="Type to search Barangay..."
                                            value={isBarangayOpen ? barangaySearch : (barangayList.find(i => i.id === formData.selectedId)?.barangay || barangaySearch)}
                                            onChange={(e) => {
                                                setBarangaySearch(e.target.value);
                                                if (!isBarangayOpen) setIsBarangayOpen(true);
                                            }}
                                            onFocus={() => setIsBarangayOpen(true)}
                                            className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isBarangayOpen) {
                                                    setIsBarangayOpen(false);
                                                    setBarangaySearch('');
                                                } else {
                                                    handleInputChange('selectedId', null);
                                                    setBarangaySearch('');
                                                }
                                            }}
                                            className="ml-2"
                                        >
                                            {isBarangayOpen || formData.selectedId ? (
                                                <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                                            ) : (
                                                <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                                            )}
                                        </button>
                                    </div>

                                    {isBarangayOpen && (
                                        <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                {barangayList
                                                    .filter(item => item.barangay.toLowerCase().includes(barangaySearch.toLowerCase()))
                                                    .map((item) => (
                                                        <div
                                                            key={item.id}
                                                            className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.selectedId === item.id ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                                                            onClick={() => {
                                                                handleInputChange('selectedId', item.id);
                                                                setBarangaySearch('');
                                                                setIsBarangayOpen(false);
                                                            }}
                                                        >
                                                            {item.barangay}
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                    {isBarangayOpen && (
                                        <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setIsBarangayOpen(false); setBarangaySearch(''); }} />
                                    )}
                                </div>
                                {errors.selectedId && <p className="text-red-500 text-xs mt-1">{errors.selectedId}</p>}
                            </div>
                        )}

                        {formData.targetType === 'billing_day' && (
                            <div>
                                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>
                                    Billing Day<span className="text-red-500">*</span>
                                </label>
                                <div className="flex items-center">
                                    <input
                                        type="number"
                                        value={formData.billingDay}
                                        onChange={(e) => handleInputChange('billingDay', parseInt(e.target.value) || 0)}
                                        className={`flex-1 px-3 py-2 border rounded focus:outline-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                                            } ${errors.billingDay ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                                        style={{
                                            borderColor: errors.billingDay ? '#ef4444' : (colorPalette && formData.billingDay ? colorPalette.primary : '')
                                        }}
                                    />
                                    <div className="flex flex-col ml-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newVal = Math.max(0, (formData.billingDay || 0) - 1);
                                                handleInputChange('billingDay', newVal);
                                            }}
                                            className={`px-3 py-1 text-white rounded-t border border-b-0 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 border-gray-700' : 'bg-gray-300 hover:bg-gray-400 border-gray-300'
                                                }`}
                                        >
                                            <Minus size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newVal = (formData.billingDay || 0) + 1;
                                                handleInputChange('billingDay', newVal);
                                            }}
                                            className={`px-3 py-1 text-white rounded-b border ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 border-gray-700' : 'bg-gray-300 hover:bg-gray-400 border-gray-300'
                                                }`}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                </div>
                                {errors.billingDay && <p className="text-red-500 text-xs mt-1">{errors.billingDay}</p>}
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {modal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
                    <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
                        }`}>
                        {modal.type === 'loading' ? (
                            <div className="text-center">
                                <div className="flex justify-center mb-4">
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
                                </div>
                                <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                    }`}>{modal.title}</h3>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                    }`}>{modal.message}</p>
                            </div>
                        ) : (
                            <>
                                <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                                    }`}>{modal.title}</h3>
                                <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`}>{modal.message}</p>
                                <div className="flex items-center justify-end gap-3">
                                    {modal.type === 'confirm' ? (
                                        <>
                                            <button
                                                onClick={modal.onCancel}
                                                className={`px-4 py-2 rounded transition-colors ${isDarkMode
                                                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                                                    }`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={modal.onConfirm}
                                                className="px-4 py-2 text-white rounded transition-colors"
                                                style={{
                                                    backgroundColor: colorPalette?.primary || '#7c3aed'
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (colorPalette?.accent) {
                                                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                                                }}
                                            >
                                                Confirm
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => {
                                                if (modal.onConfirm) {
                                                    modal.onConfirm();
                                                } else {
                                                    setModal({ ...modal, isOpen: false });
                                                }
                                            }}
                                            className="px-4 py-2 text-white rounded transition-colors"
                                            style={{
                                                backgroundColor: colorPalette?.primary || '#7c3aed'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (colorPalette?.accent) {
                                                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                                            }}
                                        >
                                            OK
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default AddSMSBlastModal;

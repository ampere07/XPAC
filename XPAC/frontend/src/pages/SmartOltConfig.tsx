import React, { useState, useEffect } from 'react';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { usePageActions } from '../hooks/usePageActions';

interface SmartOltData {
    id: number;
    sub_domain: string;
    token: string;
    created_at: string;
    updated_at: string;
}

interface SmartOltResponse {
    success: boolean;
    data: SmartOltData[];
    count: number;
    message?: string;
}

interface ModalConfig {
    isOpen: boolean;
    type: 'success' | 'error' | 'warning' | 'confirm';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

const SmartOltConfig: React.FC = () => {
    // Add, Edit and Delete are granted separately. The same keys the API
    // demands, so a control is only drawn when the request behind it would
    // succeed.
    const actions = usePageActions('smart-olt');

    const [configs, setConfigs] = useState<SmartOltData[]>([]);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [isCreating, setIsCreating] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [showToken, setShowToken] = useState<Record<number, boolean>>({});
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        try {
            const theme = localStorage.getItem('theme');
            return theme === 'dark' || theme === null;
        } catch (e) {
            return true;
        }
    });
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    const [formData, setFormData] = useState({
        sub_domain: '',
        token: ''
    });

    const [modal, setModal] = useState<ModalConfig>({
        isOpen: false,
        type: 'success',
        title: '',
        message: ''
    });

    const fetchConfigs = async () => {
        try {
            setLoading(true);
            const response = await apiClient.get<SmartOltResponse>('/smart-olt');
            if (response.data.success && response.data.data) {
                setConfigs(response.data.data);
            } else {
                setConfigs([]);
            }
        } catch (error) {
            console.error('Error fetching SmartOLT configs:', error);
            setConfigs([]);
        } finally {
            setLoading(false);
        }
    };

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
        fetchConfigs();
    }, []);

    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };

        checkDarkMode();

        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });

        return () => observer.disconnect();
    }, []);

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const resetForm = () => {
        setFormData({
            sub_domain: '',
            token: ''
        });
    };

    const handleStartCreate = () => {
        if (!actions.canCreate) return;
        resetForm();
        setIsCreating(true);
    };

    const handleStartEdit = (config: SmartOltData) => {
        if (!actions.canEdit) return;
        setFormData({
            sub_domain: config.sub_domain || '',
            token: config.token || ''
        });
        setEditingId(config.id);
    };

    const handleSave = async () => {
        if (!formData.sub_domain || !formData.token) {
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Validation Error',
                message: 'Sub-domain and Token are required'
            });
            return;
        }

        try {
            setLoading(true);

            const payload = {
                ...formData
            };

            if (editingId) {
                await apiClient.put(`/smart-olt/${editingId}`, payload);
            } else {
                await apiClient.post('/smart-olt', payload);
            }

            setModal({
                isOpen: true,
                type: 'success',
                title: 'Success',
                message: 'SmartOLT configuration saved successfully'
            });

            setIsCreating(false);
            setEditingId(null);
            await fetchConfigs();
            resetForm();
            setShowToken({});
        } catch (error: any) {
            console.error('Error saving SmartOLT config:', error);
            const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: `Failed to save: ${errorMessage}`
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!actions.canDelete) return;
        setModal({
            isOpen: true,
            type: 'confirm',
            title: 'Delete Configuration',
            message: 'Are you sure you want to delete this configuration?',
            onConfirm: async () => {
                try {
                    setLoading(true);
                    await apiClient.delete(`/smart-olt/${id}`);
                    setModal({
                        isOpen: true,
                        type: 'success',
                        title: 'Deleted',
                        message: 'SmartOLT configuration deleted successfully'
                    });
                    await fetchConfigs();
                } catch (error: any) {
                    console.error('Error deleting SmartOLT config:', error);
                    setModal({
                        isOpen: true,
                        type: 'error',
                        title: 'Error',
                        message: `Failed to delete: ${error.message}`
                    });
                } finally {
                    setLoading(false);
                }
            }
        });
    };

    const handleCancel = () => {
        resetForm();
        setIsCreating(false);
        setEditingId(null);
        setShowToken({});
    };

    const toggleTokenVisibility = (id: number) => {
        setShowToken(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    return (
        <div className={`p-4 min-h-full ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'
            }`}>
            <div className={`mb-6 pb-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">SmartOLT Configuration</h2>
                        <p className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                            Manage your SmartOLT API credentials
                        </p>
                    </div>
                    {actions.canCreate && configs.length === 0 && !isCreating && (
                        <button
                            onClick={handleStartCreate}
                            className="px-4 py-2 text-white font-medium rounded-lg transition-all shadow-lg hover:scale-105 active:scale-95"
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
                            Configure SmartOLT
                        </button>
                    )}
                </div>
            </div>

            <div className="max-w-4xl space-y-4">
                {loading && configs.length === 0 && !isCreating ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-t-2 mb-4" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
                        <p className="text-sm animate-pulse">Loading configurations...</p>
                    </div>
                ) : (
                    <>
                        {configs.map((config) => (
                            <div key={config.id} className={`rounded-xl p-6 border shadow-sm transition-all ${isDarkMode
                                ? 'bg-gray-800 border-gray-700'
                                : 'bg-white border-gray-200'
                                }`}>
                                {editingId === config.id ? (
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-semibold">Edit Configuration</h3>
                                            <span className="text-xs font-mono text-gray-500">ID: {config.id}</span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className={`block text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                    Sub-domain
                                                </label>
                                                <div className="relative group">
                                                    <input
                                                        type="text"
                                                        value={formData.sub_domain}
                                                        onChange={(e) => handleInputChange('sub_domain', e.target.value)}
                                                        placeholder="your-subdomain"
                                                        className={`w-full px-4 py-2.5 rounded-lg border focus:ring-2 focus:outline-none transition-all ${isDarkMode
                                                            ? 'bg-gray-700 border-gray-600 text-white'
                                                            : 'bg-white border-gray-300 text-gray-900'
                                                            }`}
                                                        style={{
                                                            borderColor: (editingId === config.id) ? (colorPalette?.primary || '#7c3aed') : undefined
                                                        }}
                                                        onFocus={(e) => {
                                                            e.target.style.boxShadow = `0 0 0 2px ${(colorPalette?.primary || '#7c3aed')}80`;
                                                            e.target.style.borderColor = colorPalette?.primary || '#7c3aed';
                                                        }}
                                                        onBlur={(e) => {
                                                            e.target.style.boxShadow = 'none';
                                                            e.target.style.borderColor = '';
                                                        }}
                                                    />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400 text-sm">
                                                        .smartolt.com
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className={`block text-sm font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                    API Token
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type={showToken[config.id] ? 'text' : 'password'}
                                                        value={formData.token}
                                                        onChange={(e) => handleInputChange('token', e.target.value)}
                                                        placeholder="Enter your API token"
                                                        className={`w-full px-4 py-2.5 rounded-lg border focus:ring-2 focus:outline-none transition-all ${isDarkMode
                                                            ? 'bg-gray-700 border-gray-600 text-white'
                                                            : 'bg-white border-gray-300 text-gray-900'
                                                            }`}
                                                        onFocus={(e) => {
                                                            e.target.style.boxShadow = `0 0 0 2px ${(colorPalette?.primary || '#7c3aed')}80`;
                                                            e.target.style.borderColor = colorPalette?.primary || '#7c3aed';
                                                        }}
                                                        onBlur={(e) => {
                                                            e.target.style.boxShadow = 'none';
                                                            e.target.style.borderColor = '';
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleTokenVisibility(config.id)}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                                    >
                                                        {showToken[config.id] ? 'Hide' : 'Show'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-700">
                                            <button
                                                onClick={handleCancel}
                                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${isDarkMode
                                                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                                                    }`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleSave}
                                                disabled={loading}
                                                className="px-6 py-2 rounded-lg font-medium text-white shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50"
                                                style={{
                                                    backgroundColor: colorPalette?.primary || '#7c3aed'
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (!loading && colorPalette?.accent) {
                                                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (!loading) {
                                                        e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                                                    }
                                                }}
                                            >
                                                {loading ? 'Saving...' : 'Save Changes'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-lg" style={{ backgroundColor: (colorPalette?.primary || '#7c3aed') + '1a' }}>
                                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: colorPalette?.primary || '#7c3aed' }}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                </div>
                                                <h3 className="text-lg font-bold">Active Configuration</h3>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {actions.canEdit && (
                                                <button
                                                    onClick={() => handleStartEdit(config)}
                                                    className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-blue-400' : 'hover:bg-gray-100 text-blue-600'
                                                        }`}
                                                    title="Edit Configuration"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                    </svg>
                                                </button>
                                                )}
                                                {actions.canDelete && (
                                                <button
                                                    onClick={() => handleDelete(config.id)}
                                                    className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-red-400' : 'hover:bg-gray-100 text-red-600'
                                                        }`}
                                                    title="Delete Configuration"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 01-1-1H5m14 0a2 2 0 012 2v2H5" />
                                                    </svg>
                                                </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-100'
                                                }`}>
                                                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Sub-domain</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-lg">{config.sub_domain}</span>
                                                    <span className="text-gray-400 text-sm">.smartolt.com</span>
                                                </div>
                                            </div>

                                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-100'
                                                }`}>
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500">API Token</span>
                                                    <button
                                                        onClick={() => toggleTokenVisibility(config.id)}
                                                        className="text-[10px] font-bold uppercase tracking-tighter hover:underline"
                                                        style={{ color: colorPalette?.primary || '#7c3aed' }}
                                                    >
                                                        {showToken[config.id] ? 'Hide' : 'Show'}
                                                    </button>
                                                </div>
                                                <span className="font-mono block truncate">
                                                    {showToken[config.id] ? config.token : '••••••••••••••••••••••••••••••••'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 text-xs text-gray-500 font-medium pt-2">
                                            <div className="flex items-center gap-1">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                Last updated: {new Date(config.updated_at).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {isCreating && (
                            <div className={`rounded-xl p-8 border animate-in fade-in slide-in-from-bottom-4 duration-300 ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 shadow-2xl'
                                : 'bg-white border-gray-200 shadow-xl'
                                }`}
                                style={isDarkMode ? { boxShadow: `0 25px 50px -12px ${(colorPalette?.primary || '#7c3aed')}1a` } : {}}
                            >
                                <div className="mb-6 text-center">
                                    <div className="inline-flex p-3 rounded-2xl mb-4" style={{ backgroundColor: (colorPalette?.primary || '#7c3aed') + '1a' }}>
                                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: colorPalette?.primary || '#7c3aed' }}>
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold">Initial Setup</h3>
                                    <p className="text-sm text-gray-500">Connect your SmartOLT instance to the system</p>
                                </div>

                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-gray-400">Sub-domain</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={formData.sub_domain}
                                                onChange={(e) => handleInputChange('sub_domain', e.target.value)}
                                                placeholder="e.g. myisp"
                                                className={`w-full px-4 py-3 rounded-xl border focus:ring-2 focus:outline-none transition-all ${isDarkMode
                                                    ? 'bg-gray-700 border-gray-600 text-white'
                                                    : 'bg-white border-gray-300 text-gray-900'
                                                    }`}
                                                onFocus={(e) => {
                                                    e.target.style.boxShadow = `0 0 0 2px ${(colorPalette?.primary || '#7c3aed')}80`;
                                                    e.target.style.borderColor = colorPalette?.primary || '#7c3aed';
                                                }}
                                                onBlur={(e) => {
                                                    e.target.style.boxShadow = 'none';
                                                    e.target.style.borderColor = '';
                                                }}
                                            />
                                            <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-gray-500 font-medium">
                                                .smartolt.com
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-gray-400">API Token</label>
                                        <input
                                            type="password"
                                            value={formData.token}
                                            onChange={(e) => handleInputChange('token', e.target.value)}
                                            placeholder="Enter your unique SmartOLT API token"
                                            className={`w-full px-4 py-3 rounded-xl border focus:ring-2 focus:outline-none transition-all ${isDarkMode
                                                ? 'bg-gray-700 border-gray-600 text-white'
                                                : 'bg-white border-gray-300 text-gray-900'
                                                }`}
                                            onFocus={(e) => {
                                                e.target.style.boxShadow = `0 0 0 2px ${(colorPalette?.primary || '#7c3aed')}80`;
                                                e.target.style.borderColor = colorPalette?.primary || '#7c3aed';
                                            }}
                                            onBlur={(e) => {
                                                e.target.style.boxShadow = 'none';
                                                e.target.style.borderColor = '';
                                            }}
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 pt-6">
                                        <button
                                            onClick={handleSave}
                                            disabled={loading}
                                            className="flex-1 py-3 rounded-xl font-bold text-white shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                                            style={{
                                                backgroundColor: colorPalette?.primary || '#7c3aed'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!loading && colorPalette?.accent) {
                                                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!loading) {
                                                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                                                }
                                            }}
                                        >
                                            {loading ? 'Processing...' : 'Complete Connection'}
                                        </button>
                                        <button
                                            onClick={handleCancel}
                                            className={`px-6 py-3 rounded-xl font-bold transition-colors ${isDarkMode ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {configs.length === 0 && !isCreating && (
                            <div className={`text-center py-24 rounded-3xl border-2 border-dashed ${isDarkMode ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'
                                }`}>
                                <div className="p-4 rounded-full inline-flex mb-4" style={{ backgroundColor: (colorPalette?.primary || '#7c3aed') + '1a' }}>
                                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: colorPalette?.primary || '#7c3aed' }}>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <h2 className="text-xl font-bold mb-2">No SmartOLT Connection</h2>
                                <p className="text-gray-500 max-w-sm mx-auto mb-8">
                                    {actions.canCreate
                                        ? 'Get started by connecting your SmartOLT account to automate ONU registration and management.'
                                        : 'No SmartOLT account is connected. Ask an administrator to set one up.'}
                                </p>
                                {/* The panel itself stays: without it a role that
                                    may only read this page would find a blank
                                    space where the explanation should be. */}
                                {actions.canCreate && (
                                <button
                                    onClick={handleStartCreate}
                                    className="px-8 py-3 rounded-xl text-white font-bold transition-all shadow-xl hover:scale-105 active:scale-95"
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
                                    Start Integration
                                </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {modal.isOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
                    <div className={`rounded-2xl p-6 max-w-sm w-full shadow-2xl border animate-in zoom-in duration-200 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
                        }`}>
                        <div className="mb-4">
                            {modal.type === 'success' ? (
                                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4 mx-auto">
                                    <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4 mx-auto">
                                    <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                            )}
                            <h3 className="text-lg font-bold text-center">{modal.title}</h3>
                            <p className="text-gray-500 text-center text-sm mt-1">{modal.message}</p>
                        </div>

                        <div className="flex gap-3">
                            {modal.type === 'confirm' && (
                                <button
                                    onClick={() => setModal({ ...modal, isOpen: false })}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all active:scale-95 ${isDarkMode ? 'bg-gray-800 text-gray-400 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (modal.type === 'confirm' && modal.onConfirm) {
                                        modal.onConfirm();
                                    }
                                    setModal({ ...modal, isOpen: false });
                                }}
                                className="flex-1 py-3 rounded-xl text-white font-bold transition-all hover:brightness-110 active:scale-95 shadow-lg"
                                style={{
                                    backgroundColor: modal.type === 'confirm' ? '#ef4444' : (colorPalette?.primary || '#7c3aed')
                                }}
                            >
                                {modal.type === 'confirm' ? 'Delete' : 'Understand'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SmartOltConfig;

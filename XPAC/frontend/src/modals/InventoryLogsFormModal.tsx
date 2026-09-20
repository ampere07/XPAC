import React, { useState, useEffect } from 'react';
import { X, Calendar, FileText, User, Users, CheckCircle2, Clock, AlertCircle, Minus, Plus, Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { createInventoryLog } from '../services/inventoryLogService';
import { InventoryItem } from '../services/inventoryItemService';
import { userService } from '../services/userService';

interface InventoryLogsFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    selectedItem?: InventoryItem;
}

const InventoryLogsFormModal: React.FC<InventoryLogsFormModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    selectedItem
}) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [modal, setModal] = useState<{
        isOpen: boolean;
        type: 'success' | 'error' | 'warning' | 'loading';
        title: string;
        message: string;
        onConfirm?: () => void;
    }>({
        isOpen: false,
        type: 'success',
        title: '',
        message: ''
    });

    // Form State
    const [formData, setFormData] = useState({
        date: new Date().toISOString().slice(0, 16),
        item_id: selectedItem?.id?.toString() || '',
        item_name: selectedItem?.item_name || '',
        item_description: selectedItem?.item_description || '',
        log_type: 'Stock Out',
        item_quantity: 1,
        requested_by: 'None',
        requested_with: 'None',
        requested_with_10: 'None',
        sn: '',
        status: 'Done',
        remarks: '',
        user_email: (() => {
            const authData = localStorage.getItem('authData');
            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    return userData.email || userData.user?.email || '';
                } catch (error) {
                    console.error('Error parsing auth data:', error);
                }
            }
            return '';
        })(),
        modified_by: (() => {
            const authData = localStorage.getItem('authData');
            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    return userData.email || userData.user?.email || '';
                } catch (error) {
                    console.error('Error parsing auth data:', error);
                }
            }
            return '';
        })(),
        organization_id: (() => {
            const authData = localStorage.getItem('authData');
            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    return userData.organization_id ?? null;
                } catch (error) {
                    console.error('Error parsing auth data:', error);
                }
            }
            return null;
        })()
    });

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                const [palette, usersRes] = await Promise.all([
                    settingsColorPaletteService.getActive(),
                    userService.getAllUsers()
                ]);
                setColorPalette(palette);

                // Filter users: exclude role_id 3 (customers)
                const filteredUsers = (usersRes.data || []).filter(u => u.role_id !== 3);

                setUsers(filteredUsers);
            } catch (err) {
                console.error('Failed to fetch initial data:', err);
            }
        };

        if (isOpen) {
            setModal(prev => ({ ...prev, isOpen: false }));
            setLoading(false);
            setLoadingPercentage(0);
            fetchInitialData();
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark');

            // Update form if selectedItem changes or modal reopens
            setFormData(prev => ({
                ...prev,
                item_id: selectedItem?.id?.toString() || '',
                item_name: selectedItem?.item_name || '',
                item_description: selectedItem?.item_description || '',
                date: new Date().toLocaleString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                })
            }));
        }
    }, [isOpen, selectedItem]);

    const getUserDisplayName = (user: any) => {
        return `${user.first_name} ${user.last_name}`.trim();
    };

    const getAvailableUsers = (currentValue: string) => {
        const otherSelectedValues = [
            formData.requested_by,
            formData.requested_with,
            formData.requested_with_10
        ].filter(val => val !== 'None' && val !== currentValue);

        return users.filter(u => !otherSelectedValues.includes(getUserDisplayName(u)));
    };


    const handleQuantityChange = (type: 'inc' | 'dec') => {
        setFormData(prev => ({
            ...prev,
            item_quantity: type === 'inc' ? prev.item_quantity + 1 : Math.max(1, prev.item_quantity - 1)
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        setLoading(true);
        setLoadingPercentage(0);

        const progressInterval = setInterval(() => {
            setLoadingPercentage(prev => {
                if (prev >= 99) return 99;
                if (prev >= 90) return prev + 1;
                if (prev >= 70) return prev + 2;
                return prev + 5;
            });
        }, 100);

        try {
            const response = await createInventoryLog({
                ...formData,
                item_id: selectedItem?.id, // Use the raw ID from props
                date: new Date().toISOString()
            });

            clearInterval(progressInterval);
            setLoadingPercentage(100);

            if (response.success) {
                setModal({
                    isOpen: true,
                    type: 'success',
                    title: 'Success',
                    message: 'Inventory log saved successfully!',
                    onConfirm: () => {
                        if (onSuccess) onSuccess();
                        onClose();
                        setModal(prev => ({ ...prev, isOpen: false }));
                    }
                });
            } else {
                throw new Error(response.message || 'Failed to save log');
            }
        } catch (err: any) {
            clearInterval(progressInterval);
            console.error('Failed to save inventory log:', err);
            const errorMessage = err.response?.data?.message || err.message || 'An error occurred while saving.';
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: errorMessage
            });
        } finally {
            setLoading(false);
            setLoadingPercentage(0);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            {loading && (
                <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center animate-in fade-in duration-200">
                    <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
                        }`}>
                        <Loader2
                            className="w-20 h-20 animate-spin"
                            style={{ color: colorPalette?.primary || '#ef4444' }}
                        />
                        <div className="text-center">
                            <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>{loadingPercentage}%</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed inset-0 z-50 flex items-center justify-end bg-black bg-opacity-50 animate-in fade-in duration-200">
                <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col relative ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'
                    }`}>
                    {/* Header */}
                    <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
                        }`}>
                        <div className="flex items-center space-x-3">
                            <h2 className="text-xl font-semibold">Inventory Logs Form</h2>
                        </div>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={onClose}
                                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${isDarkMode
                                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                                    }`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading}
                                className="px-6 py-2 rounded text-sm font-medium text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: colorPalette?.primary || '#ef4444' }}
                            >
                                {loading ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-none">
                        {/* Date */}
                        <div className="space-y-2">
                            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                Date
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    readOnly
                                    value={formData.date}
                                    className={`w-full px-4 py-2.5 border rounded focus:outline-none ${isDarkMode
                                        ? 'bg-gray-800 text-white border-gray-700'
                                        : 'bg-gray-50 text-gray-900 border-gray-300'
                                        }`}
                                />
                                <Calendar size={18} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                            </div>
                        </div>


                        <div className="space-y-6">
                            {/* Item Name */}
                            <div className="space-y-2">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Item Name
                                </label>
                                <input
                                    type="text"
                                    readOnly
                                    value={formData.item_name}
                                    className={`w-full px-4 py-2.5 border rounded ${isDarkMode
                                        ? 'bg-gray-800 text-white border-gray-700'
                                        : 'bg-gray-100 text-gray-500 border-gray-200 font-medium'
                                        }`}
                                />
                            </div>

                            {/* Log Type */}
                            <div className="space-y-3">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Transaction Type<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <div className={`grid grid-cols-2 gap-2 p-1 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                    {['Stock In', 'Stock Out'].map((type) => {
                                        const isActive = formData.log_type === type;
                                        return (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => setFormData(prev => ({ ...prev, log_type: type }))}
                                                className={`py-2.5 rounded-md text-sm font-semibold transition-all duration-200 ${isActive
                                                    ? 'text-white shadow-lg'
                                                    : isDarkMode
                                                        ? 'text-gray-400 hover:text-gray-200'
                                                        : 'text-gray-500 hover:text-gray-700'
                                                    }`}
                                                style={{
                                                    backgroundColor: isActive ? (colorPalette?.primary || '#ef4444') : 'transparent'
                                                }}
                                            >
                                                <div className="flex items-center justify-center space-x-1.5">
                                                    {type === 'Stock In' && <ArrowDownToLine size={16} />}
                                                    {type === 'Stock Out' && <ArrowUpFromLine size={16} />}
                                                    <span>{type}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Item Quantity */}
                            <div className="space-y-2">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Item Quantity<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <div className={`flex items-center border rounded overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                                    }`}>
                                    <button
                                        onClick={() => handleQuantityChange('dec')}
                                        type="button"
                                        className={`px-3 py-2.5 transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                                    >
                                        <Minus size={16} />
                                    </button>
                                    <input
                                        type="number"
                                        value={formData.item_quantity}
                                        onChange={(e) => setFormData(prev => ({ ...prev, item_quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                                        className="flex-1 bg-transparent text-center border-none outline-none text-sm font-bold"
                                    />
                                    <button
                                        onClick={() => handleQuantityChange('inc')}
                                        type="button"
                                        className={`px-3 py-2.5 transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Item Description */}
                        <div className="space-y-2">
                            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                Item Description
                            </label>
                            <textarea
                                readOnly
                                rows={2}
                                value={formData.item_description}
                                className={`w-full px-4 py-2.5 border rounded resize-none ${isDarkMode
                                    ? 'bg-gray-800 text-white border-gray-700'
                                    : 'bg-gray-100 text-gray-500 border-gray-200'
                                    }`}
                            />
                        </div>



                        <div className="space-y-6">
                            {/* Requested By */}
                            <div className="space-y-2">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Requested By<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        value={formData.requested_by}
                                        onChange={(e) => setFormData(prev => ({ ...prev, requested_by: e.target.value }))}
                                        className={`w-full px-4 py-2.5 border rounded focus:outline-none appearance-none ${isDarkMode
                                            ? 'bg-gray-800 text-white border-gray-700'
                                            : 'bg-white text-gray-900 border-gray-300'
                                            }`}
                                    >
                                        <option value="None">None</option>
                                        {getAvailableUsers(formData.requested_by).map(u => (
                                            <option key={u.id} value={getUserDisplayName(u)}>{getUserDisplayName(u)}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <User size={18} className={isDarkMode ? 'text-gray-500' : 'text-gray-400'} />
                                    </div>
                                </div>
                            </div>

                            {/* Requested With (1) */}
                            <div className="space-y-2">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Requested With<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        value={formData.requested_with}
                                        onChange={(e) => setFormData(prev => ({ ...prev, requested_with: e.target.value }))}
                                        className={`w-full px-4 py-2.5 border rounded focus:outline-none appearance-none ${isDarkMode
                                            ? 'bg-gray-800 text-white border-gray-700'
                                            : 'bg-white text-gray-900 border-gray-300'
                                            }`}
                                    >
                                        <option value="None">None</option>
                                        {getAvailableUsers(formData.requested_with).map(u => (
                                            <option key={u.id} value={getUserDisplayName(u)}>{getUserDisplayName(u)}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <Users size={18} className={isDarkMode ? 'text-gray-500' : 'text-gray-400'} />
                                    </div>
                                </div>
                            </div>

                            {/* Requested With (2/10) */}
                            <div className="space-y-2">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Requested With (Addl)<span className="text-red-500 ml-0.5">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        value={formData.requested_with_10}
                                        onChange={(e) => setFormData(prev => ({ ...prev, requested_with_10: e.target.value }))}
                                        className={`w-full px-4 py-2.5 border rounded focus:outline-none appearance-none ${isDarkMode
                                            ? 'bg-gray-800 text-white border-gray-700'
                                            : 'bg-white text-gray-900 border-gray-300'
                                            }`}
                                    >
                                        <option value="None">None</option>
                                        {getAvailableUsers(formData.requested_with_10).map(u => (
                                            <option key={u.id} value={getUserDisplayName(u)}>{getUserDisplayName(u)}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <Users size={18} className={isDarkMode ? 'text-gray-500' : 'text-gray-400'} />
                                    </div>
                                </div>
                            </div>

                            {/* SN */}
                            <div className="space-y-2">
                                <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    SN
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={formData.sn}
                                        onChange={(e) => setFormData(prev => ({ ...prev, sn: e.target.value }))}
                                        placeholder="Serial Number"
                                        className={`w-full px-4 py-2.5 border rounded focus:outline-none transition-all ${isDarkMode
                                            ? 'bg-gray-800 text-white border-gray-700 focus:border-red-500'
                                            : 'bg-white text-gray-900 border-gray-300 focus:border-red-500'
                                            }`}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Status Toggle */}
                        <div className="space-y-3">
                            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                Status<span className="text-red-500 ml-0.5">*</span>
                            </label>
                            <div className={`grid grid-cols-3 gap-2 p-1 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                {['Done', 'In Progress', 'Failed'].map((status) => {
                                    const isActive = formData.status === status;
                                    return (
                                        <button
                                            key={status}
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, status }))}
                                            className={`py-2.5 rounded-md text-sm font-semibold transition-all duration-200 ${isActive
                                                ? 'text-white shadow-lg'
                                                : isDarkMode
                                                    ? 'text-gray-400 hover:text-gray-200'
                                                    : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                            style={{
                                                backgroundColor: isActive ? (colorPalette?.primary || '#ef4444') : 'transparent'
                                            }}
                                        >
                                            <div className="flex items-center justify-center space-x-1.5">
                                                {status === 'Done' && <CheckCircle2 size={16} />}
                                                {status === 'In Progress' && <Clock size={16} />}
                                                {status === 'Failed' && <AlertCircle size={16} />}
                                                <span>{status}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Remarks */}
                        <div className="space-y-2 pb-6">
                            <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                Remarks
                            </label>
                            <textarea
                                rows={3}
                                value={formData.remarks}
                                onChange={(e) => setFormData(prev => ({ ...prev, remarks: e.target.value }))}
                                placeholder="Add your notes here..."
                                className={`w-full px-4 py-3 border rounded focus:outline-none transition-all ${isDarkMode
                                    ? 'bg-gray-800 text-white border-gray-700 focus:border-red-500'
                                    : 'bg-white text-gray-900 border-gray-300 focus:border-red-500'
                                    }`}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {modal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10001] animate-in fade-in zoom-in duration-200 text-center">
                    <div className={`border rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
                        }`}>
                        <div className="flex flex-col items-center">
                            {modal.type === 'success' ? (
                                <CheckCircle2 className="w-16 h-16 text-green-500 mb-4 animate-bounce" />
                            ) : (
                                <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                            )}
                            <h3 className="text-xl font-bold mb-2">{modal.title}</h3>
                            <p className="mb-6 opacity-80 whitespace-pre-line">{modal.message}</p>
                            <button
                                onClick={() => {
                                    if (modal.onConfirm) {
                                        modal.onConfirm();
                                    } else {
                                        setModal({ ...modal, isOpen: false });
                                    }
                                }}
                                className="px-8 py-2.5 text-white rounded-full font-semibold transition-all active:scale-95 shadow-lg"
                                style={{ backgroundColor: colorPalette?.primary || '#ef4444' }}
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default InventoryLogsFormModal;

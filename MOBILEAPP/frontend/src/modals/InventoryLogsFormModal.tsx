import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Modal,
    ScrollView,
    ActivityIndicator,
    Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    X,
    Calendar,
    User,
    Users,
    CheckCircle2,
    Clock,
    AlertCircle,
    Minus,
    Plus,
    CheckCircle,
    XCircle,
    Loader2
} from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { createInventoryLog } from '../services/inventoryLogService';
import { InventoryItem } from '../contexts/InventoryContext';
import { userService } from '../services/userService';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// Adding classNames support manually if Nativewind is used
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
    selectedItem,
}) => {
    // Hardcoded to light theme based on user request
    const isDarkMode = false;

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
        message: '',
    });

    // Dropdown visibility state
    const [showRequestedByDropdown, setShowRequestedByDropdown] = useState(false);
    const [showRequestedWithDropdown, setShowRequestedWithDropdown] = useState(false);
    const [showRequestedWith10Dropdown, setShowRequestedWith10Dropdown] = useState(false);

    const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        date: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
        item_id: selectedItem?.item_id?.toString() || '',
        item_name: selectedItem?.item_name || '',
        item_description: selectedItem?.item_description || '',
        item_quantity: 1,
        log_type: 'Stock In',
        requested_by: 'None',
        requested_with: 'None',
        requested_with_10: 'None',
        sn: '',
        status: 'Done',
        remarks: '',
    });

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                const [palette, usersRes] = await Promise.all([
                    settingsColorPaletteService.getActive(),
                    userService.getAllUsers(),
                ]);
                setColorPalette(palette);

                // Filter users except role_id 3 (customer)
                const filteredUsers = (usersRes.data || []).filter(
                    (u: any) => u.role_id !== 3
                );
                setUsers(filteredUsers);
            } catch (err) {
                console.error('Failed to fetch initial data:', err);
            }
        };

        if (isOpen) {
            setModal((prev) => ({ ...prev, isOpen: false }));
            setLoading(false);
            setLoadingPercentage(0);
            fetchInitialData();

            // Update form if selectedItem changes or modal reopens
            setFormData((prev) => ({
                ...prev,
                item_id: selectedItem?.item_id?.toString() || '',
                item_name: selectedItem?.item_name || '',
                item_description: selectedItem?.item_description || '',
                date: dayjs().tz('Asia/Manila').add(8, 'hour').format('MM/DD/YYYY hh:mm:ss A'),
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
            formData.requested_with_10,
        ].filter((val) => val !== 'None' && val !== currentValue);

        return users.filter((u) => !otherSelectedValues.includes(getUserDisplayName(u)));
    };

    const handleQuantityChange = (type: 'inc' | 'dec') => {
        setFormData((prev) => ({
            ...prev,
            item_quantity:
                type === 'inc' ? prev.item_quantity + 1 : Math.max(0, prev.item_quantity - 1),
        }));
    };

    const handleSubmit = async () => {
        setLoading(true);
        setLoadingPercentage(0);

        progressIntervalRef.current = setInterval(() => {
            setLoadingPercentage((prev) => {
                if (prev >= 99) return 99;
                if (prev >= 90) return prev + 1;
                if (prev >= 70) return prev + 2;
                return prev + 5;
            });
        }, 100);

        try {
            const response = await createInventoryLog({
                ...formData,
                item_id: selectedItem?.item_id,
                date: dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss'),
            });

            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
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
                        setModal((prev) => ({ ...prev, isOpen: false }));
                    },
                });
            } else {
                throw new Error(response.message || 'Failed to save log');
            }
        } catch (err: any) {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            console.error('Failed to save inventory log:', err);
            const errorMessage =
                err.response?.data?.message ||
                err.message ||
                'An error occurred while saving.';
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Error',
                message: errorMessage,
            });
        } finally {
            setLoading(false);
            setLoadingPercentage(0);
        }
    };

    const primaryColor = colorPalette?.primary || '#7c3aed';

    const DropdownField = ({
        label,
        value,
        icon,
        visible,
        onToggle,
        fieldKey,
    }: {
        label: string;
        value: string;
        icon: React.ReactNode;
        visible: boolean;
        onToggle: () => void;
        fieldKey: 'requested_by' | 'requested_with' | 'requested_with_10';
    }) => (
        <View className="mb-4">
            <Text className="text-sm font-medium mb-2 text-gray-700">
                {label}<Text className="text-red-500">*</Text>
            </Text>
            <TouchableOpacity
                onPress={onToggle}
                className="w-full px-4 py-[10px] border border-gray-300 rounded-lg bg-white flex-row items-center justify-between"
            >
                <Text className="text-gray-900 text-sm flex-1">{value}</Text>
                {icon}
            </TouchableOpacity>

            {visible && (
                <View className="border border-gray-300 rounded-lg bg-white mt-1 max-h-[180px] overflow-hidden">
                    <ScrollView nestedScrollEnabled>
                        <Pressable
                            onPress={() => {
                                setFormData((prev) => ({ ...prev, [fieldKey]: 'None' }));
                                onToggle();
                            }}
                            className="px-4 py-[10px] border-b border-gray-100 active:bg-gray-100"
                        >
                            <Text className="text-gray-500 text-sm">None</Text>
                        </Pressable>
                        {getAvailableUsers(value).map((u, index) => (
                            <Pressable
                                key={u.id}
                                onPress={() => {
                                    setFormData((prev) => ({
                                        ...prev,
                                        [fieldKey]: getUserDisplayName(u),
                                    }));
                                    onToggle();
                                }}
                                className={`px-4 py-[10px] active:bg-gray-100 ${index !== getAvailableUsers(value).length - 1 ? 'border-b border-gray-100' : ''}`}
                            >
                                <Text className="text-gray-900 text-sm">
                                    {getUserDisplayName(u)}
                                </Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            )}
        </View>
    );

    return (
        <Modal
            visible={isOpen}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={onClose}
        >
            <View className="flex-1 bg-black/50 justify-end">
                {/* Loading Modal */}
                <Modal
                    visible={loading}
                    transparent={true}
                    animationType="fade"
                >
                    <View className="flex-1 bg-black/70 items-center justify-center">
                        <View className="bg-white rounded-xl p-8 items-center space-y-6 min-w-[320px]">
                            <Loader2
                                size={80}
                                color={primaryColor}
                                className="animate-spin"
                            />
                            <View>
                                <Text className="text-4xl font-bold text-gray-900">
                                    {loadingPercentage}%
                                </Text>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Result Modal */}
                <Modal
                    visible={modal.isOpen}
                    transparent={true}
                    animationType="fade"
                >
                    <View className="flex-1 bg-black/75 items-center justify-center p-4">
                        <View className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80%] overflow-hidden">
                            <View className="px-6 py-4 border-b border-gray-200 flex-row items-center justify-between">
                                <Text className="text-lg font-semibold text-gray-900">{modal.title}</Text>
                                <Pressable
                                    onPress={() => {
                                        if (modal.onConfirm) {
                                            modal.onConfirm();
                                        } else {
                                            setModal((prev) => ({ ...prev, isOpen: false }));
                                        }
                                    }}
                                    className="p-1"
                                >
                                    <X size={20} color="#4B5563" />
                                </Pressable>
                            </View>
                            <ScrollView className="px-6 py-4">
                                <View className="space-y-3">
                                    <View
                                        className={`flex-row items-center gap-3 p-3 rounded-lg border ${modal.type === 'success' ? 'bg-green-100 border-green-300' :
                                            modal.type === 'warning' ? 'bg-yellow-100 border-yellow-300' :
                                                'bg-red-100 border-red-300'
                                            }`}
                                    >
                                        {modal.type === 'success' && <CheckCircle className="text-green-500" size={20} />}
                                        {modal.type === 'warning' && <AlertCircle className="text-yellow-500" size={20} />}
                                        {modal.type === 'error' && <XCircle className="text-red-500" size={20} />}

                                        <Text className={`text-sm flex-1 ${modal.type === 'success' ? 'text-green-800' :
                                            modal.type === 'warning' ? 'text-yellow-800' :
                                                'text-red-800'
                                            }`}>
                                            {modal.message}
                                        </Text>
                                    </View>
                                </View>
                            </ScrollView>
                            <View className="px-6 py-4 border-t border-gray-200 flex-row justify-end">
                                <Pressable
                                    onPress={() => {
                                        if (modal.onConfirm) {
                                            modal.onConfirm();
                                        } else {
                                            setModal((prev) => ({ ...prev, isOpen: false }));
                                        }
                                    }}
                                    className="px-6 py-2 rounded-lg"
                                    style={{ backgroundColor: primaryColor }}
                                >
                                    <Text className="text-white font-medium text-center">OK</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Main Form Panel */}
                <View className="h-[90%] w-full shadow-2xl rounded-t-3xl overflow-hidden flex-col bg-gray-50">
                    <View className="px-6 py-4 flex-row items-center justify-between border-b bg-gray-100 border-gray-200">
                        <View className="flex-row items-center space-x-3">
                            <Text className="text-xl font-semibold text-gray-900">
                                Inventory Logs Form
                            </Text>
                        </View>
                        <View className="flex-row items-center space-x-3 gap-2">
                            <Pressable
                                onPress={onClose}
                                className="px-4 py-[8px] border rounded-lg"
                                style={{ borderColor: primaryColor }}
                            >
                                <Text style={{ color: primaryColor }} className="text-sm font-medium">Cancel</Text>
                            </Pressable>
                            <Pressable
                                onPress={handleSubmit}
                                disabled={loading}
                                className="px-6 py-[8px] rounded-lg"
                                style={{
                                    backgroundColor: loading ? '#9ca3af' : primaryColor
                                }}
                            >
                                <Text className="text-white text-sm font-medium">
                                    {loading ? 'Saving...' : 'Submit'}
                                </Text>
                            </Pressable>
                        </View>
                    </View>

                    <ScrollView
                        className="flex-1 p-6"
                        contentContainerStyle={{ paddingBottom: 40 }}
                        showsVerticalScrollIndicator={false}
                        scrollEnabled={!showRequestedByDropdown && !showRequestedWithDropdown && !showRequestedWith10Dropdown}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Date */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">Date</Text>
                            <View className="relative justify-center">
                                <TextInput
                                    editable={false}
                                    value={formData.date}
                                    className="w-full pl-4 pr-11 py-[10px] border rounded-lg bg-gray-100 border-gray-300 text-gray-600 opacity-75"
                                />
                                <Calendar
                                    size={18}
                                    color="#6b7280"
                                    style={{ position: 'absolute', right: 16 }}
                                />
                            </View>
                        </View>

                        {/* Item Name */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">Item Name</Text>
                            <TextInput
                                editable={false}
                                value={formData.item_name}
                                className="w-full px-4 py-[10px] border rounded-lg bg-gray-100 border-gray-300 text-gray-600 opacity-75 font-medium"
                            />
                        </View>

                        {/* Log Type */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">
                                Log Type<Text className="text-red-500">*</Text>
                            </Text>
                            <View className="flex-row gap-2 bg-gray-200 p-1 rounded-lg">
                                {(['Stock In', 'Stock Out'] as const).map((type) => {
                                    const isActive = formData.log_type === type;
                                    return (
                                        <TouchableOpacity
                                            key={type}
                                            onPress={() =>
                                                setFormData((prev) => ({ ...prev, log_type: type }))
                                            }
                                            className="flex-1 py-[10px] rounded-md items-center justify-center shadow-sm"
                                            style={{
                                                backgroundColor: isActive ? primaryColor : 'transparent',
                                            }}
                                        >
                                            <View className="flex-row items-center gap-[6px]">
                                                {type === 'Stock In' && (
                                                    <Plus
                                                        size={16}
                                                        color={isActive ? '#ffffff' : '#4B5563'}
                                                    />
                                                )}
                                                {type === 'Stock Out' && (
                                                    <Minus
                                                        size={16}
                                                        color={isActive ? '#ffffff' : '#4B5563'}
                                                    />
                                                )}
                                                <Text
                                                    className={`text-[13px] font-semibold ${isActive ? 'text-white' : 'text-gray-600'
                                                        }`}
                                                >
                                                    {type}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Item Quantity */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">
                                Item Quantity<Text className="text-red-500">*</Text>
                            </Text>
                            <View className="flex-row items-center border border-gray-300 rounded-lg bg-white overflow-hidden">
                                <TouchableOpacity
                                    onPress={() => handleQuantityChange('dec')}
                                    className="px-4 py-3 bg-gray-50 border-r border-gray-200"
                                >
                                    <Minus size={16} color="#4B5563" />
                                </TouchableOpacity>
                                <TextInput
                                    value={String(formData.item_quantity)}
                                    onChangeText={(val) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            item_quantity: parseInt(val) || 0,
                                        }))
                                    }
                                    keyboardType="numeric"
                                    className="flex-1 text-center text-sm font-bold text-gray-900 bg-transparent py-[10px]"
                                />
                                <TouchableOpacity
                                    onPress={() => handleQuantityChange('inc')}
                                    className="px-4 py-3 bg-gray-50 border-l border-gray-200"
                                >
                                    <Plus size={16} color="#4B5563" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Item Description */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">Item Description</Text>
                            <TextInput
                                editable={false}
                                value={formData.item_description}
                                multiline
                                numberOfLines={2}
                                className="w-full px-4 py-[10px] border rounded-lg bg-gray-100 border-gray-300 text-gray-600 opacity-75 h-[72px] text-left align-text-top"
                            />
                        </View>

                        {/* Requested By */}
                        <DropdownField
                            label="Requested By"
                            value={formData.requested_by}
                            icon={<User size={18} color="#6b7280" />}
                            visible={showRequestedByDropdown}
                            onToggle={() => {
                                setShowRequestedByDropdown((prev) => !prev);
                                setShowRequestedWithDropdown(false);
                                setShowRequestedWith10Dropdown(false);
                            }}
                            fieldKey="requested_by"
                        />

                        {/* Requested With */}
                        <DropdownField
                            label="Requested With"
                            value={formData.requested_with}
                            icon={<Users size={18} color="#6b7280" />}
                            visible={showRequestedWithDropdown}
                            onToggle={() => {
                                setShowRequestedWithDropdown((prev) => !prev);
                                setShowRequestedByDropdown(false);
                                setShowRequestedWith10Dropdown(false);
                            }}
                            fieldKey="requested_with"
                        />

                        {/* Requested With (Addl) */}
                        <DropdownField
                            label="Requested With (Addl)"
                            value={formData.requested_with_10}
                            icon={<Users size={18} color="#6b7280" />}
                            visible={showRequestedWith10Dropdown}
                            onToggle={() => {
                                setShowRequestedWith10Dropdown((prev) => !prev);
                                setShowRequestedByDropdown(false);
                                setShowRequestedWithDropdown(false);
                            }}
                            fieldKey="requested_with_10"
                        />

                        {/* SN */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">SN</Text>
                            <TextInput
                                value={formData.sn}
                                onChangeText={(val) =>
                                    setFormData((prev) => ({ ...prev, sn: val }))
                                }
                                placeholder="Serial Number"
                                placeholderTextColor="#9ca3af"
                                className="w-full px-4 py-[10px] border border-gray-300 rounded-lg bg-white text-gray-900 text-sm"
                            />
                        </View>

                        {/* Status Toggle */}
                        <View className="mb-4">
                            <Text className="text-sm font-medium mb-2 text-gray-700">
                                Status<Text className="text-red-500">*</Text>
                            </Text>
                            <View className="flex-row gap-2 bg-gray-200 p-1 rounded-lg">
                                {(['Done', 'In Progress', 'Failed'] as const).map((status) => {
                                    const isActive = formData.status === status;
                                    return (
                                        <TouchableOpacity
                                            key={status}
                                            onPress={() =>
                                                setFormData((prev) => ({ ...prev, status }))
                                            }
                                            className="flex-1 py-[10px] rounded-md items-center justify-center shadow-sm"
                                            style={{
                                                backgroundColor: isActive ? primaryColor : 'transparent',
                                            }}
                                        >
                                            <View className="flex-row items-center gap-[6px]">
                                                {status === 'Done' && (
                                                    <CheckCircle2
                                                        size={16}
                                                        color={isActive ? '#ffffff' : '#4B5563'}
                                                    />
                                                )}
                                                {status === 'In Progress' && (
                                                    <Clock
                                                        size={16}
                                                        color={isActive ? '#ffffff' : '#4B5563'}
                                                    />
                                                )}
                                                {status === 'Failed' && (
                                                    <AlertCircle
                                                        size={16}
                                                        color={isActive ? '#ffffff' : '#4B5563'}
                                                    />
                                                )}
                                                <Text
                                                    className={`text-[13px] font-semibold ${isActive ? 'text-white' : 'text-gray-600'
                                                        }`}
                                                >
                                                    {status}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Remarks */}
                        <View className="mb-[24px]">
                            <Text className="text-sm font-medium mb-2 text-gray-700">Remarks</Text>
                            <TextInput
                                value={formData.remarks}
                                onChangeText={(val) =>
                                    setFormData((prev) => ({ ...prev, remarks: val }))
                                }
                                placeholder="Add your notes here..."
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={3}
                                className="w-full px-4 py-[10px] border border-gray-300 rounded-lg bg-white text-gray-900 text-sm h-24 text-left align-text-top"
                            />
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

export default InventoryLogsFormModal;

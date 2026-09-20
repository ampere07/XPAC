import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AddReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

interface ModalConfig {
    isOpen: boolean;
    type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

interface FormData {
    report_name: string;
    report_type: string;
    report_schedule: string;
    day: string;
    report_time: string;
    send_to: string;
    date_from: string;
    date_to: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REPORT_TYPES = [
    'Manual Transaction',
    'Payment Portal',
    'Inventory',
    'Job Order',
    'Service Order',
    'Work Order',
    'Summary',
];

const REPORT_SCHEDULES = [
    'Every Day',
    'Every Month',
    'Every 3 Months',
    'Every Year',
];

const QUICK_RANGES = [
    { label: 'Everyday', days: 1 },
    { label: 'Weekly', days: 7 },
    { label: 'Monthly', days: 30 },
    { label: 'Quarterly', days: 90 },
];

const formatTime12h = (raw: string): string => {
    try {
        const [h, m] = raw.split(':');
        let hours = parseInt(h, 10);
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${hours}:${m} ${ampm} GMT+8`;
    } catch {
        return raw;
    }
};

// ─── Component ────────────────────────────────────────────────────────────────

const AddReportModal: React.FC<AddReportModalProps> = ({ isOpen, onClose, onSaved }) => {
    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);

    const [formData, setFormData] = useState<FormData>({
        report_name: '',
        report_type: '',
        report_schedule: '',
        day: '',
        report_time: '',
        send_to: '',
        date_from: '',
        date_to: '',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const [modal, setModal] = useState<ModalConfig>({
        isOpen: false,
        type: 'success',
        title: '',
        message: '',
    });

    useEffect(() => {
        if (isOpen) {
            setFormData({ report_name: '', report_type: '', report_schedule: '', day: '', report_time: '', send_to: '', date_from: '', date_to: '' });
            setErrors({});
        }
    }, [isOpen]);

    const handleChange = (field: keyof FormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };

    const handleRangeSelect = (days: number) => {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - (days - 1));
        const fmt = (d: Date) => d.toISOString().split('T')[0];
        setFormData(prev => ({ ...prev, date_from: fmt(from), date_to: fmt(to) }));
        if (errors.date_from) setErrors(prev => ({ ...prev, date_from: '' }));
        if (errors.date_to) setErrors(prev => ({ ...prev, date_to: '' }));
    };

    const validate = () => {
        const e: Record<string, string> = {};
        if (!formData.report_name.trim()) e.report_name = 'Report name is required.';
        if (!formData.report_type) e.report_type = 'Please select a report type.';
        if (!formData.report_schedule) e.report_schedule = 'Please select a schedule.';
        if (!formData.day.trim()) e.day = 'Day is required.';
        if (!formData.report_time) e.report_time = 'Please enter a time.';
        if (!formData.send_to.trim()) e.send_to = 'Send To is required.';
        if (!formData.date_from) e.date_from = 'Start date is required.';
        if (!formData.date_to) e.date_to = 'End date is required.';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSave = async () => {
        if (!validate()) {
            setModal({ isOpen: true, type: 'warning', title: 'Validation Error', message: 'Please complete all required fields, including selecting a quick date range.' });
            return;
        }

        setLoading(true);
        setLoadingPercentage(0);

        const progressInterval = setInterval(() => {
            setLoadingPercentage(prev => {
                if (prev >= 90) return prev + 1 > 99 ? 99 : prev + 1;
                if (prev >= 70) return prev + 3;
                return prev + 8;
            });
        }, 200);

        try {
            const authDataStr = await AsyncStorage.getItem('authData');
            const user = authDataStr ? JSON.parse(authDataStr) : null;
            const createdBy = user?.email_address || user?.email || 'system';

            const payload = {
                report_name: formData.report_name.trim(),
                report_type: formData.report_type,
                report_schedule: formData.report_schedule,
                day: formData.day,
                report_time: formData.report_time,
                send_to: formData.send_to.trim(),
                date_range: `${formData.date_from} to ${formData.date_to}`,
                created_by: createdBy,
            };

            const res = await apiClient.post<{ success: boolean; message?: string }>('/reports', payload);

            if (!res.data?.success) {
                throw new Error(res.data?.message || 'Failed to save report.');
            }

            clearInterval(progressInterval);
            setLoadingPercentage(100);

            setModal({
                isOpen: true,
                type: 'success',
                title: 'Report Created',
                message: `"${formData.report_name}" has been saved successfully.`,
                onConfirm: () => {
                    setModal(prev => ({ ...prev, isOpen: false }));
                    onSaved();
                    onClose();
                },
            });
        } catch (err: any) {
            clearInterval(progressInterval);
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Failed to Create Report',
                message: err?.response?.data?.message || err?.message || 'An unexpected error occurred.',
            });
        } finally {
            setLoading(false);
            setLoadingPercentage(0);
        }
    };

    return (
        <ModalUITemplate
            isOpen={isOpen}
            onClose={onClose}
            title="Add Report"
            loading={loading}
            loadingPercentage={loading ? loadingPercentage : undefined}
            primaryAction={{ label: 'Save', onClick: handleSave, disabled: loading }}
            secondaryActionLabel="Cancel"
            alertModal={{
                ...modal,
                onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
                onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
            }}
        >
            <AddReportContent formData={formData} handleChange={handleChange} handleRangeSelect={handleRangeSelect} errors={errors} />
        </ModalUITemplate>
    );
};

// ─── Field Components ───────────────────────────────────────────────────────────

const TextField: React.FC<{
    label: string;
    value: string;
    onChangeText: (t: string) => void;
    placeholder: string;
    error?: string;
    keyboardType?: 'default' | 'numeric' | 'email-address';
    hint?: string;
}> = ({ label, value, onChangeText, placeholder, error, keyboardType = 'default', hint }) => {
    const { isDarkMode, colorPalette } = useModalTheme();
    const [isFocused, setIsFocused] = useState(false);
    const borderColor = error ? '#ef4444' : isFocused ? (colorPalette?.primary || '#7c3aed') : (isDarkMode ? '#374151' : '#d1d5db');
    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>
                {label}<Text style={{ color: '#ef4444' }}> *</Text>
            </Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor="#9ca3af"
                keyboardType={keyboardType}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 8, borderColor, color: isDarkMode ? '#ffffff' : '#111827' }}
            />
            {!!hint && <Text style={{ fontSize: 12, color: isDarkMode ? '#6b7280' : '#9ca3af' }}>{hint}</Text>}
            {!!error && <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>}
        </View>
    );
};

const PickerField: React.FC<{
    label: string;
    value: string;
    onValueChange: (v: string) => void;
    options: string[];
    placeholder: string;
    error?: string;
}> = ({ label, value, onValueChange, options, placeholder, error }) => {
    const { isDarkMode } = useModalTheme();
    const borderColor = error ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>
                {label}<Text style={{ color: '#ef4444' }}> *</Text>
            </Text>
            <View style={{ borderWidth: 1, borderColor, borderRadius: 8, overflow: 'hidden', justifyContent: 'center' }}>
                <Picker selectedValue={value} onValueChange={onValueChange} style={{ color: isDarkMode ? '#ffffff' : '#111827' }} dropdownIconColor={isDarkMode ? '#d1d5db' : '#6b7280'}>
                    <Picker.Item label={placeholder} value="" />
                    {options.map(o => (
                        <Picker.Item key={o} label={o} value={o} />
                    ))}
                </Picker>
            </View>
            {!!error && <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>}
        </View>
    );
};

const PreviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    const { isDarkMode } = useModalTheme();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ fontSize: 12, width: 110, color: isDarkMode ? '#6b7280' : '#9ca3af' }}>{label}</Text>
            <Text style={{ fontSize: 12, fontWeight: '500', flex: 1, color: isDarkMode ? '#ffffff' : '#111827' }}>{value}</Text>
        </View>
    );
};

const AddReportContent: React.FC<{
    formData: FormData;
    handleChange: (field: keyof FormData, value: string) => void;
    handleRangeSelect: (days: number) => void;
    errors: Record<string, string>;
}> = ({ formData, handleChange, handleRangeSelect, errors }) => {
    const { isDarkMode, colorPalette } = useModalTheme();
    const primary = colorPalette?.primary || '#7c3aed';
    const hasPreview = !!(formData.report_name || formData.report_type || formData.report_schedule);

    return (
        <View style={{ gap: 20 }}>
            <TextField
                label="Report Name"
                value={formData.report_name}
                onChangeText={(t) => handleChange('report_name', t)}
                placeholder="e.g. Monthly Service Order Summary"
                error={errors.report_name}
            />

            <PickerField
                label="Report Type"
                value={formData.report_type}
                onValueChange={(v) => handleChange('report_type', v)}
                options={REPORT_TYPES}
                placeholder="Select report type…"
                error={errors.report_type}
            />

            <PickerField
                label="Report Schedule"
                value={formData.report_schedule}
                onValueChange={(v) => handleChange('report_schedule', v)}
                options={REPORT_SCHEDULES}
                placeholder="Select schedule…"
                error={errors.report_schedule}
            />

            {/* Quick Date Range */}
            <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>
                    Quick Date Range<Text style={{ color: '#ef4444' }}> *</Text>
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {QUICK_RANGES.map(r => {
                        const active = formData.date_from && formData.date_to && (() => {
                            const to = new Date();
                            const from = new Date();
                            from.setDate(to.getDate() - (r.days - 1));
                            return formData.date_from === from.toISOString().split('T')[0] && formData.date_to === to.toISOString().split('T')[0];
                        })();
                        return (
                            <TouchableOpacity
                                key={r.label}
                                onPress={() => handleRangeSelect(r.days)}
                                style={{
                                    paddingHorizontal: 14,
                                    paddingVertical: 8,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: active ? primary : (isDarkMode ? '#374151' : '#d1d5db'),
                                    backgroundColor: active ? primary : 'transparent',
                                }}
                            >
                                <Text style={{ fontSize: 13, fontWeight: '500', color: active ? '#ffffff' : (isDarkMode ? '#d1d5db' : '#374151') }}>{r.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                {!!(errors.date_from || errors.date_to) && <Text style={{ color: '#ef4444', fontSize: 12 }}>Please select a date range.</Text>}
            </View>

            <TextField
                label="Day"
                value={formData.day}
                onChangeText={(t) => handleChange('day', t)}
                placeholder="e.g. 15"
                keyboardType="numeric"
                error={errors.day}
            />

            <TextField
                label="Report Time (GMT+8)"
                value={formData.report_time}
                onChangeText={(t) => handleChange('report_time', t)}
                placeholder="HH:MM (24h) e.g. 14:30"
                error={errors.report_time}
            />

            <TextField
                label="Send To"
                value={formData.send_to}
                onChangeText={(t) => handleChange('send_to', t)}
                placeholder="e.g. admin@company.com or multiple emails"
                keyboardType="email-address"
                hint="Enter email address(es) where the report will be sent."
                error={errors.send_to}
            />

            {/* Preview card */}
            {hasPreview && (
                <View style={{ borderRadius: 12, borderWidth: 1, padding: 16, backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb', borderColor: isDarkMode ? '#374151' : '#e5e7eb' }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 12, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>PREVIEW</Text>
                    <View style={{ gap: 8 }}>
                        {!!formData.report_name && <PreviewRow label="Name" value={formData.report_name} />}
                        {!!formData.report_type && <PreviewRow label="Type" value={formData.report_type} />}
                        {!!formData.report_schedule && <PreviewRow label="Schedule" value={formData.report_schedule} />}
                        {!!formData.day && <PreviewRow label="Day" value={formData.day} />}
                        {!!formData.report_time && <PreviewRow label="Time (GMT+8)" value={formatTime12h(formData.report_time)} />}
                        {!!formData.send_to && <PreviewRow label="Send To" value={formData.send_to} />}
                        {!!(formData.date_from && formData.date_to) && <PreviewRow label="Date Range" value={`${formData.date_from} to ${formData.date_to}`} />}
                    </View>
                </View>
            )}
        </View>
    );
};

export default AddReportModal;

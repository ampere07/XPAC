import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

/** Extra inputs a schedule needs. Mirrors Report::SCHEDULE_REQUIREMENTS. */
type ScheduleField = 'weekday' | 'day' | 'month';

interface ScheduleOption {
    value: string;
    label: string;
    requires: ScheduleField[];
    hint: string;
}

interface FormData {
    report_name: string;
    report_type: string;
    report_schedule: string;
    report_weekday: string;
    report_month: string;
    day: string;
    report_time: string;
    send_to: string;
    date_from: string;
    date_to: string;
}

type FormField = keyof FormData;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Must stay in sync with ReportDataset::reportTypes() on the backend. */
const REPORT_TYPES = [
    'Manual Transaction',
    'Payment Portal',
    'Combined Transactions',
    'Inventory',
    'Job Order',
    'Service Order',
    'Work Order',
    'Summary',
];

/** Extra explanation shown under the report-type picker. */
const REPORT_TYPE_HINTS: Record<string, string> = {
    'Summary': 'A consolidated summary across billing, orders, inventory and subscribers.',
    'Combined Transactions':
        'Manual transactions and payment-portal payments in one listing, with a Source column '
        + 'plus separate and combined totals.',
};

/**
 * Every schedule declares which extra inputs it needs, so the form renders and
 * validates from this one table instead of demanding a day-of-month for every
 * schedule including "Every Day".
 */
const REPORT_SCHEDULES: ScheduleOption[] = [
    { value: 'Every Day', label: 'Every Day', requires: [], hint: 'Runs once a day at the time you choose.' },
    { value: 'Every Week', label: 'Every Week', requires: ['weekday'], hint: 'Runs once a week on the weekday you choose.' },
    { value: 'Every Month', label: 'Every Month', requires: ['day'], hint: 'Runs once a month on the day you choose.' },
    { value: 'Every 3 Months', label: 'Every 3 Months (Quarterly)', requires: ['day', 'month'], hint: 'Runs in the starting month, then every third month after it.' },
    { value: 'Every Year', label: 'Every Year', requires: ['month', 'day'], hint: 'Runs once a year on the month and day you choose.' },
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const QUICK_RANGES = [
    { label: 'Today', days: 1 },
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const EMPTY_FORM: FormData = {
    report_name: '',
    report_type: '',
    report_schedule: '',
    report_weekday: '',
    report_month: '',
    day: '',
    report_time: '',
    send_to: '',
    date_from: '',
    date_to: '',
};

const CONDITIONAL_FIELDS: Record<ScheduleField, FormField> = {
    weekday: 'report_weekday',
    month: 'report_month',
    day: 'day',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Local-calendar YYYY-MM-DD.
 *
 * Not toISOString().split('T')[0]: that converts to UTC, so for a GMT+8 user
 * any time before 08:00 produced yesterday's date and every preset range was
 * silently off by one day.
 */
const toLocalISODate = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const formatTime12h = (raw: string): string => {
    const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
    if (!match) return raw;

    const hours24 = Number(match[1]);
    if (Number.isNaN(hours24) || hours24 > 23) return raw;

    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${match[2]} ${ampm} GMT+8`;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const parseRecipients = (raw: string): { valid: string[]; invalid: string[] } => {
    const parts = raw.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);

    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];

    parts.forEach(part => {
        if (!EMAIL_RE.test(part)) {
            invalid.push(part);
            return;
        }
        const key = part.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            valid.push(part);
        }
    });

    return { valid, invalid };
};

const getSchedule = (value: string): ScheduleOption | undefined =>
    REPORT_SCHEDULES.find(s => s.value === value);

/** Normalise free-typed time entry: "930" → "09:30", "9:5" → "09:05". */
const normalizeTimeInput = (raw: string): string => {
    const digits = raw.replace(/[^\d]/g, '');
    if (digits.length === 0) return '';

    let hours: string;
    let minutes: string;

    if (digits.length <= 2) {
        hours = digits;
        minutes = '00';
    } else if (digits.length === 3) {
        hours = digits.slice(0, 1);
        minutes = digits.slice(1);
    } else {
        hours = digits.slice(0, 2);
        minutes = digits.slice(2, 4);
    }

    const h = Math.min(23, Number(hours));
    const m = Math.min(59, Number(minutes));

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// ─── Component ────────────────────────────────────────────────────────────────

const AddReportModal: React.FC<AddReportModalProps> = ({ isOpen, onClose, onSaved }) => {
    const [loading, setLoading] = useState(false);
    const [loadingPercentage, setLoadingPercentage] = useState(0);
    const [submitAttempted, setSubmitAttempted] = useState(false);

    const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
    const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});

    const [modal, setModal] = useState<ModalConfig>({
        isOpen: false,
        type: 'success',
        title: '',
        message: '',
    });

    const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopProgress = useCallback(() => {
        if (progressTimer.current !== null) {
            clearInterval(progressTimer.current);
            progressTimer.current = null;
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            setFormData(EMPTY_FORM);
            setErrors({});
            setSubmitAttempted(false);
            setLoading(false);
            setLoadingPercentage(0);
        }
    }, [isOpen]);

    // The old version left this interval running if the modal unmounted mid-save.
    useEffect(() => stopProgress, [stopProgress]);

    // ── Derived state ──────────────────────────────────────────────────────────

    const schedule = useMemo(() => getSchedule(formData.report_schedule), [formData.report_schedule]);

    const needs = useCallback(
        (field: ScheduleField) => Boolean(schedule?.requires.includes(field)),
        [schedule]
    );

    const recipients = useMemo(() => parseRecipients(formData.send_to), [formData.send_to]);

    const maxDay = useMemo(() => {
        if (needs('month') && formData.report_month) {
            const index = Number(formData.report_month) - 1;
            if (index >= 0 && index < 12) return DAYS_IN_MONTH[index];
        }
        return 31;
    }, [needs, formData.report_month]);

    const scheduleSummary = useMemo(() => {
        if (!schedule) return '';

        const time = formData.report_time ? ` at ${formatTime12h(formData.report_time)}` : '';
        const day = formData.day ? Number(formData.day) : null;
        const monthName = formData.report_month ? MONTHS[Number(formData.report_month) - 1] : null;

        switch (schedule.value) {
            case 'Every Day':
                return `Every day${time}.`;
            case 'Every Week':
                return formData.report_weekday ? `Every ${formData.report_weekday}${time}.` : `Every week${time}.`;
            case 'Every Month':
                return day ? `Every month on day ${day}${time}.` : `Every month${time}.`;
            case 'Every 3 Months':
                return monthName && day
                    ? `Every 3 months starting ${monthName}, on day ${day}${time}.`
                    : `Every 3 months${time}.`;
            case 'Every Year':
                return monthName && day ? `Every year on ${monthName} ${day}${time}.` : `Every year${time}.`;
            default:
                return '';
        }
    }, [schedule, formData.report_time, formData.day, formData.report_month, formData.report_weekday]);

    // ── Field handling ─────────────────────────────────────────────────────────

    const clearError = (field: FormField) =>
        setErrors(prev => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });

    const handleChange = (field: FormField, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        clearError(field);
    };

    /**
     * Selecting a schedule clears the inputs the new schedule does not use, plus
     * their errors — otherwise a stale value would still be submitted and an
     * error for a now-hidden field would block saving with nothing to fix.
     */
    const handleScheduleChange = (value: string) => {
        const required = getSchedule(value)?.requires ?? [];

        setFormData(prev => {
            const updated: FormData = { ...prev, report_schedule: value };
            (Object.keys(CONDITIONAL_FIELDS) as ScheduleField[]).forEach(key => {
                if (!required.includes(key)) updated[CONDITIONAL_FIELDS[key]] = '';
            });
            return updated;
        });

        setErrors(prev => {
            const next = { ...prev };
            delete next.report_schedule;
            (Object.keys(CONDITIONAL_FIELDS) as ScheduleField[]).forEach(key => {
                if (!required.includes(key)) delete next[CONDITIONAL_FIELDS[key]];
            });
            return next;
        });
    };

    const handleRangeSelect = (days: number) => {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - (days - 1));

        setFormData(prev => ({
            ...prev,
            date_from: toLocalISODate(from),
            date_to: toLocalISODate(to),
        }));

        clearError('date_from');
        clearError('date_to');
    };

    // ── Validation ─────────────────────────────────────────────────────────────

    const validate = useCallback((): Partial<Record<FormField, string>> => {
        const e: Partial<Record<FormField, string>> = {};

        if (!formData.report_name.trim()) {
            e.report_name = 'Report name is required.';
        } else if (formData.report_name.trim().length < 3) {
            e.report_name = 'Use at least 3 characters.';
        }

        if (!formData.report_type) e.report_type = 'Select what the report should cover.';

        const selected = getSchedule(formData.report_schedule);
        if (!selected) {
            e.report_schedule = 'Select how often this report should run.';
        } else {
            if (selected.requires.includes('weekday') && !formData.report_weekday) {
                e.report_weekday = 'Choose which weekday the report should run on.';
            }

            if (selected.requires.includes('month') && !formData.report_month) {
                e.report_month = 'Choose which month the report should run in.';
            }

            if (selected.requires.includes('day')) {
                const day = Number(formData.day);
                if (!formData.day.trim()) {
                    e.day = 'Enter the day of the month the report should run on.';
                } else if (!Number.isInteger(day) || day < 1 || day > 31) {
                    e.day = 'Day must be a whole number between 1 and 31.';
                } else if (selected.requires.includes('month') && day > maxDay) {
                    const monthName = MONTHS[Number(formData.report_month) - 1] ?? 'That month';
                    e.day = `${monthName} only has ${maxDay} days.`;
                }
            }
        }

        if (!formData.report_time) {
            e.report_time = 'Enter the time of day the report should be sent.';
        } else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(formData.report_time)) {
            e.report_time = 'Enter a valid 24-hour time, e.g. 14:30.';
        }

        if (!formData.send_to.trim()) {
            e.send_to = 'Enter at least one recipient email address.';
        } else if (recipients.invalid.length > 0) {
            e.send_to = `Not a valid email address: ${recipients.invalid.join(', ')}`;
        } else if (recipients.valid.length === 0) {
            e.send_to = 'Enter at least one valid email address.';
        }

        if (!formData.date_from || !formData.date_to) {
            e.date_from = 'Choose the reporting period.';
        } else if (formData.date_from > formData.date_to) {
            e.date_from = 'The end date cannot be before the start date.';
        }

        return e;
    }, [formData, recipients, maxDay]);

    useEffect(() => {
        if (submitAttempted) setErrors(validate());
    }, [submitAttempted, validate]);

    // ── Save ───────────────────────────────────────────────────────────────────

    const handleSave = async () => {
        setSubmitAttempted(true);

        const validationErrors = validate();
        setErrors(validationErrors);

        const count = Object.keys(validationErrors).length;
        if (count > 0) {
            setModal({
                isOpen: true,
                type: 'warning',
                title: 'Check the form',
                message: count === 1
                    ? Object.values(validationErrors)[0] ?? 'Please correct the highlighted field.'
                    : `Please correct the ${count} highlighted fields before saving.`,
            });
            return;
        }

        setLoading(true);
        setLoadingPercentage(5);

        stopProgress();
        progressTimer.current = setInterval(() => {
            setLoadingPercentage(prev => {
                if (prev >= 90) return Math.min(prev + 1, 95);
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
                report_time: formData.report_time,
                // Only fields this schedule uses are sent; the rest go as null so
                // a stale value cannot affect when the report fires.
                day: needs('day') ? Number(formData.day) : null,
                report_weekday: needs('weekday') ? formData.report_weekday : null,
                report_month: needs('month') ? Number(formData.report_month) : null,
                send_to: recipients.valid.join(', '),
                date_range: `${formData.date_from} to ${formData.date_to}`,
                created_by: createdBy,
            };

            const res = await apiClient.post<{
                success: boolean;
                message?: string;
                warning?: string | null;
                errors?: Record<string, string[]>;
            }>('/reports', payload);

            if (!res.data?.success) {
                throw new Error(res.data?.message || 'Failed to save report.');
            }

            stopProgress();
            setLoadingPercentage(100);
            setLoading(false);

            const warning = res.data.warning;

            setModal({
                isOpen: true,
                type: warning ? 'warning' : 'success',
                title: warning ? 'Report Saved With a Warning' : 'Report Created',
                message: warning
                    ? `"${formData.report_name.trim()}" was saved and will run on schedule, but the first PDF could not be produced:\n\n${warning}`
                    : `"${formData.report_name.trim()}" has been saved.\n\n${scheduleSummary}\nIt will be emailed to ${recipients.valid.length} recipient${recipients.valid.length === 1 ? '' : 's'}.`,
                onConfirm: () => {
                    setModal(prev => ({ ...prev, isOpen: false }));
                    onSaved();
                    onClose();
                },
            });
        } catch (err: any) {
            stopProgress();
            setLoading(false);
            setLoadingPercentage(0);

            const fieldErrors = err?.response?.data?.errors as Record<string, string[]> | undefined;
            if (fieldErrors) {
                const mapped: Partial<Record<FormField, string>> = {};
                Object.entries(fieldErrors).forEach(([key, messages]) => {
                    const field = (key === 'date_range' ? 'date_from' : key) as FormField;
                    if (field in EMPTY_FORM) mapped[field] = messages?.[0] ?? 'Invalid value.';
                });
                setErrors(prev => ({ ...prev, ...mapped }));
            }

            setModal({
                isOpen: true,
                type: 'error',
                title: 'Failed to Create Report',
                message: err?.response?.data?.message
                    || err?.message
                    || 'An unexpected error occurred. Please try again.',
            });
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
                onConfirm: modal.onConfirm || (() => setModal(prev => ({ ...prev, isOpen: false }))),
                onCancel: modal.onCancel || (() => setModal(prev => ({ ...prev, isOpen: false }))),
            }}
        >
            <AddReportContent
                formData={formData}
                errors={errors}
                schedule={schedule}
                maxDay={maxDay}
                scheduleSummary={scheduleSummary}
                recipients={recipients.valid}
                handleChange={handleChange}
                handleScheduleChange={handleScheduleChange}
                handleRangeSelect={handleRangeSelect}
            />
        </ModalUITemplate>
    );
};

// ─── Field Components ─────────────────────────────────────────────────────────

const TextField: React.FC<{
    label: string;
    value: string;
    onChangeText: (t: string) => void;
    placeholder: string;
    error?: string;
    required?: boolean;
    keyboardType?: 'default' | 'numeric' | 'email-address';
    hint?: string;
    maxLength?: number;
    autoCapitalize?: 'none' | 'sentences';
    onBlur?: () => void;
}> = ({
    label, value, onChangeText, placeholder, error, required = true,
    keyboardType = 'default', hint, maxLength, autoCapitalize = 'sentences', onBlur,
}) => {
    const { isDarkMode, colorPalette } = useModalTheme();
    const [isFocused, setIsFocused] = useState(false);

    const borderColor = error
        ? '#ef4444'
        : isFocused
            ? (colorPalette?.primary || '#7c3aed')
            : (isDarkMode ? '#374151' : '#d1d5db');

    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>
                {label}{required && <Text style={{ color: '#ef4444' }}> *</Text>}
            </Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor="#9ca3af"
                keyboardType={keyboardType}
                maxLength={maxLength}
                autoCapitalize={autoCapitalize}
                autoCorrect={false}
                onFocus={() => setIsFocused(true)}
                onBlur={() => { setIsFocused(false); onBlur?.(); }}
                style={{
                    width: '100%', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1,
                    borderRadius: 8, borderColor, color: isDarkMode ? '#ffffff' : '#111827',
                }}
            />
            {!!hint && !error && (
                <Text style={{ fontSize: 12, color: isDarkMode ? '#6b7280' : '#9ca3af' }}>{hint}</Text>
            )}
            {!!error && <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>}
        </View>
    );
};

const PickerField: React.FC<{
    label: string;
    value: string;
    onValueChange: (v: string) => void;
    options: Array<{ label: string; value: string }>;
    placeholder: string;
    error?: string;
    hint?: string;
}> = ({ label, value, onValueChange, options, placeholder, error, hint }) => {
    const { isDarkMode } = useModalTheme();
    const borderColor = error ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');

    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>
                {label}<Text style={{ color: '#ef4444' }}> *</Text>
            </Text>
            <View style={{ borderWidth: 1, borderColor, borderRadius: 8, overflow: 'hidden', justifyContent: 'center' }}>
                <Picker
                    selectedValue={value}
                    onValueChange={onValueChange}
                    style={{ color: isDarkMode ? '#ffffff' : '#111827' }}
                    dropdownIconColor={isDarkMode ? '#d1d5db' : '#6b7280'}
                >
                    <Picker.Item label={placeholder} value="" />
                    {options.map(o => (
                        <Picker.Item key={o.value} label={o.label} value={o.value} />
                    ))}
                </Picker>
            </View>
            {!!hint && !error && (
                <Text style={{ fontSize: 12, color: isDarkMode ? '#6b7280' : '#9ca3af' }}>{hint}</Text>
            )}
            {!!error && <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>}
        </View>
    );
};

const PreviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    const { isDarkMode } = useModalTheme();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ fontSize: 12, width: 92, color: isDarkMode ? '#6b7280' : '#9ca3af' }}>{label}</Text>
            <Text style={{ fontSize: 12, fontWeight: '500', flex: 1, color: isDarkMode ? '#ffffff' : '#111827' }}>
                {value}
            </Text>
        </View>
    );
};

const AddReportContent: React.FC<{
    formData: FormData;
    errors: Partial<Record<FormField, string>>;
    schedule?: ScheduleOption;
    maxDay: number;
    scheduleSummary: string;
    recipients: string[];
    handleChange: (field: FormField, value: string) => void;
    handleScheduleChange: (value: string) => void;
    handleRangeSelect: (days: number) => void;
}> = ({
    formData, errors, schedule, maxDay, scheduleSummary, recipients,
    handleChange, handleScheduleChange, handleRangeSelect,
}) => {
    const { isDarkMode, colorPalette } = useModalTheme();
    const primary = colorPalette?.primary || '#7c3aed';

    const needs = (field: ScheduleField) => Boolean(schedule?.requires.includes(field));

    const cardStyle = {
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        gap: 16,
        backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb',
        borderColor: isDarkMode ? '#374151' : '#e5e7eb',
    } as const;

    const sectionLabelStyle = {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.5,
        color: isDarkMode ? '#9ca3af' : '#6b7280',
    } as const;

    const previewRows: Array<[string, string]> = [
        ['Name', formData.report_name],
        ['Type', formData.report_type],
        ['Schedule', scheduleSummary],
        ['First period', formData.date_from && formData.date_to ? `${formData.date_from} to ${formData.date_to}` : ''],
        ['Recipients', recipients.join(', ')],
    ];

    const visiblePreviewRows = previewRows.filter(([, value]) => Boolean(value));

    return (
        <View style={{ gap: 20 }}>
            <TextField
                label="Report Name"
                value={formData.report_name}
                onChangeText={t => handleChange('report_name', t)}
                placeholder="e.g. Monthly Service Order Summary"
                maxLength={255}
                error={errors.report_name}
            />

            <PickerField
                label="Report Type"
                value={formData.report_type}
                onValueChange={v => handleChange('report_type', v)}
                options={REPORT_TYPES.map(t => ({ label: t, value: t }))}
                placeholder="Select report type…"
                error={errors.report_type}
                hint={REPORT_TYPE_HINTS[formData.report_type]}
            />

            {/* ── Schedule ──────────────────────────────────────────────────── */}
            <View style={cardStyle}>
                <Text style={sectionLabelStyle}>SCHEDULE</Text>

                <PickerField
                    label="Runs"
                    value={formData.report_schedule}
                    onValueChange={handleScheduleChange}
                    options={REPORT_SCHEDULES.map(s => ({ label: s.label, value: s.value }))}
                    placeholder="Select schedule…"
                    error={errors.report_schedule}
                    hint={schedule?.hint}
                />

                {/*
                  Only the inputs the selected schedule needs are rendered at all,
                  so a hidden field can neither be required nor hold a stale value.
                */}
                {needs('weekday') && (
                    <PickerField
                        label="Weekday"
                        value={formData.report_weekday}
                        onValueChange={v => handleChange('report_weekday', v)}
                        options={WEEKDAYS.map(d => ({ label: d, value: d }))}
                        placeholder="Select weekday…"
                        error={errors.report_weekday}
                    />
                )}

                {needs('month') && (
                    <PickerField
                        label={schedule?.value === 'Every 3 Months' ? 'Starting Month' : 'Month'}
                        value={formData.report_month}
                        onValueChange={v => handleChange('report_month', v)}
                        options={MONTHS.map((m, i) => ({ label: m, value: String(i + 1) }))}
                        placeholder="Select month…"
                        error={errors.report_month}
                    />
                )}

                {needs('day') && (
                    <TextField
                        label="Day of Month"
                        value={formData.day}
                        onChangeText={t => handleChange('day', t.replace(/[^\d]/g, '').slice(0, 2))}
                        placeholder={`1–${maxDay}`}
                        keyboardType="numeric"
                        maxLength={2}
                        error={errors.day}
                        hint={!needs('month') && Number(formData.day) > 28
                            ? `Months shorter than ${formData.day} days will run on their last day instead.`
                            : undefined}
                    />
                )}

                <TextField
                    label="Time (GMT+8)"
                    value={formData.report_time}
                    onChangeText={t => handleChange('report_time', t.replace(/[^\d:]/g, '').slice(0, 5))}
                    onBlur={() => {
                        // Accepts "930" or "9:5" and normalises to "09:30" / "09:05"
                        // so a valid entry is never rejected on formatting alone.
                        const normalized = normalizeTimeInput(formData.report_time);
                        if (normalized && normalized !== formData.report_time) {
                            handleChange('report_time', normalized);
                        }
                    }}
                    placeholder="HH:MM (24-hour), e.g. 14:30"
                    keyboardType="numeric"
                    maxLength={5}
                    error={errors.report_time}
                />

                {!!scheduleSummary && (
                    <View style={{ backgroundColor: `${primary}14`, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                        <Text style={{ fontSize: 12, color: primary }}>{scheduleSummary}</Text>
                    </View>
                )}
            </View>

            {/* ── Reporting period ──────────────────────────────────────────── */}
            <View style={cardStyle}>
                <Text style={sectionLabelStyle}>REPORTING PERIOD</Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {QUICK_RANGES.map(range => {
                        const to = new Date();
                        const from = new Date();
                        from.setDate(to.getDate() - (range.days - 1));
                        const active = formData.date_from === toLocalISODate(from)
                            && formData.date_to === toLocalISODate(to);

                        return (
                            <TouchableOpacity
                                key={range.label}
                                onPress={() => handleRangeSelect(range.days)}
                                style={{
                                    paddingHorizontal: 14,
                                    paddingVertical: 8,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: active ? primary : (isDarkMode ? '#374151' : '#d1d5db'),
                                    backgroundColor: active ? primary : 'transparent',
                                }}
                            >
                                <Text style={{
                                    fontSize: 13,
                                    fontWeight: '500',
                                    color: active ? '#ffffff' : (isDarkMode ? '#d1d5db' : '#374151'),
                                }}>
                                    {range.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <TextField
                    label="From"
                    value={formData.date_from}
                    onChangeText={t => handleChange('date_from', t.replace(/[^\d-]/g, '').slice(0, 10))}
                    placeholder="YYYY-MM-DD"
                    maxLength={10}
                    autoCapitalize="none"
                    error={errors.date_from}
                />

                <TextField
                    label="To"
                    value={formData.date_to}
                    onChangeText={t => handleChange('date_to', t.replace(/[^\d-]/g, '').slice(0, 10))}
                    placeholder="YYYY-MM-DD"
                    maxLength={10}
                    autoCapitalize="none"
                    error={errors.date_to}
                    hint="The first report covers these dates. Each scheduled send after it rolls forward to the next window of the same length, so no data is sent twice."
                />
            </View>

            {/* ── Recipients ────────────────────────────────────────────────── */}
            <TextField
                label="Send To"
                value={formData.send_to}
                onChangeText={t => handleChange('send_to', t)}
                placeholder="admin@company.com, ops@company.com"
                keyboardType="email-address"
                autoCapitalize="none"
                hint="Separate multiple addresses with commas. Each recipient gets their own copy with the PDF attached."
                error={errors.send_to}
            />

            {recipients.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {recipients.map(email => (
                        <View
                            key={email.toLowerCase()}
                            style={{
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: 999,
                                backgroundColor: `${primary}1a`,
                            }}
                        >
                            <Text style={{ fontSize: 11, fontWeight: '500', color: primary }}>{email}</Text>
                        </View>
                    ))}
                </View>
            )}

            {/* ── Preview ───────────────────────────────────────────────────── */}
            {visiblePreviewRows.length > 0 && (
                <View style={{
                    borderRadius: 12,
                    borderWidth: 1,
                    padding: 16,
                    backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb',
                    borderColor: isDarkMode ? '#374151' : '#e5e7eb',
                }}>
                    <Text style={{ ...sectionLabelStyle, marginBottom: 12 }}>PREVIEW</Text>
                    <View style={{ gap: 8 }}>
                        {visiblePreviewRows.map(([label, value]) => (
                            <PreviewRow key={label} label={label} value={value} />
                        ))}
                    </View>
                </View>
            )}
        </View>
    );
};

export default AddReportModal;

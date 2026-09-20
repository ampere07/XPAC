import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Plus, AlertCircle, CalendarDays, Clock, Mail, Info, Eye, X } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { reportService } from '../services/reportService';

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
    /** Which of weekday / day / month this schedule actually uses. */
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
 * Every schedule declares exactly which extra inputs it needs. The form renders
 * and validates from this table, so "Every Day" no longer asks for a day of the
 * month and "Every Week" no longer asks for anything but a weekday.
 */
const REPORT_SCHEDULES: ScheduleOption[] = [
    {
        value: 'Every Day',
        label: 'Every Day',
        requires: [],
        hint: 'Runs once a day at the time you choose.',
    },
    {
        value: 'Every Week',
        label: 'Every Week',
        requires: ['weekday'],
        hint: 'Runs once a week on the weekday you choose.',
    },
    {
        value: 'Every Month',
        label: 'Every Month',
        requires: ['day'],
        hint: 'Runs once a month on the day of the month you choose.',
    },
    {
        value: 'Every 3 Months',
        label: 'Every 3 Months (Quarterly)',
        requires: ['day', 'month'],
        hint: 'Runs in the starting month you choose and then every third month after it.',
    },
    {
        value: 'Every Year',
        label: 'Every Year',
        requires: ['month', 'day'],
        hint: 'Runs once a year on the month and day you choose.',
    },
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A reporting-period preset.
 *
 * `resolve` returns the inclusive calendar bounds rather than a day count, because
 * "this month" and "last month" are not fixed-length windows. The distinction is not
 * cosmetic: the resulting span becomes the report's period LENGTH, which
 * Report::nextAutomaticWindow() reuses for every later automatic send. A monthly report
 * captured as "1st to today" would advance in short windows for ever after.
 *
 * Every bound is a local calendar date. The backend stamps 00:00:00 on the start and
 * 23:59:59 on the end, so a selected day is always counted whole at both edges.
 */
interface QuickRange {
    label: string;
    resolve: () => { from: Date; to: Date };
}

/** The current date plus the previous `days - 1`, so `days` counts whole days inclusively. */
const rollingDays = (days: number): { from: Date; to: Date } => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    return { from, to };
};

const QUICK_RANGES: QuickRange[] = [
    { label: 'Today', resolve: () => rollingDays(1) },
    { label: 'Last 7 days', resolve: () => rollingDays(7) },
    { label: 'Last 30 days', resolve: () => rollingDays(30) },
    { label: 'Last 90 days', resolve: () => rollingDays(90) },
    {
        // Day 0 of the NEXT month is the last day of this one, which gets February and
        // every 30-day month right without a table of month lengths.
        label: 'This month',
        resolve: () => {
            const now = new Date();
            return {
                from: new Date(now.getFullYear(), now.getMonth(), 1),
                to: new Date(now.getFullYear(), now.getMonth() + 1, 0),
            };
        },
    },
    {
        label: 'Last month',
        resolve: () => {
            const now = new Date();
            return {
                from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                to: new Date(now.getFullYear(), now.getMonth(), 0),
            };
        },
    },
];

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

/** Fields that only exist for some schedules. */
const CONDITIONAL_FIELDS: Record<ScheduleField, FormField> = {
    weekday: 'report_weekday',
    month: 'report_month',
    day: 'day',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Local-calendar YYYY-MM-DD.
 *
 * Deliberately not toISOString().split('T')[0]: that converts to UTC, so for a
 * GMT+8 user any time before 08:00 produced yesterday's date and the preset
 * ranges were silently off by one day.
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

const formatDisplayDate = (iso: string): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Split a Send To value into valid and invalid addresses, case-insensitively deduped. */
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

/** Inclusive day count between two YYYY-MM-DD dates, or null if either is unset/invalid. */
const periodLengthInDays = (from: string, to: string): number | null => {
    if (!from || !to) return null;

    const start = Date.parse(`${from}T00:00:00`);
    const end = Date.parse(`${to}T00:00:00`);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;

    return Math.round((end - start) / 86_400_000) + 1;
};

/** Days in a month, ignoring leap years for February (28 is the safe floor). */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ─── Component ────────────────────────────────────────────────────────────────

const AddReportModal: React.FC<AddReportModalProps> = ({ isOpen, onClose, onSaved }) => {
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
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

    // ── Init ───────────────────────────────────────────────────────────────────

    useEffect(() => {
        const syncTheme = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
        syncTheme();

        const observer = new MutationObserver(syncTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        settingsColorPaletteService.getActive().then(setColorPalette).catch(() => { });

        return () => observer.disconnect();
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

    const stopProgress = useCallback(() => {
        if (progressTimer.current !== null) {
            clearInterval(progressTimer.current);
            progressTimer.current = null;
        }
    }, []);

    // The old version left this interval running if the modal unmounted mid-save.
    useEffect(() => stopProgress, [stopProgress]);

    // Close on Escape, but never while a save is in flight.
    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !loading && !modal.isOpen) onClose();
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, loading, modal.isOpen, onClose]);

    // ── Derived state ──────────────────────────────────────────────────────────

    const schedule = useMemo(() => getSchedule(formData.report_schedule), [formData.report_schedule]);

    const needs = useCallback(
        (field: ScheduleField) => Boolean(schedule?.requires.includes(field)),
        [schedule]
    );

    const recipients = useMemo(() => parseRecipients(formData.send_to), [formData.send_to]);

    /** Largest day-of-month that is valid in every month this schedule can hit. */
    const maxDay = useMemo(() => {
        if (!needs('day')) return 31;

        // Month-specific schedules are bounded by that month's length.
        if (needs('month') && formData.report_month) {
            const index = Number(formData.report_month) - 1;
            if (index >= 0 && index < 12) return DAYS_IN_MONTH[index];
        }

        return 31;
    }, [needs, formData.report_month]);

    /** Human-readable sentence describing when this report will run. */
    const scheduleSummary = useMemo(() => {
        if (!schedule) return '';

        const time = formData.report_time ? ` at ${formatTime12h(formData.report_time)}` : '';
        const day = formData.day ? Number(formData.day) : null;
        const monthName = formData.report_month ? MONTHS[Number(formData.report_month) - 1] : null;

        switch (schedule.value) {
            case 'Every Day':
                return `Every day${time}.`;
            case 'Every Week':
                return formData.report_weekday
                    ? `Every ${formData.report_weekday}${time}.`
                    : `Every week${time}.`;
            case 'Every Month':
                return day ? `Every month on day ${day}${time}.` : `Every month${time}.`;
            case 'Every 3 Months':
                if (monthName && day) {
                    return `Every 3 months starting ${monthName}, on day ${day}${time}.`;
                }
                return `Every 3 months${time}.`;
            case 'Every Year':
                return monthName && day
                    ? `Every year on ${monthName} ${day}${time}.`
                    : `Every year${time}.`;
            default:
                return '';
        }
    }, [schedule, formData.report_time, formData.day, formData.report_month, formData.report_weekday]);

    /** Warn when a chosen day is clamped in shorter months. */
    const dayClampNotice = useMemo(() => {
        const day = Number(formData.day);
        if (!needs('day') || !day) return null;

        if (needs('month')) {
            const limit = maxDay;
            return day > limit
                ? `${MONTHS[Number(formData.report_month) - 1] ?? 'That month'} only has ${limit} days.`
                : null;
        }

        return day > 28
            ? `Months shorter than ${day} days will run on their last day instead.`
            : null;
    }, [formData.day, formData.report_month, maxDay, needs]);

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
     * Changing the schedule resets the inputs the new schedule does not use, and
     * drops their validation errors.
     *
     * Without this, a value left behind from a previous selection would still be
     * submitted (and could change when the report fires), and an error message
     * for a now-hidden field would block the form with nothing on screen to fix.
     */
    const handleScheduleChange = (value: string) => {
        const next = getSchedule(value);
        const required = next?.requires ?? [];

        setFormData(prev => {
            const updated: FormData = { ...prev, report_schedule: value };

            (Object.keys(CONDITIONAL_FIELDS) as ScheduleField[]).forEach(key => {
                if (!required.includes(key)) {
                    updated[CONDITIONAL_FIELDS[key]] = '';
                }
            });

            return updated;
        });

        setErrors(prev => {
            const next2 = { ...prev };
            delete next2.report_schedule;

            (Object.keys(CONDITIONAL_FIELDS) as ScheduleField[]).forEach(key => {
                if (!required.includes(key)) {
                    delete next2[CONDITIONAL_FIELDS[key]];
                }
            });

            return next2;
        });
    };

    const handleRangeSelect = (range: QuickRange) => {
        const { from, to } = range.resolve();

        setFormData(prev => ({
            ...prev,
            date_from: toLocalISODate(from),
            date_to: toLocalISODate(to),
        }));

        clearError('date_from');
        clearError('date_to');
    };

    // ── Live PDF preview ───────────────────────────────────────────────────────

    /**
     * Object URL of the rendered draft, or null when nothing has been previewed.
     *
     * Held in state rather than derived so the pane keeps showing the last render
     * while the operator edits, instead of blanking on every keystroke.
     */
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);

    /**
     * A blob URL is a live reference into the tab's memory, and a report PDF is not
     * small. Released whenever it is replaced and again on unmount, so opening the
     * modal repeatedly does not accumulate documents nobody is looking at.
     */
    useEffect(() => () => { reportService.releasePreview(previewUrl); }, [previewUrl]);

    /**
     * Render the form's current values, without creating anything.
     *
     * Only the three fields the document is built from are required, so an operator
     * can look at the layout before deciding a schedule or recipients.
     */
    const handlePreview = useCallback(async () => {
        if (!formData.report_type) {
            setPreviewError('Choose a report type first.');
            return;
        }
        if (!formData.date_from || !formData.date_to) {
            setPreviewError('Set the reporting period first.');
            return;
        }

        setPreviewLoading(true);
        setPreviewError(null);

        try {
            const url = await reportService.previewDraft({
                report_name: formData.report_name || undefined,
                report_type: formData.report_type,
                date_range: `${formData.date_from} to ${formData.date_to}`,
            });
            // Replacing, so the one being dropped is released here rather than waiting
            // for the effect above to run on the next change.
            setPreviewUrl(prev => { reportService.releasePreview(prev); return url; });
        } catch (err: any) {
            setPreviewError(err?.message || 'The preview could not be generated.');
        } finally {
            setPreviewLoading(false);
        }
    }, [formData.report_type, formData.date_from, formData.date_to, formData.report_name]);

    const closePreview = useCallback(() => {
        setPreviewUrl(prev => { reportService.releasePreview(prev); return null; });
        setPreviewError(null);
    }, []);

    const periodDays = useMemo(
        () => periodLengthInDays(formData.date_from, formData.date_to),
        [formData.date_from, formData.date_to]
    );

    const activeQuickRange = useMemo(() => {
        if (!formData.date_from || !formData.date_to) return null;

        const today = toLocalISODate(new Date());
        if (formData.date_to !== today) return null;

        // Matched on BOTH ends. Comparing only the start made "This month" and any
        // rolling range that happened to begin on the 1st indistinguishable, so the
        // wrong chip lit up.
        return QUICK_RANGES.find(range => {
            const { from, to } = range.resolve();
            return formData.date_from === toLocalISODate(from)
                && formData.date_to === toLocalISODate(to);
        })?.label ?? null;
    }, [formData.date_from, formData.date_to]);

    // ── Validation ─────────────────────────────────────────────────────────────

    /**
     * Validates only the fields that are actually visible for the chosen
     * schedule. Hidden inputs are never required and never produce an error.
     */
    const validate = useCallback((): Partial<Record<FormField, string>> => {
        const e: Partial<Record<FormField, string>> = {};

        if (!formData.report_name.trim()) {
            e.report_name = 'Report name is required.';
        } else if (formData.report_name.trim().length < 3) {
            e.report_name = 'Use at least 3 characters so the report is easy to identify.';
        } else if (formData.report_name.trim().length > 255) {
            e.report_name = 'Report name cannot exceed 255 characters.';
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
            e.report_time = 'Pick the time of day the report should be sent.';
        } else if (!/^\d{2}:\d{2}(:\d{2})?$/.test(formData.report_time)) {
            e.report_time = 'Enter a valid time.';
        }

        if (!formData.send_to.trim()) {
            e.send_to = 'Enter at least one recipient email address.';
        } else if (recipients.invalid.length > 0) {
            e.send_to = `Not a valid email address: ${recipients.invalid.join(', ')}`;
        } else if (recipients.valid.length === 0) {
            e.send_to = 'Enter at least one valid email address.';
        }

        if (!formData.date_from) e.date_from = 'Choose the start of the reporting period.';
        if (!formData.date_to) e.date_to = 'Choose the end of the reporting period.';

        if (formData.date_from && formData.date_to && formData.date_from > formData.date_to) {
            e.date_to = 'The end date cannot be before the start date.';
        }

        return e;
    }, [formData, recipients, maxDay]);

    // Once the user has tried to save, keep validation live so fixes clear
    // immediately instead of only on the next attempt.
    useEffect(() => {
        if (submitAttempted) setErrors(validate());
    }, [submitAttempted, validate]);

    // ── Save ───────────────────────────────────────────────────────────────────

    const handleSave = async () => {
        setSubmitAttempted(true);

        const validationErrors = validate();
        setErrors(validationErrors);

        if (Object.keys(validationErrors).length > 0) {
            const count = Object.keys(validationErrors).length;
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
            const authData = localStorage.getItem('authData');
            const user = authData ? JSON.parse(authData) : null;
            const createdBy = user?.email_address || user?.email || 'system';

            const payload = {
                report_name: formData.report_name.trim(),
                report_type: formData.report_type,
                report_schedule: formData.report_schedule,
                report_time: formData.report_time,
                // Only the fields this schedule uses are sent; the rest go as
                // null so a stale value can never affect when the report fires.
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

            // Surface server-side field errors on the matching inputs.
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

    if (!isOpen) return null;

    // ── Styling ────────────────────────────────────────────────────────────────

    const primary = colorPalette?.primary || '#7c3aed';

    const inputCls = (field: FormField) => {
        const base = 'w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none transition-colors';
        if (errors[field]) {
            return `${base} border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`;
        }
        return `${base} custom-focus-ring ${isDarkMode
            ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
            : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`;
    };

    const labelCls = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
    const hintCls = `mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`;
    const sectionLabelCls = `flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;
    const cardCls = `rounded-xl border p-4 ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`;

    const FieldError: React.FC<{ field: FormField }> = ({ field }) =>
        errors[field] ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-red-400">
                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{errors[field]}</span>
            </p>
        ) : null;

    const previewRows: Array<[string, string]> = [
        ['Name', formData.report_name],
        ['Type', formData.report_type],
        ['Schedule', scheduleSummary],
        ['First period', formData.date_from && formData.date_to
            ? `${formatDisplayDate(formData.date_from)} – ${formatDisplayDate(formData.date_to)}`
                + (periodDays ? `, then rolling ${periodDays} days` : '')
            : ''],
        ['Recipients', recipients.valid.join(', ')],
    ];

    return (
        <>
            <style>
                {`
                .custom-focus-ring:focus {
                    border-color: ${primary} !important;
                    box-shadow: 0 0 0 2px ${primary}40 !important;
                }
                `}
            </style>

            {/* ── Loading overlay ─────────────────────────────────────────────── */}
            {loading && (
                <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
                    <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <Loader2 className="w-20 h-20 animate-spin" style={{ color: primary }} />
                        <div className="text-center">
                            <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {loadingPercentage}%
                            </p>
                            <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                Saving the report and generating its first PDF…
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Slide-in panel ──────────────────────────────────────────────── */}
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-end z-[5000]">
                <div className={`h-full w-full max-w-lg flex flex-col shadow-2xl transition-transform animate-slide-in ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>

                    {/* Header */}
                    <div className={`px-6 py-4 flex items-center justify-between border-b flex-shrink-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${primary}20` }}>
                                <Plus size={16} style={{ color: primary }} />
                            </div>
                            <div>
                                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    Add Report
                                </h2>
                                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Configure a new scheduled report
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Preview renders the document the recipient would get,
                                through the same service, without creating anything. */}
                            <button
                                type="button"
                                onClick={handlePreview}
                                disabled={loading || previewLoading}
                                title="Render this report as a PDF without creating it"
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                            >
                                {previewLoading
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : <Eye size={14} />}
                                Preview
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={loading}
                                className="px-4 py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                                style={{ backgroundColor: primary }}
                            >
                                Save
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-5">

                        {/* Live PDF preview. Shown only once something has been rendered,
                            so the form is not permanently half a screen narrower. */}
                        {(previewUrl || previewError) && (
                            <div className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-gray-50'}`}>
                                <div className={`flex items-center justify-between px-3 py-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                                    <span className={`text-xs font-medium flex items-center gap-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        <Eye size={12} /> PDF preview
                                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                                            &mdash; not saved
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={closePreview}
                                        className={`p-1 rounded ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
                                        aria-label="Close preview"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>

                                {previewError ? (
                                    <p className="px-3 py-4 text-xs text-red-500 flex items-start gap-2">
                                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                        {previewError}
                                    </p>
                                ) : (
                                    <iframe
                                        src={previewUrl ?? undefined}
                                        title="Report PDF preview"
                                        className="w-full h-[420px] rounded-b-lg"
                                    />
                                )}
                            </div>
                        )}

                        {/* Report Name */}
                        <div>
                            <label htmlFor="report_name" className={labelCls}>
                                Report Name <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="report_name"
                                type="text"
                                autoComplete="off"
                                maxLength={255}
                                value={formData.report_name}
                                onChange={e => handleChange('report_name', e.target.value)}
                                placeholder="e.g. Monthly Service Order Summary"
                                className={inputCls('report_name')}
                                aria-invalid={Boolean(errors.report_name)}
                            />
                            <FieldError field="report_name" />
                        </div>

                        {/* Report Type */}
                        <div>
                            <label htmlFor="report_type" className={labelCls}>
                                Report Type <span className="text-red-500">*</span>
                            </label>
                            <select
                                id="report_type"
                                value={formData.report_type}
                                onChange={e => handleChange('report_type', e.target.value)}
                                className={inputCls('report_type')}
                                aria-invalid={Boolean(errors.report_type)}
                            >
                                <option value="">Select report type…</option>
                                {REPORT_TYPES.map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                            <p className={hintCls}>
                                {REPORT_TYPE_HINTS[formData.report_type]
                                    ?? (formData.report_type
                                        ? `A record listing of ${formData.report_type.toLowerCase()} data with subtotals and grand totals.`
                                        : 'Choose what the report should cover.')}
                            </p>
                            <FieldError field="report_type" />
                        </div>

                        {/* ── Schedule ─────────────────────────────────────────── */}
                        <div className={cardCls}>
                            <p className={sectionLabelCls}>
                                <Clock size={12} /> Schedule
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="report_schedule" className={labelCls}>
                                        Runs <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        id="report_schedule"
                                        value={formData.report_schedule}
                                        onChange={e => handleScheduleChange(e.target.value)}
                                        className={inputCls('report_schedule')}
                                        aria-invalid={Boolean(errors.report_schedule)}
                                    >
                                        <option value="">Select schedule…</option>
                                        {REPORT_SCHEDULES.map(s => (
                                            <option key={s.value} value={s.value}>{s.label}</option>
                                        ))}
                                    </select>
                                    {schedule && <p className={hintCls}>{schedule.hint}</p>}
                                    <FieldError field="report_schedule" />
                                </div>

                                {/*
                                  Only the inputs the selected schedule needs are
                                  rendered at all — hidden fields cannot be
                                  required, and cannot hold a stale value.
                                */}
                                {needs('weekday') && (
                                    <div>
                                        <label htmlFor="report_weekday" className={labelCls}>
                                            Weekday <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            id="report_weekday"
                                            value={formData.report_weekday}
                                            onChange={e => handleChange('report_weekday', e.target.value)}
                                            className={inputCls('report_weekday')}
                                            aria-invalid={Boolean(errors.report_weekday)}
                                        >
                                            <option value="">Select weekday…</option>
                                            {WEEKDAYS.map(d => (
                                                <option key={d} value={d}>{d}</option>
                                            ))}
                                        </select>
                                        <FieldError field="report_weekday" />
                                    </div>
                                )}

                                {(needs('month') || needs('day')) && (
                                    <div className={`grid gap-4 ${needs('month') && needs('day') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                        {needs('month') && (
                                            <div>
                                                <label htmlFor="report_month" className={labelCls}>
                                                    {schedule?.value === 'Every 3 Months' ? 'Starting Month' : 'Month'}
                                                    {' '}<span className="text-red-500">*</span>
                                                </label>
                                                <select
                                                    id="report_month"
                                                    value={formData.report_month}
                                                    onChange={e => handleChange('report_month', e.target.value)}
                                                    className={inputCls('report_month')}
                                                    aria-invalid={Boolean(errors.report_month)}
                                                >
                                                    <option value="">Select month…</option>
                                                    {MONTHS.map((m, i) => (
                                                        <option key={m} value={String(i + 1)}>{m}</option>
                                                    ))}
                                                </select>
                                                <FieldError field="report_month" />
                                            </div>
                                        )}

                                        {needs('day') && (
                                            <div>
                                                <label htmlFor="day" className={labelCls}>
                                                    Day of Month <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    id="day"
                                                    type="number"
                                                    inputMode="numeric"
                                                    min={1}
                                                    max={maxDay}
                                                    step={1}
                                                    value={formData.day}
                                                    onChange={e => handleChange('day', e.target.value)}
                                                    placeholder={`1–${maxDay}`}
                                                    className={inputCls('day')}
                                                    aria-invalid={Boolean(errors.day)}
                                                />
                                                <FieldError field="day" />
                                                {!errors.day && dayClampNotice && (
                                                    <p className={hintCls}>{dayClampNotice}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div>
                                    <label htmlFor="report_time" className={labelCls}>
                                        Time (GMT+8) <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="report_time"
                                        type="time"
                                        value={formData.report_time}
                                        onChange={e => handleChange('report_time', e.target.value)}
                                        className={inputCls('report_time')}
                                        style={isDarkMode ? { colorScheme: 'dark' } : undefined}
                                        aria-invalid={Boolean(errors.report_time)}
                                    />
                                    <FieldError field="report_time" />
                                </div>

                                {scheduleSummary && (
                                    <div
                                        className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                                        style={{ backgroundColor: `${primary}14`, color: primary }}
                                    >
                                        <Info size={13} className="mt-0.5 flex-shrink-0" />
                                        <span>{scheduleSummary}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Reporting period ─────────────────────────────────── */}
                        <div className={cardCls}>
                            <p className={sectionLabelCls}>
                                <CalendarDays size={12} /> Reporting Period
                            </p>

                            <div className="flex flex-wrap gap-2 mb-4">
                                {QUICK_RANGES.map(range => {
                                    const active = activeQuickRange === range.label;
                                    return (
                                        <button
                                            key={range.label}
                                            type="button"
                                            onClick={() => handleRangeSelect(range)}
                                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${active
                                                ? 'text-white'
                                                : isDarkMode
                                                    ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                                                    : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                                            style={active ? { backgroundColor: primary, borderColor: primary } : undefined}
                                        >
                                            {range.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="date_from" className={labelCls}>
                                        From <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="date_from"
                                        type="date"
                                        value={formData.date_from}
                                        max={formData.date_to || undefined}
                                        onChange={e => handleChange('date_from', e.target.value)}
                                        className={inputCls('date_from')}
                                        style={isDarkMode ? { colorScheme: 'dark' } : undefined}
                                        aria-invalid={Boolean(errors.date_from)}
                                    />
                                    <FieldError field="date_from" />
                                </div>
                                <div>
                                    <label htmlFor="date_to" className={labelCls}>
                                        To <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="date_to"
                                        type="date"
                                        value={formData.date_to}
                                        min={formData.date_from || undefined}
                                        onChange={e => handleChange('date_to', e.target.value)}
                                        className={inputCls('date_to')}
                                        style={isDarkMode ? { colorScheme: 'dark' } : undefined}
                                        aria-invalid={Boolean(errors.date_to)}
                                    />
                                    <FieldError field="date_to" />
                                </div>
                            </div>

                            <p className={hintCls}>
                                {periodDays
                                    ? `The first report covers these dates. Each scheduled send after it rolls forward to the next ${periodDays}-day window, so no data is sent twice.`
                                    : 'The first report covers these dates. Each scheduled send after it rolls forward to the next window of the same length, so no data is sent twice.'}
                            </p>
                        </div>

                        {/* ── Recipients ───────────────────────────────────────── */}
                        <div>
                            <label htmlFor="send_to" className={labelCls}>
                                Send To <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="send_to"
                                type="text"
                                inputMode="email"
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={formData.send_to}
                                onChange={e => handleChange('send_to', e.target.value)}
                                placeholder="admin@company.com, ops@company.com"
                                className={inputCls('send_to')}
                                aria-invalid={Boolean(errors.send_to)}
                            />
                            <p className={hintCls}>
                                Separate multiple addresses with commas. Each recipient receives their own
                                copy with the PDF attached.
                            </p>
                            <FieldError field="send_to" />

                            {recipients.valid.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {recipients.valid.map(email => (
                                        <span
                                            key={email.toLowerCase()}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                                            style={{ backgroundColor: `${primary}1a`, color: primary }}
                                        >
                                            <Mail size={10} />
                                            {email}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── Preview ──────────────────────────────────────────── */}
                        {previewRows.some(([, value]) => Boolean(value)) && (
                            <div className={`rounded-xl border p-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                <p className={sectionLabelCls}>Preview</p>
                                <div className="space-y-2">
                                    {previewRows.filter(([, value]) => Boolean(value)).map(([label, value]) => (
                                        <div key={label} className="flex items-start gap-2">
                                            <span className={`text-xs w-24 flex-shrink-0 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                {label}
                                            </span>
                                            <span className={`text-xs font-medium break-words ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                {value}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Result modal ────────────────────────────────────────────────── */}
            {modal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10000]">
                    <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                        {modal.type === 'loading' ? (
                            <div className="text-center">
                                <div className="flex justify-center mb-4">
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: primary }} />
                                </div>
                                <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    {modal.title}
                                </h3>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{modal.message}</p>
                            </div>
                        ) : (
                            <>
                                <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    {modal.title}
                                </h3>
                                <p className={`mb-6 text-sm whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    {modal.message}
                                </p>
                                <div className="flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (modal.onConfirm) {
                                                modal.onConfirm();
                                            } else {
                                                setModal(prev => ({ ...prev, isOpen: false }));
                                            }
                                        }}
                                        className="px-4 py-2 text-white rounded transition-colors"
                                        style={{ backgroundColor: primary }}
                                        onMouseEnter={e => {
                                            if (colorPalette?.accent) {
                                                e.currentTarget.style.backgroundColor = colorPalette.accent;
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.backgroundColor = primary;
                                        }}
                                    >
                                        OK
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default AddReportModal;

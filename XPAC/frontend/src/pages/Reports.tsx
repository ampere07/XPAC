import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    RefreshCw, Filter, ArrowUp, ArrowDown, ExternalLink,
    ChevronLeft, ChevronRight, X, Settings2, FileText, Plus, DownloadCloud,
    ToggleLeft, ToggleRight, Trash2, Loader2, AlertTriangle
} from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AddReportModal from '../modals/AddReportModal';
import TableFunnelFilter, { FunnelColumn } from '../filter/TableFunnelFilter';
import { useFunnelFilter } from '../filter/useFunnelFilter';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportData {
    id: number;
    report_name: string;
    report_type: string;
    report_schedule: string;
    report_time: string;
    day: string | null;
    /** Only set when the schedule is weekly. */
    report_weekday?: string | null;
    /** 1–12; only set for quarterly and yearly schedules. */
    report_month?: number | string | null;
    send_to: string;
    date_range: string;
    created_by: string;
    created_at: string;
    file_url?: string;
    is_active?: boolean | number | null;
    last_dispatched_at?: string | null;
}

interface ModalConfig {
    isOpen: boolean;
    type: 'success' | 'error' | 'confirm';
    title: string;
    message: string;
    /** Label for the primary button on a confirm dialog. */
    confirmLabel?: string;
    onConfirm?: () => void;
}

const ALL_COLUMNS = [
    { key: 'id', label: 'ID' },
    { key: 'report_name', label: 'Report Name' },
    { key: 'report_type', label: 'Report Type' },
    { key: 'report_schedule', label: 'Schedule' },
    { key: 'report_time', label: 'Time' },
    { key: 'day', label: 'Day' },
    { key: 'report_weekday', label: 'Weekday' },
    { key: 'report_month', label: 'Month' },
    { key: 'send_to', label: 'Send To' },
    { key: 'date_range', label: 'Date Range' },
    { key: 'last_dispatched_at', label: 'Last Sent' },
    { key: 'created_by', label: 'Created By' },
    { key: 'created_at', label: 'Created At' },
];

/**
 * One filter entry per column in ALL_COLUMNS, so every column the table can show is filterable.
 * Keys match exactly - the table renders each cell from row[key] and the filter reads the same
 * key. The schedule/type columns offer the values present in the loaded reports rather than
 * requiring a lookup endpoint.
 */
const FUNNEL_COLUMNS: FunnelColumn[] = [
    { key: 'id', label: 'ID', dataType: 'varchar' },
    { key: 'report_name', label: 'Report Name', dataType: 'varchar' },
    { key: 'report_type', label: 'Report Type', dataType: 'checklist' },
    { key: 'report_schedule', label: 'Schedule', dataType: 'checklist' },
    { key: 'report_time', label: 'Time', dataType: 'varchar' },
    { key: 'day', label: 'Day', dataType: 'varchar' },
    { key: 'report_weekday', label: 'Weekday', dataType: 'checklist' },
    { key: 'report_month', label: 'Month', dataType: 'checklist' },
    { key: 'send_to', label: 'Send To', dataType: 'varchar' },
    { key: 'date_range', label: 'Date Range', dataType: 'varchar' },
    { key: 'last_dispatched_at', label: 'Last Sent', dataType: 'datetime' },
    { key: 'created_by', label: 'Created By', dataType: 'varchar' },
    { key: 'created_at', label: 'Created At', dataType: 'datetime' },
];

// Weekday and Month are hidden by default: they only apply to some schedules,
// and the Schedule column already spells the whole cadence out in words.
const DEFAULT_VISIBLE = [
    'id', 'report_name', 'report_type', 'report_schedule', 'report_time',
    'send_to', 'date_range', 'last_dispatched_at', 'created_by', 'created_at',
];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// itemsPerPage is now managed as state inside the component

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (d?: string | null) => {
    if (!d) return '—';
    try {
        const date = new Date(d);
        if (isNaN(date.getTime())) return d;
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        let hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const hh = String(hours).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hh}:${minutes} ${ampm}`;
    } catch {
        return d;
    }
};

const formatTime12h = (raw: string): string => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(raw).trim());
    if (!match) return String(raw);

    const hours24 = Number(match[1]);
    if (Number.isNaN(hours24) || hours24 > 23) return String(raw);

    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${match[2]} ${ampm} GMT+8`;
};

/**
 * Spell the cadence out in full, e.g. "Every Year on December 25".
 *
 * Reading a schedule used to require cross-referencing the Schedule and Day
 * columns, and Day was meaningless for daily and weekly reports.
 */
const describeSchedule = (row: ReportData): string => {
    const schedule = (row.report_schedule || '').trim();
    if (!schedule) return '—';

    const day = row.day ? Number(row.day) : null;
    const monthIndex = row.report_month ? Number(row.report_month) - 1 : null;
    const month = monthIndex !== null && monthIndex >= 0 && monthIndex < 12
        ? MONTH_NAMES[monthIndex]
        : null;

    switch (schedule) {
        case 'Every Week':
            return row.report_weekday ? `Every ${row.report_weekday}` : schedule;
        case 'Every Month':
            return day ? `Every Month on day ${day}` : schedule;
        case 'Every 3 Months':
            if (month && day) return `Every 3 Months from ${month}, day ${day}`;
            return day ? `Every 3 Months on day ${day}` : schedule;
        case 'Every Year':
            return month && day ? `Every Year on ${month} ${day}` : schedule;
        default:
            return schedule;
    }
};

const getCellValue = (row: ReportData, key: string): string => {
    if (key === 'report_schedule') return describeSchedule(row);

    const raw = (row as any)[key];

    // A blank day / weekday / month is correct for schedules that don't use it,
    // rather than missing data.
    if (raw == null || raw === '') {
        return key === 'day' || key === 'report_weekday' || key === 'report_month'
            ? 'n/a'
            : '—';
    }

    if (key === 'created_at' || key === 'last_dispatched_at') return formatDate(raw);
    if (key === 'report_time') return formatTime12h(String(raw));

    if (key === 'report_month') {
        const index = Number(raw) - 1;
        return index >= 0 && index < 12 ? MONTH_NAMES[index] : String(raw);
    }

    return String(raw);
};

// ─── Role Guard Helper ────────────────────────────────────────────────────────

const hasReportsAccess = (): boolean => {
    try {
        const authData = localStorage.getItem('authData');
        if (!authData) return false;
        const user = JSON.parse(authData);
        const roleId = String(user.role_id ?? '');
        const role = (user.role ?? '').toLowerCase().trim();
        return roleId === '1' || roleId === '7' || role === 'administrator' || role === 'superadmin';
    } catch {
        return false;
    }
};

/**
 * Deleting a report is Super Admin only.
 *
 * The role name is compared lower-cased because the login endpoint sends it
 * that way ("superadmin"); comparing against 'SuperAdmin' elsewhere in the app
 * silently never matches and leaves only the role_id branch working.
 *
 * This hides the control. The route is separately gated server-side, so a user
 * who forges authData still gets a 403.
 */
const isSuperAdmin = (): boolean => {
    try {
        const authData = localStorage.getItem('authData');
        if (!authData) return false;
        const user = JSON.parse(authData);
        return String(user.role_id ?? '') === '7'
            || (user.role ?? '').toLowerCase().trim() === 'superadmin';
    } catch {
        return false;
    }
};

const errorMessage = (err: any): string => {
    const status = err?.response?.status;
    if (status === 401) return 'Your session has expired. Please sign in again.';
    return err?.response?.data?.message
        || err?.message
        || 'An unexpected error occurred. Please try again.';
};

// ─── Main Component ───────────────────────────────────────────────────────────

const Reports: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [accessDenied] = useState<boolean>(!hasReportsAccess());
    const [canDelete] = useState<boolean>(isSuperAdmin());
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    // Data
    const [rows, setRows] = useState<ReportData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Auto Send Report master switch. null until the setting has loaded, so the
    // control is never rendered showing a state that may not be the real one.
    const [autoSend, setAutoSend] = useState<boolean | null>(null);
    const [isSavingAutoSend, setIsSavingAutoSend] = useState(false);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const [modal, setModal] = useState<ModalConfig>({
        isOpen: false,
        type: 'success',
        title: '',
        message: '',
    });

    // UI state
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [sortColumn, setSortColumn] = useState<string | null>('created_at');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE);
    const [showColumnPicker, setShowColumnPicker] = useState(false);

    const columnPickerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // ── Color palette & dark mode ──────────────────────────────────────────────

    useEffect(() => {
        settingsColorPaletteService.getActive().then(p => setColorPalette(p)).catch(() => { });
    }, []);

    useEffect(() => {
        const check = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
        check();
        const obs = new MutationObserver(check);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // ── Click outside ─────────────────────────────────────────────────────────

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
                setShowColumnPicker(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Fetch data ─────────────────────────────────────────────────────────────

    const fetchReports = async (silent = false) => {
        if (!silent) setIsLoading(true);
        else setIsRefreshing(true);
        try {
            const res = await apiClient.get<{ success: boolean; data: ReportData[] }>('/reports');
            if (res.data.success && Array.isArray(res.data.data)) {
                setRows(res.data.data);
            }
            // Always update current page based on new length
            setCurrentPage(1);
        } catch (err) {
            console.error('Failed to fetch reports:', err);
            // Optionally set error state here
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    const fetchSettings = useCallback(async () => {
        try {
            const res = await apiClient.get<{
                success: boolean;
                data: { auto_send_enabled: boolean };
            }>('/reports/settings');

            if (res.data?.success) {
                setAutoSend(Boolean(res.data.data?.auto_send_enabled));
            }
        } catch (err) {
            // Leaving this null hides the toggle rather than showing a state we
            // cannot vouch for.
            console.error('Failed to load report settings:', err);
            setAutoSend(null);
        }
    }, []);

    useEffect(() => {
        if (!accessDenied) {
            fetchReports();
            fetchSettings();
        }
    }, [accessDenied, fetchSettings]);

    // ── Auto Send Report ───────────────────────────────────────────────────────

    const handleToggleAutoSend = async () => {
        if (autoSend === null || isSavingAutoSend) return;

        const next = !autoSend;
        setIsSavingAutoSend(true);

        try {
            const res = await apiClient.put<{
                success: boolean;
                message?: string;
                data: { auto_send_enabled: boolean };
            }>('/reports/settings', { auto_send_enabled: next });

            if (!res.data?.success) {
                throw new Error(res.data?.message || 'Failed to update the setting.');
            }

            setAutoSend(Boolean(res.data.data?.auto_send_enabled));
            await fetchReports(true);

            setModal({
                isOpen: true,
                type: 'success',
                title: next ? 'Auto Send Enabled' : 'Auto Send Disabled',
                message: res.data.message
                    || (next
                        ? 'Scheduled reports will be sent automatically.'
                        : 'Scheduled reports will no longer be sent automatically.'),
            });
        } catch (err: any) {
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Could Not Update Auto Send',
                message: errorMessage(err),
            });
        } finally {
            setIsSavingAutoSend(false);
        }
    };

    // ── Delete (Super Admin only) ──────────────────────────────────────────────

    const performDelete = async (row: ReportData) => {
        setDeletingId(row.id);

        try {
            const res = await apiClient.delete<{ success: boolean; message?: string }>(
                `/reports/${row.id}`
            );

            if (!res.data?.success) {
                throw new Error(res.data?.message || 'Failed to delete the report.');
            }

            await fetchReports(true);

            setModal({
                isOpen: true,
                type: 'success',
                title: 'Report Deleted',
                message: res.data.message || `"${row.report_name}" has been deleted.`,
            });
        } catch (err: any) {
            setModal({
                isOpen: true,
                type: 'error',
                title: 'Delete Failed',
                message: errorMessage(err),
            });
        } finally {
            setDeletingId(null);
        }
    };

    const requestDelete = (row: ReportData) => {
        setModal({
            isOpen: true,
            type: 'confirm',
            title: 'Delete this report?',
            message: `"${row.report_name}" will be removed, along with its delivery history and any emails still waiting to go out.\n\nThis cannot be undone.`,
            confirmLabel: 'Delete Report',
            onConfirm: () => {
                setModal(prev => ({ ...prev, isOpen: false }));
                void performDelete(row);
            },
        });
    };

    // ── Toggle columns ─────────────────────────────────────────────────────────

    const toggleColumn = (key: string) => {
        setVisibleColumns(prev => {
            if (prev.includes(key)) {
                if (prev.length <= 1) return prev; // keep at least one
                return prev.filter(c => c !== key);
            }
            return [...prev, key];
        });
    };

    const handleSort = (key: string) => {
        if (sortColumn === key) {
            setSortDir(p => p === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(key);
            setSortDir('asc');
        }
    };

    // ── Derived Data ──────────────────────────────────────────────────────────

    const searched = useMemo(() => {
        let f = rows;

        // Search
        if (searchQuery.trim()) {
            const lower = searchQuery.toLowerCase();
            f = f.filter(r =>
                r.report_name?.toLowerCase().includes(lower) ||
                r.report_type?.toLowerCase().includes(lower) ||
                r.send_to?.toLowerCase().includes(lower)
            );
        }

        // Sort on a copy: sorting `f` in place mutated the `rows` state array
        // whenever no search filter had produced a new array.
        if (sortColumn) {
            f = [...f].sort((a, b) => {
                const va = (a as any)[sortColumn];
                const vb = (b as any)[sortColumn];
                if (va == null && vb == null) return 0;
                if (va == null) return sortDir === 'asc' ? -1 : 1;
                if (vb == null) return sortDir === 'asc' ? 1 : -1;

                if (typeof va === 'number' && typeof vb === 'number') {
                    return sortDir === 'asc' ? va - vb : vb - va;
                }

                // string compare
                const sa = String(va).toLowerCase();
                const sb = String(vb).toLowerCase();
                if (sa < sb) return sortDir === 'asc' ? -1 : 1;
                if (sa > sb) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return f;
    }, [rows, searchQuery, sortColumn, sortDir]);

    // Applied on the searched set so the counts and the table describe the same rows - the point
    // Customer.tsx applies its own funnel.
    const funnel = useFunnelFilter({
        storageKey: 'reportsFunnelFilters',
        columns: FUNNEL_COLUMNS,
        rows: searched,
    });

    const filtered = funnel.filteredRows;

    const paginated = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filtered.slice(start, start + itemsPerPage);
    }, [filtered, currentPage, itemsPerPage]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

    useEffect(() => {
        setCurrentPage(1);
    }, [itemsPerPage]);

    // Scroll to top on page change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [currentPage]);

    // Ordered columns based on ALL_COLUMNS to preserve original index
    const orderedVisibleColumns = ALL_COLUMNS.filter(c => visibleColumns.includes(c.key));

    // ── Guards ────────────────────────────────────────────────────────────────

    if (accessDenied) {
        return (
            <div className={`h-screen flex items-center justify-center ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
                <div className={`flex flex-col items-center gap-4 p-10 rounded-2xl shadow-xl border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: '#ef444420' }}>
                        <X size={32} stroke="#ef4444" strokeWidth={2.5} />
                    </div>
                    <div className="text-center">
                        <h2 className={`text-xl font-bold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            Access Denied
                        </h2>
                        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            You do not have permission to view the reports page.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ── Render Helpers ────────────────────────────────────────────────────────

    const primary = colorPalette?.primary || '#7c3aed';
    const bg = isDarkMode ? 'bg-gray-950' : 'bg-white';
    const headerBg = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200';
    const text = isDarkMode ? 'text-white' : 'text-gray-900';
    const subText = isDarkMode ? 'text-gray-400' : 'text-gray-500';
    const thCls = isDarkMode ? 'bg-gray-900 text-gray-300 border-gray-800' : 'bg-gray-50 text-gray-600 border-gray-200';
    const tdCls = isDarkMode ? 'text-gray-300 border-gray-800' : 'text-gray-700 border-gray-200';
    const rowHover = isDarkMode ? 'group-hover:bg-gray-800' : 'group-hover:bg-gray-100/70';
    const inputCls = isDarkMode
        ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500 hover:border-gray-600'
        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 hover:border-gray-400';
    const cardBg = isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';

    return (
        <>
            <div className={`flex flex-col h-full overflow-hidden ${bg}`}>

                {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
                <div className={`flex flex-col sm:flex-row sm:items-center justify-between px-5 py-3 border-b gap-3 flex-shrink-0 ${headerBg}`}>
                    <div className="flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto">
                        <div className="flex items-center gap-3">
                            <FileText size={20} style={{ color: primary }} />
                            <h1 className={`text-lg font-bold ${text}`}>Reports</h1>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                                {filtered.length.toLocaleString()} records
                            </span>
                        </div>
                        {isMobile && (
                            <button
                                onClick={() => setIsAddModalOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm text-white rounded-md transition-opacity hover:opacity-90 font-medium flex-shrink-0"
                                style={{ backgroundColor: primary }}
                            >
                                <Plus size={14} />
                                Add
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full sm:w-auto">
                        {!isMobile && (
                            <button
                                onClick={() => setIsAddModalOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm text-white rounded-md transition-opacity hover:opacity-90 font-medium flex-shrink-0"
                                style={{ backgroundColor: primary }}
                            >
                                <Plus size={14} />
                                Add
                            </button>
                        )}

                        {/* Search */}
                        <div className="flex-1 min-w-[150px] sm:min-w-[200px] flex-shrink-0">
                            <GlobalSearch 
                                searchQuery={searchQuery}
                                setSearchQuery={setSearchQuery}
                                isDarkMode={isDarkMode}
                                colorPalette={colorPalette}
                                placeholder="Search reports…"
                            />
                        </div>

                        <button
                            onClick={funnel.open}
                            title={funnel.activeCount > 0
                                ? `Active Filters:\n${Object.keys(funnel.activeFilters).map(funnel.labelFor).join('\n')}`
                                : 'Column Filters'}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md transition-colors flex-shrink-0 ${funnel.activeCount > 0
                                ? 'text-white'
                                : isDarkMode ? 'text-gray-300 border-gray-600 hover:bg-gray-700' : 'text-gray-600 border-gray-300 hover:bg-gray-100'
                                }`}
                            style={funnel.activeCount > 0 ? { backgroundColor: primary, borderColor: primary } : {}}
                        >
                            <Filter size={14} />
                            Filters{funnel.activeCount > 0 ? ` (${funnel.activeCount})` : ''}
                        </button>

                        {/* Column picker */}
                        <div className="relative flex-shrink-0" ref={columnPickerRef}>
                            <button
                                onClick={() => setShowColumnPicker(p => !p)}
                                className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md transition-colors ${showColumnPicker
                                    ? 'text-white'
                                    : isDarkMode ? 'text-gray-300 border-gray-600 hover:bg-gray-700' : 'text-gray-600 border-gray-300 hover:bg-gray-100'
                                    }`}
                                style={showColumnPicker ? { backgroundColor: primary, borderColor: primary } : {}}
                            >
                                <Settings2 size={14} />
                                Columns
                            </button>

                            {showColumnPicker && (
                                <div className={`absolute right-0 top-10 z-50 w-64 border rounded-xl shadow-2xl p-3 ${cardBg}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs font-semibold ${text}`}>Toggle Columns</span>
                                        <div className="flex gap-2">
                                            <button onClick={() => setVisibleColumns(ALL_COLUMNS.map(c => c.key))} className="text-xs" style={{ color: primary }}>All</button>
                                            <span className={`text-xs ${subText}`}>·</span>
                                            <button onClick={() => setVisibleColumns(DEFAULT_VISIBLE)} className="text-xs" style={{ color: primary }}>Reset</button>
                                        </div>
                                    </div>
                                    <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                                        {ALL_COLUMNS.map(col => (
                                            <label key={col.key} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${isDarkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={visibleColumns.includes(col.key)}
                                                    onChange={() => toggleColumn(col.key)}
                                                    className="rounded"
                                                    style={{ accentColor: primary }}
                                                />
                                                {col.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Auto Send Report master switch */}
                        {autoSend !== null && (
                            <button
                                onClick={handleToggleAutoSend}
                                disabled={isSavingAutoSend}
                                title={autoSend
                                    ? 'Scheduled reports are being emailed automatically. Click to turn this off.'
                                    : 'Scheduled reports are NOT being emailed. Click to turn automatic sending back on.'}
                                className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${autoSend
                                    ? 'text-white'
                                    : isDarkMode
                                        ? 'text-amber-300 border-amber-700/60 bg-amber-500/10 hover:bg-amber-500/20'
                                        : 'text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100'
                                    }`}
                                style={autoSend ? { backgroundColor: primary, borderColor: primary } : undefined}
                            >
                                {isSavingAutoSend
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : autoSend
                                        ? <ToggleRight size={14} />
                                        : <ToggleLeft size={14} />}
                                <span className="whitespace-nowrap">
                                    Auto Send: {autoSend ? 'On' : 'Off'}
                                </span>
                            </button>
                        )}

                        {/* Refresh */}
                        <button
                            onClick={() => fetchReports(true)}
                            disabled={isRefreshing || isLoading}
                            className={`p-2 border rounded-md transition-colors flex-shrink-0 ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                                }`}
                            title="Refresh"
                        >
                            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* A disabled master switch is easy to forget about, so it is
                    stated on the page rather than only in the toolbar pill. */}
                {autoSend === false && (
                    <div className={`flex items-start gap-2 px-5 py-2.5 border-b text-xs flex-shrink-0 ${isDarkMode
                        ? 'bg-amber-500/10 border-amber-800/50 text-amber-200'
                        : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                    >
                        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                        <span>
                            <strong className="font-semibold">Automatic sending is off.</strong>{' '}
                            The schedules below are saved but no reports are being emailed. Turn
                            "Auto Send" back on to resume.
                        </span>
                    </div>
                )}

                {/* ── Table area ──────────────────────────────────────────────────────── */}
                <div className="flex-1 min-h-0 overflow-auto" ref={scrollRef}>
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <div
                                className="animate-spin rounded-full h-12 w-12 border-b-4 border-t-4"
                                style={{ borderColor: primary, borderTopColor: 'transparent' }}
                            />
                            <p className={`text-sm ${subText}`}>Loading reports…</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <FileText size={40} className={subText} />
                            <p className={`text-base font-medium ${text}`}>No records found</p>
                            <p className={`text-sm ${subText}`}>
                                {searchQuery
                                    ? 'Try adjusting your search query.'
                                    : 'No report data available. Start by clicking the "+ Add" button.'}
                            </p>
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="text-sm mt-1 underline"
                                    style={{ color: primary }}
                                >
                                    Clear search
                                </button>
                            )}
                        </div>
                    ) : (
                        <table className="w-max min-w-full text-xs border-separate border-spacing-0">
                            <thead>
                                <tr className="sticky top-0 z-30">
                                    <th className={`sticky left-0 top-0 z-30 px-3 py-2.5 text-left font-semibold border-b border-r text-xs ${thCls} w-10`}>#</th>
                                    {orderedVisibleColumns.map(col => (
                                        <th
                                            key={col.key}
                                            className={`sticky top-0 z-20 px-3 py-2.5 text-left font-semibold border-b border-r whitespace-nowrap select-none cursor-pointer ${thCls}`}
                                            onClick={() => handleSort(col.key)}
                                        >
                                            <div className="flex items-center gap-1">
                                                {col.label}
                                                {sortColumn === col.key ? (
                                                    sortDir === 'asc'
                                                        ? <ArrowUp size={11} style={{ color: primary }} />
                                                        : <ArrowDown size={11} style={{ color: primary }} />
                                                ) : (
                                                    <ArrowUp size={11} className="opacity-20" />
                                                )}
                                            </div>
                                        </th>
                                    ))}
                                    {/* Action column: Download, plus Delete for Super Admin */}
                                    <th className={`sticky top-0 z-20 px-3 py-2.5 text-center font-semibold border-b text-xs ${thCls} whitespace-nowrap`}>
                                        {canDelete ? 'Actions' : 'Download'}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((row, idx) => {
                                    const rowNum = (currentPage - 1) * itemsPerPage + idx + 1;
                                    const isEven = idx % 2 === 0;
                                    const evenBg = isDarkMode
                                        ? (isEven ? 'bg-gray-900' : 'bg-gray-850')
                                        : (isEven ? 'bg-white' : 'bg-gray-50');

                                    return (
                                        <tr
                                            key={row.id}
                                            className={`${evenBg} ${rowHover} transition-colors duration-100 group`}
                                        >
                                            <td className={`sticky left-0 z-10 px-3 py-2 border-b border-r ${tdCls} ${subText} ${evenBg}`}>
                                                {rowNum}
                                            </td>
                                            {orderedVisibleColumns.map(col => (
                                                <td
                                                    key={col.key}
                                                    className={`px-3 py-2 border-b border-r whitespace-nowrap max-w-xs overflow-hidden text-ellipsis ${tdCls}`}
                                                    title={getCellValue(row, col.key)}
                                                >
                                                    {getCellValue(row, col.key)}
                                                </td>
                                            ))}
                                            <td className={`px-3 py-2 border-b text-center ${tdCls}`}>
                                                <div className="flex justify-center items-center gap-2">
                                                    {row.file_url ? (
                                                        <a
                                                            href={row.file_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors font-medium border ${isDarkMode
                                                                ? 'hover:bg-gray-800 border-gray-700 text-gray-300'
                                                                : 'hover:bg-gray-100 border-gray-300 text-gray-700'
                                                                }`}
                                                            title="Download PDF from Google Drive"
                                                        >
                                                            <DownloadCloud size={14} style={{ color: primary }} />
                                                            <span className="text-xs">Download</span>
                                                        </a>
                                                    ) : (
                                                        <span className="text-gray-400 italic text-[11px]">No file</span>
                                                    )}

                                                    {canDelete && (
                                                        <button
                                                            type="button"
                                                            onClick={() => requestDelete(row)}
                                                            disabled={deletingId !== null}
                                                            title="Delete this report"
                                                            aria-label={`Delete ${row.report_name}`}
                                                            className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isDarkMode
                                                                ? 'border-gray-700 text-red-400 hover:bg-red-500/10 hover:border-red-800'
                                                                : 'border-gray-300 text-red-500 hover:bg-red-50 hover:border-red-300'
                                                                }`}
                                                        >
                                                            {deletingId === row.id
                                                                ? <Loader2 size={14} className="animate-spin" />
                                                                : <Trash2 size={14} />}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* ── Pagination ───────────────────────────────────────────────────────── */}
                {!isLoading && filtered.length > 0 && (
                    <div className={`flex flex-col md:flex-row items-center justify-between gap-3 px-5 py-3 border-t flex-shrink-0 ${headerBg}`}>
                        <div className={`flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs ${subText}`}>
                            <div className="flex items-center gap-1.5">
                                <span>Show</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                    className={`px-1.5 py-1 rounded border text-xs focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                >
                                    <option value={10}>10</option>
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                                <span>entries</span>
                            </div>
                            <span>
                                Showing {((currentPage - 1) * itemsPerPage + 1).toLocaleString()}–{Math.min(currentPage * itemsPerPage, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} records
                            </span>
                        </div>

                        <div className="flex items-center flex-wrap justify-center gap-1 w-full md:w-auto">
                            <button
                                onClick={() => setCurrentPage(1)}
                                disabled={currentPage === 1}
                                className={`px-2 py-1.5 text-xs border rounded disabled:opacity-30 transition-colors ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                ««
                            </button>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className={`flex items-center gap-0.5 px-2 py-1.5 text-xs border rounded disabled:opacity-30 transition-colors ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                <ChevronLeft size={12} /> Prev
                            </button>

                            {/* Page numbers */}
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let page: number;
                                if (totalPages <= 5) page = i + 1;
                                else if (currentPage <= 3) page = i + 1;
                                else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                                else page = currentPage - 2 + i;
                                return (
                                    <button
                                        key={page}
                                        onClick={() => setCurrentPage(page)}
                                        className={`w-8 h-7 text-xs border rounded transition-colors ${page === currentPage
                                            ? 'text-white border-transparent'
                                            : isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                                            }`}
                                        style={page === currentPage ? { backgroundColor: primary, borderColor: primary } : {}}
                                    >
                                        {page}
                                    </button>
                                );
                            })}

                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages <= 1}
                                className={`flex items-center gap-0.5 px-2 py-1.5 text-xs border rounded disabled:opacity-30 transition-colors ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                Next <ChevronRight size={12} />
                            </button>
                            <button
                                onClick={() => setCurrentPage(totalPages)}
                                disabled={currentPage === totalPages || totalPages <= 1}
                                className={`px-2 py-1.5 text-xs border rounded disabled:opacity-30 transition-colors ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                »»
                            </button>
                        </div>

                        <span className={`text-xs whitespace-nowrap ${subText}`}>
                            Page {currentPage} of {totalPages}
                        </span>
                    </div>
                )}
            </div>

            {/* ── Add Report Modal ─────────────────────────────── */}
            <AddReportModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSaved={() => fetchReports(true)}
            />

            <TableFunnelFilter
                {...funnel.panelProps}
                title="Report Filters"
                subtitle="Refine your scheduled report results"
            />

            {/* ── Confirmation / result dialog ─────────────────────────── */}
            {modal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10000] p-4">
                    <div className={`border rounded-lg p-6 max-w-md w-full ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-start gap-3 mb-4">
                            {modal.type !== 'success' && (
                                <div
                                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                                    style={{ backgroundColor: '#ef444420' }}
                                >
                                    <AlertTriangle size={18} stroke="#ef4444" />
                                </div>
                            )}
                            <h3 className={`text-lg font-semibold ${text} ${modal.type !== 'success' ? 'mt-1' : ''}`}>
                                {modal.title}
                            </h3>
                        </div>

                        <p className={`mb-6 text-sm whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {modal.message}
                        </p>

                        <div className="flex items-center justify-end gap-3">
                            {modal.type === 'confirm' && (
                                <button
                                    type="button"
                                    onClick={() => setModal(prev => ({ ...prev, isOpen: false }))}
                                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${isDarkMode
                                        ? 'bg-gray-700 hover:bg-gray-600 text-white'
                                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    if (modal.onConfirm) modal.onConfirm();
                                    else setModal(prev => ({ ...prev, isOpen: false }));
                                }}
                                className="px-4 py-2 text-white rounded text-sm font-medium transition-opacity hover:opacity-90"
                                style={{ backgroundColor: modal.type === 'confirm' ? '#dc2626' : primary }}
                            >
                                {modal.type === 'confirm' ? (modal.confirmLabel ?? 'Confirm') : 'OK'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Reports;

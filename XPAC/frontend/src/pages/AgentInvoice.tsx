import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    RefreshCw, Download, FileText, Users, User as UserIcon, Loader2,
    ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, ChevronDown, X
} from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { ROLE, roleIdOf } from '../config/permissions';
import { agentInvoiceService, AgentInvoiceRecord } from '../services/agentInvoiceService';
import AgentInvoiceDetails from '../components/AgentInvoiceDetails';
import GlobalSearch from './globalfunctions/GlobalSearch';
import AgentInvoiceDownloadModal from '../modals/AgentInvoiceDownloadModal';
import AgentPayoutModal from '../modals/AgentPayoutModal';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})`
        : hex;
};

interface ColumnDefinition {
    key: string;
    label: string;
    minWidth: number;
    align?: 'right' | 'left' | 'center';
}

const columns: ColumnDefinition[] = [
    { key: 'invoice_number', label: 'Invoice No.', minWidth: 150 },
    { key: 'invoice_type', label: 'Type', minWidth: 100 },
    { key: 'billed_to', label: 'Team / Agent', minWidth: 200 },
    { key: 'invoice_date', label: 'Invoice Date', minWidth: 130 },
    { key: 'period', label: 'Billing Period', minWidth: 190 },
    { key: 'total_customers', label: 'Customers', minWidth: 110, align: 'right' },
    { key: 'total_amount', label: 'Total Amount', minWidth: 140, align: 'right' },
    { key: 'subtotal', label: 'Subtotal', minWidth: 140, align: 'right' },
    { key: 'status', label: 'Status', minWidth: 120 },
    // No Actions column: a row opens its detail pane on click, and View PDF,
    // Download and Pay Out all live there.
];


const formatCurrency = (amount: number): string =>
    `₱${Number(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;

const formatDate = (value?: string | null): string => {
    if (!value) return '-';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

/**
 * The statuses the list offers when changing one by hand.
 *
 * Mirrors AgentInvoice::SELECTABLE_STATUSES on the server. Sent and Cancelled
 * are still accepted by the API so invoices already carrying them keep working,
 * they are simply no longer offered as new choices.
 */
const STATUS_OPTIONS = ['Generated', 'Paid', 'Unpaid'];

// The "Show N entries" choices. A page is counted in BILLING WEEKS, not
// invoices: the table renders one collapsible group per week, and paging by
// invoice split a week across two pages so its header showed up on both.
const PAGE_SIZES = [5];

/** Status colours, matching the way the billing invoice list colours its own. */
const statusTone = (status: string, isDarkMode: boolean): string => {
    const tone: Record<string, string> = {
        Generated: isDarkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-50 text-blue-700',
        Sent: isDarkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700',
        Paid: isDarkMode ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-50 text-emerald-700',
        Unpaid: isDarkMode ? 'bg-rose-900/40 text-rose-300' : 'bg-rose-50 text-rose-700',
        Cancelled: isDarkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-200 text-gray-700',
    };

    return tone[status] || (isDarkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700');
};

/** The read-only status pill, shown to anyone who may not change a status. */
const StatusBadge: React.FC<{ status: string; isDarkMode: boolean }> = ({ status, isDarkMode }) => (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusTone(status, isDarkMode)}`}>
        {status}
    </span>
);

/**
 * The status pill, editable in place — picking a value saves it immediately.
 *
 * Every click is stopped from reaching the row, which opens the details panel:
 * without that, choosing a status would also slide the panel open every time.
 *
 * Only rendered for an administrator or a superadmin; everyone else gets the
 * read-only StatusBadge above. The server enforces the same restriction and
 * answers 403 regardless of what the page renders, so hiding the control is a
 * convenience, never the protection.
 */
const StatusSelect: React.FC<{
    status: string;
    isDarkMode: boolean;
    saving: boolean;
    onChange: (next: string) => void;
}> = ({ status, isDarkMode, saving, onChange }) => {
    // A status the invoice already holds that is no longer offered (a legacy
    // Sent or Cancelled) is added to the list, so the control shows what the
    // invoice actually says instead of silently displaying the first option.
    const options = STATUS_OPTIONS.includes(status) ? STATUS_OPTIONS : [...STATUS_OPTIONS, status];

    return (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <select
                value={status}
                disabled={saving}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChange(e.target.value)}
                title="Change this invoice's status"
                className={`appearance-none cursor-pointer rounded-full px-2.5 py-1 pr-6 text-xs font-semibold border-0 outline-none focus:ring-2 focus:ring-offset-0 ${
                    isDarkMode ? 'focus:ring-gray-600' : 'focus:ring-gray-300'
                } disabled:opacity-60 disabled:cursor-wait ${statusTone(status, isDarkMode)}`}
                style={{
                    // The arrow is drawn here rather than with a plugin, since
                    // appearance-none removes the native one.
                    backgroundImage:
                        `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='3'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.4rem center',
                    backgroundSize: '0.7rem',
                }}
            >
                {options.map(option => (
                    // Options are drawn by the OS, which ignores the pill's
                    // colours, so they are given readable ones of their own.
                    <option
                        key={option}
                        value={option}
                        style={{
                            backgroundColor: isDarkMode ? '#111827' : '#ffffff',
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                        }}
                    >
                        {option}
                    </option>
                ))}
            </select>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-70" />}
        </div>
    );
};

const AgentInvoice: React.FC = () => {
    const { can } = usePermissions();
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    const [records, setRecords] = useState<AgentInvoiceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState('');

    const [currentPage, setCurrentPage] = useState(1);
    // Billing weeks per page, not invoices — see PAGE_SIZES.
    const [itemsPerPage, setItemsPerPage] = useState(5);
    const [totalCount, setTotalCount] = useState(0);
    const [lastPage, setLastPage] = useState(1);

    const [expandedPeriods, setExpandedPeriods] = useState<string[]>([]);
    const [isDownloadOpen, setIsDownloadOpen] = useState(false);
    const [selected, setSelected] = useState<AgentInvoiceRecord | null>(null);
    // The invoice a payout is being raised for, or null when none is.
    const [payoutFor, setPayoutFor] = useState<AgentInvoiceRecord | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [pdfPending, setPdfPending] = useState<number | null>(null);
    // The invoice whose status is being saved right now, so only that row's
    // control is disabled rather than the whole list.
    const [statusPending, setStatusPending] = useState<number | null>(null);

    /**
     * Whether this user may change an invoice's status.
     *
     * Administrators and superadmins only. Read once — authData does not change
     * without a reload — and resolved through roleIdOf, which tries role_id and
     * falls back to the role name, since either can be missing or stale in
     * storage. That is the same resolution the rest of the app uses, so this
     * page cannot disagree with the sidebar about who someone is.
     *
     * The server enforces the restriction independently; this only decides
     * whether the control is worth showing.
     */
    const canEditStatus = useMemo(() => {
        try {
            const authData = JSON.parse(localStorage.getItem('authData') || '{}');
            const roleId = roleIdOf(authData);
            return roleId === ROLE.ADMINISTRATOR || roleId === ROLE.SUPER_ADMIN;
        } catch {
            // Unreadable authData means we cannot show it is allowed, so we do
            // not offer it. The read-only pill still renders.
            return false;
        }
    }, []);

    // Whether this user may generate invoices or change a status. The server is
    // the authority — this only decides whether the control is worth showing.
    /**
     * The rows grouped by the week they bill, in the order the server sent them.
     *
     * The server already orders by invoice date descending, so taking the groups
     * in first-seen order keeps the newest week at the top without sorting
     * again — and without disagreeing with the order inside each group.
     *
     * Grouping is per page: pagination is server side, so a week spanning a page
     * boundary appears in both, each showing what that page holds. The count and
     * total on the header say "on this page" for the same reason.
     */
    const periodGroups = useMemo(() => {
        const groups: Array<{ key: string; label: string; records: AgentInvoiceRecord[]; subtotal: number }> = [];
        const index = new Map<string, number>();

        records.forEach(record => {
            const key = `${record.period_start ?? ''}|${record.period_end ?? ''}`;

            if (!index.has(key)) {
                index.set(key, groups.length);
                groups.push({
                    key,
                    label: record.period_start || record.period_end
                        ? `${formatDate(record.period_start)} – ${formatDate(record.period_end)}`
                        : 'No billing period',
                    records: [],
                    subtotal: 0,
                });
            }

            const group = groups[index.get(key)!];
            group.records.push(record);
            group.subtotal += Number(record.subtotal || 0);
        });

        return groups;
    }, [records]);

    // Expanded rather than collapsed is tracked, so every week starts closed —
    // the page is a list of weeks first, and one opens only when asked for.
    const togglePeriod = (key: string) => {
        setExpandedPeriods(current =>
            current.includes(key) ? current.filter(k => k !== key) : [...current, key]
        );
    };

    const primaryColor = colorPalette?.primary || '#7c3aed';
    const searchDebounce = useRef<number | null>(null);

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        const stored = localStorage.getItem('theme');
        if (stored) setIsDarkMode(stored === 'dark');

        const fetchPalette = async () => {
            try {
                setColorPalette(await settingsColorPaletteService.getActive());
            } catch (err) {
                console.error('[AgentInvoice] Failed to fetch color palette:', err);
            }
        };
        fetchPalette();

        const onPalette = () => fetchPalette();
        window.addEventListener('palette-updated', onPalette);
        return () => window.removeEventListener('palette-updated', onPalette);
    }, []);

    const load = useCallback(async (page: number, quiet = false) => {
        if (quiet) setIsRefreshing(true); else setIsLoading(true);
        setError(null);

        try {
            const response = await agentInvoiceService.list({
                search: searchTerm,

                type: typeFilter,
                page,
                per_page: itemsPerPage,
                // A page is N weeks, and carries every invoice in them.
                group_by_period: true,
            });

            if (response?.success) {
                setRecords(response.data || []);
                setTotalCount(response.meta?.total ?? 0);
                setLastPage(response.meta?.last_page ?? 1);
            } else {
                setRecords([]);
                setError('Failed to load invoices.');
            }
        } catch (err: any) {
            console.error('[AgentInvoice] Failed to load invoices:', err);
            setRecords([]);
            setError(err?.response?.data?.message || 'Failed to load invoices.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [searchTerm, typeFilter, itemsPerPage]);

    // Filters reset to the first page: staying on page 4 of a narrower result
    // set would show an empty table.
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, typeFilter, itemsPerPage]);

    useEffect(() => {
        if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
        searchDebounce.current = window.setTimeout(() => load(currentPage), 250);
        return () => {
            if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
        };
    }, [load, currentPage]);

    const handleOpenDetails = async (record: AgentInvoiceRecord) => {
        setSelected(record);

        // The list already carries the customers, but re-reading gives the
        // freshest set and keeps the modal correct if the list is stale.
        setIsLoadingDetail(true);
        try {
            const response = await agentInvoiceService.get(record.id);
            if (response?.success) setSelected(response.data);
        } catch (err) {
            console.error('[AgentInvoice] Failed to load invoice details:', err);
        } finally {
            setIsLoadingDetail(false);
        }
    };

    // Where the open record sits in the list, so the pane's chevrons know
    // whether there is anywhere to step to. Matches Invoice.tsx's approach.
    const selectedIndex = selected ? records.findIndex(r => r.id === selected.id) : -1;

    const handlePreviousRecord = () => {
        if (selectedIndex > 0) handleOpenDetails(records[selectedIndex - 1]);
    };

    const handleNextRecord = () => {
        if (selectedIndex >= 0 && selectedIndex < records.length - 1) {
            handleOpenDetails(records[selectedIndex + 1]);
        }
    };


    /**
     * Read the server's message out of a failed blob request.
     *
     * The PDF endpoint is fetched with responseType 'blob', so when it answers
     * with a JSON error the body arrives as a Blob and `err.response.data.message`
     * is undefined — which is why a 500 here used to surface as nothing more
     * than a minified error name in the console. Reading the blob back as text
     * recovers what the server actually said.
     */
    const messageFromBlobError = async (err: any): Promise<string | null> => {
        const data = err?.response?.data;

        if (!(data instanceof Blob)) {
            return err?.response?.data?.message ?? null;
        }

        try {
            const text = await data.text();
            const parsed = JSON.parse(text);
            return parsed?.error || parsed?.message || null;
        } catch {
            return null;
        }
    };

    const handlePdf = async (record: AgentInvoiceRecord, download: boolean) => {
        setPdfPending(record.id);
        try {
            const source = await agentInvoiceService.pdfBlob(record.id, download);

            // Hosted on Drive: open the link. There is no blob to build and
            // nothing to revoke, and a download is left to Drive's own viewer —
            // the file is not on this origin, so `download` could not name it
            // anyway.
            if (source.kind === 'url') {
                window.open(source.url, '_blank', 'noopener');
                return;
            }

            const url = window.URL.createObjectURL(source.blob);

            if (download) {
                const link = document.createElement('a');
                link.href = url;
                link.download = `${record.invoice_number}.pdf`;
                document.body.appendChild(link);
                link.click();
                link.remove();
            } else {
                window.open(url, '_blank', 'noopener');
            }

            // Released on the next tick so the tab has taken the reference.
            window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
        } catch (err: any) {
            const message = await messageFromBlobError(err);
            console.error('[AgentInvoice] Failed to open the PDF:', message || err);
            window.alert(message || 'The invoice PDF could not be opened.');
        } finally {
            setPdfPending(null);
        }
    };



    /**
     * Save a new status for one invoice.
     *
     * Applied to the list straight away and put back if the server refuses, so
     * the pill responds at once without ever showing a value the database does
     * not hold. The server's own copy of the record replaces it on success, so
     * anything else it changed (updated_by) is picked up rather than guessed.
     */
    const handleStatusChange = async (record: AgentInvoiceRecord, next: string) => {
        if (!canEditStatus || next === record.status || statusPending !== null) return;

        const previous = record.status;
        const apply = (status: string) => {
            setRecords(rows => rows.map(r => (r.id === record.id ? { ...r, status } : r)));
            setSelected(sel => (sel && sel.id === record.id ? { ...sel, status } : sel));
        };

        apply(next);
        setStatusPending(record.id);
        setError(null);

        try {
            const response = await agentInvoiceService.updateStatus(record.id, next);

            if (!response?.success) {
                throw new Error(response?.message || 'The status could not be saved.');
            }

            if (response.data) {
                const saved = response.data;
                setRecords(rows => rows.map(r => (r.id === record.id ? { ...r, ...saved } : r)));
                setSelected(sel => (sel && sel.id === record.id ? { ...sel, ...saved } : sel));
            }
        } catch (err: any) {
            // Put the old value back: the list must never show a status the
            // database does not hold. 403 here means "not an administrator",
            // which is the server's rule to enforce, not this page's.
            apply(previous);
            setError(
                err?.response?.data?.message
                || err?.message
                || 'The status could not be saved.'
            );
        } finally {
            setStatusPending(null);
        }
    };

    const cell = (record: AgentInvoiceRecord, key: string): React.ReactNode => {
        switch (key) {
            case 'invoice_number':
                return <span className="font-semibold">{record.invoice_number}</span>;
            case 'invoice_type':
                return (
                    <span className="inline-flex items-center gap-1.5">
                        {record.invoice_type === 'team'
                            ? <Users className="h-3.5 w-3.5 opacity-70" />
                            : <UserIcon className="h-3.5 w-3.5 opacity-70" />}
                        {record.invoice_type === 'team' ? 'Team' : 'Solo'}
                    </span>
                );
            case 'billed_to':
                return record.billed_to;
            case 'invoice_date':
                return formatDate(record.invoice_date);
            case 'period':
                return `${formatDate(record.period_start)} – ${formatDate(record.period_end)}`;
            case 'total_customers':
                return record.total_customers;
            case 'total_amount':
                return formatCurrency(record.total_amount);
            case 'subtotal':
                return <span className="font-semibold">{formatCurrency(record.subtotal)}</span>;
            case 'status':
                return canEditStatus
                    ? (
                        <StatusSelect
                            status={record.status}
                            isDarkMode={isDarkMode}
                            saving={statusPending === record.id}
                            onChange={(next) => handleStatusChange(record, next)}
                        />
                    )
                    : <StatusBadge status={record.status} isDarkMode={isDarkMode} />;
            default:
                return '-';
        }
    };

    return (
        // Row layout, as the billing Invoice page uses: the list is one column
        // and the detail pane another, so opening a record narrows the list
        // rather than covering it.
        <div className={`h-full flex flex-col md:flex-row overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            <div className={`flex-1 flex flex-col overflow-hidden min-w-0 ${selected && isMobile ? 'hidden' : ''}`}>
            {/* Toolbar — search, the type filter, and the two actions on one
                row. The page has no title bar of its own: the sidebar already
                says which section this is. */}
            <div className={`px-4 py-3 border-b flex-shrink-0 flex flex-wrap items-center gap-2 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className="flex-1 min-w-[200px]">
                    <GlobalSearch
                        searchQuery={searchTerm}
                        setSearchQuery={setSearchTerm}
                        isDarkMode={isDarkMode}
                        colorPalette={colorPalette}
                        placeholder="Search invoice number, team or agent..."
                    />
                </div>

                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                >
                    <option value="">All types</option>
                    <option value="team">Team</option>
                    <option value="solo">Solo</option>
                </select>

                {(searchTerm || typeFilter) && (
                    <button
                        onClick={() => { setSearchTerm(''); setTypeFilter(''); }}
                        className={`px-3 py-2 rounded-lg text-sm border transition-colors ${isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                    >
                        Clear
                    </button>
                )}

                <button
                    onClick={() => setIsDownloadOpen(true)}
                    disabled={isLoading}
                    title="Download invoice PDFs"
                    className="p-2 rounded-lg transition-all flex items-center justify-center shadow-sm disabled:opacity-50 border"
                    style={{ backgroundColor: '#ffffff', borderColor: primaryColor, color: primaryColor }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = hexToRgba(primaryColor, 0.1); }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
                >
                    <Download className="h-5 w-5" />
                </button>
                <button
                    onClick={() => load(currentPage, true)}
                    disabled={isLoading || isRefreshing}
                    title="Refresh"
                    className="p-2 rounded-lg transition-all flex items-center justify-center shadow-sm disabled:opacity-50 border"
                    style={{ backgroundColor: '#ffffff', borderColor: primaryColor, color: primaryColor }}
                >
                    <RefreshCw className={`h-5 w-5 ${(isLoading || isRefreshing) ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin" style={{ color: primaryColor }} />
                    </div>
                ) : error ? (
                    <div className={`h-full flex flex-col items-center justify-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        <X className="h-8 w-8 text-rose-500" />
                        <p className="text-sm">{error}</p>
                    </div>
                ) : records.length === 0 ? (
                    <div className={`h-full flex flex-col items-center justify-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        <FileText className="h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">No invoices yet</p>
                        <p className="text-xs">Invoices are raised automatically every Monday for the week just ended.</p>
                    </div>
                ) : (
                    <>
                    {/* Nine columns of nowrap text run to roughly 1300px, so on a
                        phone the table is read by scrolling sideways past the
                        invoice number to reach the amount. Below md the same
                        records are cards under the same period headers, and a
                        card opens the same detail pane a row does. */}
                    <div className="md:hidden p-3 space-y-3">
                        {periodGroups.map(group => {
                            const isOpen = expandedPeriods.includes(group.key);

                            return (
                                <div key={group.key} className="space-y-2">
                                    <button
                                        onClick={() => togglePeriod(group.key)}
                                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                                            isDarkMode ? 'bg-gray-800/70 text-gray-100' : 'bg-gray-100 text-gray-800'
                                        }`}
                                    >
                                        <ChevronDown
                                            className={`h-4 w-4 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                                            style={{ color: primaryColor }}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wider">
                                            {group.label}
                                        </span>
                                        <span className="flex-shrink-0 text-xs font-semibold">
                                            {formatCurrency(group.subtotal)}
                                        </span>
                                    </button>

                                    {isOpen && group.records.map(record => (
                                        <button
                                            key={record.id}
                                            onClick={() => handleOpenDetails(record)}
                                            className={`w-full rounded-lg border p-4 text-left transition-colors ${
                                                isDarkMode
                                                    ? 'bg-gray-900 border-gray-800 text-gray-200 hover:bg-gray-800/60'
                                                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate">{cell(record, 'invoice_number')}</div>
                                                    <div className="mt-1 truncate text-xs opacity-80">{cell(record, 'billed_to')}</div>
                                                </div>
                                                <div className="flex-shrink-0 text-right">
                                                    <div className="text-base font-bold">{cell(record, 'total_amount')}</div>
                                                    <div className="mt-1 flex justify-end">{cell(record, 'status')}</div>
                                                </div>
                                            </div>

                                            <div className={`mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs ${
                                                isDarkMode ? 'border-gray-800' : 'border-gray-100'
                                            }`}>
                                                {(['invoice_type', 'invoice_date', 'total_customers', 'subtotal'] as const).map(key => {
                                                    const col = columns.find(c => c.key === key);
                                                    if (!col) return null;

                                                    return (
                                                        <div key={key} className="min-w-0">
                                                            <div className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>{col.label}</div>
                                                            <div className="mt-0.5 truncate">{cell(record, key)}</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            );
                        })}
                    </div>

                    <table className="hidden md:table w-full text-sm">
                        <thead>
                            <tr className={`border-b sticky top-0 z-10 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                {columns.map(col => (
                                    <th
                                        key={col.key}
                                        style={{ minWidth: col.minWidth }}
                                        className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
                                            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                                        } ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                                    >
                                        {col.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {periodGroups.map(group => {
                                const isOpen = expandedPeriods.includes(group.key);

                                return (
                                    <React.Fragment key={group.key}>
                                        {/* The period header. Clicking it opens or closes the
                                            week; the count and total describe what is in the
                                            group on this page, not across every page. */}
                                        <tr
                                            onClick={() => togglePeriod(group.key)}
                                            className={`border-b cursor-pointer select-none transition-colors ${
                                                isDarkMode
                                                    ? 'bg-gray-800/70 hover:bg-gray-800 border-gray-700 text-gray-100'
                                                    : 'bg-gray-100 hover:bg-gray-200/70 border-gray-200 text-gray-800'
                                            }`}
                                        >
                                            <td colSpan={columns.length} className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    <ChevronDown
                                                        className={`h-4 w-4 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                                                        style={{ color: primaryColor }}
                                                    />
                                                    <span className="text-[11px] font-bold uppercase tracking-wider">
                                                        {group.label}
                                                    </span>
                                                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-white text-gray-600'}`}>
                                                        {group.records.length} {group.records.length === 1 ? 'invoice' : 'invoices'}
                                                    </span>
                                                    <span className={`ml-auto text-xs font-semibold ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                        {formatCurrency(group.subtotal)}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>

                                        {isOpen && group.records.map(record => (
                                            <tr
                                                key={record.id}
                                                onClick={() => handleOpenDetails(record)}
                                                className={`border-b cursor-pointer transition-colors ${isDarkMode ? 'border-gray-800 hover:bg-gray-800/60 text-gray-200' : 'border-gray-100 hover:bg-gray-50 text-gray-700'} ${
                                                    selected?.id === record.id ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-100') : ''
                                                }`}
                                            >
                                                {columns.map(col => (
                                                    <td
                                                        key={col.key}
                                                        style={{ minWidth: col.minWidth }}
                                                        className={`px-4 py-3 whitespace-nowrap ${
                                                            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                                                        }`}
                                                    >
                                                        {cell(record, col.key)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                    </>
                )}
            </div>

            {/* Pagination */}
            {totalCount > 0 && (
                <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                    <div className={`flex flex-wrap items-center gap-3 sm:gap-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        <div className="flex items-center gap-2">
                            <span>Show</span>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                className={`px-2 py-1 rounded border text-sm focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                            >
                                {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <span>weeks</span>
                        </div>
                        <span>
                            Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                            <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalCount)}</span> of{' '}
                            <span className="font-medium">{totalCount}</span>{' '}
                            {totalCount === 1 ? 'week' : 'weeks'}
                            {records.length > 0 && (
                                <> · <span className="font-medium">{records.length}</span>{' '}
                                {records.length === 1 ? 'invoice' : 'invoices'}</>
                            )}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} title="First page"
                            className={`p-1 rounded transition-colors disabled:opacity-40 ${isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                            <ChevronsLeft className="h-5 w-5" />
                        </button>
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} title="Previous"
                            className={`p-1 rounded transition-colors disabled:opacity-40 ${isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className={`px-3 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            Page {currentPage} of {lastPage}
                        </span>
                        <button onClick={() => setCurrentPage(p => Math.min(lastPage, p + 1))} disabled={currentPage >= lastPage} title="Next"
                            className={`p-1 rounded transition-colors disabled:opacity-40 ${isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                            <ChevronRight className="h-5 w-5" />
                        </button>
                        <button onClick={() => setCurrentPage(lastPage)} disabled={currentPage >= lastPage} title="Last page"
                            className={`p-1 rounded transition-colors disabled:opacity-40 ${isDarkMode ? 'text-white hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                            <ChevronsRight className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            )}

            </div>

            {/* Detail pane — a sibling of the list, not an overlay, so the list
                stays readable behind it and the record can be stepped through. */}
            {selected && (
                <div className="flex-shrink-0 overflow-hidden h-full">
                    <AgentInvoiceDetails
                        key={selected.id}
                        invoiceRecord={selected}
                        isLoading={isLoadingDetail}
                        isPdfPending={pdfPending === selected.id}
                        onClose={() => setSelected(null)}
                        onPrevious={selectedIndex > 0 ? handlePreviousRecord : undefined}
                        onNext={selectedIndex >= 0 && selectedIndex < records.length - 1 ? handleNextRecord : undefined}
                        onViewPdf={() => handlePdf(selected, false)}
                        onDownloadPdf={() => handlePdf(selected, true)}
                        onPayOut={can('agent-invoices.payout') ? () => setPayoutFor(selected) : undefined}
                    />
                </div>
            )}

            <AgentInvoiceDownloadModal
                isOpen={isDownloadOpen}
                onClose={() => setIsDownloadOpen(false)}
            />

            {/* Raised from an invoice, so the form asks only for the agent and
                shows the invoice number as its reference. */}
            <AgentPayoutModal
                isOpen={payoutFor !== null}
                onClose={() => setPayoutFor(null)}
                onSuccess={() => {
                    setPayoutFor(null);
                    load(currentPage, true);
                }}
                fromInvoice
                invoiceNumber={payoutFor?.invoice_number}
                agentId={payoutFor?.agent_id ?? undefined}
                agentName={payoutFor?.billed_to}
            />
        </div>
    );
};

export default AgentInvoice;

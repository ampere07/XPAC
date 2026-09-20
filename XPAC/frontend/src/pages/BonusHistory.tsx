import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Gift, Plus, RefreshCw, Search, Loader2, CalendarRange, X } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { commissionService } from '../services/commissionService';
import { usePermissions } from '../hooks/usePermissions';
import { getStoredAgentIdentity } from '../utils/agentReferral';
import BonusPayoutModal from '../modals/BonusPayoutModal';

interface ColumnDefinition {
    key: string;
    label: string;
    minWidth: number;
    align?: 'right' | 'left';
}

// The same columns the bonus tab carried on the page this replaced, so a reader
// coming from the old screen finds the record laid out where they expect it.
const bonusColumns: ColumnDefinition[] = [
    { key: 'id', label: 'ID', minWidth: 80 },
    { key: 'ref_number', label: 'Ref Number', minWidth: 150 },
    { key: 'type', label: 'Type', minWidth: 120 },
    { key: 'total_amount', label: 'Total Amount', minWidth: 150, align: 'right' },
    { key: 'created_by', label: 'Created By', minWidth: 180 },
    { key: 'status', label: 'Status', minWidth: 120 },
    { key: 'approved_by', label: 'Approved By', minWidth: 180 },
];

// What an agent reads: the columns Agent Payout shows for the same rows, so the
// record an agent sees and the one an administrator signs off are laid out alike.
const agentColumns: ColumnDefinition[] = [
    { key: 'id', label: 'ID', minWidth: 80 },
    { key: 'ref_number', label: 'Ref Number', minWidth: 150 },
    { key: 'type', label: 'Type', minWidth: 120 },
    { key: 'total_amount', label: 'Total Amount', minWidth: 150, align: 'right' },
    { key: 'commission_id_list', label: 'Job Orders', minWidth: 200 },
    { key: 'created_by', label: 'Created By', minWidth: 180 },
    { key: 'status', label: 'Status', minWidth: 120 },
    { key: 'approved_by', label: 'Approved By', minWidth: 180 },
];

// The transaction kind, labelled as Agent Payout labels it. `type` is a loose
// column — commission, incentives, incentives_payout, Bonus, Bonus_payout, all,
// achievement — so an unrecognised value is shown as stored rather than hidden.
const TYPE_LABELS: Record<string, string> = {
    incentives_payout: 'Payout',
    incentives: 'Add Incentives',
    Bonus_payout: 'Payout',
    Bonus: 'Add Bonus',
};

const typeLabel = (type?: string | null): string => (type ? TYPE_LABELS[type] || type : '—');

const PAGE_SIZE = 50;

// What the mobile card leads with: the amount, and where the record stands.
// The remaining columns follow underneath as label/value pairs.
const CARD_HEADLINE_KEYS = ['total_amount', 'status'];

/**
 * The agent history screen, and the administrator's Bonus History.
 *
 * One page under two sidebar labels, reading a different table for each — the
 * two roles want different things from it:
 *
 *   - An AGENT reads their own row of agent_commission_history: every payout,
 *     incentive and bonus movement against them, in one list. That table's
 *     `type` column already spans all of them (commission / incentives /
 *     incentives_payout / Bonus / Bonus_payout / all / achievement), so there is
 *     nothing to split into tabs and no kind of record to leave out.
 *   - Everyone else reads agent_bonus_history, which is what the "Bonus History"
 *     entry inside the Agent group means.
 *
 * Reads the endpoints directly rather than through useCommissionStore: that
 * store loads earnings alongside the history, and this page shows none of them.
 * Its own small piece of state also means the poll that store runs — and the
 * re-render churn that came with it — is not inherited here.
 *
 * Both endpoints are scoped server side to what the signed-in user may see. The
 * agent branch narrows by id again on this side, so a role the server counts as
 * an administrator can never put another agent's payouts on an agent's screen.
 */
const BonusHistory: React.FC = () => {
    const { can } = usePermissions();
    // Raising a bonus is an administrator's act against an agent, so the button
    // has no place on the agent's own reading of their history — whatever keys
    // the account happens to hold.
    const canManagePayouts = can('agent-payout');

    // Read once: the signed-in user does not change while the page is open, and
    // reading it up front means the first render is already the right one.
    const identity = useMemo(() => getStoredAgentIdentity(), []);
    const isAgentViewer = identity.isAgent;
    const columns = isAgentViewer ? agentColumns : bonusColumns;

    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    const [rows, setRows] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [currentPage, setCurrentPage] = useState(1);

    const [showBonusModal, setShowBonusModal] = useState(false);

    // The date range lives in the sidebar, which is hidden below md. Without a
    // second way in, an agent on a phone could search but never narrow by date.
    const [showMobileFilters, setShowMobileFilters] = useState(false);

    const [sidebarWidth, setSidebarWidth] = useState(256);
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const sidebarStartXRef = useRef<number>(0);
    const sidebarStartWidthRef = useRef<number>(0);

    const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizingSidebar(true);
        sidebarStartXRef.current = e.clientX;
        sidebarStartWidthRef.current = sidebarWidth;
    };

    useEffect(() => {
        if (!isResizingSidebar) return;

        const handleMouseMove = (e: MouseEvent) => {
            const diff = e.clientX - sidebarStartXRef.current;
            setSidebarWidth(Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff)));
        };
        const handleMouseUp = () => setIsResizingSidebar(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingSidebar]);

    useEffect(() => {
        const checkDarkMode = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const fetchPalette = async () => {
            try {
                setColorPalette(await settingsColorPaletteService.getActive());
            } catch (err) {
                console.error('[BonusHistory] Failed to fetch color palette:', err);
            }
        };
        fetchPalette();
    }, []);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        const label = isAgentViewer ? 'history' : 'bonus history';
        try {
            // One list either way — the agent's whole agent_commission_history,
            // or agent_bonus_history for everyone else.
            const res = await (isAgentViewer
                ? commissionService.getPayoutHistory(2000, 0)
                : commissionService.getBonusHistory(2000, 0)) as any;

            if (res?.success) {
                const data: any[] = res.data || [];

                // An agent sees only rows carrying their own id. Their name and
                // email are not consulted: agent_commission_history points at an
                // account by id, so the id is the only thing that can match.
                setRows(isAgentViewer
                    ? (identity.id === null
                        ? []
                        : data.filter(row => Number(row.agent_id) === Number(identity.id)))
                    : data);
            } else {
                setRows([]);
                setError(`Failed to load ${label}.`);
            }
        } catch (err: any) {
            console.error('[BonusHistory] Load failed:', err);
            setRows([]);
            setError(err?.response?.data?.message || err?.message || `Failed to load ${label}.`);
        } finally {
            setIsLoading(false);
        }
    }, [isAgentViewer, identity.id]);

    useEffect(() => {
        load();
    }, [load]);

    // A narrower result set can leave the reader stranded on a page that no
    // longer exists, showing an empty table.
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, dateFrom, dateTo]);

    const filtered = useMemo(() => {
        const query = searchTerm.toLowerCase().replace(/\s+/g, '');

        return rows.filter((row: any) => {
            if (dateFrom || dateTo) {
                const raw = row.created_at || row.date;
                const stamp = raw ? new Date(raw) : null;

                if (!stamp || isNaN(stamp.getTime())) return false;
                if (dateFrom && stamp < new Date(`${dateFrom}T00:00:00`)) return false;
                if (dateTo && stamp > new Date(`${dateTo}T23:59:59`)) return false;
            }

            if (query === '') return true;

            return columns.some(col => {
                const val = row[col.key];
                if (val === null || val === undefined) return false;
                return String(val).toLowerCase().replace(/\s+/g, '').includes(query);
            });
        });
    }, [rows, columns, searchTerm, dateFrom, dateTo]);

    const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const formatAmount = (value: any): string => {
        const n = parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''));
        if (isNaN(n)) return String(value ?? '');
        return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    /**
     * One cell, read the way Agent Payout reads the same columns: the kind and
     * the approval state as badges, the job orders as #ids, the amount as money.
     */
    const renderCell = (row: any, key: string): React.ReactNode => {
        const val = row[key];

        if (key === 'total_amount') return formatAmount(val);

        if (key === 'type') {
            const payout = val === 'incentives_payout' || val === 'Bonus_payout';
            return (
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${payout
                    ? isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-100 text-red-700'
                    : isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-100 text-green-700'
                    }`}>
                    {typeLabel(val)}
                </span>
            );
        }

        if (key === 'status') {
            // Settled states in green, awaiting action in amber, declined in red
            // — the same reading as the Transaction List and Agent Payout.
            const status = val || 'Pending';
            return (
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${(status === 'Paid' || status === 'Approved')
                    ? isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-100 text-green-700'
                    : status === 'Rejected'
                        ? isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-100 text-red-700'
                        : isDarkMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-100 text-amber-700'
                    }`}>
                    {status}
                </span>
            );
        }

        if (key === 'commission_id_list') {
            return (
                <span className="font-mono text-xs text-blue-400 font-medium">
                    {val ? String(val).split(',').map((id: string) => `#${id.trim()}`).join(', ') : '—'}
                </span>
            );
        }

        return val ?? '—';
    };

    const surface = isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';
    const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

    return (
        <div className={`h-full flex ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Sidebar: title, Add, and the date range — the same arrangement
                AgentPayout uses, so the two agent pages read the same way. */}
            <div
                className={`hidden md:flex border-r flex-shrink-0 flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
                style={{ width: `${sidebarWidth}px` }}
            >
                <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                        <h2 className={`text-lg font-semibold uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {isAgentViewer ? 'HISTORY' : 'BONUS HISTORY'}
                        </h2>
                        {canManagePayouts && !isAgentViewer && (
                            <button
                                onClick={() => setShowBonusModal(true)}
                                className="px-3 py-1.5 rounded text-white text-sm font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                                style={{ backgroundColor: colorPalette?.primary || '#ef4444' }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = colorPalette?.accent || '#dc2626';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#ef4444';
                                }}
                                title="New Bonus"
                            >
                                <Plus size={14} />
                                Add
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    <div className={`px-4 py-3 border-b space-y-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                        <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                DATE RANGE
                            </span>
                            {(dateFrom || dateTo) && (
                                <button
                                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                                    className="text-[10px] font-bold uppercase tracking-wider hover:underline"
                                    style={{ color: colorPalette?.primary || '#7c3aed' }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="space-y-2">
                            <div className="relative">
                                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                    style={dateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                                />
                            </div>
                            <div className="relative">
                                <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                    style={dateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
                    style={{ backgroundColor: isResizingSidebar ? (colorPalette?.primary || '#7c3aed') : 'transparent' }}
                    onMouseDown={handleMouseDownSidebarResize}
                />
            </div>

            <div className="flex-1 flex flex-col min-w-0">
                {/* Header: search only. Add and the date range live in the sidebar. */}
                <div className={`p-4 border-b flex-shrink-0 ${surface}`}>
                    <div className="flex items-center gap-2 sm:gap-3 w-full">
                        {/* min-w-0 rather than a 200px floor: on a 360px screen the
                            floor plus the buttons beside it overflows the row. */}
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Search history..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={`w-full pl-10 pr-4 py-2 rounded border focus:outline-none transition-all ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                                    }`}
                                style={searchTerm ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                            />
                        </div>

                        {/* The sidebar's date range, reachable where the sidebar is not. */}
                        <button
                            onClick={() => setShowMobileFilters(prev => !prev)}
                            title="Date range"
                            className={`md:hidden relative p-2 rounded border transition-colors flex-shrink-0 ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <CalendarRange size={18} />
                            {(dateFrom || dateTo) && (
                                <span
                                    className="absolute right-1 top-1 h-2 w-2 rounded-full"
                                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                />
                            )}
                        </button>

                        {/* On mobile the sidebar is hidden, so Add has nowhere
                            else to live. */}
                        {canManagePayouts && !isAgentViewer && (
                            <button
                                onClick={() => setShowBonusModal(true)}
                                className="md:hidden p-2 rounded border transition-colors flex-shrink-0 text-white"
                                style={{ backgroundColor: colorPalette?.primary || '#ef4444', borderColor: colorPalette?.primary || '#ef4444' }}
                                title="Add Record"
                            >
                                <Plus size={18} />
                            </button>
                        )}

                        <button
                            onClick={load}
                            disabled={isLoading}
                            title="Refresh"
                            className={`p-2 rounded border transition-colors flex-shrink-0 disabled:opacity-60 ${isDarkMode
                                ? 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>

                    {showMobileFilters && (
                        <div className={`md:hidden mt-3 pt-3 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    DATE RANGE
                                </span>
                                {(dateFrom || dateTo) && (
                                    <button
                                        onClick={() => { setDateFrom(''); setDateTo(''); }}
                                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                                        style={{ color: colorPalette?.primary || '#7c3aed' }}
                                    >
                                        <X size={12} />
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>From</label>
                                    <input
                                        type="date"
                                        value={dateFrom}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                        className={`w-full px-2 py-2 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                        style={dateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                                    />
                                </div>
                                <div>
                                    <label className={`text-[10px] mb-1 block ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>To</label>
                                    <input
                                        type="date"
                                        value={dateTo}
                                        onChange={(e) => setDateTo(e.target.value)}
                                        className={`w-full px-2 py-2 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                        style={dateTo ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

            <div className="flex-1 overflow-auto">
                {isLoading && rows.length === 0 ? (
                    <div className={`flex items-center justify-center gap-2 py-16 ${textMuted}`}>
                        <Loader2 size={18} className="animate-spin" />
                        <span>Loading {isAgentViewer ? 'history' : 'bonus history'}...</span>
                    </div>
                ) : error ? (
                    <div className="py-16 text-center text-red-500">{error}</div>
                ) : (
                    <>
                    {/* Eight columns of nowrap text do not fit a phone, and a
                        sideways scroll hides the amount — the one figure the
                        row is read for. Below md each record is a card instead,
                        laid out from the same column list so the two views can
                        never describe different fields. */}
                    <div className="md:hidden p-3 space-y-3">
                        {pageRows.length === 0 ? (
                            <div className={`rounded border p-6 text-center ${isDarkMode
                                ? 'bg-gray-900 border-gray-800 text-gray-400' : 'bg-white border-gray-200 text-gray-600'}`}>
                                No matching records found
                            </div>
                        ) : pageRows.map((row: any, i: number) => {
                            const rest = columns.filter(col => !CARD_HEADLINE_KEYS.includes(col.key));

                            return (
                                <div
                                    key={row.id ?? i}
                                    className={`rounded-lg border p-4 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                            {renderCell(row, 'total_amount')}
                                        </div>
                                        <div className="flex-shrink-0">{renderCell(row, 'status')}</div>
                                    </div>

                                    <div className={`mt-3 pt-3 space-y-2 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                                        {rest.map(col => (
                                            <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                                                <span className={`flex-shrink-0 ${textMuted}`}>{col.label}</span>
                                                <span className={`min-w-0 break-words text-right ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                                    {renderCell(row, col.key)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <table className="hidden md:table w-full text-sm">
                        <thead className={isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}>
                            <tr>
                                {columns.map(col => (
                                    <th
                                        key={col.key}
                                        style={{ minWidth: col.minWidth }}
                                        className={`px-4 py-3 font-semibold whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'
                                            } ${textMuted}`}
                                    >
                                        {col.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {pageRows.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length} className={`py-16 text-center ${textMuted}`}>
                                        No matching records found
                                    </td>
                                </tr>
                            ) : pageRows.map((row: any, i: number) => (
                                <tr
                                    key={row.id ?? i}
                                    className={`border-b ${isDarkMode
                                        ? 'border-gray-800 hover:bg-gray-900' : 'border-gray-200 hover:bg-gray-50'}`}
                                >
                                    {columns.map(col => (
                                        <td
                                            key={col.key}
                                            className={`px-4 py-3 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'
                                                } ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}
                                        >
                                            {renderCell(row, col.key)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </>
                )}
            </div>

            {filtered.length > 0 && (
                <div className={`flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t text-sm ${surface} ${textMuted}`}>
                    <span className="text-center sm:text-left">
                        Showing <span className="font-medium">{(currentPage - 1) * PAGE_SIZE + 1}</span> to{' '}
                        <span className="font-medium">{Math.min(currentPage * PAGE_SIZE, filtered.length)}</span> of{' '}
                        <span className="font-medium">{filtered.length}</span> records
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1 rounded border disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <span>Page {currentPage} of {lastPage}</span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(lastPage, p + 1))}
                            disabled={currentPage >= lastPage}
                            className="px-3 py-1 rounded border disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
            </div>

            <BonusPayoutModal
                isOpen={showBonusModal}
                onClose={() => setShowBonusModal(false)}
                onSuccess={() => {
                    setShowBonusModal(false);
                    load();
                }}
            />
        </div>
    );
};

export default BonusHistory;

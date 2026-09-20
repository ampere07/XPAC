import React, { useState, useEffect, useRef } from 'react';
import { DollarSign, Download, Filter, Search, Loader2, TrendingUp, Calendar, ArrowUpRight, ArrowDownRight, Clock, Receipt, History, ExternalLink, ChevronRight, ChevronLeft, RefreshCw, Columns, ChevronUp, ChevronDown, GripVertical, Columns3, ArrowUp, ArrowDown, ChevronsLeft, ChevronsRight, Gift } from 'lucide-react';
import { exportToCSV, exportToPDF } from '../utils/exportUtils';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useCommissionStore } from '../store/commissionStore';
import { CommissionData, PayoutHistoryData } from '../types/commission';
import AgentPayoutModal from '../modals/AgentPayoutModal';
import CommissionDetails from '../components/CommissionDetails';
import { useAgentStore } from '../store/agentStore';
import ModalUITemplate from '../modals/ui-modal/ModalUITemplate';
import { Agent, User } from '../types/api';
import { userService } from '../services/userService';
import apiClient from '../config/api';
import { usePermissions } from '../hooks/usePermissions';
import { agentInvoiceService } from '../services/agentInvoiceService';

interface ColumnDefinition {
    key: string;
    label: string;
    minWidth: number;
    align?: 'right' | 'left';
}

const earningsColumns: ColumnDefinition[] = [
    { key: 'id', label: 'Transaction ID', minWidth: 120 },
    { key: 'customer', label: 'Customer Name', minWidth: 200 },
    { key: 'service', label: 'Service Type', minWidth: 150 },
    { key: 'date', label: 'Date', minWidth: 120 },
    { key: 'status', label: 'Status', minWidth: 100 },
    { key: 'amount', label: 'Amount', minWidth: 120, align: 'right' },
];

const payoutColumns: ColumnDefinition[] = [
    { key: 'id', label: 'ID', minWidth: 80 },
    { key: 'type', label: 'Type', minWidth: 120 },
    { key: 'ref_number', label: 'Ref Number', minWidth: 150 },
    { key: 'total_amount', label: 'Total Amount', minWidth: 150 },
    { key: 'commission_id_list', label: 'Job Orders', minWidth: 200 },
    // Who raised the record, and who signed it off. Paired deliberately, the
    // same way the Transaction List shows them.
    { key: 'created_by', label: 'Created By', minWidth: 180 },
    { key: 'status', label: 'Status', minWidth: 120 },
    { key: 'approved_by', label: 'Approved By', minWidth: 180 },
];

/**
 * Reconcile a saved column order with the columns that exist today.
 *
 * The order each user arranges is remembered in their browser, so a column
 * added later would never appear for anyone who has already used the page.
 * Keys that no longer exist are dropped and new ones appended, which keeps a
 * user's arrangement intact while still surfacing new columns.
 */
const mergeColumnOrder = (saved: string | null, columns: ColumnDefinition[]): string[] => {
    const valid = columns.map(c => c.key);
    if (!saved) return valid;

    try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return valid;

        const merged = parsed.filter((key: string) => valid.includes(key));
        valid.forEach(key => { if (!merged.includes(key)) merged.push(key); });
        return merged;
    } catch {
        return valid;
    }
};

interface PaginationControlsProps {
    totalPages: number;
    itemsPerPage: number;
    setItemsPerPage: (val: number) => void;
    isDarkMode: boolean;
    currentPage: number;
    totalDisplayCount: number;
    handlePageChange: (page: number) => void;
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
    totalPages,
    itemsPerPage,
    setItemsPerPage,
    isDarkMode,
    currentPage,
    totalDisplayCount,
    handlePageChange
}) => {
    if (totalPages <= 1) return null;

    return (
        <div className={`flex flex-col md:flex-row items-center md:justify-between gap-3 px-4 py-3 border-t relative z-20 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className={`flex flex-wrap items-center justify-center md:justify-start gap-3 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                <div className="flex items-center gap-2">
                    <span>Show</span>
                    <select
                        value={itemsPerPage}
                        onChange={(e) => setItemsPerPage(Number(e.target.value))}
                        className={`px-2 py-1 rounded border text-sm focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                    >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                    </select>
                    <span>entries</span>
                </div>
                <span>
                    Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalDisplayCount)}</span> of <span className="font-medium">{totalDisplayCount}</span> results
                </span>
            </div>
            <div className="flex items-center flex-wrap justify-center gap-1 w-full md:w-auto">
                <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === 1
                        ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                        : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                        }`}
                    title="First Page"
                >
                    <ChevronsLeft size={16} />
                </button>

                <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1
                        ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                        : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                        }`}
                >
                    <ChevronLeft size={16} />
                </button>

                <div className="flex items-center space-x-1">
                    <span className={`px-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Page {currentPage} of {totalPages}
                    </span>
                </div>

                <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages
                        ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                        : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                        }`}
                >
                    <ChevronRight size={16} />
                </button>

                <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages
                        ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed')
                        : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')
                        }`}
                    title="Last Page"
                >
                    <ChevronsRight size={16} />
                </button>
            </div>
        </div>
    );
};

const AgentPayout: React.FC = () => {
    const {
        payoutHistory,
        isLoading,
        totalPayouts,
        fetchCommissions,
        fetchUpdates
    } = useCommissionStore();

    // Signing a payout off. The buttons were previously wired straight to the
    // handler for anyone who could open the page; the API now demands this same
    // key, so the two agree.
    const { can } = usePermissions();
    const canApprove = can('agent-payout.approve');

    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
    const [showMobileFilters, setShowMobileFilters] = useState<boolean>(false);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sidebarWidth, setSidebarWidth] = useState(256);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(50);

    // Sidebar resizing state
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const sidebarStartXRef = useRef<number>(0);
    const sidebarStartWidthRef = useRef<number>(0);

    // Date range state
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const [selectedRecord, setSelectedRecord] = useState<CommissionData | PayoutHistoryData | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    // True while an approve/reject request is in flight, so the buttons cannot be
    // pressed twice and apply a payout more than once.
    const [approvalPending, setApprovalPending] = useState(false);
    // The pending payout being approved, or null. Approving opens the payout
    // form so its details can be entered before it is applied.
    const [approveRecord, setApproveRecord] = useState<any | null>(null);
    const [agentList, setAgentList] = useState<User[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string | number>('all');
    const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const [visibleColumnsPayouts, setVisibleColumnsPayouts] = useState<string[]>(payoutColumns.map(c => c.key));

    // Column Management State
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [isRefreshingManual, setIsRefreshingManual] = useState(false);
    const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
    const { agents, fetchAgents } = useAgentStore();
    const [columnOrderPayouts, setColumnOrderPayouts] = useState<string[]>(
        () => mergeColumnOrder(localStorage.getItem('agentPayoutPayoutColumnOrder'), payoutColumns)
    );

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
                setFilterDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleToggleColumn = (columnKey: string) => {
        setVisibleColumnsPayouts(prev =>
            prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
        );
    };

    const handleSelectAllColumns = () => {
        setVisibleColumnsPayouts(payoutColumns.map(c => c.key));
    };

    const handleDeselectAllColumns = () => {
        setVisibleColumnsPayouts([]);
    };

    const handleExport = () => {
        const currentCols = payoutColumns;
        const visibleCols = visibleColumnsPayouts;
        const currentOrder = columnOrderPayouts;

        const exportColumns = currentCols
            .filter(col => visibleCols.includes(col.key))
            .sort((a, b) => currentOrder.indexOf(a.key) - currentOrder.indexOf(b.key));

        const getExportValue = (row: any, columnKey: string) => {
            const val = row[columnKey];
            if (columnKey === 'total_amount' || columnKey === 'amount' || columnKey === 'incentive_value') {
                return typeof val === 'number'
                    ? `₱${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    : !isNaN(Number(val))
                        ? `₱${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : val;
            }
            if (columnKey === 'created_at' || columnKey === 'date' || columnKey === 'processed_at') return val ? new Date(val).toLocaleString() : '-';
            return val || '-';
        };

        const title = 'Agent Payout History Report';

        exportToPDF(title, `agent_payout_history_export`, exportColumns, currentData, getExportValue, colorPalette);
    };

    const colStartXRef = useRef<number>(0);
    const colStartWidthRef = useRef<number>(0);

    const fetchData = async () => {
        await fetchCommissions(true);
    };

    const handleRefresh = async () => {
        setIsRefreshingManual(true);
        await fetchUpdates();
        setTimeout(() => setIsRefreshingManual(false), 800);
    };

    useEffect(() => {
        const fetchPalette = async () => {
            const palette = await settingsColorPaletteService.getActive();
            setColorPalette(palette);
        };
        fetchPalette();
        fetchData();
        fetchAgents();

        const fetchAgentsData = async () => {
            try {
                const response = await userService.getUsersByRole('agent');
                if (response.success && response.data && response.data.length > 0) {
                    setAgentList(response.data);
                } else {
                    const responseById = await userService.getUsersByRoleId(4);
                    if (responseById.success && responseById.data) {
                        setAgentList(responseById.data);
                    }
                }
            } catch (error) {
                setAgentList([]);
            }
        };
        fetchAgentsData();

        const checkDarkMode = () => {
            setIsDarkMode(localStorage.getItem('theme') !== 'light');
        };
        checkDarkMode();

        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Sidebar Resizing Logic
    useEffect(() => {
        if (!isResizingSidebar) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingSidebar) return;
            const diff = e.clientX - sidebarStartXRef.current;
            const newWidth = Math.max(200, Math.min(500, sidebarStartWidthRef.current + diff));
            setSidebarWidth(newWidth);
        };

        const handleMouseUp = () => setIsResizingSidebar(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingSidebar]);

    const handleMouseDownSidebarResize = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizingSidebar(true);
        sidebarStartXRef.current = e.clientX;
        sidebarStartWidthRef.current = sidebarWidth;
    };

    const handleSort = (columnKey: string) => {
        if (sortColumn === columnKey) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(columnKey);
            setSortDirection('asc');
        }
    };

    const handleResizeStart = (columnKey: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingColumn(columnKey);
        colStartXRef.current = e.clientX;
        const currentWidth = columnWidths[columnKey] || payoutColumns.find(c => c.key === columnKey)?.minWidth || 150;
        colStartWidthRef.current = currentWidth;
    };

    useEffect(() => {
        if (!resizingColumn) return;
        const handleMouseMove = (e: MouseEvent) => {
            const diff = e.clientX - colStartXRef.current;
            const newWidth = Math.max(80, colStartWidthRef.current + diff);
            setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
        };
        const handleMouseUp = () => setResizingColumn(null);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingColumn]);

    const handleDragStart = (columnKey: string, e: React.DragEvent) => {
        setDraggedColumn(columnKey);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (columnKey: string, e: React.DragEvent) => {
        e.preventDefault();
        if (columnKey !== draggedColumn) {
            setDragOverColumn(columnKey);
        }
    };

    const handleDrop = (columnKey: string) => {
        if (!draggedColumn || draggedColumn === columnKey) {
            setDraggedColumn(null);
            setDragOverColumn(null);
            return;
        }

        const currentOrder = [...columnOrderPayouts];
        const draggedIdx = currentOrder.indexOf(draggedColumn);
        const dropIdx = currentOrder.indexOf(columnKey);

        currentOrder.splice(draggedIdx, 1);
        currentOrder.splice(dropIdx, 0, draggedColumn);

        setColumnOrderPayouts(currentOrder);
        localStorage.setItem('agentPayoutPayoutColumnOrder', JSON.stringify(currentOrder));

        setDraggedColumn(null);
        setDragOverColumn(null);
    };

    // No handler raises a payout from this page any more. One is raised from the
    // agent invoice it settles, which is what gives it a reference tying back to
    // that document; this page approves and rejects what already exists.

    const sortedData = React.useMemo(() => {
        const rawData = payoutHistory;
        if (!sortColumn) return rawData;

        return [...rawData].sort((a: any, b: any) => {
            let valA = a[sortColumn];
            let valB = b[sortColumn];

            // Handle numeric strings like amounts
            if (sortColumn === 'amount' || sortColumn === 'total_amount' || sortColumn === 'incentive_value' || sortColumn === 'quota_reached' || sortColumn === 'job_order_id') {
                valA = parseFloat(String(valA).replace(/[^\d.-]/g, '')) || 0;
                valB = parseFloat(String(valB).replace(/[^\d.-]/g, '')) || 0;
            }

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [payoutHistory, sortColumn, sortDirection]);

    const filteredData = React.useMemo(() => {
        const normalizedQuery = searchTerm.toLowerCase().replace(/\s+/g, '');
        return sortedData.filter((row: any) => {
            if (selectedAgentId !== 'all') {
                // Compared as strings because the id arrives as a number from
                // the API and as whatever the sidebar button held. A row with no
                // agent_id belongs to no agent, so it is excluded rather than
                // shown under every one of them — which is what the old
                // `row.agent_id &&` guard did.
                if (String(row.agent_id ?? '') !== String(selectedAgentId)) return false;
            }

            const checkValue = (val: any): boolean => {
                if (val === null || val === undefined) return false;
                if (typeof val === 'object') return Object.values(val).some(v => checkValue(v));
                return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
            };

            const matchesSearch = searchTerm === '' || checkValue(row);

            // Date range filtering
            if (dateFrom || dateTo) {
                const dateVal = row.date || row.created_at;
                if (!dateVal) return matchesSearch;

                const itemDate = new Date(dateVal).getTime();
                if (dateFrom && itemDate < new Date(dateFrom).getTime()) return false;
                if (dateTo && itemDate > new Date(dateTo).getTime()) return false;
            }

            return matchesSearch;
        });
        // selectedAgentId belongs here: the filter reads it, so leaving it out
        // meant picking an agent recomputed nothing and the list never changed.
    }, [sortedData, searchTerm, dateFrom, dateTo, selectedAgentId]);

    const currentData = filteredData;
    const totalPages = Math.ceil(currentData.length / itemsPerPage);
    const paginatedData = currentData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        const tableArea = document.querySelector('.overflow-auto');
        if (tableArea) tableArea.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleRowClick = (record: CommissionData | PayoutHistoryData) => {
        setSelectedRecord(record);
        setShowDetails(true);
    };

    /**
     * Approve or reject a pending payout.
     *
     * The approver is never sent from here — the server records the signed-in
     * user, exactly as it does when a transaction is approved.
     */
    /**
     * Open the agent invoice a payout settled, by its number.
     *
     * A payout raised from an invoice carries that invoice's number as its
     * reference, which is the only link back to it — there is no invoice id on
     * the payout row. The number is searched for and matched exactly, so a
     * reference that merely contains another invoice's number cannot open the
     * wrong document.
     *
     * Best effort: a hand-entered payout has a random reference matching no
     * invoice, and nothing opens. That is not a failure worth interrupting the
     * approver with, so it is logged rather than raised.
     */
    const openInvoicePdfByNumber = async (refNumber: string) => {
        try {
            const list = await agentInvoiceService.list({ search: refNumber, per_page: 10 });
            const invoice = (list?.data || []).find(i => i.invoice_number === refNumber);

            if (!invoice) {
                console.info('[AgentPayout] No agent invoice matches the reference', refNumber);
                return;
            }

            const source = await agentInvoiceService.pdfBlob(invoice.id, false);

            if (source.kind === 'url') {
                window.open(source.url, '_blank', 'noopener');
                return;
            }

            const url = window.URL.createObjectURL(source.blob);
            window.open(url, '_blank', 'noopener');
            window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
        } catch (err) {
            console.error('[AgentPayout] Could not open the invoice PDF:', err);
        }
    };

    const handleApproval = async (record: any, action: 'approve' | 'reject') => {
        if (approvalPending) return;

        // Approving collects the payout's details first — amount, type, proof
        // and remarks — because a payout raised from an invoice was recorded
        // without them. The modal posts to the same approve endpoint once they
        // are entered, so this returns rather than approving with nothing.
        if (action === 'approve') {
            setApproveRecord(record);
            return;
        }

        // Only a rejection reaches here — approving returned above to collect
        // its details first. This screen lists the commission ledger; bonus
        // records are rejected from the Bonus History tab on the Commission page.
        const url = `/commissions/history/${record.id}/reject`;

        setApprovalPending(true);
        try {
            const res = await apiClient.post<{ success: boolean; message?: string }>(url);

            if (!res.data?.success) {
                throw new Error(res.data?.message || `Failed to ${action} the payout.`);
            }

            await fetchData();
            setShowDetails(false);
            setSelectedRecord(null);
        } catch (err: any) {
            const message = err?.response?.data?.message || err?.message || `Failed to ${action} the payout.`;
            window.alert(message);
        } finally {
            setApprovalPending(false);
        }
    };

    const handlePrevious = () => {
        if (!selectedRecord) return;
        const index = currentData.findIndex(r => r.id === (selectedRecord as PayoutHistoryData).id);
        if (index > 0) setSelectedRecord(currentData[index - 1]);
    };

    const handleNext = () => {
        if (!selectedRecord) return;
        const index = currentData.findIndex(r => r.id === (selectedRecord as PayoutHistoryData).id);
        if (index !== -1 && index < currentData.length - 1) setSelectedRecord(currentData[index + 1]);
    };

    if (isLoading) {
        return (
            <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }



    return (
        <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Sidebar */}
            <div className={`hidden md:flex border-r flex-shrink-0 flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`} style={{ width: `${sidebarWidth}px` }}>
                <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    {/* No Add here: a payout is raised from the agent invoice it
                        settles, so the reference ties back to that document. */}
                    <div className="flex items-center mb-1">
                        <h2 className={`text-lg font-semibold uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            PAYOUT HISTORY
                        </h2>
                    </div>
                </div>


                <div className="flex-1 overflow-y-auto">
                    {/* Date Range Filter Section */}
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

                    {/* Agent List */}
                    <button
                        onClick={() => setSelectedAgentId('all')}
                        className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} ${selectedAgentId === 'all' ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
                        style={selectedAgentId === 'all' ? {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                            color: colorPalette?.primary || '#7c3aed'
                        } : {}}
                    >
                        <div className="flex items-center">
                            <span>All Agents</span>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs ${selectedAgentId === 'all' ? 'text-white' : isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`} style={selectedAgentId === 'all' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}>
                            {agentList.length}
                        </span>
                    </button>

                    {agentList.map((agent) => {
                        const agentName = `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.replace(/\s+/g, ' ').trim();
                        const isSelected = selectedAgentId === agent.id;
                        return (
                            <button
                                key={agent.id}
                                onClick={() => setSelectedAgentId(agent.id)}
                                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} ${isSelected ? '' : isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
                                style={isSelected ? {
                                    backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(249, 115, 22, 0.2)',
                                    color: colorPalette?.primary || '#7c3aed'
                                } : {}}
                            >
                                <div className="flex items-center">
                                    <span className="truncate max-w-[150px] text-left">{agentName || agent.username}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
                {/* Sidebar Resize Handle */}
                <div
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-10"
                    style={{ backgroundColor: isResizingSidebar ? (colorPalette?.primary || '#7c3aed') : 'transparent' }}
                    onMouseDown={handleMouseDownSidebarResize}
                />
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Summary cards. One colour for every figure: they are four
                    readings of the same thing — money the agent holds — and a
                    green/blue split implied a meaning none of them carry. */}
                {selectedAgentId !== 'all' && (
                    <div className={`p-4 border-b flex-shrink-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                        {(() => {
                            // Compared as numbers: the id comes back from the API
                            // as a number and a strict === against a string id
                            // silently found nobody, which read as every card
                            // being zero.
                            const selectedAgent = agentList.find(a => Number(a.id) === Number(selectedAgentId));
                            const bal = selectedAgent?.agent_balance;
                            // COMMISSION, not `balance`. What an agent has earned
                            // from approved job orders lives in commission_value;
                            // `commission` is the per-referral rate and `balance`
                            // is a separate spendable bucket that is 0 for every
                            // agent here. Showing balance meant the cards read
                            // zero while the money sat in the column beside it.
                            // These four now match the payout modal's tiles.
                            // @ts-ignore
                            const commission = bal?.commission_value || 0;
                            const incentives = bal?.incentives || 0;
                            // @ts-ignore
                            const bonus = bal?.bonus || bal?.Bonus || 0;
                            // @ts-ignore
                            const achievement = bal?.achievement || 0;

                            const valueColor = colorPalette?.primary || '#ef4444';
                            const card = (label: string, value: any) => (
                                <div className={`p-3 rounded-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                    <div className="text-xs text-gray-500 mb-1">{label}</div>
                                    <div className="text-xl font-bold" style={{ color: valueColor }}>
                                        ₱{Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                            );

                            return (
                                <>
                                    {card('Commission', commission)}
                                    {card('Incentives', incentives)}
                                    {card('Bonus', bonus)}
                                    {card('Achievement', achievement)}
                                </>
                            );
                        })()}
                    </div>
                )}

                {/* Header/Toolbar */}
                <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
                        <div className="relative flex-1 min-w-[200px] flex-shrink-0">
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

                        {isMobile && (
                            <button
                                onClick={() => setShowMobileFilters(!showMobileFilters)}
                                className={`p-2 rounded border transition-colors flex-shrink-0 ${(dateFrom || dateTo) ? 'text-red-500' : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
                                title="Date Filters"
                            >
                                <Filter size={18} />
                            </button>
                        )}

                        <div className="relative flex-shrink-0" ref={filterDropdownRef}>
                            <button
                                className={`p-2 rounded border transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                                title="Column Visibility"
                            >
                                <Columns3 size={18} />
                            </button>
                            {filterDropdownOpen && (
                                <div className={`absolute top-full right-0 mt-2 w-72 rounded shadow-lg z-50 max-h-[70vh] flex flex-col ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
                                    <div className={`p-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                                        <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Column Visibility</span>
                                        <div className="flex space-x-2">
                                            <button onClick={handleSelectAllColumns} className="text-xs text-blue-500 hover:underline">Select All</button>
                                            <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>|</span>
                                            <button onClick={handleDeselectAllColumns} className="text-xs text-blue-500 hover:underline">Deselect All</button>
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto flex-1">
                                        {payoutColumns.map((column) => (
                                            <label
                                                key={column.key}
                                                className={`flex items-center px-4 py-2 cursor-pointer text-sm ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={visibleColumnsPayouts.includes(column.key)}
                                                    onChange={() => handleToggleColumn(column.key)}
                                                    className="mr-3 h-4 w-4 rounded"
                                                    style={{ accentColor: colorPalette?.primary || '#3b82f6' }}
                                                />
                                                <span>{column.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleExport}
                            className={`p-2 rounded border transition-colors flex-shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                            title="Export to PDF"
                        >
                            <Download size={18} />
                        </button>
                        <button
                            onClick={handleRefresh}
                            className={`p-2 rounded border transition-colors flex-shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                            style={{ color: colorPalette?.primary || '#ef4444' }}
                            title={isLoading ? `Loading... ${payoutHistory.length}/${totalPayouts}` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
                        >
                            <RefreshCw size={18} className={isLoading || isRefreshingManual ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Mobile Date Filters Inline */}
                {isMobile && showMobileFilters && (
                    <div className={`p-4 border-b flex flex-col gap-3 flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-center justify-between">
                            <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                DATE RANGE
                            </span>
                            {(dateFrom || dateTo) && (
                                <button
                                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                                    className="text-xs font-semibold hover:underline"
                                    style={{ color: colorPalette?.primary || '#7c3aed' }}
                                >
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
                                    className={`w-full px-2 py-1.5 rounded text-xs focus:outline-none border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                    style={dateFrom ? { borderColor: colorPalette?.primary || '#7c3aed' } : {}}
                                />
                            </div>
                            <div>
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
                )}

                {/* Table Area */}
                <div className="flex-1 overflow-auto relative scrollbar-thin">
                    <table className="w-max min-w-full text-sm border-separate border-spacing-0">
                        <thead>
                            <tr className={`border-b sticky top-0 z-10 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'}`}>
                                {columnOrderPayouts
                                    .filter(key => visibleColumnsPayouts.includes(key))
                                    .map((colKey, index, array) => {
                                        const colDef = payoutColumns.find(c => c.key === colKey);
                                        if (!colDef) return null;

                                        const isSorted = sortColumn === colKey;
                                        const width = columnWidths[colKey] || colDef.minWidth;

                                        return (
                                            <th
                                                key={colKey}
                                                draggable
                                                onDragStart={(e) => handleDragStart(colKey, e)}
                                                onDragOver={(e) => handleDragOver(colKey, e)}
                                                onDrop={() => handleDrop(colKey)}
                                                onClick={() => handleSort(colKey)}
                                                className={`group relative py-3 px-3 font-normal whitespace-nowrap cursor-pointer select-none transition-colors ${isDarkMode ? 'text-gray-400 bg-gray-800 hover:bg-gray-700' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'} ${index < array.length - 1 ? (isDarkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : ''} ${dragOverColumn === colKey ? (isDarkMode ? 'border-l-2 border-orange-500' : 'border-l-2 border-orange-600') : ''} ${draggedColumn === colKey ? 'opacity-50' : ''}`}
                                                style={{ width: `${width}px`, minWidth: `${width}px` }}
                                            >
                                                <div className={`flex items-center space-x-1 ${colDef.align === 'right' ? 'justify-end' : ''}`}>
                                                    <span>{colDef.label}</span>
                                                    {isSorted && (
                                                        sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                                                    )}
                                                </div>

                                                {/* Resize Handle */}
                                                <div
                                                    onMouseDown={(e) => handleResizeStart(colKey, e)}
                                                    className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity z-10 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`}
                                                />
                                            </th>
                                        );
                                    })}
                            </tr>
                        </thead>
                        <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}>
                            {paginatedData.length > 0 ? (
                                paginatedData.map((row: any, i) => (
                                    <tr
                                        key={i}
                                        onClick={() => handleRowClick(row)}
                                        className={`border-b transition-colors cursor-pointer ${isDarkMode ? 'border-gray-800 hover:bg-gray-800' : 'border-gray-200 hover:bg-gray-50'}`}
                                        style={(selectedRecord as any)?.id === row.id
                                            ? { backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(59, 130, 246, 0.2)' }
                                            : {}}
                                    >
                                        {columnOrderPayouts
                                            .filter(key => visibleColumnsPayouts.includes(key))
                                            .map((colKey, index, array) => {
                                                const colDef = payoutColumns.find(c => c.key === colKey);
                                                if (!colDef) return null;

                                                const val = row[colKey];
                                                const width = columnWidths[colKey] || colDef.minWidth;

                                                return (
                                                    <td
                                                        key={colKey}
                                                        className={`py-3 px-3 whitespace-nowrap ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} ${index < array.length - 1 ? (isDarkMode ? 'border-r border-gray-800' : 'border-r border-gray-200') : ''}`}
                                                        style={{ width: `${width}px`, minWidth: `${width}px` }}
                                                    >
                                                        {colKey === 'id' ? (
                                                            <span className={`font-mono font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{val}</span>
                                                        ) : colKey === 'status' ? (
                                                            // Approval state, using the same reading as the Transaction List:
                                                            // settled states in green, awaiting action in amber, declined in red.
                                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${(val === 'Paid' || val === 'Approved')
                                                                ? isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-100 text-green-700'
                                                                : val === 'Rejected'
                                                                    ? isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-100 text-red-700'
                                                                    : isDarkMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-100 text-amber-700'
                                                                }`}>
                                                                {val || 'Pending'}
                                                            </span>
                                                        ) : colKey === 'type' ? (
                                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${row.type === 'incentives_payout'
                                                                ? isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-100 text-red-700'
                                                                : isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-100 text-green-700'
                                                                }`}>
                                                                {row.type === 'incentives_payout' ? 'Payout' : row.type === 'incentives' ? 'Add Incentives' : row.type || '---'}
                                                            </span>
                                                        ) : (colKey === 'amount' || colKey === 'total_amount') ? (
                                                            <span className={`font-bold tracking-tight ${colKey === 'total_amount' && row.type === 'incentives_payout'
                                                                ? 'text-red-500'
                                                                : colKey === 'total_amount' && row.type === 'incentives'
                                                                    ? 'text-green-500'
                                                                    : ''
                                                                }`}>
                                                                {colKey === 'total_amount' && row.type === 'incentives_payout' ? '-' : colKey === 'total_amount' && row.type === 'incentives' ? '+' : ''}
                                                                {typeof val === 'number' ? `₱${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : !isNaN(Number(val)) ? `₱${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : val}
                                                            </span>
                                                        ) : colKey === 'ref_number' ? (
                                                            <span className="font-mono text-blue-500 font-medium">{val}</span>
                                                        ) : colKey === 'commission_id_list' ? (
                                                            <span className="font-mono text-xs text-blue-400 font-medium">
                                                                {val ? val.split(',').map((id: string) => `#${id.trim()}`).join(', ') : '---'}
                                                            </span>
                                                        ) : colKey === 'incentive_value' ? (
                                                            <span className="font-bold tracking-tight text-green-500">
                                                                +{typeof val === 'number' ? `₱${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : !isNaN(Number(val)) ? `₱${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : val}
                                                            </span>
                                                        ) : colKey === 'job_order_id' ? (
                                                            <span className="font-mono text-xs text-blue-400 font-medium">#{val}</span>
                                                        ) : colKey === 'processed_at' ? (
                                                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                                                {val ? new Date(val).toLocaleString() : '---'}
                                                            </span>
                                                        ) : (
                                                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                                                {val || '---'}
                                                            </span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={columnOrderPayouts.length} className="px-6 py-10 text-center text-gray-500 italic">
                                        No matching records found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <PaginationControls
                    totalPages={totalPages}
                    itemsPerPage={itemsPerPage}
                    setItemsPerPage={setItemsPerPage}
                    isDarkMode={isDarkMode}
                    currentPage={currentPage}
                    totalDisplayCount={currentData.length}
                    handlePageChange={handlePageChange}
                />
            </div>

            {/* Details Panel */}
            {showDetails && selectedRecord && (
                <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
                    <CommissionDetails
                        data={selectedRecord}
                        type="payouts"
                        isMobile={isMobile}
                        approvalPending={approvalPending}
                        onApprove={canApprove ? (record) => handleApproval(record, 'approve') : undefined}
                        onReject={canApprove ? (record) => handleApproval(record, 'reject') : undefined}
                        onClose={() => { setShowDetails(false); setSelectedRecord(null); }}
                        onPrevious={currentData.findIndex(r => r.id === (selectedRecord as any).id) > 0 ? handlePrevious : undefined}
                        onNext={currentData.findIndex(r => r.id === (selectedRecord as any).id) < currentData.length - 1 ? handleNext : undefined}
                    />
                </div>
            )}

            {/* Approving a pending payout: the same form, every field required,
                writing its details onto the record and applying it. */}
            <AgentPayoutModal
                isOpen={approveRecord !== null}
                onClose={() => setApproveRecord(null)}
                onSuccess={() => {
                    const settled = approveRecord;
                    setApproveRecord(null);

                    // The record on screen is now Approved, and the detail pane
                    // hides Approve/Reject for anything that is not Pending — so
                    // marking it here is what takes the buttons away, without
                    // closing the pane the approver is reading.
                    setSelectedRecord((current: any) =>
                        current && current.id === settled?.id
                            ? { ...current, status: 'Approved' }
                            : current
                    );

                    handleRefresh();

                    // The invoice this payout settled, opened so the approver
                    // sees the document they just paid.
                    if (settled?.ref_number) {
                        openInvoicePdfByNumber(String(settled.ref_number));
                    }
                }}
                approveId={approveRecord?.id}
                approveRefNumber={approveRecord?.ref_number}
                agentId={approveRecord?.agent_id}
                agentName={approveRecord?.agent_name}
            />
        </div>
    );
};

export default AgentPayout;

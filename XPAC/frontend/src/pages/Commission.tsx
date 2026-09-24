import React, { useState, useEffect, useRef } from 'react';
import { DollarSign, Download, Filter, Search, Loader2, TrendingUp, Calendar, ArrowUpRight, ArrowDownRight, Clock, Receipt, History, ExternalLink, ChevronRight, ChevronLeft, RefreshCw, Columns, Plus, ChevronUp, ChevronDown, GripVertical, Columns3, ArrowUp, ArrowDown, ChevronsLeft, ChevronsRight, Gift } from 'lucide-react';
import { exportToCSV, exportToPDF } from '../utils/exportUtils';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useCommissionStore } from '../store/commissionStore';
import { CommissionData, PayoutHistoryData } from '../types/commission';
import CommissionDetails from '../components/CommissionDetails';
import CommissionPayoutModal from '../modals/CommissionPayoutModal';
import IncentivesPayoutModal from '../modals/IncentivesPayoutModal';
import BonusPayoutModal from '../modals/BonusPayoutModal';
import { useAgentStore } from '../store/agentStore';
import ModalUITemplate from '../modals/ui-modal/ModalUITemplate';
import { Agent } from '../types/api';
import TableFunnelFilter, { FunnelColumn } from '../filter/TableFunnelFilter';
import { useFunnelFilter } from '../filter/useFunnelFilter';
import apiClient from '../config/api';
import { usePermissions } from '../hooks/usePermissions';

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
    { key: 'ref_number', label: 'Ref Number', minWidth: 150 },
    { key: 'total_amount', label: 'Total Amount', minWidth: 150 },
    { key: 'commission_id_list', label: 'Job Orders', minWidth: 200 },
    { key: 'created_by', label: 'Processed By', minWidth: 150 },
    // Payouts are recorded Pending and only move the balance once approved.
    { key: 'status', label: 'Status', minWidth: 110 },
    { key: 'approved_by', label: 'Approved By', minWidth: 160 },
];

const incentivesColumns: ColumnDefinition[] = [
    { key: 'id', label: 'ID', minWidth: 80 },
    { key: 'ref_number', label: 'Ref Number', minWidth: 150 },
    { key: 'type', label: 'Type', minWidth: 120 },
    { key: 'total_amount', label: 'Total Amount', minWidth: 150 },
    { key: 'created_by', label: 'Processed By', minWidth: 150 },
    { key: 'status', label: 'Status', minWidth: 110 },
    { key: 'approved_by', label: 'Approved By', minWidth: 160 },
];

// Auto-awarded quota incentives (from the agent_incentive_history table / cron).
const incentiveHistoryColumns: ColumnDefinition[] = [
    { key: 'id', label: 'ID', minWidth: 80 },
    { key: 'agent_name', label: 'Agent', minWidth: 180 },
    { key: 'job_order_id', label: 'Job Order', minWidth: 110 },
    { key: 'batch_number', label: 'Batch', minWidth: 90, align: 'right' },
    { key: 'quota_reached', label: 'Quota Reached', minWidth: 130, align: 'right' },
    { key: 'incentive_value', label: 'Incentive Value', minWidth: 150, align: 'right' },
    { key: 'processed_at', label: 'Processed At', minWidth: 180 },
];

/**
 * One filter entry per column of each tab's table, so every column this screen can show is
 * filterable. Keys match the ColumnDefinition lists above exactly - each table renders its cells
 * from row[key] and the filter reads the same key.
 *
 * Keyed by tab because the four tabs show four different record shapes; the funnel is handed
 * whichever set matches the tab in view, so switching tabs switches the filterable columns
 * rather than offering columns that do not exist on the rows on screen.
 */
const FUNNEL_COLUMNS_BY_TAB: Record<string, FunnelColumn[]> = {
    earnings: [
        { key: 'id', label: 'Transaction ID', dataType: 'varchar' },
        { key: 'customer', label: 'Customer Name', dataType: 'varchar' },
        { key: 'service', label: 'Service Type', dataType: 'checklist' },
        { key: 'date', label: 'Date', dataType: 'date' },
        { key: 'status', label: 'Status', dataType: 'checklist' },
        { key: 'amount', label: 'Amount', dataType: 'decimal' },
    ],
    payouts: [
        { key: 'id', label: 'ID', dataType: 'varchar' },
        { key: 'ref_number', label: 'Ref Number', dataType: 'varchar' },
        { key: 'total_amount', label: 'Total Amount', dataType: 'decimal' },
        { key: 'commission_id_list', label: 'Job Orders', dataType: 'varchar' },
        { key: 'created_by', label: 'Processed By', dataType: 'checklist' },
        { key: 'status', label: 'Status', dataType: 'checklist' },
        { key: 'approved_by', label: 'Approved By', dataType: 'checklist' },
    ],
    incentives: [
        { key: 'id', label: 'ID', dataType: 'varchar' },
        { key: 'agent_name', label: 'Agent', dataType: 'checklist' },
        { key: 'job_order_id', label: 'Job Order', dataType: 'varchar' },
        { key: 'batch_number', label: 'Batch', dataType: 'int' },
        { key: 'quota_reached', label: 'Quota Reached', dataType: 'int' },
        { key: 'incentive_value', label: 'Incentive Value', dataType: 'decimal' },
        { key: 'processed_at', label: 'Processed At', dataType: 'datetime' },
    ],
    bonus: [
        { key: 'id', label: 'ID', dataType: 'varchar' },
        { key: 'ref_number', label: 'Ref Number', dataType: 'varchar' },
        { key: 'type', label: 'Type', dataType: 'checklist' },
        { key: 'total_amount', label: 'Total Amount', dataType: 'decimal' },
        { key: 'created_by', label: 'Processed By', dataType: 'checklist' },
        { key: 'status', label: 'Status', dataType: 'checklist' },
        { key: 'approved_by', label: 'Approved By', dataType: 'checklist' },
    ],
};

/**
 * A saved column order reconciled with today's columns: unknown keys dropped,
 * new ones appended, so columns added later still show for existing users.
 */
const mergeSavedOrder = (saved: string | null, columns: ColumnDefinition[]): string[] => {
    const valid = columns.map(c => c.key);
    if (!saved) return valid;
    try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return valid;
        const merged = parsed.filter((k: string) => valid.includes(k));
        valid.forEach(k => { if (!merged.includes(k)) merged.push(k); });
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

const Commission: React.FC = () => {
    const {
        earnings: data,
        payoutHistory,
        incentiveHistory,
        bonusHistory,
        stats,
        isLoading,
        totalEarnings,
        totalPayouts,
        totalIncentives,
        lastUpdated,
        fetchCommissions,
        fetchUpdates
    } = useCommissionStore();

    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
    const [showMobileFilters, setShowMobileFilters] = useState<boolean>(false);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [activeTab, setActiveTab] = useState<'earnings' | 'payouts' | 'incentives' | 'bonus'>('payouts');
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
    // Payouts and bonus records raised here are saved Pending. Approving one
    // (which moves the balance) or rejecting it uses the same key as the Agent
    // page that owns the record: agent-payout.approve for payout history,
    // bonus-history.payout for bonus history. Raising one is commission.create.
    const { can } = usePermissions();
    const canCreate = can('commission.create');
    const canApprove = activeTab === 'bonus' ? can('bonus-history.payout') : can('agent-payout.approve');
    const [approvalPending, setApprovalPending] = useState(false);

    // Column Visibility State
    const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const [visibleColumnsEarnings, setVisibleColumnsEarnings] = useState<string[]>(earningsColumns.map(c => c.key));
    const [visibleColumnsPayouts, setVisibleColumnsPayouts] = useState<string[]>(payoutColumns.map(c => c.key));
    const [visibleColumnsIncentives, setVisibleColumnsIncentives] = useState<string[]>(incentiveHistoryColumns.map(c => c.key));
    const [visibleColumnsBonus, setVisibleColumnsBonus] = useState<string[]>(incentivesColumns.map(c => c.key));

    // Column Management State
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [isRefreshingManual, setIsRefreshingManual] = useState(false);
    const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
    const [showPayoutModal, setShowPayoutModal] = useState(false);
    const [showIncentiveModal, setShowIncentiveModal] = useState(false);
    const [showBonusModal, setShowBonusModal] = useState(false);
    const [payoutAgent, setPayoutAgent] = useState<Agent | null>(null);
    const { agents, fetchAgents } = useAgentStore();
    const [columnOrderEarnings, setColumnOrderEarnings] = useState<string[]>(() => {
        const saved = localStorage.getItem('commissionEarningsColumnOrder');
        return saved ? JSON.parse(saved) : earningsColumns.map(c => c.key);
    });
    const [columnOrderPayouts, setColumnOrderPayouts] = useState<string[]>(
        () => mergeSavedOrder(localStorage.getItem('commissionPayoutColumnOrder'), payoutColumns)
    );
    const [columnOrderIncentives, setColumnOrderIncentives] = useState<string[]>(() => {
        // New key (v2): the Incentives tab now lists agent_incentive_history rows,
        // so the old saved order (ref_number/type/total_amount) no longer applies.
        const saved = localStorage.getItem('commissionIncentivesColumnOrderV2');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Keep only known keys and append any new ones.
            const valid = incentiveHistoryColumns.map(c => c.key);
            const filtered = parsed.filter((k: string) => valid.includes(k));
            valid.forEach(k => { if (!filtered.includes(k)) filtered.push(k); });
            return filtered;
        }
        return incentiveHistoryColumns.map(c => c.key);
    });

    const [columnOrderBonus, setColumnOrderBonus] = useState<string[]>(() => {
        const saved = localStorage.getItem('commissionBonusColumnOrder');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    if (!parsed.includes('type')) {
                        parsed.splice(2, 0, 'type');
                    }
                    return mergeSavedOrder(JSON.stringify(parsed), incentivesColumns);
                }
            } catch { /* fall through to the default order */ }
        }
        return incentivesColumns.map(c => c.key);
    });

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
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else {
            setVisibleColumnsBonus(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        }
    };

    const handleSelectAllColumns = () => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(earningsColumns.map(c => c.key));
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(payoutColumns.map(c => c.key));
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives(incentiveHistoryColumns.map(c => c.key));
        } else {
            setVisibleColumnsBonus(incentivesColumns.map(c => c.key));
        }
    };

    const handleDeselectAllColumns = () => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings([]);
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts([]);
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives([]);
        } else {
            setVisibleColumnsBonus([]);
        }
    };

    const handleExport = () => {
        const currentCols = activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : activeTab === 'incentives' ? incentiveHistoryColumns : incentivesColumns;
        const visibleCols = activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus;
        const currentOrder = activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus;

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

        const titleMap: Record<string, string> = {
            earnings: 'Commission Earnings Report',
            payouts: 'Commission Payout History Report',
            incentives: 'Incentives History Report',
            bonus: 'Bonus Payout History Report'
        };
        const title = titleMap[activeTab] || 'Commission Report';

        exportToPDF(title, `commission_${activeTab}_export`, exportColumns, currentData, getExportValue, colorPalette);
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

        const checkDarkMode = () => {
            setIsDarkMode(localStorage.getItem('theme') !== 'light');
        };
        checkDarkMode();

        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        return () => observer.disconnect();
    }, []);

    // Polling for updates every 3 seconds - incremental fetch (mirrors Customer.tsx).
    // fetchUpdates refreshes payoutHistory (Commission & Bonus History) and incentiveHistory (Incentives History).
    useEffect(() => {
        const POLLING_INTERVAL = 3000; // 3 seconds
        const intervalId = setInterval(async () => {
            try {
                await fetchUpdates();
            } catch (err) {
                console.error('[Commission Page] Polling failed:', err);
            }
        }, POLLING_INTERVAL);

        return () => clearInterval(intervalId);
    }, [fetchUpdates]);

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
        const currentWidth = columnWidths[columnKey] || (activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : activeTab === 'incentives' ? incentiveHistoryColumns : incentivesColumns).find(c => c.key === columnKey)?.minWidth || 150;
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

        const currentOrder = activeTab === 'earnings'
            ? [...columnOrderEarnings]
            : activeTab === 'payouts'
                ? [...columnOrderPayouts]
                : [...columnOrderIncentives];
        const draggedIdx = currentOrder.indexOf(draggedColumn);
        const dropIdx = currentOrder.indexOf(columnKey);

        currentOrder.splice(draggedIdx, 1);
        currentOrder.splice(dropIdx, 0, draggedColumn);

        if (activeTab === 'earnings') {
            setColumnOrderEarnings(currentOrder);
            localStorage.setItem('commissionEarningsColumnOrder', JSON.stringify(currentOrder));
        } else if (activeTab === 'payouts') {
            setColumnOrderPayouts(currentOrder);
            localStorage.setItem('commissionPayoutColumnOrder', JSON.stringify(currentOrder));
        } else if (activeTab === 'incentives') {
            setColumnOrderIncentives(currentOrder);
            localStorage.setItem('commissionIncentivesColumnOrderV2', JSON.stringify(currentOrder));
        } else {
            setColumnOrderBonus(currentOrder);
            localStorage.setItem('commissionBonusColumnOrder', JSON.stringify(currentOrder));
        }

        setDraggedColumn(null);
        setDragOverColumn(null);
    };

    const handleOpenPayout = () => {
        setPayoutAgent(null);
        if (activeTab === 'incentives') {
            setShowIncentiveModal(true);
        } else if (activeTab === 'bonus') {
            setShowBonusModal(true);
        } else {
            setShowPayoutModal(true);
        }
    };

    const handleSelectAgentForPayout = (agent: Agent) => {
        setPayoutAgent(agent);
        setShowPayoutModal(true);
    };

    const sortedData = React.useMemo(() => {
        const rawData = activeTab === 'earnings'
            ? data
            : activeTab === 'payouts'
                ? payoutHistory.filter((item: any) => !item.type || item.type === 'commission')
                : activeTab === 'incentives'
                    ? incentiveHistory
                    : bonusHistory;
        if (!sortColumn) return rawData;

        return [...rawData].sort((a: any, b: any) => {
            let valA = a[sortColumn];
            let valB = b[sortColumn];

            // Handle numeric strings like amounts
            if (sortColumn === 'amount' || sortColumn === 'total_amount' || sortColumn === 'incentive_value' || sortColumn === 'quota_reached' || sortColumn === 'job_order_id' || sortColumn === 'batch_number') {
                valA = parseFloat(String(valA).replace(/[^\d.-]/g, '')) || 0;
                valB = parseFloat(String(valB).replace(/[^\d.-]/g, '')) || 0;
            }

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, payoutHistory, incentiveHistory, bonusHistory, activeTab, sortColumn, sortDirection]);

    const filteredData = React.useMemo(() => {
        const normalizedQuery = searchTerm.toLowerCase().replace(/\s+/g, '');
        return sortedData.filter((row: any) => {
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
    }, [sortedData, searchTerm, dateFrom, dateTo]);

    // Applied on the searched set so the counts and the table describe the same rows - the point
    // Customer.tsx applies its own funnel. The column set follows the tab in view; selections are
    // stored per tab so switching back restores what was set there.
    const funnel = useFunnelFilter({
        storageKey: `commissionFunnelFilters:${activeTab}`,
        columns: FUNNEL_COLUMNS_BY_TAB[activeTab] || FUNNEL_COLUMNS_BY_TAB.earnings,
        rows: filteredData,
    });

    const currentData = funnel.filteredRows;
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
     * Approve or reject the pending record on screen. Commission payouts live in
     * the commission ledger, bonus records in their own; the approver is the
     * signed-in user, recorded server side. Approving sends no details, so the
     * amount, type, proof and remarks entered when the record was raised stand.
     */
    const handleApproval = async (record: any, action: 'approve' | 'reject') => {
        if (approvalPending || !record?.id) return;
        const ledger = activeTab === 'bonus' ? 'bonus-history' : 'history';
        const amount = Number(record.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
        const prompt = action === 'approve'
            ? `Approve ${record.ref_number || 'this record'} (\u20B1${amount}) for ${record.agent_name || 'this agent'}? This applies it to the agent's balance.`
            : `Reject ${record.ref_number || 'this record'}? No balance will change.`;
        if (!window.confirm(prompt)) return;

        setApprovalPending(true);
        try {
            const res = await apiClient.post<{ success: boolean; message?: string }>(`/commissions/${ledger}/${record.id}/${action}`);
            if (!res.data?.success) {
                throw new Error(res.data?.message || `Failed to ${action} the record.`);
            }
            const status = action === 'approve' ? 'Approved' : 'Rejected';
            setSelectedRecord((current: any) => current && current.id === record.id ? { ...current, status } : current);
            await fetchUpdates();
        } catch (err: any) {
            window.alert(err?.response?.data?.message || err?.message || `Failed to ${action} the record.`);
        } finally {
            setApprovalPending(false);
        }
    };

    const handlePrevious = () => {
        if (!selectedRecord) return;
        const index = currentData.findIndex(r => r.id === (activeTab === 'earnings' ? (selectedRecord as CommissionData).id : (selectedRecord as PayoutHistoryData).id));
        if (index > 0) setSelectedRecord(currentData[index - 1]);
    };

    const handleNext = () => {
        if (!selectedRecord) return;
        const index = currentData.findIndex(r => r.id === (activeTab === 'earnings' ? (selectedRecord as CommissionData).id : (selectedRecord as PayoutHistoryData).id));
        if (index !== -1 && index < currentData.length - 1) setSelectedRecord(currentData[index + 1]);
    };

    if (isLoading) {
        return (
            <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
                <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
        );
    }

    const SidebarItem = ({ id, label, icon: Icon }: { id: string, label: string, icon: any }) => (
        <button
            onClick={() => {
                setActiveTab(id as any);
                setCurrentPage(1);
                setShowDetails(false);
                setSelectedRecord(null);
            }}
            className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${activeTab === id
                ? ''
                : isDarkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'
                }`}
            style={activeTab === id ? {
                backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(59, 130, 246, 0.1)',
                color: colorPalette?.primary || '#3b82f6'
            } : {}}
        >
            <div className="flex items-center gap-3">
                <Icon size={18} />
                <span className="font-medium">{label}</span>
            </div>
        </button>
    );

    return (
        <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* Sidebar */}
            <div className={`hidden md:flex border-r flex-shrink-0 flex-col relative ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`} style={{ width: `${sidebarWidth}px` }}>
                <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                        <h2 className={`text-lg font-semibold uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {activeTab === 'incentives' ? 'INCENTIVES' : activeTab === 'bonus' ? 'BONUS' : 'COMMISSIONS'}
                        </h2>
                        {activeTab !== 'incentives' && canCreate && (
                            <button
                                onClick={handleOpenPayout}
                                className="px-3 py-1.5 rounded text-white text-sm font-medium flex items-center gap-1.5 transition-colors shadow-sm"
                                style={{ backgroundColor: colorPalette?.primary || '#ef4444' }}
                                onMouseEnter={(e) => {
                                    if (colorPalette?.accent) {
                                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                                    } else {
                                        e.currentTarget.style.backgroundColor = '#dc2626';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#ef4444';
                                }}
                                title="New Commission Payout"
                            >
                                <Plus size={14} />
                                Add
                            </button>
                        )}
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

                    <div className="py-2 space-y-1">
                        <SidebarItem id="payouts" label="Commission History" icon={History} />
                        <SidebarItem id="incentives" label="Incentives History" icon={Gift} />
                        <SidebarItem id="bonus" label="Bonus History" icon={Gift} />
                    </div>

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
                {/* Mobile Tabs */}
                {isMobile && (
                    <div className={`flex border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                        <button
                            onClick={() => { setActiveTab('payouts'); setCurrentPage(1); }}
                            className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-all ${
                                activeTab === 'payouts'
                                    ? `text-white border-blue-500`
                                    : `${isDarkMode ? 'text-gray-400 border-transparent hover:text-gray-200' : 'text-gray-600 border-transparent hover:text-gray-800'}`
                            }`}
                            style={activeTab === 'payouts' && colorPalette?.primary ? { color: colorPalette.primary, borderBottomColor: colorPalette.primary } : {}}
                        >
                            Commission
                        </button>
                        <button
                            onClick={() => { setActiveTab('incentives'); setCurrentPage(1); }}
                            className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-all ${
                                activeTab === 'incentives'
                                    ? `text-white border-blue-500`
                                    : `${isDarkMode ? 'text-gray-400 border-transparent hover:text-gray-200' : 'text-gray-600 border-transparent hover:text-gray-800'}`
                            }`}
                            style={activeTab === 'incentives' && colorPalette?.primary ? { color: colorPalette.primary, borderBottomColor: colorPalette.primary } : {}}
                        >
                            Incentives
                        </button>
                        <button
                            onClick={() => { setActiveTab('bonus'); setCurrentPage(1); }}
                            className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-all ${
                                activeTab === 'bonus'
                                    ? `text-white border-blue-500`
                                    : `${isDarkMode ? 'text-gray-400 border-transparent hover:text-gray-200' : 'text-gray-600 border-transparent hover:text-gray-800'}`
                            }`}
                            style={activeTab === 'bonus' && colorPalette?.primary ? { color: colorPalette.primary, borderBottomColor: colorPalette.primary } : {}}
                        >
                            Bonus
                        </button>
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

                        {isMobile && activeTab !== 'incentives' && canCreate && (
                            <button
                                onClick={handleOpenPayout}
                                className="p-2 rounded border transition-colors flex-shrink-0 text-white"
                                style={{ backgroundColor: colorPalette?.primary || '#ef4444', borderColor: colorPalette?.primary || '#ef4444' }}
                                title="Add Record"
                            >
                                <Plus size={18} />
                            </button>
                        )}

                        {isMobile && (
                            <button
                                onClick={() => setShowMobileFilters(!showMobileFilters)}
                                className={`p-2 rounded border transition-colors flex-shrink-0 ${(dateFrom || dateTo) ? 'text-red-500' : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
                                title="Date Filters"
                            >
                                <Filter size={18} />
                            </button>
                        )}

                        <button
                            onClick={funnel.open}
                            title={funnel.activeCount > 0
                                ? `Active Filters:\n${Object.keys(funnel.activeFilters).map(funnel.labelFor).join('\n')}`
                                : 'Column Filters'}
                            className={`p-2 rounded border transition-colors flex items-center flex-shrink-0 ${funnel.activeCount > 0
                                ? 'text-white border-transparent'
                                : isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                            style={funnel.activeCount > 0 ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                        >
                            <Filter size={18} />
                            {funnel.activeCount > 0 && (
                                <span className="ml-1.5 text-xs font-bold">{funnel.activeCount}</span>
                            )}
                        </button>

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
                                        {(activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : activeTab === 'incentives' ? incentiveHistoryColumns : incentivesColumns).map((column) => (
                                            <label
                                                key={column.key}
                                                className={`flex items-center px-4 py-2 cursor-pointer text-sm ${isDarkMode ? 'hover:bg-gray-700 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={(activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus).includes(column.key)}
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
                            title={isLoading ? `Loading... ${(activeTab === 'earnings' ? data.length : activeTab === 'incentives' ? incentiveHistory.length : payoutHistory.length)}/${(activeTab === 'earnings' ? totalEarnings : activeTab === 'incentives' ? totalIncentives : totalPayouts)}` : isRefreshingManual ? "Checking for updates..." : "Refresh Records"}
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
                                {(activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus)
                                    .filter(key => (activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus).includes(key))
                                    .map((colKey, index, array) => {
                                        const colDef = (activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : activeTab === 'incentives' ? incentiveHistoryColumns : incentivesColumns).find(c => c.key === colKey);
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
                                        style={(activeTab === 'earnings' ? (selectedRecord as any)?.id === row.id : (selectedRecord as any)?.id === row.id)
                                            ? { backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(59, 130, 246, 0.2)' }
                                            : {}}
                                    >
                                        {(activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus)
                                            .filter(key => (activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus).includes(key))
                                            .map((colKey, index, array) => {
                                                const colDef = (activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : activeTab === 'incentives' ? incentiveHistoryColumns : incentivesColumns).find(c => c.key === colKey);
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
                                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${(val === 'Paid' || val === 'Approved')
                                                                ? isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-100 text-green-700'
                                                                : val === 'Rejected'
                                                                    ? isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-100 text-red-700'
                                                                    : isDarkMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-100 text-amber-700'
                                                                }`}>
                                                                {val || (activeTab === 'earnings' ? '' : 'Pending')}
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
                                    <td colSpan={(activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus).length} className="px-6 py-10 text-center text-gray-500 italic">
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
                        type={activeTab}
                        isMobile={isMobile}
                        approvalPending={approvalPending}
                        onApprove={canApprove && (activeTab === 'payouts' || activeTab === 'bonus') ? (record) => handleApproval(record, 'approve') : undefined}
                        onReject={canApprove && (activeTab === 'payouts' || activeTab === 'bonus') ? (record) => handleApproval(record, 'reject') : undefined}
                        onClose={() => { setShowDetails(false); setSelectedRecord(null); }}
                        onPrevious={currentData.findIndex(r => r.id === (selectedRecord as any).id) > 0 ? handlePrevious : undefined}
                        onNext={currentData.findIndex(r => r.id === (selectedRecord as any).id) < currentData.length - 1 ? handleNext : undefined}
                    />
                </div>
            )}

            {/* Commission Payout Modal */}
            <CommissionPayoutModal
                isOpen={showPayoutModal}
                onClose={() => setShowPayoutModal(false)}
                onSuccess={() => {
                    setShowPayoutModal(false);
                    fetchData();
                }}
                agentId={payoutAgent?.id}
                agentName={payoutAgent?.team_name}
            />

            {/* Incentives Payout Modal */}
            <IncentivesPayoutModal
                isOpen={showIncentiveModal}
                onClose={() => setShowIncentiveModal(false)}
                onSuccess={() => {
                    setShowIncentiveModal(false);
                    handleRefresh();
                }}
                agentId={payoutAgent?.id}
                agentName={payoutAgent?.team_name}
            />

            {/* Bonus Payout Modal */}
            <BonusPayoutModal
                isOpen={showBonusModal}
                onClose={() => setShowBonusModal(false)}
                onSuccess={() => {
                    setShowBonusModal(false);
                    fetchData();
                }}
                agentId={payoutAgent?.id}
                agentName={payoutAgent?.team_name}
            />

            <TableFunnelFilter
                {...funnel.panelProps}
                title="Commission Filters"
                subtitle="Refine your commission results"
            />
        </div>
    );
};

export default Commission;


import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Loader2, ChevronsLeft, ChevronsRight, Clock } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { PrepaidOverrideRequest } from '../services/prepaidOverrideService';
import PrepaidOverrideDetails from '../components/PrepaidOverrideDetails';
import { usePrepaidOverrideStore } from '../store/prepaidOverrideStore';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { getUserDisplayName } from '../utils/userDisplay';
import pusher from '../services/pusherService';
import SessionExpiredModal from '../components/SessionExpiredModal';
import { usePermissions } from '../hooks/usePermissions';

const hexToRgba = (hex: string, opacity: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})`
        : hex;
};

/** Roles allowed to open this module at all. */
const VIEWER_ROLES = ['superadmin', 'administrator'];

/**
 * Roles allowed to APPROVE or REJECT.
 *
 * Narrower than VIEWER_ROLES on purpose: the whole point of the module is that the person who asks
 * for free service days is not the person who grants them. An administrator can watch the queue;
 * only a superadmin decides it — the same split the Transaction Revert module uses.
 */

const STATUS_FILTERS = ['all', 'pending', 'processed', 'rejected'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

interface PrepaidOverrideProps {
    /** Override request to open on arrival, e.g. from a notification. Empty for ordinary nav. */
    autoOpenOverrideId?: string;
}

const PrepaidOverride: React.FC<PrepaidOverrideProps> = ({ autoOpenOverrideId }) => {
    const { can } = usePermissions();
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const { overrideRequests, isLoading, error, fetchOverrideRequests, fetchUpdates } = usePrepaidOverrideStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const scrollRef = React.useRef<HTMLDivElement>(null);

    const [selected, setSelected] = useState<PrepaidOverrideRequest | null>(null);
    const [mobileView, setMobileView] = useState<'list' | 'details'>('list');
    const [hasNewData, setHasNewData] = useState<boolean>(false);

    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [userRoleName, setUserRoleName] = useState<string>('');

    const [showSessionExpired, setShowSessionExpired] = useState(false);

    useEffect(() => {
        const handleExpired = () => setShowSessionExpired(true);
        window.addEventListener('auth:session-expired', handleExpired);
        return () => window.removeEventListener('auth:session-expired', handleExpired);
    }, []);

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768 && mobileView === 'details') setMobileView('list');
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [mobileView]);

    useEffect(() => {
        const authData = localStorage.getItem('authData');
        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                setUserRoleName((parsed.role_name || '').toLowerCase());
            } catch (e) {}
        }
    }, []);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                setColorPalette(await settingsColorPaletteService.getActive());
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();
    }, []);

    useEffect(() => {
        const observer = new MutationObserver(() => setIsDarkMode(localStorage.getItem('theme') !== 'light'));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        setIsDarkMode(localStorage.getItem('theme') !== 'light');
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        fetchOverrideRequests();
    }, [fetchOverrideRequests]);

    // An approval writes to billing_accounts, which is what the 'transactions' channel already
    // announces — reusing it means a decision made elsewhere lands here without a second channel.
    useEffect(() => {
        const channel = pusher.subscribe('transactions');
        const handleDataChange = async () => {
            setHasNewData(true);
            try {
                await fetchUpdates();
            } catch (err) {
                console.error('[PrepaidOverride Page] Failed to fetch updates:', err);
            }
        };
        channel.bind('transaction-updated', handleDataChange);
        return () => {
            channel.unbind('transaction-updated', handleDataChange);
            pusher.unsubscribe('transactions');
        };
    }, [fetchUpdates]);

    useEffect(() => {
        const POLLING_INTERVAL = 5000;
        const intervalId = setInterval(async () => {
            try {
                await fetchUpdates();
            } catch (err) {
                console.error('[PrepaidOverride Page] Polling failed:', err);
            }
        }, POLLING_INTERVAL);
        return () => clearInterval(intervalId);
    }, [fetchUpdates]);

    const handleRefresh = async () => {
        setHasNewData(false);
        await fetchOverrideRequests(true);
    };

    const handleRowClick = (row: PrepaidOverrideRequest) => {
        setSelected(row);
        if (window.innerWidth < 768) setMobileView('details');
    };

    const handleMobileBack = () => {
        if (mobileView === 'details') {
            setSelected(null);
            setMobileView('list');
        }
    };

    /**
     * Open the request a notification pointed at.
     *
     * Tracked by id so it fires once: without this, closing the panel would reopen it on the next
     * render and the list could never be reached again.
     */
    const autoOpenedIdRef = React.useRef<string | null>(null);

    useEffect(() => {
        if (!autoOpenOverrideId) {
            autoOpenedIdRef.current = null;
            return;
        }
        if (autoOpenedIdRef.current === autoOpenOverrideId) return;

        const target = overrideRequests.find((r) => String(r.id) === String(autoOpenOverrideId));
        // Wait for the list rather than fetching separately, so the opened record is the same
        // object the list holds and stays in sync with refreshes.
        if (!target) return;

        autoOpenedIdRef.current = autoOpenOverrideId;
        handleRowClick(target);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpenOverrideId, overrideRequests]);

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${mm}/${dd}/${date.getFullYear()}`;
    };

    const userOrgId = useMemo(() => {
        try {
            const authData = JSON.parse(localStorage.getItem('authData') || '{}');
            return (
                authData.organization_id ||
                authData.user?.organization_id ||
                authData.organization?.id ||
                authData.user?.organization?.id ||
                null
            );
        } catch {
            return null;
        }
    }, []);

    const filtered = useMemo(() => {
        // Organization scope — mirrors TransactionsRevert exactly: an org user sees their own
        // rows, a superadmin (no org) sees the unscoped ones.
        let rows = userOrgId
            ? overrideRequests.filter((r) => r.organization_id === userOrgId)
            : overrideRequests.filter((r) => !r.organization_id);

        if (statusFilter !== 'all') {
            rows = rows.filter((r) => {
                const s = (r.status || '').toLowerCase();
                // 'approved' and 'processed' are the same decision under two names; the filter
                // treats them as one so a row can never hide from both.
                return statusFilter === 'processed' ? s === 'processed' || s === 'approved' : s === statusFilter;
            });
        }

        if (!searchQuery) return rows;

        const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
        const matches = (val: any): boolean =>
            val !== null && val !== undefined && String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);

        return rows.filter(
            (r) =>
                matches(r.account_no) ||
                matches(r.billing_account?.customer?.full_name) ||
                matches(r.reason) ||
                matches(r.remarks) ||
                matches(r.status) ||
                matches(r.days_adjustment) ||
                matches(r.requester?.email_address)
        );
    }, [overrideRequests, searchQuery, statusFilter, userOrgId]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, itemsPerPage, statusFilter]);

    const totalPages = Math.ceil(filtered.length / itemsPerPage);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
    };

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }, [currentPage]);

    const paginated = useMemo(
        () => filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
        [filtered, currentPage, itemsPerPage]
    );

    const pendingCount = useMemo(
        () => filtered.filter((r) => (r.status || '').toLowerCase() === 'pending').length,
        [filtered]
    );

    const getStatusColor = (status?: string) => {
        switch ((status || '').toLowerCase()) {
            case 'processed':
            case 'approved':
                return 'text-green-500';
            case 'pending':
                return 'text-yellow-500';
            case 'rejected':
                return 'text-red-500';
            default:
                return isDarkMode ? 'text-gray-500' : 'text-gray-400';
        }
    };

    // Approving or rejecting a request: prepaid-override.approve (SuperAdmin
    // among the seeded roles).
    const canDecide = can('prepaid-override.approve');

    const PaginationControls = () => {
        if (totalPages <= 1) return null;
        const navBtn = (disabled: boolean) =>
            `px-3 py-1 rounded text-sm transition-colors ${
                disabled
                    ? isDarkMode
                        ? 'text-gray-600 bg-gray-800 cursor-not-allowed'
                        : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                    : isDarkMode
                      ? 'text-white bg-gray-700 hover:bg-gray-600'
                      : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300'
            }`;

        return (
            <div className={`border-t p-4 flex items-center justify-between ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className={`flex items-center gap-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
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
                        </select>
                        <span>entries</span>
                    </div>
                    <span>
                        Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                        <span className="font-medium">{Math.min(currentPage * itemsPerPage, filtered.length)}</span> of{' '}
                        <span className="font-medium">{filtered.length}</span> results
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className={navBtn(currentPage === 1)} title="First Page">
                        <ChevronsLeft size={16} />
                    </button>
                    <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className={navBtn(currentPage === 1)}>
                        Previous
                    </button>
                    <span className={`px-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Page {currentPage} of {totalPages}
                    </span>
                    <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className={navBtn(currentPage === totalPages)}>
                        Next
                    </button>
                    <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} className={navBtn(currentPage === totalPages)} title="Last Page">
                        <ChevronsRight size={16} />
                    </button>
                </div>
            </div>
        );
    };

    if (userRoleName && !VIEWER_ROLES.includes(userRoleName)) {
        return (
            <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                <div className="text-center">
                    <Clock size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium">Access Restricted</p>
                    <p className="text-sm mt-2">Only Administrators and Super Admins can view Prepaid Override requests.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
            {/* List Panel */}
            <div className={`overflow-hidden flex-1 flex flex-col md:pb-0 ${mobileView === 'details' ? 'hidden md:flex' : ''}`}>
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className={`border-b flex-shrink-0 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                        <div className="px-4 py-4">
                            <div className="flex items-center justify-between mb-2">
                                <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    Prepaid Override Requests
                                </h1>
                                {pendingCount > 0 && (
                                    <span className="text-xs font-semibold px-2 py-1 rounded-full bg-yellow-500 bg-opacity-20 text-yellow-500">
                                        {pendingCount} pending
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
                                <div className="flex items-center space-x-3 flex-1 min-w-[250px]">
                                    <div className="flex-1 w-full">
                                        <GlobalSearch
                                            searchQuery={searchQuery}
                                            setSearchQuery={setSearchQuery}
                                            isDarkMode={isDarkMode}
                                            colorPalette={colorPalette}
                                            placeholder="Search override requests..."
                                        />
                                    </div>
                                    <select
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                                        className={`px-3 py-2 rounded-lg border text-sm focus:outline-none flex-shrink-0 capitalize ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                                    >
                                        {STATUS_FILTERS.map((s) => (
                                            <option key={s} value={s}>
                                                {s === 'all' ? 'All statuses' : s}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                    <button
                                        onClick={handleRefresh}
                                        disabled={isLoading}
                                        className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                                        style={{
                                            backgroundColor: '#ffffff',
                                            borderColor: colorPalette?.primary || '#7c3aed',
                                            color: colorPalette?.primary || '#7c3aed',
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isLoading && colorPalette?.primary) {
                                                e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isLoading) e.currentTarget.style.backgroundColor = '#ffffff';
                                        }}
                                        title="Refresh"
                                    >
                                        <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                                        {hasNewData && (
                                            <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                            </span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* List Items */}
                    <div className="flex-1 overflow-y-auto" ref={scrollRef}>
                        {isLoading ? (
                            <div className="flex justify-center py-20">
                                <Loader2 className={`h-8 w-8 animate-spin ${isDarkMode ? 'text-white' : 'text-gray-900'}`} />
                            </div>
                        ) : error ? (
                            <div className="text-center py-20 text-red-500">{error}</div>
                        ) : filtered.length > 0 ? (
                            <div className="space-y-0">
                                {paginated.map((row) => {
                                    const days = Number(row.days_adjustment || 0);
                                    return (
                                        <div
                                            key={row.id}
                                            onClick={() => handleRowClick(row)}
                                            className={`flex items-start px-4 py-3 cursor-pointer transition-colors border-b ${
                                                isDarkMode
                                                    ? `hover:bg-gray-800 border-b-gray-800 ${selected?.id === row.id ? 'bg-gray-800' : ''}`
                                                    : `hover:bg-gray-100 border-b-gray-200 ${selected?.id === row.id ? 'bg-gray-100' : ''}`
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0 pr-4">
                                                <div className={`font-semibold text-sm mb-0.5 truncate uppercase flex items-center justify-between ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                                                    <span className="truncate">
                                                        {row.billing_account?.customer?.full_name || row.account_no || `Request #${row.id}`}
                                                    </span>
                                                    <span className={`text-[10px] font-medium tracking-wide flex-shrink-0 ml-2 ${getStatusColor(row.status)}`}>
                                                        {(row.status || 'PENDING').toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} flex items-center`}>
                                                    <span className="font-medium text-blue-500">{row.account_no}</span>
                                                    <span className="mx-1.5 opacity-50">|</span>
                                                    <span className={`font-bold ${days > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {days > 0 ? `+${days}` : days}d
                                                    </span>
                                                    <span className="mx-1.5 opacity-50">|</span>
                                                    <span>{formatDate(row.created_at)}</span>
                                                    {row.requester?.email_address && (
                                                        <>
                                                            <span className="mx-1.5 opacity-50">|</span>
                                                            <span className="truncate">{getUserDisplayName(row.requester, row.requester.email_address)}</span>
                                                        </>
                                                    )}
                                                </div>
                                                {row.reason && (
                                                    <div className={`text-xs truncate mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                        {row.reason}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                No prepaid override requests found
                            </div>
                        )}
                    </div>
                    {!isLoading && filtered.length > 0 && <PaginationControls />}
                </div>
            </div>

            {/* Mobile details panel */}
            {selected && mobileView === 'details' && (
                <div className={`md:hidden flex-1 flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
                    <PrepaidOverrideDetails
                        overrideRequest={selected}
                        onClose={handleMobileBack}
                        onRefresh={fetchOverrideRequests}
                        isDarkMode={isDarkMode}
                        colorPalette={colorPalette}
                        canDecide={canDecide}
                        onUpdate={(updated) => setSelected(updated)}
                    />
                </div>
            )}

            {/* Desktop details panel */}
            {selected && (mobileView !== 'details' || window.innerWidth >= 768) && (
                <div className="hidden md:block flex-shrink-0 overflow-hidden">
                    <PrepaidOverrideDetails
                        overrideRequest={selected}
                        onClose={() => setSelected(null)}
                        onRefresh={fetchOverrideRequests}
                        isDarkMode={isDarkMode}
                        colorPalette={colorPalette}
                        canDecide={canDecide}
                        onUpdate={(updated) => setSelected(updated)}
                    />
                </div>
            )}

            <SessionExpiredModal
                isOpen={showSessionExpired}
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                onConfirm={() => {
                    setShowSessionExpired(false);
                    localStorage.removeItem('authData');
                    window.location.reload();
                }}
            />
        </div>
    );
};

export default PrepaidOverride;

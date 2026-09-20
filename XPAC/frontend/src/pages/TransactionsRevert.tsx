import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Loader2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { TransactionRevert } from '../services/transactionRevertService';
import TransactionsRevertDetails from '../components/TransactionsRevertDetails';
import { useTransactionRevertStore } from '../store/transactionRevertStore';
import GlobalSearch from './globalfunctions/GlobalSearch';
import pusher from '../services/pusherService';
import apiClient from '../config/api';
import SessionExpiredModal from '../components/SessionExpiredModal';

const hexToRgba = (hex: string, opacity: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

const TransactionsRevert: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const {
        revertRequests,
        isLoading,
        error,
        fetchRevertRequests,
        fetchUpdates
    } = useTransactionRevertStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const scrollRef = React.useRef<HTMLDivElement>(null);

    const [selectedRevert, setSelectedRevert] = useState<TransactionRevert | null>(null);
    const selectedRevertRef = React.useRef<TransactionRevert | null>(null);
    const [mobileView, setMobileView] = useState<'list' | 'details'>('list');
    const [viewers, setViewers] = useState<Record<string, string[]>>({});
    const [hasNewData, setHasNewData] = useState<boolean>(false);

    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);
    const [userRoleName, setUserRoleName] = useState<string>('');

    const [showSessionExpired, setShowSessionExpired] = useState(false);

    useEffect(() => {
        const handleExpired = () => {
            setShowSessionExpired(true);
        };

        window.addEventListener('auth:session-expired', handleExpired);
        
        return () => {
            window.removeEventListener('auth:session-expired', handleExpired);
        };
    }, []);

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768 && mobileView === 'details') {
                setMobileView('list');
            }
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
            } catch (e) { }
        }
    }, []);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();
    }, []);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDarkMode(localStorage.getItem('theme') !== 'light');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        setIsDarkMode(localStorage.getItem('theme') !== 'light');
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        selectedRevertRef.current = selectedRevert;
    }, [selectedRevert]);

    // Presence channel for knowing who's viewing what
    useEffect(() => {
        const presenceChannel = pusher.subscribe('presence-transaction-reverts-presence');

        presenceChannel.bind('viewing-update', (data: { revert_id: string; username: string; action: string }) => {
            setViewers(prev => {
                const username = data.username;
                const currentViewers = prev[data.revert_id] || [];
                if (data.action === 'started_viewing') {
                    if (!currentViewers.includes(username)) {
                        return { ...prev, [data.revert_id]: [...currentViewers, username] };
                    }
                } else if (data.action === 'stopped_viewing') {
                    return { ...prev, [data.revert_id]: currentViewers.filter(name => name !== username) };
                }
                return prev;
            });
        });

        presenceChannel.bind('pusher:member_removed', (member: any) => {
            const identifier = member.info?.username || member.info?.email;
            if (identifier) {
                setViewers(prev => {
                    const newState = { ...prev };
                    Object.keys(newState).forEach(id => {
                        newState[id] = (newState[id] || []).filter(e => e !== identifier);
                    });
                    return newState;
                });
            }
        });

        presenceChannel.bind('pusher:subscription_succeeded', (members: any) => {
        });

        presenceChannel.bind('pusher:member_added', (member: any) => {
            // If we are currently viewing a revert request, broadcast it so the new member knows
            if (selectedRevertRef.current) {
                broadCastViewing(String(selectedRevertRef.current.id), 'started_viewing');
            }
        });

        return () => {
            presenceChannel.unbind_all();
            pusher.unsubscribe('presence-transaction-reverts-presence');
        };
    }, []);

    useEffect(() => {
        fetchRevertRequests();
    }, [fetchRevertRequests]);

    useEffect(() => {
        const channel = pusher.subscribe('transactions');
        const handleDataChange = async () => {
            setHasNewData(true);
            try {
                await fetchUpdates();
            } catch (err) {
                console.error('[TransactionsRevert Page] Failed to fetch updates:', err);
            }
        };
        channel.bind('transaction-updated', handleDataChange);
        return () => {
            channel.unbind('transaction-updated', handleDataChange);
            pusher.unsubscribe('transactions');
        };
    }, [fetchUpdates]);

    const handleRefresh = async () => {
        setHasNewData(false);
        await fetchRevertRequests(true);
    };

    // Polling for updates every 3 seconds - Incremental fetch
    useEffect(() => {
        const POLLING_INTERVAL = 3000; // 3 seconds
        const intervalId = setInterval(async () => {
            try {
                await fetchUpdates();
            } catch (err) {
                console.error('[TransactionsRevert Page] Polling failed:', err);
            }
        }, POLLING_INTERVAL);

        return () => clearInterval(intervalId);
    }, [fetchUpdates]);

    const broadCastViewing = async (id: string, action: string) => {
        try {
            await apiClient.post('/transaction-reverts/broadcast-viewing', {
                revert_id: id,
                action: action
            });
        } catch (err) {
            console.error('[Presence] Failed to broadcast viewing:', err);
        }
    };

    const handleRowClick = (revert: TransactionRevert) => {
        // Broadcast stop viewing for previous selection if exists
        if (selectedRevert && selectedRevert.id !== revert.id) {
            broadCastViewing(String(selectedRevert.id), 'stopped_viewing');
        }
        
        // Broadcast start viewing for new selection
        if (selectedRevert?.id !== revert.id) {
            broadCastViewing(String(revert.id), 'started_viewing');
        }

        setSelectedRevert(revert);
        if (window.innerWidth < 768) {
            setMobileView('details');
        }
    };

    const handleMobileBack = () => {
        if (mobileView === 'details') {
            setSelectedRevert(null);
            setMobileView('list');
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    };

    const userOrgId = useMemo(() => {
        try {
            const authData = JSON.parse(localStorage.getItem('authData') || '{}');
            return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
        } catch {
            return null;
        }
    }, []);

    const filteredReverts = useMemo(() => {
        let filtered = revertRequests;

        // Organization filter — mirrors applicationmanagement.tsx logic exactly
        if (userOrgId) {
            filtered = filtered.filter((r: TransactionRevert) => r.organization_id === userOrgId);
        } else {
            filtered = filtered.filter((r: TransactionRevert) => !r.organization_id);
        }

        if (!searchQuery) return filtered;

        const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, '');
        return filtered.filter((r: TransactionRevert) => {
            const checkValue = (val: any): boolean => {
                if (val === null || val === undefined) return false;
                return String(val).toLowerCase().replace(/\s+/g, '').includes(normalizedQuery);
            };

            return (
                checkValue(r.transaction?.account_no) ||
                checkValue(r.transaction?.account?.customer?.full_name) ||
                checkValue(r.reason) ||
                checkValue(r.remarks) ||
                checkValue(r.status) ||
                checkValue(r.requester?.email_address)
            );
        });
    }, [revertRequests, searchQuery, userOrgId]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, itemsPerPage]);

    const totalPages = Math.ceil(filteredReverts.length / itemsPerPage);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [currentPage]);

    useEffect(() => {
        return () => {
            if (selectedRevert) {
                broadCastViewing(String(selectedRevert.id), 'stopped_viewing');
            }
        };
    }, [selectedRevert]);

    const paginatedReverts = useMemo(() => {
        return filteredReverts.slice(
            (currentPage - 1) * itemsPerPage,
            currentPage * itemsPerPage
        );
    }, [filteredReverts, currentPage, itemsPerPage]);

    const PaginationControls = () => {
        if (totalPages <= 1) return null;
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
                        Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredReverts.length)}</span> of <span className="font-medium">{filteredReverts.length}</span> results
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => handlePageChange(1)}
                        disabled={currentPage === 1}
                        className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === 1 ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed') : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}
                        title="First Page"
                    >
                        <ChevronsLeft size={16} />
                    </button>
                    <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === 1 ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed') : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}
                    >
                        Previous
                    </button>
                    <span className={`px-2 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        Page {currentPage} of {totalPages}
                    </span>
                    <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === totalPages ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed') : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}
                    >
                        Next
                    </button>
                    <button
                        onClick={() => handlePageChange(totalPages)}
                        disabled={currentPage === totalPages}
                        className={`px-2 py-1 rounded text-sm transition-colors ${currentPage === totalPages ? (isDarkMode ? 'text-gray-600 bg-gray-800 cursor-not-allowed' : 'text-gray-400 bg-gray-100 cursor-not-allowed') : (isDarkMode ? 'text-white bg-gray-700 hover:bg-gray-600' : 'text-gray-700 bg-white hover:bg-gray-50 border border-gray-300')}`}
                        title="Last Page"
                    >
                        <ChevronsRight size={16} />
                    </button>
                </div>
            </div>
        );
    };

    const getStatusColor = (status?: string) => {
        if (!status) return isDarkMode ? 'text-gray-500' : 'text-gray-400';
        switch (status.toLowerCase()) {
            case 'done': return 'text-green-500';
            case 'pending': return 'text-yellow-500';
            case 'rejected': return 'text-red-500';
            default: return isDarkMode ? 'text-gray-500' : 'text-gray-400';
        }
    };

    // Admin/Superadmin guard
    if (userRoleName && userRoleName !== 'superadmin' && userRoleName !== 'administrator') {
        return (
            <div className={`h-full flex items-center justify-center ${isDarkMode ? 'bg-gray-950 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                <div className="text-center">
                    <RefreshCw size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium">Access Restricted</p>
                    <p className="text-sm mt-2">Only Administrators and Super Admins can view Transaction Revert Requests.</p>
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
                                    Transaction Revert Requests
                                </h1>
                            </div>
                            <div className="flex items-center justify-between space-x-3 overflow-x-auto scrollbar-none pb-1 -mb-1 w-full">
                                <div className="flex items-center space-x-3 flex-1 min-w-[250px]">
                                    <div className="flex-1 w-full">
                                        <GlobalSearch 
                                            searchQuery={searchQuery}
                                            setSearchQuery={setSearchQuery}
                                            isDarkMode={isDarkMode}
                                            colorPalette={colorPalette}
                                            placeholder="Search revert requests..."
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                    <button
                                        onClick={handleRefresh}
                                        disabled={isLoading}
                                        className="relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center shadow-sm disabled:opacity-50 border"
                                        style={{
                                            backgroundColor: '#ffffff',
                                            borderColor: colorPalette?.primary || '#7c3aed',
                                            color: colorPalette?.primary || '#7c3aed'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isLoading && colorPalette?.primary) {
                                                e.currentTarget.style.backgroundColor = hexToRgba(colorPalette.primary, 0.1);
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isLoading) {
                                                e.currentTarget.style.backgroundColor = '#ffffff';
                                            }
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
                        ) : filteredReverts.length > 0 ? (
                            <div className="space-y-0">
                                {paginatedReverts.map((revert: TransactionRevert) => (
                                    <div
                                        key={revert.id}
                                        onClick={() => handleRowClick(revert)}
                                        className={`flex items-start px-4 py-3 cursor-pointer transition-colors border-b ${isDarkMode
                                            ? `hover:bg-gray-800 border-b-gray-800 ${selectedRevert?.id === revert.id ? 'bg-gray-800' : ''}`
                                            : `hover:bg-gray-100 border-b-gray-200 ${selectedRevert?.id === revert.id ? 'bg-gray-100' : ''}`
                                            }`}
                                    >
                                        <div className="flex-1 min-w-0 pr-4">
                                            <div className={`font-semibold text-sm mb-0.5 truncate uppercase flex items-center justify-between ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>
                                                <div className="flex items-center min-w-0">
                                                    <span className="truncate">
                                                        {revert.transaction?.account?.customer?.full_name || revert.transaction?.account_no || `Request #${revert.id}`}
                                                    </span>
                                                    {viewers[String(revert.id)] && viewers[String(revert.id)].length > 0 && (
                                                        <div className="flex flex-wrap gap-1 ml-2 flex-shrink-0">
                                                            {viewers[String(revert.id)].map((username: string) => (
                                                                <span 
                                                                    key={username} 
                                                                    className="text-[8px] px-1.5 py-0.5 rounded-full font-bold animate-pulse lowercase shadow-sm"
                                                                    style={{
                                                                        backgroundColor: colorPalette?.primary || '#f97316',
                                                                        color: '#ffffff'
                                                                    }}
                                                                >
                                                                    {username} is viewing
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className={`text-[10px] font-medium tracking-wide flex-shrink-0 ml-2 capitalize ${getStatusColor(revert.status)}`}>
                                                    {(revert.status || 'PENDING').toUpperCase()}
                                                </span>
                                            </div>
                                            <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} flex items-center`}>
                                                {revert.transaction?.account_no && (
                                                    <>
                                                        <span className="font-medium text-blue-500">{revert.transaction.account_no}</span>
                                                        <span className="mx-1.5 opacity-50">|</span>
                                                    </>
                                                )}
                                                <span>{formatDate(revert.created_at)}</span>
                                                {revert.requester?.email_address && (
                                                    <>
                                                        <span className="mx-1.5 opacity-50">|</span>
                                                        <span className="truncate">{revert.requester.email_address}</span>
                                                    </>
                                                )}
                                            </div>
                                            {revert.reason && (
                                                <div className={`text-xs truncate mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                    {revert.reason}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                No revert requests found
                            </div>
                        )}
                    </div>
                    {!isLoading && filteredReverts.length > 0 && <PaginationControls />}
                </div>
            </div>

            {/* Mobile details panel */}
            {selectedRevert && mobileView === 'details' && (
                <div className={`md:hidden flex-1 flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
                    <TransactionsRevertDetails
                        revert={selectedRevert}
                        onClose={handleMobileBack}
                        onRefresh={fetchRevertRequests}
                        isDarkMode={isDarkMode}
                        colorPalette={colorPalette}
                        onUpdate={(updated: TransactionRevert) => setSelectedRevert(updated)}
                    />
                </div>
            )}

            {/* Desktop details panel */}
            {selectedRevert && (mobileView !== 'details' || window.innerWidth >= 768) && (
                <div className="hidden md:block flex-shrink-0 overflow-hidden">
                    <TransactionsRevertDetails
                        revert={selectedRevert}
                        onClose={() => setSelectedRevert(null)}
                        onRefresh={fetchRevertRequests}
                        isDarkMode={isDarkMode}
                        colorPalette={colorPalette}
                        onUpdate={(updated: TransactionRevert) => setSelectedRevert(updated)}
                    />
                </div>
            )}

            <SessionExpiredModal 
                isOpen={showSessionExpired} 
                isDarkMode={isDarkMode}
                colorPalette={colorPalette}
                onConfirm={() => {
                    setShowSessionExpired(false);
                    // Only clear auth data and reload to redirect to log in
                    localStorage.removeItem('authData');
                    window.location.reload();
                }} 
            />
        </div>
    );
};

export default TransactionsRevert;

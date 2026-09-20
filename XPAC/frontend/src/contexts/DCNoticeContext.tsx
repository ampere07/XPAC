import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { dcNoticeService, DCNotice } from '../services/dcNoticeService';
import { usePermissions } from '../hooks/usePermissions';

interface DCNoticeContextType {
    dcNoticeRecords: DCNotice[];
    isLoading: boolean;
    error: string | null;
    refreshDCNoticeRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
    isFullyLoaded: boolean;
}

const DCNoticeContext = createContext<DCNoticeContextType | undefined>(undefined);

export const useDCNoticeContext = () => {
    const context = useContext(DCNoticeContext);
    if (!context) {
        throw new Error('useDCNoticeContext must be used within a DCNoticeProvider');
    }
    return context;
};

interface DCNoticeProviderProps {
    children: ReactNode;
}

export const DCNoticeProvider: React.FC<DCNoticeProviderProps> = ({ children }) => {
    const { can } = usePermissions();

    // This provider wraps the whole app shell in Dashboard.tsx, so it mounts for
    // every role — including a customer, who has no DC Notice page to open and
    // whose request comes back 403. Ask before fetching rather than fetching and
    // swallowing the failure: the call pulls the entire table, and a role that
    // cannot open the page has no use for a row of it.
    const canRead = can('dc-notice');

    const [dcNoticeRecords, setDCNoticeRecords] = useState<DCNotice[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isFullyLoaded, setIsFullyLoaded] = useState<boolean>(false);

    const fetchDCNoticeRecords = useCallback(async (force = false, silent = false) => {
        if (!canRead) {
            return;
        }

        // If we have data and not forced, skip fetching
        if (!force && dcNoticeRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // Silent refresh (polling/background): Skip fast mode, fetch full data directly
            // to avoid flickering where account_no/full_name disappear then reappear
            if (silent && dcNoticeRecords.length > 0) {
                const fullResponse = await dcNoticeService.getAll(false, 1, 0);

                if (fullResponse.success) {
                    let fullRecords = fullResponse.data || [];
                    fullRecords.sort((a, b) => b.id - a.id);
                    setDCNoticeRecords(fullRecords);
                    setLastUpdated(new Date());
                    setError(null);
                }
                return;
            }

            // Initial load: Two-phase approach for fast first paint
            // PHASE 1: Fast load - Get basic data INSTANTLY
            const fastResponse = await dcNoticeService.getAll(true, 1, 0);

            if (fastResponse.success) {
                let records = fastResponse.data || [];
                records.sort((a, b) => b.id - a.id);

                setDCNoticeRecords(records);
                setLastUpdated(new Date());
                setError(null);

                // PHASE 2: Load full data in background
                setTimeout(async () => {
                    try {
                        const fullResponse = await dcNoticeService.getAll(false, 1, 0);

                        if (fullResponse.success) {
                            let fullRecords = fullResponse.data || [];
                            fullRecords.sort((a, b) => b.id - a.id);
                            setDCNoticeRecords(fullRecords);
                            setLastUpdated(new Date());
                            setIsFullyLoaded(true);
                        }
                    } catch (bgError) {
                        // Silent fail for background load
                    }
                }, 100);
            } else {
                setError('Failed to load DC Notice records');
                if (dcNoticeRecords.length === 0) {
                    setDCNoticeRecords([]);
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch DC Notice records:', err);
            if (!silent) {
                setError('Failed to load DC Notice records. Please try again.');
                if (dcNoticeRecords.length === 0) {
                    setDCNoticeRecords([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [dcNoticeRecords.length, canRead]);

    const refreshDCNoticeRecords = useCallback(async () => {
        await fetchDCNoticeRecords(true, false);
    }, [fetchDCNoticeRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchDCNoticeRecords(true, true);
    }, [fetchDCNoticeRecords]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (dcNoticeRecords.length === 0) {
            fetchDCNoticeRecords(false, false);
        }
    }, [fetchDCNoticeRecords, dcNoticeRecords.length]);

    return (
        <DCNoticeContext.Provider
            value={{
                dcNoticeRecords,
                isLoading,
                error,
                refreshDCNoticeRecords,
                silentRefresh,
                lastUpdated,
                isFullyLoaded
            }}
        >
            {children}
        </DCNoticeContext.Provider>
    );
};

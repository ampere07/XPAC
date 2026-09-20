import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { dcNoticeService, DCNotice } from '../services/dcNoticeService';

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
    const [dcNoticeRecords, setDCNoticeRecords] = useState<DCNotice[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isFullyLoaded, setIsFullyLoaded] = useState<boolean>(false);

    const fetchDCNoticeRecords = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && dcNoticeRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // PHASE 1: Fast load - Get basic data INSTANTLY (Fetch all records with high limit)
            const fastResponse = await dcNoticeService.getAll(true, 1, 10000);

            if (fastResponse.success) {
                let records = fastResponse.data || [];
                // Sort by ID descending by default if not sorted from backend
                records.sort((a, b) => b.id - a.id);

                setDCNoticeRecords(records);
                setLastUpdated(new Date());
                setError(null);

                // PHASE 2: Load full data in background
                setTimeout(async () => {
                    try {
                        const fullResponse = await dcNoticeService.getAll(false, 1, 10000);

                        if (fullResponse.success) {
                            let fullRecords = fullResponse.data || [];
                            fullRecords.sort((a, b) => b.id - a.id);
                            setDCNoticeRecords(fullRecords);
                            setLastUpdated(new Date());
                            setIsFullyLoaded(true);
                        }
                    } catch (bgError) {
                        console.warn('Background full data load failed:', bgError);
                    }
                }, 100);
            } else {
                setError('Failed to load DC Notice records');
                // Don't clear data on error if we have it
                if (dcNoticeRecords.length === 0) {
                    setDCNoticeRecords([]);
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch DC Notice records:', err);
            if (!silent) {
                setError('Failed to load DC Notice records. Please try again.');
                // Don't clear data on error if we have it
                if (dcNoticeRecords.length === 0) {
                    setDCNoticeRecords([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [dcNoticeRecords.length]);

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

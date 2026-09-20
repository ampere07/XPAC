import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { overdueService, Overdue } from '../services/overdueService';

interface OverdueContextType {
    overdueRecords: Overdue[];
    isLoading: boolean;
    error: string | null;
    refreshOverdueRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const OverdueContext = createContext<OverdueContextType | undefined>(undefined);

export const useOverdueContext = () => {
    const context = useContext(OverdueContext);
    if (!context) {
        throw new Error('useOverdueContext must be used within an OverdueProvider');
    }
    return context;
};

interface OverdueProviderProps {
    children: ReactNode;
}

export const OverdueProvider: React.FC<OverdueProviderProps> = ({ children }) => {
    const [overdueRecords, setOverdueRecords] = useState<Overdue[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchOverdueRecords = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && overdueRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // PHASE 1: Fast load - Get basic data INSTANTLY (Fetch all records with high limit)
            const fastResponse = await overdueService.getAll(true, 1, 10000);

            if (fastResponse.success) {
                let records = fastResponse.data || [];
                // Sort by ID descending by default if not sorted from backend
                records.sort((a, b) => b.id - a.id);

                setOverdueRecords(records);
                setLastUpdated(new Date());
                setError(null);

                // PHASE 2: Load full data in background
                setTimeout(async () => {
                    try {
                        const fullResponse = await overdueService.getAll(false, 1, 10000);

                        if (fullResponse.success) {
                            let fullRecords = fullResponse.data || [];
                            fullRecords.sort((a, b) => b.id - a.id);
                            setOverdueRecords(fullRecords);
                            setLastUpdated(new Date());
                        }
                    } catch (bgError) {
                        console.warn('Background full data load failed:', bgError);
                    }
                }, 100);
            } else {
                setError('Failed to load Overdue records');
                // Don't clear data on error if we have it
                if (overdueRecords.length === 0) {
                    setOverdueRecords([]);
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch Overdue records:', err);
            if (!silent) {
                setError('Failed to load Overdue records. Please try again.');
                // Don't clear data on error if we have it
                if (overdueRecords.length === 0) {
                    setOverdueRecords([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [overdueRecords.length]);

    const refreshOverdueRecords = useCallback(async () => {
        await fetchOverdueRecords(true, false);
    }, [fetchOverdueRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchOverdueRecords(true, true);
    }, [fetchOverdueRecords]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (overdueRecords.length === 0) {
            fetchOverdueRecords(false, false);
        }
    }, [fetchOverdueRecords, overdueRecords.length]);

    return (
        <OverdueContext.Provider
            value={{
                overdueRecords,
                isLoading,
                error,
                refreshOverdueRecords,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </OverdueContext.Provider>
    );
};

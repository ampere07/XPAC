import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getBillingRecords, BillingRecord } from '../services/billingService';

interface BillingContextType {
    billingRecords: BillingRecord[];
    isLoading: boolean;
    error: string | null;
    refreshBillingRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const BillingContext = createContext<BillingContextType | undefined>(undefined);

export const BillingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [billingRecords, setBillingRecords] = useState<BillingRecord[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchBillingRecords = useCallback(async (force = false, silent = false) => {
        // If we have data and it's less than 5 minutes old, don't auto-fetch unless forced
        // actually, user wants "if theres a new data it will just input the new data",
        // so we should probably fetch effectively in background but not show loading state if we have data.

        if (!force && billingRecords.length > 0) {
            // Do nothing if not forced and we have data
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            const data = await getBillingRecords();
            setBillingRecords(data.data);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            console.error('Failed to fetch billing records:', err);
            if (!silent) {
                setError('Failed to load billing records. Please try again.');
                // Don't clear data on error if we have it
                if (billingRecords.length === 0) {
                    setBillingRecords([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [billingRecords.length]);

    // Initial fetch?
    // We can let the consumer trigger the initial fetch, or do it here.
    // It's better to let the consumer (Customer page) trigger it so we don't fetch if user never visits that page.

    const refreshBillingRecords = useCallback(async () => {
        await fetchBillingRecords(true, false);
    }, [fetchBillingRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchBillingRecords(true, true);
    }, [fetchBillingRecords]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (billingRecords.length === 0) {
            fetchBillingRecords(false, false);
        }
    }, [fetchBillingRecords, billingRecords.length]);

    return (
        <BillingContext.Provider value={{
            billingRecords,
            isLoading,
            error,
            refreshBillingRecords,
            silentRefresh,
            lastUpdated
        }}>
            {children}
        </BillingContext.Provider>
    );
};

export const useBillingContext = () => {
    const context = useContext(BillingContext);
    if (context === undefined) {
        throw new Error('useBillingContext must be used within a BillingProvider');
    }
    return context;
};

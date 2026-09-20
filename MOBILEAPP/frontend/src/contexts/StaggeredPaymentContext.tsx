import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { staggeredInstallationService } from '../services/staggeredInstallationService';

interface StaggeredInstallation {
    id: string;
    account_no: string;
    staggered_install_no: string;
    staggered_date: string;
    staggered_balance: number;
    months_to_pay: number;
    monthly_payment: number;
    modified_by: string;
    modified_date: string;
    user_email: string;
    remarks: string;
    status: string;
    month1: string | null;
    month2: string | null;
    month3: string | null;
    month4: string | null;
    month5: string | null;
    month6: string | null;
    month7: string | null;
    month8: string | null;
    month9: string | null;
    month10: string | null;
    month11: string | null;
    month12: string | null;
    created_at: string;
    updated_at: string;
    billing_account?: {
        id: number;
        account_no: string;
        customer: {
            full_name: string;
            contact_number_primary: string;
            barangay: string;
            city: string;
            desired_plan: string;
            address: string;
            region: string;
        };
        account_balance: number;
    };
}

interface StaggeredPaymentContextType {
    staggeredRecords: StaggeredInstallation[];
    isLoading: boolean;
    error: string | null;
    refreshStaggeredRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
    isFullyLoaded: boolean;
}

const StaggeredPaymentContext = createContext<StaggeredPaymentContextType | undefined>(undefined);

export const useStaggeredPaymentContext = () => {
    const context = useContext(StaggeredPaymentContext);
    if (!context) {
        throw new Error('useStaggeredPaymentContext must be used within a StaggeredPaymentProvider');
    }
    return context;
};

interface StaggeredPaymentProviderProps {
    children: ReactNode;
}

export const StaggeredPaymentProvider: React.FC<StaggeredPaymentProviderProps> = ({ children }) => {
    const [staggeredRecords, setStaggeredRecords] = useState<StaggeredInstallation[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isFullyLoaded, setIsFullyLoaded] = useState<boolean>(false);

    const fetchStaggeredRecords = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && staggeredRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            console.log('Fetching staggered installations from API...');
            const result = await staggeredInstallationService.getAll();

            if (result.success && result.data) {
                setStaggeredRecords(result.data);
                setLastUpdated(new Date());
                setIsFullyLoaded(true);
                setError(null);
                console.log('Staggered installations loaded:', result.data.length);
            } else {
                throw new Error(result.message || 'Failed to fetch staggered installations');
            }
        } catch (err: any) {
            console.error('Failed to fetch staggered installations:', err);
            if (!silent) {
                setError(`Failed to load staggered installations: ${err.message || 'Unknown error'}`);
                // Don't clear data on error if we have it
                if (staggeredRecords.length === 0) {
                    setStaggeredRecords([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [staggeredRecords.length]);

    const refreshStaggeredRecords = useCallback(async () => {
        await fetchStaggeredRecords(true, false);
    }, [fetchStaggeredRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchStaggeredRecords(true, true);
    }, [fetchStaggeredRecords]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (staggeredRecords.length === 0) {
            fetchStaggeredRecords(false, false);
        }
    }, [fetchStaggeredRecords, staggeredRecords.length]);

    return (
        <StaggeredPaymentContext.Provider
            value={{
                staggeredRecords,
                isLoading,
                error,
                refreshStaggeredRecords,
                silentRefresh,
                lastUpdated,
                isFullyLoaded
            }}
        >
            {children}
        </StaggeredPaymentContext.Provider>
    );
};

export type { StaggeredInstallation };

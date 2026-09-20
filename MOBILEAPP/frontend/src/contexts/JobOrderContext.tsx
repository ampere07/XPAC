import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJobOrders } from '../services/jobOrderService';
import { usePermissions } from '../hooks/usePermissions';
import { JobOrder } from '../types/jobOrder';

interface JobOrderContextType {
    jobOrders: JobOrder[];
    isLoading: boolean;
    error: string | null;
    refreshJobOrders: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const JobOrderContext = createContext<JobOrderContextType | undefined>(undefined);

export const useJobOrderContext = () => {
    const context = useContext(JobOrderContext);
    if (!context) {
        throw new Error('useJobOrderContext must be used within a JobOrderProvider');
    }
    return context;
};

interface JobOrderProviderProps {
    children: ReactNode;
}

export const JobOrderProvider: React.FC<JobOrderProviderProps> = ({ children }) => {
    // This provider wraps the whole dashboard, so it mounts for every role. /job-orders is
    // a staff collection — a customer session used to fetch it on mount and take a 403.
    const { can, ready: permissionsReady } = usePermissions();
    const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchJobOrders = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && jobOrders.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // Get user role and email for filtering
            const authData = await AsyncStorage.getItem('authData');
            let assignedEmail: string | undefined;

            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    const isTechnician = userData.role_id === 2 || (userData.role && userData.role.toLowerCase() === 'technician');
                    if (isTechnician && userData.email) {
                        assignedEmail = userData.email;
                    }
                } catch (err) {
                    console.error('Error parsing auth data:', err);
                }
            }

            // Fetch job orders
            // fastMode=false, page=1, limit=1000 (fetch all for client filtering), search=undefined, assignedEmail
            const response = await getJobOrders(false, 1, 1000, undefined, assignedEmail);

            if (!response.success) {
                throw new Error(response.message || 'Failed to fetch job orders');
            }

            if (response.success && Array.isArray(response.jobOrders)) {
                setJobOrders(response.jobOrders);
                setLastUpdated(new Date());
                setError(null);
            } else {
                setJobOrders([]);
                setError(null);
            }
        } catch (err: any) {
            console.error('Failed to fetch job orders:', err);
            if (!silent) {
                setError(err.message || 'Failed to load job orders. Please try again.');
                // Don't clear data on error if we have it
                if (jobOrders.length === 0) {
                    setJobOrders([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [jobOrders.length]);

    const refreshJobOrders = useCallback(async () => {
        await fetchJobOrders(true, false);
    }, [fetchJobOrders]);

    const silentRefresh = useCallback(async () => {
        await fetchJobOrders(true, true);
    }, [fetchJobOrders]);

    // Initial fetch effect
    useEffect(() => {
        // Wait for the keys to load, then only fetch for a user who may read job orders.
        if (!permissionsReady || !can('job-order')) return;

        // Only fetch if empty, otherwise let the logic decide
        if (jobOrders.length === 0) {
            fetchJobOrders(false, false);
        }
    }, [fetchJobOrders, jobOrders.length, permissionsReady, can]);

    return (
        <JobOrderContext.Provider
            value={{
                jobOrders,
                isLoading,
                error,
                refreshJobOrders,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </JobOrderContext.Provider>
    );
};

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { getWorkOrders } from '../services/workOrderService';
import { WorkOrder } from '../types/workOrder';

interface WorkOrderContextType {
    workOrders: WorkOrder[];
    isLoading: boolean;
    error: string | null;
    refreshWorkOrders: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const WorkOrderContext = createContext<WorkOrderContextType | undefined>(undefined);

export const useWorkOrderContext = () => {
    const context = useContext(WorkOrderContext);
    if (!context) {
        throw new Error('useWorkOrderContext must be used within a WorkOrderProvider');
    }
    return context;
};

interface WorkOrderProviderProps {
    children: ReactNode;
}

export const WorkOrderProvider: React.FC<WorkOrderProviderProps> = ({ children }) => {
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchWorkOrders = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && workOrders.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // Get user role and email for filtering
            const authData = localStorage.getItem('authData');
            let assignedEmail: string | undefined;

            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    if (userData.role && userData.role.toLowerCase() === 'technician' && userData.email) {
                        assignedEmail = userData.email;
                    }
                } catch (err) {
                    console.error('Error parsing auth data:', err);
                }
            }

            // Fetch work orders
            const response = await getWorkOrders(false, 1, 10000, '', assignedEmail);

            if (!response.success) {
                throw new Error(response.message || 'Failed to fetch work orders');
            }

            if (response.success && Array.isArray(response.workOrders)) {
                setWorkOrders(response.workOrders);
                setLastUpdated(new Date());
                setError(null);
            } else {
                setWorkOrders([]);
                setError(null);
            }
        } catch (err: any) {
            console.error('Failed to fetch work orders:', err);
            if (!silent) {
                setError(err.message || 'Failed to load work orders. Please try again.');
                // Don't clear data on error if we have it
                if (workOrders.length === 0) {
                    setWorkOrders([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [workOrders.length]);

    const refreshWorkOrders = useCallback(async () => {
        await fetchWorkOrders(true, false);
    }, [fetchWorkOrders]);

    const silentRefresh = useCallback(async () => {
        await fetchWorkOrders(true, true);
    }, [fetchWorkOrders]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (workOrders.length === 0) {
            fetchWorkOrders(false, false);
        }
    }, [fetchWorkOrders, workOrders.length]);

    return (
        <WorkOrderContext.Provider
            value={{
                workOrders,
                isLoading,
                error,
                refreshWorkOrders,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </WorkOrderContext.Provider>
    );
};

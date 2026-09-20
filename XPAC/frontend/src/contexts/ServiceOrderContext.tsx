import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { getServiceOrders, ServiceOrderData } from '../services/serviceOrderService';

interface ServiceOrder {
    id: string;
    ticketId: string;
    timestamp: string;
    accountNumber: string;
    fullName: string;
    contactAddress: string;
    dateInstalled: string;
    contactNumber: string;
    fullAddress: string;
    houseFrontPicture: string;
    emailAddress: string;
    plan: string;
    provider: string;
    affiliate: string;
    username: string;
    connectionType: string;
    routerModemSN: string;
    lcp: string;
    nap: string;
    port: string;
    vlan: string;
    concern: string;
    concernRemarks: string;
    visitStatus: string;
    visitBy: string;
    visitWith: string;
    visitWithOther: string;
    visitRemarks: string;
    modifiedBy: string;
    modifiedDate: string;
    userEmail: string;
    requestedBy: string;
    assignedEmail: string;
    supportRemarks: string;
    serviceCharge: string;
    repairCategory?: string;
    supportStatus?: string;
    priorityLevel?: string;
    newRouterSn?: string;
    newLcpnap?: string;
    newPlan?: string;
    clientSignatureUrl?: string;
    image1Url?: string;
    image2Url?: string;
    image3Url?: string;
    rawUpdatedAt?: string;
}

interface ServiceOrderContextType {
    serviceOrders: ServiceOrder[];
    isLoading: boolean;
    error: string | null;
    refreshServiceOrders: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    fetchNextPage: () => Promise<void>;
    setSearchQuery: (query: string) => void;
    searchQuery: string;
    hasMore: boolean;
    currentPage: number;
    lastUpdated: Date | null;
}

const ServiceOrderContext = createContext<ServiceOrderContextType | undefined>(undefined);

export const useServiceOrderContext = () => {
    const context = useContext(ServiceOrderContext);
    if (!context) {
        throw new Error('useServiceOrderContext must be used within a ServiceOrderProvider');
    }
    return context;
};

interface ServiceOrderProviderProps {
    children: ReactNode;
}

const transformServiceOrder = (order: ServiceOrderData): ServiceOrder => {
    return {
        id: order.id || '',
        ticketId: order.ticket_id || order.id || '',
        timestamp: order.timestamp || '',
        accountNumber: order.account_no || '',
        fullName: order.full_name || '',
        contactAddress: order.contact_address || '',
        dateInstalled: order.date_installed || '',
        contactNumber: order.contact_number || '',
        fullAddress: order.full_address || '',
        houseFrontPicture: order.house_front_picture_url || '',
        emailAddress: order.email_address || '',
        plan: order.plan || '',
        provider: '',
        affiliate: order.group_name || '',
        username: order.username || '',
        connectionType: order.connection_type || '',
        routerModemSN: order.router_modem_sn || '',
        lcp: order.lcp || '',
        nap: order.nap || '',
        port: order.port || '',
        vlan: order.vlan || '',
        concern: order.concern || '',
        concernRemarks: order.concern_remarks || '',
        visitStatus: order.visit_status || '',
        visitBy: order.visit_by_user || '',
        visitWith: order.visit_with || '',
        visitWithOther: '',
        visitRemarks: order.visit_remarks || '',
        modifiedBy: order.updated_by_user || '',
        modifiedDate: order.updated_at || '',
        userEmail: order.assigned_email || '',
        requestedBy: order.requested_by || '',
        assignedEmail: order.assigned_email || '',
        supportRemarks: order.support_remarks || '',
        serviceCharge: order.service_charge ? String(order.service_charge) : '0',
        repairCategory: order.repair_category || '',
        supportStatus: order.support_status || '',
        priorityLevel: order.priority_level || '',
        newRouterSn: order.new_router_sn || '',
        newLcpnap: order.new_lcpnap || '',
        newPlan: order.new_plan || '',
        clientSignatureUrl: order.client_signature_url || '',
        image1Url: order.image1_url || '',
        image2Url: order.image2_url || '',
        image3Url: order.image3_url || '',
        rawUpdatedAt: order.updated_at || ''
    };
};

export const ServiceOrderProvider: React.FC<ServiceOrderProviderProps> = ({ children }) => {
    const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [hasMore, setHasMore] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [isFetchingNextPage, setIsFetchingNextPage] = useState<boolean>(false);

    const fetchServiceOrders = useCallback(async (page = 1, force = false, silent = false, query = searchQuery) => {
        // If we have data and not forced and it's first page, skip fetching
        if (page === 1 && !force && serviceOrders.length > 0 && query === searchQuery) {
            return;
        }

        if (page === 1 && !silent) {
            setIsLoading(true);
        } else if (page > 1) {
            setIsFetchingNextPage(true);
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

            // Fetch service orders with pagination
            const response = (await getServiceOrders(assignedEmail, page, 50, query)) as any;

            if (!response.success) {
                throw new Error(response.message || 'Failed to fetch service orders');
            }

            if (response.success && Array.isArray(response.data)) {
                const orders = response.data.map(transformServiceOrder);

                if (page === 1) {
                    setServiceOrders(orders);
                } else {
                    setServiceOrders(prev => [...prev, ...orders]);
                }

                if (response.pagination) {
                    setHasMore(response.pagination.has_more);
                    setCurrentPage(response.pagination.current_page);
                } else {
                    // Fallback for older API versions if any
                    setHasMore(false);
                }

                setLastUpdated(new Date());
                setError(null);
            } else {
                if (page === 1) {
                    setServiceOrders([]);
                }
                setHasMore(false);
                setError(null);
            }
        } catch (err: any) {
            console.error('Failed to fetch service orders:', err);
            if (!silent) {
                setError(err.message || 'Failed to load service orders. Please try again.');
            }
        } finally {
            setIsLoading(false);
            setIsFetchingNextPage(false);
        }
    }, [serviceOrders.length, searchQuery]);

    const refreshServiceOrders = useCallback(async () => {
        setCurrentPage(1);
        await fetchServiceOrders(1, true, false);
    }, [fetchServiceOrders]);

    const silentRefresh = useCallback(async () => {
        await fetchServiceOrders(1, true, true);
    }, [fetchServiceOrders]);

    const fetchNextPage = useCallback(async () => {
        if (!hasMore || isLoading || isFetchingNextPage) return;
        await fetchServiceOrders(currentPage + 1, true, false);
    }, [currentPage, hasMore, isLoading, isFetchingNextPage, fetchServiceOrders]);

    const handleSearch = useCallback((query: string) => {
        setSearchQuery(query);
        setCurrentPage(1);
        fetchServiceOrders(1, true, false, query);
    }, [fetchServiceOrders]);

    // Initial fetch effect
    useEffect(() => {
        if (serviceOrders.length === 0) {
            fetchServiceOrders(1, false, false);
        }
    }, [fetchServiceOrders, serviceOrders.length]);

    return (
        <ServiceOrderContext.Provider
            value={{
                serviceOrders,
                isLoading: isLoading || isFetchingNextPage,
                error,
                refreshServiceOrders,
                silentRefresh,
                fetchNextPage,
                setSearchQuery: handleSearch,
                searchQuery,
                hasMore,
                currentPage,
                lastUpdated
            }}
        >
            {children}
        </ServiceOrderContext.Provider>
    );
};

export type { ServiceOrder };

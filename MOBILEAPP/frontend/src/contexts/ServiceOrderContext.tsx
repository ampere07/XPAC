import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServiceOrders, ServiceOrderData } from '../services/serviceOrderService';
import { usePermissions } from '../hooks/usePermissions';

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
    newLcp?: string;
    newNap?: string;
    newPort?: string;
    newVlan?: string;
    routerModel?: string;
    proofImageUrl?: string;
    clientSignatureUrl?: string;
    image1Url?: string;
    image2Url?: string;
    image3Url?: string;
    rawUpdatedAt?: string;
    region?: string;
    city?: string;
    barangay?: string;
    referredBy?: string;
    start_time?: string | null;
    end_time?: string | null;
    setupImageUrl?: string;
    routerReadingImageUrl?: string;
    boxReadingImageUrl?: string;
    speedtestImageUrl?: string;
    // Whether an administrator released this service order to the technician
    // ahead of their queue. Locked (false) until they do.
    technicianEnabled?: boolean;
}

interface ServiceOrderContextType {
    serviceOrders: ServiceOrder[];
    isLoading: boolean;
    isRefreshing: boolean;
    isFetchingNextPage: boolean;
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
        newLcp: order.new_lcp || '',
        newNap: order.new_nap || '',
        newPort: order.new_port || '',
        newVlan: order.new_vlan || '',
        routerModel: order.router_model || '',
        proofImageUrl: order.proof_image_url || '',
        clientSignatureUrl: order.client_signature_url || '',
        image1Url: order.image1_url || '',
        image2Url: order.image2_url || '',
        image3Url: order.image3_url || '',
        rawUpdatedAt: order.updated_at || '',
        region: order.region || '',
        city: order.city || '',
        barangay: order.barangay || '',
        referredBy: order.referred_by || '',
        start_time: order.start_time || null,
        end_time: order.end_time || null,
        setupImageUrl: order.setup_image_url || '',
        routerReadingImageUrl: order.router_reading_image_url || '',
        boxReadingImageUrl: order.box_reading_image_url || '',
        speedtestImageUrl: order.speedtest_image_url || '',
        // Read straight off the column so the technician lock always reflects
        // the database. MySQL hands tinyint back as 1/0 or "1"/"0".
        technicianEnabled: (order as any).technician_enabled === true
            || (order as any).technician_enabled === 1
            || (order as any).technician_enabled === '1'
    };
};

export const ServiceOrderProvider: React.FC<ServiceOrderProviderProps> = ({ children }) => {
    // Mounted for every role by Dashboard, but /service-orders is a staff collection.
    // A customer session used to fetch it on mount and take a 403.
    const { can, ready: permissionsReady } = usePermissions();
    const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([]);
    const ordersRef = React.useRef<ServiceOrder[]>([]);
    const fetchingRef = React.useRef<boolean>(false);
    const queryRef = React.useRef<string>('');
    const paginationRef = React.useRef<{ page: number, hasMore: boolean }>({ page: 1, hasMore: true });

    // Sync ref with state
    useEffect(() => {
        ordersRef.current = serviceOrders;
    }, [serviceOrders]);

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [isFetchingNextPage, setIsFetchingNextPage] = useState<boolean>(false);

    const fetchServiceOrders = useCallback(async (page = 1, force = false, silent = false, query = queryRef.current) => {
        // Strict guard against overlapping requests
        if (fetchingRef.current && !force) return;
        
        // If we have data and not forced and it's first page, skip fetching
        if (page === 1 && !force && ordersRef.current.length > 0 && query === queryRef.current) {
            return;
        }

        fetchingRef.current = true;
        if (page === 1 && !silent) {
            setIsLoading(true);
        } else if (page > 1) {
            setIsFetchingNextPage(true);
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
                } catch (err) { }
            }

            // Fetch service orders with pagination
            const response = (await getServiceOrders(assignedEmail, page, 50, query)) as any;

            if (response.success && Array.isArray(response.data)) {
                const orders = response.data.map(transformServiceOrder);

                if (page === 1) {
                    setServiceOrders(orders);
                } else {
                    setServiceOrders(prev => [...prev, ...orders]);
                }

                const hasMoreVal = response.pagination ? response.pagination.has_more : false;
                paginationRef.current = { page, hasMore: hasMoreVal };
                
                setLastUpdated(new Date());
                setError(null);
            } else {
                if (page === 1) setServiceOrders([]);
                paginationRef.current.hasMore = false;
            }
        } catch (err: any) {
            if (!silent) setError(err.message || 'Failed to load data.');
        } finally {
            setIsLoading(false);
            setIsFetchingNextPage(false);
            fetchingRef.current = false;
        }
    }, []); // Totally stable

    const refreshServiceOrders = useCallback(async () => {
        await fetchServiceOrders(1, true, false);
    }, [fetchServiceOrders]);

    const silentRefresh = useCallback(async () => {
        await fetchServiceOrders(1, true, true);
    }, [fetchServiceOrders]);

    const fetchNextPage = useCallback(async () => {
        if (!paginationRef.current.hasMore || fetchingRef.current) return;
        await fetchServiceOrders(paginationRef.current.page + 1, true, false);
    }, [fetchServiceOrders]);

    const handleSearch = useCallback((query: string) => {
        queryRef.current = query;
        setSearchQuery(query);
        fetchServiceOrders(1, true, false, query);
    }, [fetchServiceOrders]);

    // Initial fetch effect
    useEffect(() => {
        // Wait for the keys to load, then only fetch for a user who may read service orders.
        if (!permissionsReady || !can('service-order')) return;

        if (ordersRef.current.length === 0 && !fetchingRef.current) {
            fetchServiceOrders(1, false, false);
        }
    }, [fetchServiceOrders, permissionsReady, can]);

    return (
        <ServiceOrderContext.Provider
            value={{
                serviceOrders,
                isLoading: isLoading && serviceOrders.length === 0, // Only true for first load
                isRefreshing: isLoading && serviceOrders.length > 0, // True for manual refreshes
                isFetchingNextPage,
                error,
                refreshServiceOrders,
                silentRefresh,
                fetchNextPage,
                setSearchQuery: handleSearch,
                searchQuery,
                hasMore: paginationRef.current.hasMore,
                currentPage: paginationRef.current.page,
                lastUpdated
            }}
        >
            {children}
        </ServiceOrderContext.Provider>
    );
};

export type { ServiceOrder };

import { create } from 'zustand';
import { getServiceOrders, ServiceOrderData } from '../services/serviceOrderService';

export interface ServiceOrder {
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
    newPlan?: string;
    clientSignatureUrl?: string;
    image1Url?: string;
    image2Url?: string;
    image3Url?: string;
    rawUpdatedAt?: string;
    referredBy?: string;
    status?: string;
    routerModel?: string;
    pulloutRouterModel?: string;
    pulloutRouterSN?: string;
    nameAddress?: string;
    createdAt?: string;
    oldLcp?: string;
    oldNap?: string;
    oldPort?: string;
    oldVlan?: string;
    oldLcpnap?: string;
    newLcp?: string;
    newNap?: string;
    newPort?: string;
    newVlan?: string;
    newLcpnap?: string;
    barangay?: string;
    city?: string;
    region?: string;
    billingDay?: string;
    onsiteRemarks?: string;
    statusRemarks?: string;
    contractTemplate?: string;
    ipAddress?: string;
    usageType?: string;
    start_time?: string | null;
    end_time?: string | null;
    organization_id?: number | null;
}

export const transformServiceOrder = (order: ServiceOrderData): ServiceOrder => {
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
        provider: order.group_name || '',
        affiliate: order.group_name || '',
        username: order.username || '',
        connectionType: order.connection_type || '',
        routerModemSN: order.router_modem_sn || '',
        lcp: order.lcp || (order as any).old_lcp || '',
        nap: order.nap || (order as any).old_nap || '',
        port: order.port || (order as any).old_port || '',
        vlan: order.vlan || (order as any).old_vlan || '',
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
        newPlan: order.new_plan || '',
        clientSignatureUrl: order.client_signature_url || '',
        image1Url: order.image1_url || '',
        image2Url: order.image2_url || '',
        image3Url: order.image3_url || '',
        rawUpdatedAt: order.updated_at || '',
        createdAt: order.created_at || '',
        referredBy: (order as any).referred_by || '',
        status: (order as any).status || '',
        routerModel: (order as any).router_model || '',
        pulloutRouterModel: (order as any).router_model || '',
        pulloutRouterSN: (order as any).router_modem_sn || '',
        nameAddress: order.full_address || '',
        oldLcp: (order as any).old_lcp || '',
        oldNap: (order as any).old_nap || '',
        oldPort: (order as any).old_port || '',
        oldVlan: (order as any).old_vlan || '',
        oldLcpnap: (order as any).old_lcpnap || '',
        newLcp: (order as any).new_lcp || '',
        newNap: (order as any).new_nap || '',
        newPort: (order as any).new_port || '',
        newVlan: (order as any).new_vlan || '',
        newLcpnap: (order as any).new_lcpnap || '',
        barangay: (order as any).barangay || '',
        city: (order as any).city || '',
        region: (order as any).region || '',
        billingDay: (order as any).billing_day || '',
        onsiteRemarks: (order as any).onsite_remarks || '',
        statusRemarks: (order as any).status_remarks || '',
        contractTemplate: (order as any).contract_template || '',
        ipAddress: (order as any).ip_address || '',
        usageType: (order as any).usage_type || '',
        start_time: order.start_time || null,
        end_time: order.end_time || null,
        organization_id: (order as any).organization_id || null,
    };
};

interface ServiceOrderState {
    serviceOrders: ServiceOrder[];
    isLoading: boolean;
    error: string | null;
    hasMore: boolean;
    currentPage: number;
    totalCount: number;
    searchQuery: string;
    lastUpdated: Date | null;
    currentFetchId: number | null; // Track current valid fetch
    isFullyLoaded: boolean;

    fetchServiceOrders: (force?: boolean, silent?: boolean, assignedEmail?: string, accountNo?: string) => Promise<void>;
    refreshServiceOrders: () => Promise<void>;
    silentRefresh: (assignedEmail?: string, accountNo?: string) => Promise<void>;
    fetchUpdates: (assignedEmail?: string, accountNo?: string) => Promise<void>;
}

export const useServiceOrderStore = create<ServiceOrderState>((set, get) => ({
    serviceOrders: [],
    isLoading: false,
    error: null,
    hasMore: true,
    currentPage: 1,
    totalCount: 0,
    searchQuery: '',
    lastUpdated: null,
    currentFetchId: null,
    isFullyLoaded: false,

    fetchServiceOrders: async (force = false, silent = false, assignedEmail?: string, accountNo?: string) => {
        const fetchId = Date.now();
        set({ currentFetchId: fetchId });

        const { serviceOrders, isLoading, totalCount } = get();

        // Prevent re-fetching if we already have data and not forced
        if (!force && serviceOrders.length >= totalCount && totalCount > 0) {
            return;
        }

        // If already loading and not forced, ignore
        if (isLoading && !force) return;

        const isInitialFetch = serviceOrders.length === 0;

        // Only show loading if not silent OR if we have no data
        if (!silent || isInitialFetch) {
            set({ isLoading: true, error: null });
        }

        try {
            // Use provided email or fallback to localStorage
            let fetchEmail = assignedEmail;
            if (!fetchEmail) {
                const authData = localStorage.getItem('authData');
                if (authData) {
                    try {
                        const userData = JSON.parse(authData);
                        if (userData.role && userData.role.toLowerCase() === 'technician' && userData.email) {
                            fetchEmail = userData.email;
                        }
                    } catch (err) { }
                }
            }

            const CHUNK_SIZE = 1000;
            // If forced but silent, we use a map to merge with current orders to avoid "blank" states
            const ordersMap = new Map();
            if (!(force && !silent)) {
                serviceOrders.forEach(o => ordersMap.set(o.id, o));
            }
            
            let currentOffset = (force) ? 0 : serviceOrders.length;
            let currentFetchPage = Math.floor(currentOffset / CHUNK_SIZE) + 1;


            const firstResult = (await (getServiceOrders as any)(fetchEmail, currentFetchPage, CHUNK_SIZE, '', undefined, accountNo)) as any;

            // Check if this fetch is still valid
            if (get().currentFetchId !== fetchId) {
                return;
            }

            if (firstResult && firstResult.success && Array.isArray(firstResult.data)) {
                const dbTotal = firstResult.pagination?.total_count || firstResult.pagination?.total || firstResult.data.length;
                const newTransformed = firstResult.data.map(transformServiceOrder);
                
                newTransformed.forEach((o: ServiceOrder) => ordersMap.set(o.id, o));

                const mergedOrders = Array.from(ordersMap.values()).sort((a: any, b: any) => {
                    const dateA = a.timestamp || a.createdAt;
                    const dateB = b.timestamp || b.createdAt;
                    const timeA = dateA ? new Date(dateA).getTime() : 0;
                    const timeB = dateB ? new Date(dateB).getTime() : 0;
                    if (timeA !== timeB) return timeB - timeA;
                    const idA = parseInt(a.id) || 0;
                    const idB = parseInt(b.id) || 0;
                    return idB - idA;
                });

                set({
                    serviceOrders: mergedOrders,
                    totalCount: dbTotal,
                    lastUpdated: new Date(),
                    error: null,
                    isLoading: false,
                    isFullyLoaded: dbTotal === 0 || mergedOrders.length >= dbTotal
                });

                // Continue fetching remaining chunks progressively
                let hasMore = firstResult.pagination?.has_more ?? (mergedOrders.length < dbTotal);
                currentFetchPage++;

                while (hasMore) {
                    // Check validity inside the loop
                    if (get().currentFetchId !== fetchId) {
                        return;
                    }

                    try {
                        const result = (await (getServiceOrders as any)(fetchEmail, currentFetchPage, CHUNK_SIZE, '', undefined, accountNo)) as any;

                        // Check if superseded after async call
                        if (get().currentFetchId !== fetchId) return;

                        if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
                            const chunkTransformed = result.data.map(transformServiceOrder);
                            chunkTransformed.forEach((o: ServiceOrder) => ordersMap.set(o.id, o));
                            
                            const updatedMerged = Array.from(ordersMap.values()).sort((a: any, b: any) => {
                                const dateA = a.createdAt || a.timestamp;
                                const dateB = b.createdAt || b.timestamp;
                                const timeA = dateA ? new Date(dateA).getTime() : 0;
                                const timeB = dateB ? new Date(dateB).getTime() : 0;
                                if (timeA !== timeB) return timeB - timeA;
                                const idA = parseInt(a.id) || 0;
                                const idB = parseInt(b.id) || 0;
                                return idB - idA;
                            });

                            const currentTotal = result.pagination?.total_count || result.pagination?.total || dbTotal;
                            set({
                                serviceOrders: updatedMerged,
                                totalCount: currentTotal,
                                isFullyLoaded: currentTotal === 0 || updatedMerged.length >= currentTotal
                            });

                            hasMore = result.pagination?.has_more ?? (updatedMerged.length < currentTotal);
                            currentFetchPage++;
                        } else {
                            hasMore = false;
                        }
                    } catch (chunkErr) {
                        console.error(`Error fetching ServiceOrder chunk:`, chunkErr);
                        hasMore = false;
                    }
                }
            } else {
                if (force || serviceOrders.length === 0) {
                    set({
                        serviceOrders: (force && !silent) ? [] : get().serviceOrders,
                        hasMore: false,
                        isLoading: false,
                        error: firstResult.message || 'Failed to fetch service orders'
                    });
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch service orders:', err);
            // Only set error if this is still the active fetch
            if (get().currentFetchId === fetchId && (!silent || get().serviceOrders.length === 0)) {
                set({
                    error: err.message || 'Failed to load service orders',
                    isLoading: false
                });
            }
        } finally {
            // Only stop loading if this is the active fetch
            if (get().currentFetchId === fetchId) {
                set({ isLoading: false });
            }
        }
    },

    refreshServiceOrders: async () => {
        await get().fetchServiceOrders(true, false);
    },

    silentRefresh: async (assignedEmail?: string, accountNo?: string) => {
        await get().fetchServiceOrders(true, true, assignedEmail, accountNo);
    },

    fetchUpdates: async (assignedEmail?: string, accountNo?: string) => {
        const { serviceOrders, lastUpdated } = get();
        
        // Use provided email or fallback to auto-detection
        let fetchEmail = assignedEmail;
        if (!fetchEmail) {
            const authData = localStorage.getItem('authData');
            if (authData) {
                try {
                    const userData = JSON.parse(authData);
                    if (userData.role && userData.role.toLowerCase() === 'technician' && userData.email) {
                        fetchEmail = userData.email;
                    }
                } catch (err) { }
            }
        }

        if (!lastUpdated) {
            await get().silentRefresh(fetchEmail, accountNo);
            return;
        }

        try {
            // Format date for MySQL: YYYY-MM-DD HH:mm:ss
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');
            
            const result = await (getServiceOrders as any)(fetchEmail, 1, 1000, '', formattedDate, accountNo) as any;

            if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
                const updatedTransformed = result.data.map(transformServiceOrder);
                
                // Merge updates into existing serviceOrders
                // We overwrite existing items with same ID and prepend/append new ones
                const mergedOrders = [...serviceOrders];
                
                updatedTransformed.forEach((newOrder: ServiceOrder) => {
                    const existingIndex = mergedOrders.findIndex(o => o.id === newOrder.id);
                    if (existingIndex !== -1) {
                        mergedOrders[existingIndex] = newOrder;
                    } else {
                        // Prepend new orders (assuming they are latest)
                        mergedOrders.unshift(newOrder);
                    }
                });

                set({ 
                    serviceOrders: mergedOrders,
                    lastUpdated: new Date(),
                    totalCount: result.pagination?.total || (get().totalCount + updatedTransformed.filter((n: ServiceOrder) => !serviceOrders.find(o => o.id === n.id)).length),
                    isFullyLoaded: true // If we're getting updates, we must have finished initial load
                });
            } else {
                set({ lastUpdated: new Date() });
            }
        } catch (err) {
            console.error('[ServiceOrderStore] Failed to fetch updates:', err);
        }
    }
}));

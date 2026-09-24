import { create } from 'zustand';
import { soaService, SOARecord } from '../services/soaService';

export interface SOARecordUI {
    id: string;
    accountNo: string;
    statementDate: string;
    statementDateRaw?: string;
    balanceFromPreviousBill: number;
    paymentReceivedPrevious: number;
    remainingBalancePrevious: number;
    monthlyServiceFee: number;
    serviceCharge: number;
    rebate: number;
    discounts: number;
    staggered: number;
    vat: number;
    dueDate: string;
    amountDue: number;
    totalAmountDue: number;
    printLink?: string;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    updatedBy?: string;
    fullName: string;
    contactNumber: string;
    emailAddress: string;
    address: string;
    plan: string;
    dateInstalled: string;
    barangay?: string;
    city?: string;
    region?: string;
    provider?: string;
    statementNo?: string;
    paymentReceived?: number;
    remainingBalance?: number;
    deliveryStatus?: string;
    deliveryDate?: string;
    deliveredBy?: string;
    deliveryRemarks?: string;
    deliveryProof?: string;
    modifiedBy?: string;
    modifiedDate?: string;
    remarks?: string;
    dateProcessed?: string;
    invoiceStatus?: string;
    referenceNo?: string;
    orNo?: string;
    transactionId?: string;
    organization_id?: number | null;
}

interface SOAState {
    soaRecords: SOARecordUI[];
    totalCount: number;
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    fetchSOARecords: (force?: boolean, silent?: boolean) => Promise<void>;
    silentRefresh: () => Promise<void>;
    refreshSOARecords: () => Promise<void>;
    pollLatestUpdates: () => Promise<void>;
    refreshSingleRecord: (id: string) => Promise<void>;
}

const transform = (record: SOARecord): SOARecordUI => {
    const formatDateObj = (date?: string | Date) => {
        if (!date) return 'N/A';
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'N/A';
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
    };

    return {
        id: record.id.toString(),
        accountNo: record.account_no || record.account?.account_no || '',
        statementDate: formatDateObj(record.statement_date),
        statementDateRaw: record.statement_date,
        balanceFromPreviousBill: Number(record.balance_from_previous_bill) || 0,
        paymentReceivedPrevious: Number(record.payment_received_previous) || 0,
        remainingBalancePrevious: Number(record.remaining_balance_previous) || 0,
        monthlyServiceFee: Number(record.monthly_service_fee) || 0,
        serviceCharge: Number(record.service_charge) || 0,
        rebate: Number(record.rebate) || 0,
        discounts: Number(record.discounts) || 0,
        staggered: Number(record.staggered) || 0,
        vat: Number(record.vat) || 0,
        dueDate: formatDateObj(record.due_date),
        amountDue: Number(record.amount_due) || 0,
        totalAmountDue: Number(record.total_amount_due) || 0,
        printLink: record.print_link,
        createdAt: formatDateObj(record.created_at),
        createdBy: record.created_by,
        updatedAt: formatDateObj(record.updated_at),
        updatedBy: record.updated_by,
        fullName: record.account?.customer?.full_name || 'Unknown',
        contactNumber: record.account?.customer?.contact_number_primary || 'N/A',
        emailAddress: record.account?.customer?.email_address || 'N/A',
        address: record.account?.customer?.address || 'N/A',
        plan: record.account?.customer?.desired_plan || 'No Plan',
        dateInstalled: formatDateObj(record.account?.date_installed),
        barangay: record.account?.customer?.barangay || '',
        city: record.account?.customer?.city || '',
        region: record.account?.customer?.region || '',
        provider: 'SWITCH',
        statementNo: record.id.toString(),
        paymentReceived: Number(record.payment_received_previous) || 0,
        remainingBalance: Number(record.remaining_balance_previous) || 0,
        modifiedBy: record.updated_by,
        modifiedDate: formatDateObj(record.updated_at),
        remarks: (record as any).remarks || '',
        dateProcessed: (record as any).date_processed || '',
        invoiceStatus: (record as any).status || '',
        referenceNo: (record as any).reference_no || '',
        orNo: (record as any).or_no || '',
        transactionId: (record as any).transaction_id || '',
        organization_id: (record as any).organization_id,
    };
};

export const useSOAStore = create<SOAState>((set, get) => ({
    soaRecords: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    lastUpdated: null,

    fetchSOARecords: async (force = false, silent = false) => {
        const { soaRecords, isLoading, totalCount } = get();

        // Lock fetching to avoid overlapping loops
        if (isLoading) return;

        // Prevent re-fetching if we already have data and not forced
        if (!force && soaRecords.length >= totalCount && totalCount > 0) {
            return;
        }

        const isInitialFetch = soaRecords.length === 0;

        // Set loading state (always lock, but only show loader if not silent)
        set({ isLoading: true, error: null });

        try {
            const CHUNK_SIZE = 2000;
            // If it's a forced refresh but silent, don't clear immediate data to avoid flickering
            let allFetchedRecords = (force && !silent) ? [] : [...soaRecords];
            let currentFetchPage = (force) ? 1 : Math.floor(allFetchedRecords.length / CHUNK_SIZE) + 1;


            // Fetch first/next chunk
            const firstResult = await soaService.getAllStatementsWithTotal(false, currentFetchPage, CHUNK_SIZE);

            if (firstResult && firstResult.data) {
                const dbTotal = firstResult.total || firstResult.data.length;
                const newTransformed = firstResult.data.map(transform);

                // Use Map for efficient merging and to prevent duplicates during forced refreshes
                const currentMap = new Map();
                if (force && silent) {
                    soaRecords.forEach(r => currentMap.set(r.id, r));
                } else if (!force) {
                    allFetchedRecords.forEach(r => currentMap.set(r.id, r));
                }

                newTransformed.forEach(r => currentMap.set(r.id, r));
                allFetchedRecords = Array.from(currentMap.values());

                set({
                    soaRecords: [...allFetchedRecords].sort((a, b) => parseInt(b.id) - parseInt(a.id)),
                    totalCount: dbTotal,
                    lastUpdated: new Date(),
                    isLoading: false
                });

                // Progressive background loading
                let hasMore = firstResult.pagination?.has_more || allFetchedRecords.length < dbTotal;
                currentFetchPage++;

                while (hasMore) {
                    try {
                        const result = await soaService.getAllStatementsWithTotal(false, currentFetchPage, CHUNK_SIZE);

                        if (result && result.data && result.data.length > 0) {
                            const chunkTransformed = result.data.map(transform);

                            // Merge new chunk
                            const updateMap = new Map();
                            allFetchedRecords.forEach(r => updateMap.set(r.id, r));
                            chunkTransformed.forEach(r => updateMap.set(r.id, r));

                            allFetchedRecords = Array.from(updateMap.values());

                            set({
                                soaRecords: [...allFetchedRecords].sort((a, b) => parseInt(b.id) - parseInt(a.id)),
                                totalCount: result.total || dbTotal
                            });

                            hasMore = result.pagination?.has_more || allFetchedRecords.length < dbTotal;
                            currentFetchPage++;
                        } else {
                            hasMore = false;
                        }
                    } catch (chunkErr) {
                        console.error(`[SOA Store] Error fetching chunk:`, chunkErr);
                        hasMore = false;
                    }
                }
            }
        } catch (err: any) {
            console.error('[SOA Store] Fetch failed:', err);
            if (!silent && get().soaRecords.length === 0) {
                set({ error: 'Failed to load SOA records. Please try again.' });
            }
        } finally {
            set({ isLoading: false });
        }
    },

    refreshSOARecords: async () => {
        await get().fetchSOARecords(true, false);
    },

    silentRefresh: async () => {
        await get().fetchSOARecords(true, true);
    },

    pollLatestUpdates: async () => {
        const { lastUpdated, soaRecords, totalCount } = get();
        if (!lastUpdated || soaRecords.length === 0) return;

        try {
            const isoString = lastUpdated.toISOString();
            
            // Note: Keep fastMode false to ensure we get customer details for any updated records
            const result = await (soaService.getAllStatementsWithTotal as any)(false, 1, 1000, isoString);
            
            if (result && result.data && result.data.length > 0) {
                const newTransformed = result.data.map(transform);
                
                const updateMap = new Map();
                soaRecords.forEach(r => updateMap.set(r.id, r));
                newTransformed.forEach((r: any) => updateMap.set(r.id, r));
                
                const allFetchedRecords = Array.from(updateMap.values());
                
                set({
                    soaRecords: [...allFetchedRecords].sort((a, b) => parseInt(b.id) - parseInt(a.id)),
                    totalCount: result.total || totalCount,
                    lastUpdated: new Date()
                });
            } else {
                set({ lastUpdated: new Date() });
            }
        } catch (err) {
            console.error('[SOA Store] Poll failed:', err);
        }
    },

    refreshSingleRecord: async (id: string) => {
        try {
            const record = await soaService.getStatementById(parseInt(id));
            if (record) {
                const transformed = transform(record);
                const { soaRecords } = get();
                const updatedRecords = soaRecords.map(r => r.id === id ? transformed : r);
                set({ soaRecords: updatedRecords });
            }
        } catch (err) {
            console.error(`[SOA Store] Failed to refresh record ${id}:`, err);
        }
    }
}));


import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { soaService, SOARecord } from '../services/soaService';

export interface SOARecordUI {
    id: string;
    accountNo: string;
    statementDate: string;
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
}

interface SOAContextType {
    soaRecords: SOARecordUI[];
    totalCount: number; // Added totalCount
    isLoading: boolean;
    error: string | null;
    refreshSOARecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const SOAContext = createContext<SOAContextType | undefined>(undefined);

export const SOAProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [soaRecords, setSOARecords] = useState<SOARecordUI[]>(() => {
        try {
            const cached = sessionStorage.getItem('soa_records');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error('Failed to load SOA records from session storage:', e);
        }
        return [];
    });

    // Add local state for total count to persist across renders
    const [totalCount, setTotalCount] = useState<number>(() => {
        const cachedTotal = sessionStorage.getItem('soa_total_count');
        return cachedTotal ? parseInt(cachedTotal, 10) : 0;
    });

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchSOARecords = useCallback(async (force = false, silent = false) => {
        // Prevent re-fetching if we already have data and not forced
        if (!force && soaRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            console.log('Fetching SOA records in chunks (TransactionList Style with huge dataset support)...');

            const CHUNK_SIZE = 5000;
            let currentFetchPage = 1;
            let allFetchedRecords: SOARecordUI[] = [];
            let hasMore = true;
            let dbTotal = 0;

            const transform = (record: SOARecord): SOARecordUI => ({
                id: record.id.toString(),
                accountNo: record.account_no || record.account?.account_no || '',
                statementDate: new Date(record.statement_date).toLocaleDateString(),
                balanceFromPreviousBill: Number(record.balance_from_previous_bill) || 0,
                paymentReceivedPrevious: Number(record.payment_received_previous) || 0,
                remainingBalancePrevious: Number(record.remaining_balance_previous) || 0,
                monthlyServiceFee: Number(record.monthly_service_fee) || 0,
                serviceCharge: Number(record.service_charge) || 0,
                rebate: Number(record.rebate) || 0,
                discounts: Number(record.discounts) || 0,
                staggered: Number(record.staggered) || 0,
                vat: Number(record.vat) || 0,
                dueDate: new Date(record.due_date).toLocaleDateString(),
                amountDue: Number(record.amount_due) || 0,
                totalAmountDue: Number(record.total_amount_due) || 0,
                printLink: record.print_link,
                createdAt: record.created_at ? new Date(record.created_at).toLocaleString() : '',
                createdBy: record.created_by,
                updatedAt: record.updated_at ? new Date(record.updated_at).toLocaleString() : '',
                updatedBy: record.updated_by,
                fullName: record.account?.customer?.full_name || 'Unknown',
                contactNumber: record.account?.customer?.contact_number_primary || 'N/A',
                emailAddress: record.account?.customer?.email_address || 'N/A',
                address: record.account?.customer?.address || 'N/A',
                plan: record.account?.customer?.desired_plan || 'No Plan',
                dateInstalled: record.account?.date_installed ? new Date(record.account.date_installed).toLocaleDateString() : 'N/A',
                barangay: record.account?.customer?.barangay || '',
                city: record.account?.customer?.city || '',
                region: record.account?.customer?.region || '',
                provider: 'SWITCH',
                statementNo: '2509180' + record.id.toString(),
                paymentReceived: Number(record.payment_received_previous) || 0,
                remainingBalance: Number(record.remaining_balance_previous) || 0,
                modifiedBy: record.updated_by,
                modifiedDate: record.updated_at ? new Date(record.updated_at).toLocaleDateString() : undefined,
            });

            // Fetch first chunk to get the total and initial data
            const firstResult = await soaService.getAllStatementsWithTotal(false, 1, CHUNK_SIZE);

            if (firstResult && firstResult.data) {
                dbTotal = firstResult.total || firstResult.data.length;
                setTotalCount(dbTotal);
                sessionStorage.setItem('soa_total_count', dbTotal.toString());

                allFetchedRecords = firstResult.data.map(transform);
                setSOARecords(allFetchedRecords);

                // If there's more, continue fetching in the background
                hasMore = firstResult.pagination?.has_more || (allFetchedRecords.length < dbTotal);
                currentFetchPage++;

                if (!silent) {
                    setIsLoading(false); // Hide loader after first chunk for responsiveness
                }

                // Progressive background loading
                while (hasMore) {
                    console.log(`Fetching SOA chunk ${currentFetchPage}...`);
                    try {
                        const result = await soaService.getAllStatementsWithTotal(false, currentFetchPage, CHUNK_SIZE);
                        if (result && result.data && result.data.length > 0) {
                            const newTransformed = result.data.map(transform);
                            allFetchedRecords = [...allFetchedRecords, ...newTransformed];
                            setSOARecords([...allFetchedRecords]); // Update state with latest chunk

                            hasMore = result.pagination?.has_more || false;
                            currentFetchPage++;

                            if (allFetchedRecords.length >= dbTotal) break;
                        } else {
                            hasMore = false;
                        }
                    } catch (chunkErr) {
                        console.error(`Error fetching SOA chunk ${currentFetchPage}:`, chunkErr);
                        hasMore = false;
                    }
                }

                // Final save to session storage if size allows
                try {
                    const json = JSON.stringify(allFetchedRecords);
                    if (json.length < 4500000) {
                        sessionStorage.setItem('soa_records', json);
                    }
                } catch (e) {
                    console.warn('Final SOA data too large for session storage cache.');
                }

                setLastUpdated(new Date());
                setError(null);
            }
        } catch (err: any) {
            console.error('Failed to fetch SOA records:', err);
            if (!silent && soaRecords.length === 0) {
                setError('Failed to load SOA records. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    }, [soaRecords.length]);

    const refreshSOARecords = useCallback(async () => {
        await fetchSOARecords(true, false);
    }, [fetchSOARecords]);

    const silentRefresh = useCallback(async () => {
        await fetchSOARecords(true, true);
    }, [fetchSOARecords]);

    // Initial fetch effect
    useEffect(() => {
        if (soaRecords.length === 0) {
            fetchSOARecords(false, false);
        }
    }, [fetchSOARecords, soaRecords.length]);

    return (
        <SOAContext.Provider value={{
            soaRecords,
            totalCount,
            isLoading,
            error,
            refreshSOARecords,
            silentRefresh,
            lastUpdated
        }}>
            {children}
        </SOAContext.Provider>
    );
};

export const useSOAContext = () => {
    const context = useContext(SOAContext);
    if (context === undefined) {
        throw new Error('useSOAContext must be used within a SOAProvider');
    }
    return context;
};

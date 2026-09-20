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
    isLoading: boolean;
    error: string | null;
    refreshSOARecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const SOAContext = createContext<SOAContextType | undefined>(undefined);

export const SOAProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [soaRecords, setSOARecords] = useState<SOARecordUI[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchSOARecords = useCallback(async (force = false, silent = false) => {
        if (!force && soaRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            // PHASE 1: Fast load - Get basic data INSTANTLY (50 records, no joins)
            const fastData = await soaService.getAllStatements(true, 1, 50);

            const transformedFastData: SOARecordUI[] = fastData.map(record => ({
                id: record.id.toString(),
                accountNo: record.account_no || '',
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
                fullName: 'Loading...',
                contactNumber: 'Loading...',
                emailAddress: 'Loading...',
                address: 'Loading...',
                plan: 'Loading...',
                dateInstalled: 'Loading...',
                barangay: '',
                city: '',
                region: '',
                provider: 'SWITCH',
                statementNo: '2509180' + record.id.toString(),
                paymentReceived: Number(record.payment_received_previous) || 0,
                remainingBalance: Number(record.remaining_balance_previous) || 0,
                deliveryStatus: undefined,
                deliveryDate: undefined,
                deliveredBy: undefined,
                deliveryRemarks: undefined,
                deliveryProof: undefined,
                modifiedBy: record.updated_by,
                modifiedDate: record.updated_at ? new Date(record.updated_at).toLocaleDateString() : undefined,
            }));

            // Show fast data immediately
            setSOARecords(transformedFastData);
            setIsLoading(false);
            setError(null);

            // PHASE 2: Load full data in background
            setTimeout(async () => {
                try {
                    const fullData = await soaService.getAllStatements(false, 1, 50);

                    const transformedData: SOARecordUI[] = fullData.map(record => ({
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
                        deliveryStatus: undefined,
                        deliveryDate: undefined,
                        deliveredBy: undefined,
                        deliveryRemarks: undefined,
                        deliveryProof: undefined,
                        modifiedBy: record.updated_by,
                        modifiedDate: record.updated_at ? new Date(record.updated_at).toLocaleDateString() : undefined,
                    }));

                    // Silently update with full data
                    setSOARecords(transformedData);
                    setLastUpdated(new Date());
                } catch (bgError) {
                    console.warn('Background full data load failed:', bgError);
                    // Keep showing fast data even if full load fails
                }
            }, 100);

        } catch (err: any) {
            console.error('Failed to fetch SOA records:', err);
            if (!silent) {
                setError('Failed to load SOA records. Please try again.');
            }
            setSOARecords([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

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

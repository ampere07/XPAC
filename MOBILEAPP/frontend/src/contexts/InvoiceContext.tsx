import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { invoiceService } from '../services/invoiceService';

// Define the UI interface that components use
export interface InvoiceRecordUI {
    id: string;
    accountNo: string;
    invoiceDate: string;
    invoiceBalance: number;
    serviceCharge: number;
    rebate: number;
    discounts: number;
    staggered: number;
    totalAmount: number;
    receivedPayment: number;
    dueDate: string;
    status: string;
    paymentPortalLogRef?: string;
    transactionId?: string;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    updatedBy?: string;
    fullName: string;
    contactNumber: string;
    emailAddress: string;
    address: string;
    plan: string;
    dateInstalled?: string;
    barangay?: string;
    city?: string;
    region?: string;
    provider?: string;
    invoiceNo?: string;
    totalAmountDue?: number;
    invoicePayment?: number;
    paymentMethod?: string;
    dateProcessed?: string;
    processedBy?: string;
    remarks?: string;
    vat?: number;
    amountDue?: number;
    balanceFromPreviousBill?: number;
    paymentReceived?: number;
    remainingBalance?: number;
    monthlyServiceFee?: number;
    staggeredPaymentsCount?: number;
    invoiceStatus: string;
}

interface InvoiceContextType {
    invoiceRecords: InvoiceRecordUI[];
    isLoading: boolean;
    error: string | null;
    refreshInvoiceRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

export const useInvoiceContext = () => {
    const context = useContext(InvoiceContext);
    if (!context) {
        throw new Error('useInvoiceContext must be used within an InvoiceProvider');
    }
    return context;
};

interface InvoiceProviderProps {
    children: ReactNode;
}

export const InvoiceProvider: React.FC<InvoiceProviderProps> = ({ children }) => {
    const [invoiceRecords, setInvoiceRecords] = useState<InvoiceRecordUI[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchInvoiceRecords = useCallback(async (isSilent: boolean = false) => {
        if (!isSilent) setIsLoading(true);
        setError(null);

        try {
            // PHASE 1: Fast load - Get basic data INSTANTLY (50 records, no joins)
            const fastData = await invoiceService.getAllInvoices(true, 1, 50);

            const transformedFastData: InvoiceRecordUI[] = fastData.map((record: any) => ({
                id: record.id.toString(),
                accountNo: record.account_no || '',
                invoiceDate: new Date(record.invoice_date).toLocaleDateString(),
                invoiceBalance: Number(record.invoice_balance) || 0,
                serviceCharge: Number(record.service_charge) || 0,
                rebate: Number(record.rebate) || 0,
                discounts: Number(record.discounts) || 0,
                staggered: Number(record.staggered) || 0,
                totalAmount: Number(record.total_amount) || 0,
                receivedPayment: Number(record.received_payment) || 0,
                dueDate: new Date(record.due_date).toLocaleDateString(),
                status: record.status,
                paymentPortalLogRef: record.payment_portal_log_ref,
                transactionId: record.transaction_id,
                createdAt: record.created_at ? new Date(record.created_at).toLocaleString() : '',
                createdBy: record.created_by,
                updatedAt: record.updated_at ? new Date(record.updated_at).toLocaleString() : '',
                updatedBy: record.updated_by,
                fullName: 'Loading...',
                contactNumber: 'Loading...',
                emailAddress: 'Loading...',
                address: 'Loading...',
                plan: 'Loading...',
                dateInstalled: '',
                barangay: '',
                city: '',
                region: '',
                provider: 'SWITCH',
                invoiceNo: '2508182' + record.id.toString(),
                totalAmountDue: Number(record.total_amount) || 0,
                invoicePayment: Number(record.received_payment) || 0,
                paymentMethod: record.received_payment > 0 ? 'Payment Received' : 'N/A',
                dateProcessed: record.received_payment > 0 && record.updated_at ? new Date(record.updated_at).toLocaleDateString() : undefined,
                billingDay: 0,
                invoiceStatus: record.status,
            }));

            // Show fast data immediately
            setInvoiceRecords(transformedFastData);
            setIsLoading(false);

            // PHASE 2: Load full data in background
            setTimeout(async () => {
                try {
                    const fullData = await invoiceService.getAllInvoices(false, 1, 50);

                    const transformedData: InvoiceRecordUI[] = fullData.map((record: any) => ({
                        id: record.id.toString(),
                        accountNo: record.account_no || record.account?.account_no || '',
                        invoiceDate: new Date(record.invoice_date).toLocaleDateString(),
                        invoiceBalance: Number(record.invoice_balance) || 0,
                        serviceCharge: Number(record.service_charge) || 0,
                        rebate: Number(record.rebate) || 0,
                        discounts: Number(record.discounts) || 0,
                        staggered: Number(record.staggered) || 0,
                        totalAmount: Number(record.total_amount) || 0,
                        receivedPayment: Number(record.received_payment) || 0,
                        dueDate: new Date(record.due_date).toLocaleDateString(),
                        status: record.status,
                        paymentPortalLogRef: record.payment_portal_log_ref,
                        transactionId: record.transaction_id,
                        createdAt: record.created_at ? new Date(record.created_at).toLocaleString() : '',
                        createdBy: record.created_by,
                        updatedAt: record.updated_at ? new Date(record.updated_at).toLocaleString() : '',
                        updatedBy: record.updated_by,
                        fullName: record.account?.customer?.full_name || 'Unknown',
                        contactNumber: record.account?.customer?.contact_number_primary || 'N/A',
                        emailAddress: record.account?.customer?.email_address || 'N/A',
                        address: record.account?.customer?.address || 'N/A',
                        plan: record.account?.customer?.desired_plan || 'No Plan',
                        dateInstalled: record.account?.date_installed ? new Date(record.account.date_installed).toLocaleDateString() : '',
                        barangay: record.account?.customer?.barangay || '',
                        city: record.account?.customer?.city || '',
                        region: record.account?.customer?.region || '',
                        provider: 'SWITCH',
                        invoiceNo: '2508182' + record.id.toString(),
                        totalAmountDue: Number(record.total_amount) || 0,
                        invoicePayment: Number(record.received_payment) || 0,
                        paymentMethod: record.received_payment > 0 ? 'Payment Received' : 'N/A',
                        dateProcessed: record.received_payment > 0 && record.updated_at ? new Date(record.updated_at).toLocaleDateString() : undefined,
                        processedBy: record.received_payment > 0 ? record.updated_by : undefined,
                        remarks: 'System Generated',
                        vat: 0,
                        amountDue: (Number(record.total_amount) || 0) - (Number(record.received_payment) || 0),
                        balanceFromPreviousBill: 0,
                        paymentReceived: Number(record.received_payment) || 0,
                        remainingBalance: (Number(record.total_amount) || 0) - (Number(record.received_payment) || 0),
                        monthlyServiceFee: Number(record.invoice_balance) || 0,
                        staggeredPaymentsCount: 0,
                        invoiceStatus: record.status,
                        billingDay: record.account?.billing_day || 0,
                    }));

                    // Silently update with full data
                    setInvoiceRecords(transformedData);
                    setLastUpdated(new Date());
                } catch (bgError) {
                    console.warn('Background full data load failed:', bgError);
                    // Keep showing fast data even if full load fails
                }
            }, 100);

        } catch (error) {
            console.error('Error fetching invoices:', error);
            setError(error instanceof Error ? error.message : 'Failed to fetch invoices');
            setInvoiceRecords([]);
        } finally {
            if (!isSilent) setIsLoading(false);
        }
    }, []);

    const refreshInvoiceRecords = useCallback(async () => {
        await fetchInvoiceRecords(false);
    }, [fetchInvoiceRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchInvoiceRecords(true);
    }, [fetchInvoiceRecords]);

    return (
        <InvoiceContext.Provider
            value={{
                invoiceRecords,
                isLoading,
                error,
                refreshInvoiceRecords,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </InvoiceContext.Provider>
    );
};

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import apiClient from '../config/api';
import { BillingType, isPrepaidGenerationType, resolveBillingType } from '../utils/billingType';

interface PaymentRecord {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: 'Online' | 'Manual';
    status?: string;
    /**
     * transactions.transaction_type ('Top Up' | 'Recurring Fee' | 'Service Charge' | ...).
     * Only present on manual transactions — an online portal payment has no such column.
     * Carried through from the response already being fetched, so no extra request is made.
     */
    type?: string | null;
}

interface SOARecord {
    id: number;
    statement_date?: string;
    statement_no?: string;
    print_link?: string;
    total_amount_due?: number;
}

interface InvoiceRecord {
    id: number;
    invoice_date?: string;
    invoice_balance?: number;
    due_date?: string;
    status?: string;
    print_link?: string;
}

interface ServiceOrderRecord {
    id: string;
    date: string;
    rawTimestamp: string | null;
    requestId: string;
    issue: string;
    issueDetails: string;
    status: string;
    statusNote: string;
    assignedEmail: string;
    visitNote: string;
    visitInfo: { status: string };
}

interface CustomerDataContextType {
    customerDetail: CustomerDetailData | null;
    payments: PaymentRecord[];
    soaRecords: SOARecord[];
    invoiceRecords: InvoiceRecord[];
    serviceOrders: ServiceOrderRecord[];
    /**
     * The account's billing type, resolved once here from billingAccount.generation_type.
     *
     * Screens must read this rather than re-deriving it: the dashboard, the Bills screen and the
     * bottom navigation all branch on it, and three independent derivations would be three chances
     * for the prepaid/postpaid rule to drift. Defaults to 'Postpaid' before the detail loads and
     * for any non-customer role, which is the pre-existing behaviour for both.
     */
    billingType: BillingType;
    isPrepaid: boolean;
    isLoading: boolean;
    error: string | null;
    refreshData: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const CustomerDataContext = createContext<CustomerDataContextType | undefined>(undefined);

export const useCustomerDataContext = () => {
    const context = useContext(CustomerDataContext);
    if (!context) {
        throw new Error('useCustomerDataContext must be used within a CustomerDataProvider');
    }
    return context;
};

/**
 * Non-throwing accessor for chrome that is shared across every role — the bottom navigation, for
 * instance, wants the billing type when it happens to be rendering for a customer but must not
 * crash a technician's session by demanding a customer-only provider.
 */
export const useCustomerDataContextOptional = () => useContext(CustomerDataContext);

export const CustomerDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [customerDetail, setCustomerDetail] = useState<CustomerDetailData | null>(null);
    const [payments, setPayments] = useState<PaymentRecord[]>([]);
    const [soaRecords, setSoaRecords] = useState<SOARecord[]>([]);
    const [invoiceRecords, setInvoiceRecords] = useState<InvoiceRecord[]>([]);
    const [serviceOrders, setServiceOrders] = useState<ServiceOrderRecord[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // Use a ref for the guard check so fetchData doesn't need customerDetail as a dependency.
    // This prevents a new fetchData/silentRefresh from being created on every data update,
    // which was causing DashboardCustomer to remount and lose its modal state.
    const customerDetailRef = React.useRef<CustomerDetailData | null>(null);

    const fetchData = useCallback(async (force = false, silent = false) => {
        if (!force && customerDetailRef.current) return;

        if (!silent) setIsLoading(true);

        try {
            const storedUser = await AsyncStorage.getItem('authData');
            if (!storedUser) return;

            const parsedUser = JSON.parse(storedUser);
            if (!parsedUser.username) return;

            // Only fetch customer details if the user role is 'customer'
            const role = (parsedUser.role || '').toLowerCase();
            const roleId = Number(parsedUser.role_id);
            const isCustomer = role === 'customer' || roleId === 3;
            if (!isCustomer) {
                setIsLoading(false);
                return;
            }

            // 1. Fetch Customer Detail
            const detail = await getCustomerDetail(parsedUser.username);
            if (!detail) throw new Error('Could not fetch customer details');

            customerDetailRef.current = detail;
            setCustomerDetail(detail);
            const accNo = detail.billingAccount?.accountNo;

            if (accNo) {
                // 2. Fetch everything else in parallel using correct backend routes
                const [logsRes, txRes, soaRes, invoiceRes, soRes] = await Promise.all([
                    apiClient.get(`/payment-portal-logs/account/${accNo}`).catch((e) => { console.error('Payment logs fetch error:', e); return { data: { data: [] } }; }),
                    apiClient.get(`/transactions/by-account/${accNo}`).catch((e) => { console.error('Transactions fetch error:', e); return { data: { data: [] } }; }),
                    apiClient.get(`/statement-of-accounts/by-account/${accNo}`).catch((e) => { console.error('SOA fetch error:', e); return { data: { data: [] } }; }),
                    apiClient.get(`/invoices/by-account/${accNo}`).catch((e) => { console.error('Invoices fetch error:', e); return { data: { data: [] } }; }),
                    apiClient.get(`/service-orders`, { params: { account_no: accNo, page: 1, limit: 50 } }).catch((e) => { console.error('Service orders fetch error:', e); return { data: { success: false, data: [] } }; })
                ]);

                // Process Payment Portal Logs
                const logsData = logsRes?.data?.data || [];
                const formattedLogs: PaymentRecord[] = Array.isArray(logsData) ? logsData.map((l: any) => ({
                    id: `log-${l.id}`,
                    date: l.date_time,
                    reference: l.reference_no,
                    amount: parseFloat(l.total_amount) || 0,
                    source: 'Online' as const,
                    status: l.status
                })) : [];

                // Process Transactions
                const txData = txRes?.data?.data || [];
                const formattedTxs: PaymentRecord[] = Array.isArray(txData) ? txData.map((t: any) => ({
                    id: `tx-${t.id}`,
                    date: t.payment_date || t.created_at,
                    reference: t.or_no || t.reference_no || `TR-${t.id}`,
                    amount: parseFloat(t.received_payment || t.amount || 0),
                    source: 'Manual' as const,
                    status: t.status || 'Posted',
                    type: t.transaction_type ?? null
                })) : [];

                const allPayments = [...formattedLogs, ...formattedTxs].sort((a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime()
                );

                setPayments(allPayments);
                setSoaRecords(soaRes?.data?.data || []);
                setInvoiceRecords(invoiceRes?.data?.data || []);

                // Process Service Orders
                const soData = soRes?.data?.data || [];
                const mappedOrders: ServiceOrderRecord[] = Array.isArray(soData) ? soData.map((order: any) => ({
                    id: order.id,
                    date: order.created_at ? (() => {
                        const d = new Date(order.created_at);
                        if (isNaN(d.getTime())) return '';
                        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
                    })() : '',
                    // Preserve the precise submission time for the support cooldown calc.
                    rawTimestamp: order.created_at || null,
                    requestId: order.ticket_id,
                    issue: order.concern || '',
                    issueDetails: order.concern_remarks || '',
                    status: order.support_status || 'Pending',
                    statusNote: order.support_remarks || '',
                    assignedEmail: order.assigned_email || '',
                    visitNote: order.visit_remarks || '',
                    visitInfo: { status: order.visit_status || 'Pending' }
                })) : [];
                setServiceOrders(mappedOrders);
            }

            setLastUpdated(new Date());
            setError(null);
        } catch (err: any) {
            console.error('Failed to fetch customer data:', err);
            if (!silent) setError(err.message || 'Failed to load data');
        } finally {
            setIsLoading(false);
        }
        // Stable dependency array — customerDetailRef.current is used instead of the state
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetchData();
    }, []);

    const refreshData = useCallback(() => fetchData(true, false), [fetchData]);
    const silentRefresh = useCallback(() => fetchData(true, true), [fetchData]);

    // Resolved once per detail change and shared by every consumer.
    const generationType = customerDetail?.billingAccount?.generation_type;
    const billingType = useMemo(() => resolveBillingType(generationType), [generationType]);
    const isPrepaid = useMemo(() => isPrepaidGenerationType(generationType), [generationType]);

    return (
        <CustomerDataContext.Provider
            value={{
                customerDetail,
                payments,
                soaRecords,
                invoiceRecords,
                serviceOrders,
                billingType,
                isPrepaid,
                isLoading,
                error,
                refreshData,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </CustomerDataContext.Provider>
    );
};

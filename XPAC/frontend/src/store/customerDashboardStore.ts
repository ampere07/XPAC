import { create } from 'zustand';
import { getCustomerDetail, CustomerDetailData } from '../services/customerDetailService';
import { soaService } from '../services/soaService';
import { invoiceService } from '../services/invoiceService';
import { paymentPortalLogsService } from '../services/paymentPortalLogsService';
import { transactionService } from '../services/transactionService';
import { serviceChargeService, ServiceChargeRecord } from '../services/serviceChargeService';

interface Payment {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: string;
    status: string;
}

interface CustomerDashboardState {
    customerDetail: CustomerDetailData | null;
    soaRecords: any[];
    invoiceRecords: any[];
    paymentRecords: Payment[];
    serviceChargeRecords: ServiceChargeRecord[];
    isLoading: boolean;
    error: string | null;
    fetchedAccountNo: string | null;
    refreshQueued: boolean;

    fetchCustomerData: (usernameOrAccountNo: string) => Promise<void>;
    refreshCustomerData: () => Promise<void>;
}

const invoiceTime = (invoice: any): number => {
    const time = new Date(invoice?.invoice_date ?? '').getTime();
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

const newestInvoiceFirst = (invoices: any[]): any[] =>
    [...invoices].sort((a, b) => invoiceTime(b) - invoiceTime(a) || Number(b?.id ?? 0) - Number(a?.id ?? 0));

export const useCustomerDashboardStore = create<CustomerDashboardState>((set, get) => ({
    customerDetail: null,
    soaRecords: [],
    invoiceRecords: [],
    paymentRecords: [],
    serviceChargeRecords: [],
    isLoading: false,
    error: null,
    fetchedAccountNo: null,
    refreshQueued: false,

    fetchCustomerData: async (usernameOrAccountNo: string) => {
        const { fetchedAccountNo, isLoading } = get();

        // Prevent refetching for the same user if already loaded
        if (fetchedAccountNo === usernameOrAccountNo || isLoading) return;

        set({ isLoading: true, error: null });

        try {
            const detail = await getCustomerDetail(usernameOrAccountNo);

            if (detail && detail.billingAccount) {
                const accNo = detail.billingAccount.accountNo;

                const [soaRes, invoiceRes, logsRes, txRes, serviceChargeLogsRes, serviceOrdersRes] = await Promise.all([
                    soaService.getStatementsByAccountNo(accNo).catch(() => []),
                    invoiceService.getInvoicesByAccountNo(accNo).catch(() => []),
                    paymentPortalLogsService.getLogsByAccountNo(accNo).catch(() => []),
                    transactionService.getTransactionsByAccountNo(accNo).catch(() => ({ success: false, data: [] })),
                    serviceChargeService.getServiceChargeLogsByAccountNo(accNo).catch(() => []),
                    serviceChargeService.getServiceOrdersByAccountNo(accNo).catch(() => [])
                ]);

                // Process Payments
                const formattedLogs: Payment[] = Array.isArray(logsRes) ? logsRes.map((l: any) => ({
                    id: `log-${l.id}`,
                    date: l.date_time,
                    reference: l.reference_no,
                    amount: parseFloat(l.total_amount),
                    source: 'Online',
                    status: l.status || 'Success'
                })) : [];

                let formattedTxs: Payment[] = [];
                if (txRes && txRes.success && Array.isArray(txRes.data)) {
                    formattedTxs = txRes.data
                        .map((t: any) => ({
                            id: `tx-${t.id}`,
                            date: t.payment_date || t.created_at,
                            reference: t.or_no || t.reference_no || `TR-${t.id}`,
                            amount: parseFloat(t.received_payment || t.amount || 0),
                            source: 'Manual',
                            status: 'Computed'
                        }));
                }

                const allPayments = [...formattedLogs, ...formattedTxs].sort((a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime()
                );

                // Process Service Charges
                const formattedServiceChargeLogs: ServiceChargeRecord[] = Array.isArray(serviceChargeLogsRes) ? serviceChargeLogsRes.map((l: any) => ({
                    id: `log-${l.id}`,
                    date: l.created_at,
                    amount: parseFloat(l.service_charge),
                    type: 'Manual Charge',
                    status: l.status || 'Unused',
                    remarks: l.remarks,
                    source: 'Log'
                })) : [];

                const formattedServiceOrderCharges: ServiceChargeRecord[] = Array.isArray(serviceOrdersRes) ? serviceOrdersRes
                    .filter((so: any) => parseFloat(so.service_charge) > 0)
                    .map((so: any) => ({
                        id: `so-${so.id}`,
                        date: so.created_at || so.timestamp,
                        amount: parseFloat(so.service_charge),
                        type: so.concern || 'Service Order',
                        status: so.status === 'used' ? 'Used' : 'Unused',
                        remarks: so.concern_remarks,
                        source: 'Order'
                    })) : [];

                const allServiceCharges = [...formattedServiceChargeLogs, ...formattedServiceOrderCharges].sort((a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime()
                );

                set({
                    customerDetail: detail,
                    soaRecords: soaRes || [],
                    invoiceRecords: newestInvoiceFirst(invoiceRes || []),
                    paymentRecords: allPayments,
                    serviceChargeRecords: allServiceCharges,
                    fetchedAccountNo: usernameOrAccountNo,
                    isLoading: false
                });
            } else {
                set({ error: 'Customer billing details not found', isLoading: false });
            }
        } catch (err: any) {
            console.error('Failed to fetch customer dashboard data:', err);
            set({ error: err.message || 'Error loading dashboard data', isLoading: false });
        }
        if (get().refreshQueued) {
            set({ refreshQueued: false });
            await get().refreshCustomerData();
        }
    },

    refreshCustomerData: async () => {
        const { fetchedAccountNo, isLoading } = get();
        if (isLoading) {
            set({ refreshQueued: true });
            return;
        }
        if (fetchedAccountNo) {
            set({ fetchedAccountNo: null }); // Clear cached ID to force refresh
            await get().fetchCustomerData(fetchedAccountNo);
        }
    }
}));

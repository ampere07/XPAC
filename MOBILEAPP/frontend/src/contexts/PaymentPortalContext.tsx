import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { paymentPortalLogsService, PaymentPortalLog } from '../services/paymentPortalLogsService';

export interface PaymentPortalRecord {
    id: string;
    reference_no: string;
    account_id: number | string;
    total_amount: number;
    date_time: string;
    checkout_id: string;
    status: string;
    transaction_status: string;
    ewallet_type?: string;
    payment_channel?: string;
    type?: string;
    payment_url?: string;
    json_payload?: string;
    callback_payload?: string;
    created_at?: string;
    updated_at?: string;
    accountNo?: string;
    fullName?: string;
    contactNo?: string;
    accountBalance?: number;
    provider?: string;
    city?: string;
    barangay?: string;
    plan?: string;
    address?: string;
    [key: string]: any;
}

interface PaymentPortalContextType {
    paymentPortalRecords: PaymentPortalRecord[];
    isLoading: boolean;
    error: string | null;
    refreshPaymentPortalRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const PaymentPortalContext = createContext<PaymentPortalContextType | undefined>(undefined);

export const PaymentPortalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [paymentPortalRecords, setPaymentPortalRecords] = useState<PaymentPortalRecord[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchPaymentPortalRecords = useCallback(async (force = false, silent = false) => {
        if (!force && paymentPortalRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            const data = await paymentPortalLogsService.getAllLogs();

            // Transform the data to match the UI interface
            const transformedRecords: PaymentPortalRecord[] = data.map((log: any) => ({
                id: log.id.toString(),
                reference_no: log.reference_no,
                account_id: log.account_id,
                total_amount: log.total_amount,
                date_time: log.date_time,
                checkout_id: log.checkout_id,
                status: log.status,
                transaction_status: log.transaction_status,
                ewallet_type: log.ewallet_type,
                payment_channel: log.payment_channel,
                type: log.type,
                payment_url: log.payment_url,
                json_payload: log.json_payload,
                callback_payload: log.callback_payload,
                updated_at: log.updated_at,
                accountNo: log.accountNo,
                fullName: log.fullName,
                contactNo: log.contactNo,
                accountBalance: log.accountBalance,
                address: log.address,
                city: log.city,
                barangay: log.barangay,
                plan: log.plan,
                provider: log.provider || log.payment_channel || 'Xendit',
            }));

            setPaymentPortalRecords(transformedRecords);
            setLastUpdated(new Date());
            setError(null);
        } catch (err: any) {
            console.error('Failed to fetch payment portal records:', err);
            if (!silent) {
                setError(err.message || 'Failed to load payment portal records. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    }, [paymentPortalRecords.length]);

    const refreshPaymentPortalRecords = useCallback(async () => {
        await fetchPaymentPortalRecords(true, false);
    }, [fetchPaymentPortalRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchPaymentPortalRecords(true, true);
    }, [fetchPaymentPortalRecords]);

    // Initial fetch effect
    useEffect(() => {
        if (paymentPortalRecords.length === 0) {
            fetchPaymentPortalRecords(false, false);
        }
    }, [fetchPaymentPortalRecords, paymentPortalRecords.length]);

    return (
        <PaymentPortalContext.Provider value={{
            paymentPortalRecords,
            isLoading,
            error,
            refreshPaymentPortalRecords,
            silentRefresh,
            lastUpdated
        }}>
            {children}
        </PaymentPortalContext.Provider>
    );
};

export const usePaymentPortalContext = () => {
    const context = useContext(PaymentPortalContext);
    if (context === undefined) {
        throw new Error('usePaymentPortalContext must be used within a PaymentPortalProvider');
    }
    return context;
};

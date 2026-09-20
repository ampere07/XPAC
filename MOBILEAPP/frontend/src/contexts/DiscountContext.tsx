import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import * as discountService from '../services/discountService';

interface DiscountRecord {
    id: string;
    fullName: string;
    accountNo: string;
    contactNumber: string;
    emailAddress: string;
    address: string;
    plan: string;
    provider: string;
    discountId: string;
    discountAmount: number;
    discountStatus: string;
    dateCreated: string;
    processedBy: string;
    processedDate: string;
    approvedBy: string;
    approvedByEmail?: string;
    modifiedBy: string;
    modifiedDate: string;
    userEmail: string;
    remarks: string;
    cityId?: number;
    barangay?: string;
    city?: string;
    completeAddress?: string;
    onlineStatus?: string;
}

interface DiscountContextType {
    discountRecords: DiscountRecord[];
    isLoading: boolean;
    error: string | null;
    refreshDiscountRecords: () => Promise<void>;
    silentRefresh: () => Promise<void>;
    lastUpdated: Date | null;
}

const DiscountContext = createContext<DiscountContextType | undefined>(undefined);

export const useDiscountContext = () => {
    const context = useContext(DiscountContext);
    if (!context) {
        throw new Error('useDiscountContext must be used within a DiscountProvider');
    }
    return context;
};

interface DiscountProviderProps {
    children: ReactNode;
}

const transformDiscountData = (data: any[]): DiscountRecord[] => {
    return data.map((discount: any) => {
        const customer = discount.billing_account?.customer;
        const plan = discount.billing_account?.plan;

        return {
            id: String(discount.id),
            fullName: customer?.full_name ||
                [customer?.first_name, customer?.middle_initial, customer?.last_name]
                    .filter(Boolean).join(' ') || 'N/A',
            accountNo: discount.account_no || 'N/A',
            contactNumber: customer?.contact_number_primary || 'N/A',
            emailAddress: customer?.email_address || 'N/A',
            address: customer?.address || 'N/A',
            completeAddress: [
                customer?.address,
                customer?.location,
                customer?.barangay,
                customer?.city,
                customer?.region
            ].filter(Boolean).join(', ') || 'N/A',
            plan: plan?.plan_name || 'N/A',
            provider: 'N/A',
            discountId: String(discount.id),
            discountAmount: parseFloat(discount.discount_amount) || 0,
            discountStatus: discount.status || 'Unknown',
            dateCreated: discount.created_at ? new Date(discount.created_at).toLocaleDateString() : 'N/A',
            processedBy: discount.processed_by_user?.full_name || discount.processed_by_user?.username || 'N/A',
            processedDate: discount.processed_date ? new Date(discount.processed_date).toLocaleDateString() : 'N/A',
            approvedBy: discount.approved_by_user?.full_name || discount.approved_by_user?.username || 'N/A',
            approvedByEmail: discount.approved_by_user?.email_address || discount.approved_by_user?.email,
            modifiedBy: discount.updated_by_user?.full_name || discount.updated_by_user?.username || 'N/A',
            modifiedDate: discount.updated_at ? new Date(discount.updated_at).toLocaleString() : 'N/A',
            userEmail: discount.processed_by_user?.email_address || discount.processed_by_user?.email || 'N/A',
            remarks: discount.remarks || '',
            cityId: undefined,
            barangay: customer?.barangay,
            city: customer?.city,
            onlineStatus: undefined
        };
    });
};

export const DiscountProvider: React.FC<DiscountProviderProps> = ({ children }) => {
    const [discountRecords, setDiscountRecords] = useState<DiscountRecord[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchDiscountRecords = useCallback(async (force = false, silent = false) => {
        // If we have data and not forced, skip fetching
        if (!force && discountRecords.length > 0) {
            return;
        }

        if (!silent) {
            setIsLoading(true);
        }

        try {
            const response = await discountService.getAll();
            if (response.success && response.data) {
                const transformedData = transformDiscountData(response.data);
                setDiscountRecords(transformedData);
                setLastUpdated(new Date());
                setError(null);
            } else {
                throw new Error('Failed to fetch discount records');
            }
        } catch (err: any) {
            console.error('Failed to fetch discount records:', err);
            if (!silent) {
                setError('Failed to load discount records. Please try again.');
                // Don't clear data on error if we have it
                if (discountRecords.length === 0) {
                    setDiscountRecords([]);
                }
            }
        } finally {
            setIsLoading(false);
        }
    }, [discountRecords.length]);

    const refreshDiscountRecords = useCallback(async () => {
        await fetchDiscountRecords(true, false);
    }, [fetchDiscountRecords]);

    const silentRefresh = useCallback(async () => {
        await fetchDiscountRecords(true, true);
    }, [fetchDiscountRecords]);

    // Initial fetch effect
    useEffect(() => {
        // Only fetch if empty, otherwise let the logic decide
        if (discountRecords.length === 0) {
            fetchDiscountRecords(false, false);
        }
    }, [fetchDiscountRecords, discountRecords.length]);

    return (
        <DiscountContext.Provider
            value={{
                discountRecords,
                isLoading,
                error,
                refreshDiscountRecords,
                silentRefresh,
                lastUpdated
            }}
        >
            {children}
        </DiscountContext.Provider>
    );
};

export type { DiscountRecord };

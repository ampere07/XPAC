import { create } from 'zustand';
import * as discountService from '../services/discountService';

export interface DiscountRecord {
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
    region?: string;
    completeAddress?: string;
    onlineStatus?: string;
    createdAtRaw?: string;
    processedDateRaw?: string;
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
            region: customer?.region,
            onlineStatus: undefined,
            createdAtRaw: discount.created_at,
            processedDateRaw: discount.processed_date
        };
    });
};

interface DiscountState {
    discountRecords: DiscountRecord[];
    isLoading: boolean;
    error: string | null;
    lastUpdated: Date | null;

    fetchDiscounts: (silent?: boolean) => Promise<void>;
    refreshDiscounts: () => Promise<void>;
    silentRefresh: () => Promise<void>;
}

export const useDiscountStore = create<DiscountState>((set, get) => ({
    discountRecords: [],
    isLoading: false,
    error: null,
    lastUpdated: null,

    fetchDiscounts: async (silent = false) => {
        const { discountRecords } = get();

        // Only show loading if not silent OR if we have no data
        if (!silent || discountRecords.length === 0) {
            set({ isLoading: true, error: null });
        }

        try {
            const response = await discountService.getAll();
            if (response.success && response.data) {
                const transformedData = transformDiscountData(response.data);
                set({
                    discountRecords: transformedData,
                    lastUpdated: new Date(),
                    error: null,
                    isLoading: false
                });
            } else {
                throw new Error('Failed to fetch discount records');
            }
        } catch (err: any) {
            console.error('Failed to fetch discounts:', err);
            set({
                error: err.message || 'Failed to fetch discounts',
                isLoading: false
            });
        }
    },

    refreshDiscounts: async () => {
        set({ discountRecords: [] });
        await get().fetchDiscounts(false);
    },

    silentRefresh: async () => {
        await get().fetchDiscounts(true);
    }
}));

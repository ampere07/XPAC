export interface Transaction {
    id: string;
    account_no: string;
    transaction_type: string;
    received_payment: number;
    payment_date: string;
    date_processed: string;
    processed_by_user: string;
    payment_method: string;
    reference_no: string;
    or_no: string;
    remarks: string;
    status: string;
    image_url: string | null;
    created_at: string;
    updated_at: string;
    payment_method_info?: {
        id: number;
        payment_method: string;
    };
    account?: {
        id: number;
        account_no: string;
        customer: {
            full_name: string;
            contact_number_primary: string;
            barangay: string;
            city: string;
            desired_plan: string;
            address: string;
            region: string;
        };
        account_balance: number;
    };
}

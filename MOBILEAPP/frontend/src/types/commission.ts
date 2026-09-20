export interface CommissionData {
    id: string;
    customer: string;
    service: string;
    date: string;
    status: string;
    amount: string | number;
    [key: string]: any;
}

export interface PayoutHistoryData {
    id: string | number;
    ref_number: string;
    total_amount: string | number;
    agent_name: string;
    created_by: string;
    created_at: string;
    remarks?: string;
    proof_of_payment?: string;
    updated_by?: string;
    updated_at?: string;
    approved_by?: string;
    commission_id_list?: string;
    [key: string]: any;
}

export interface CommissionStats {
    total: string;
    pending: string;
    thisMonth: string;
    totalCount: number;
    user_name?: string;
    user_created_at?: string;
}

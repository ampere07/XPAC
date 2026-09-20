import apiClient from '../config/api';

export interface ReconnectionLogRecord {
    id: string;
    accountNo: string;
    customerName: string;
    address: string;
    contactNumber?: string;
    emailAddress?: string;
    plan?: string;
    balance?: number;
    status?: string;
    reconnectionDate?: string;
    reconnectedBy?: string;
    reason?: string;
    remarks?: string;
    cityId?: number;
    appliedDate?: string;
    reconnectionFee?: number;
    daysDisconnected?: number;
    username?: string;
    sessionId?: string;
    splynxId?: string;
    mikrotikId?: string;
    disconnectionCode?: string;
    reconnectionCode?: string;
    onlineStatus?: string;
    date?: string;
    barangay?: string;
    city?: string;
    dateFormat?: string;
    organization_id?: number;
}

export const getReconnectionLogs = async (page: number = 1, perPage: number = 1000): Promise<{ data: ReconnectionLogRecord[], total: number, hasMore: boolean }> => {
    try {
        const response = await apiClient.get<any>('/reconnection-logs', {
            params: { page, per_page: perPage }
        });
        const responseData = response.data;

        if (responseData?.status === 'success' && Array.isArray(responseData.data)) {
            return {
                data: responseData.data,
                total: responseData.total || responseData.data.length,
                hasMore: responseData.pagination?.has_more || false
            };
        }

        return { data: [], total: 0, hasMore: false };
    } catch (error) {
        console.error('Error fetching reconnection logs:', error);
        return { data: [], total: 0, hasMore: false };
    }
};

import apiClient from '../config/api';

export interface DataLogRecord {
    id: string;
    log_type: string;
    old_details: string | null;
    new_details: string | null;
    created_at: string;
    created_by: string;
    updated_at: string;
    updated_by: string;
}

export const getDataLogs = async (params: { search?: string; logType?: string; limit?: number } = {}): Promise<{ data: DataLogRecord[] }> => {
    try {
        const response = await apiClient.get<any>('/data-logs', {
            params: {
                search: params.search || undefined,
                log_type: params.logType || undefined,
                limit: params.limit || undefined
            }
        });
        const responseData = response.data;

        if (responseData?.status === 'success' && Array.isArray(responseData.data)) {
            return {
                data: responseData.data
            };
        }

        return { data: [] };
    } catch (error) {
        console.error('Error fetching data logs:', error);
        return { data: [] };
    }
};

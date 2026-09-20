import apiClient from '../config/api';

export interface NAP {
    id: number;
    nap_name: string;
    created_at?: string;
    updated_at?: string;
}

interface PaginationMeta {
    current_page: number;
    total_pages: number;
    total_items: number;
    items_per_page: number;
    has_next: boolean;
    has_prev: boolean;
}

export interface NapApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
    pagination?: PaginationMeta;
    errors?: Record<string, string[]>;
}

export const getNAPs = async (
    page: number = 1,
    limit: number = 50,
    search: string = ''
): Promise<NapApiResponse<NAP[]>> => {
    try {
        const response = await apiClient.get<NapApiResponse<NAP[]>>('/nap', {
            params: { page, limit, search }
        });
        return response.data;
    } catch (error: any) {
        console.error('Error fetching NAP records:', error);
        throw error;
    }
};

export const getAllNAPs = async (): Promise<NapApiResponse<NAP[]>> => {
    return getNAPs(1, 10000);
};

export const getNAPById = async (id: number): Promise<NapApiResponse<NAP>> => {
    try {
        const response = await apiClient.get<NapApiResponse<NAP>>(`/nap/${id}`);
        return response.data;
    } catch (error: any) {
        console.error('Error fetching NAP record:', error);
        throw error;
    }
};

export const createNAP = async (name: string): Promise<NapApiResponse<NAP>> => {
    try {
        const response = await apiClient.post<NapApiResponse<NAP>>('/nap', { name });
        return response.data;
    } catch (error: any) {
        console.error('Error creating NAP:', error);
        throw error;
    }
};

export const updateNAP = async (id: number, name: string): Promise<NapApiResponse<NAP>> => {
    try {
        const response = await apiClient.put<NapApiResponse<NAP>>(`/nap/${id}`, { name });
        return response.data;
    } catch (error: any) {
        console.error('Error updating NAP:', error);
        throw error;
    }
};

export const deleteNAP = async (id: number): Promise<NapApiResponse<void>> => {
    try {
        const response = await apiClient.delete<NapApiResponse<void>>(`/nap/${id}`);
        return response.data;
    } catch (error: any) {
        console.error('Error deleting NAP:', error);
        throw error;
    }
};

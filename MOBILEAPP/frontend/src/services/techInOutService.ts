import apiClient from '../config/api';

export const techInOutService = {
    getStatus: async (techId: number) => {
        const response = await apiClient.get(`/tech-in-out/status?tech_id=${techId}`);
        return response.data;
    },

    timeIn: async (techId: number) => {
        const response = await apiClient.post(`/tech-in-out/time-in`, { tech_id: techId });
        return response.data;
    },

    timeOut: async (techId: number) => {
        const response = await apiClient.post(`/tech-in-out/time-out`, { tech_id: techId });
        return response.data;
    }
};

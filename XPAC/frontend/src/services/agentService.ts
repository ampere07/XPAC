import apiClient from '../config/api';
import {
  Agent,
  ApiResponse
} from '../types/api';

export const agentService = {
  getAllAgents: async (): Promise<ApiResponse<Agent[]>> => {
    try {
      const response = await apiClient.get<ApiResponse<Agent[]>>('/agents');
      return response.data;
    } catch (error: any) {
      console.error('Get agents API error:', error.message);
      throw error;
    }
  },

  createAgent: async (agentData: Omit<Agent, 'id' | 'created_at'>): Promise<ApiResponse<Agent>> => {
    try {
      const response = await apiClient.post<ApiResponse<Agent>>('/agents', agentData);
      return response.data;
    } catch (error: any) {
      console.error('Create agent API error:', error.message);
      throw error;
    }
  },

  getAgentById: async (agentId: number): Promise<ApiResponse<Agent>> => {
    const response = await apiClient.get<ApiResponse<Agent>>(`/agents/${agentId}`);
    return response.data;
  },

  updateAgent: async (agentId: number, agentData: Partial<Agent>): Promise<ApiResponse<Agent>> => {
    try {
      const response = await apiClient.put<ApiResponse<Agent>>(`/agents/${agentId}`, agentData);
      return response.data;
    } catch (error: any) {
      console.error('Update agent API error:', error.message);
      throw error;
    }
  },

  deleteAgent: async (agentId: number): Promise<ApiResponse<void>> => {
    try {
      const response = await apiClient.delete<ApiResponse<void>>(`/agents/${agentId}`);
      return response.data;
    } catch (error: any) {
      console.error('Delete agent API error:', error.message);
      throw error;
    }
  }
};

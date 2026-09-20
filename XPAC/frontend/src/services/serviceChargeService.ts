import apiClient from '../config/api';

export interface ServiceChargeRecord {
  id: string | number;
  date: string;
  amount: number;
  type: string;
  status: string;
  remarks?: string;
  source: 'Log' | 'Order';
}

export const serviceChargeService = {
  getServiceChargeLogsByAccountNo: async (accountNo: string) => {
    try {
      const response = await apiClient.get<any>(`/service-charges?account_no=${accountNo}`);
      return response.data.success ? response.data.data : [];
    } catch (error) {
      console.error('Error fetching service charge logs:', error);
      return [];
    }
  },

  getServiceOrdersByAccountNo: async (accountNo: string) => {
    try {
      // The ServiceOrderApiController has a filter for account_no
      const response = await apiClient.get<any>(`/service-orders?account_no=${accountNo}`);
      return response.data.success ? response.data.data : [];
    } catch (error) {
      console.error('Error fetching service orders for charges:', error);
      return [];
    }
  }
};

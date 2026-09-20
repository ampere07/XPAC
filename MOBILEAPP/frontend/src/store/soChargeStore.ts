import { create } from 'zustand';
import apiClient from '../config/api';

export interface SOChargeRecord {
  id: string | number;
  display_id: string | number;
  account_no: string;
  full_name?: string;
  date: string;
  amount: number;
  type: string;
  status: string;
  remarks?: string;
  source: 'Log' | 'Order';
  organization_id?: number;
}

interface SOChargeState {
  chargeRecords: SOChargeRecord[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  
  fetchChargeRecords: (force?: boolean, silent?: boolean) => Promise<void>;
  refreshChargeRecords: () => Promise<void>;
  silentRefresh: () => Promise<void>;
}

export const useSOChargeStore = create<SOChargeState>((set, get) => ({
  chargeRecords: [],
  totalCount: 0,
  isLoading: false,
  error: null,
  lastUpdated: null,

  fetchChargeRecords: async (force = false, silent = false) => {
    if (get().isLoading && !force) return;
    if (!force && get().chargeRecords.length > 0) return;

    if (!silent) set({ isLoading: true, error: null });

    try {
      // 1. Fetch Logs (Manual Charges)
      const logsResponse = await apiClient.get<any>('/service-charges');
      const logs = logsResponse.data.success ? logsResponse.data.data : [];

      // 2. Fetch Service Orders with charges
      const ordersResponse = await apiClient.get<any>('/service-orders?has_charge=1');
      const orders = ordersResponse.data.success ? ordersResponse.data.data : [];

      // Mapping Logic (Similar to customerDashboardStore)
      const mappedLogs: SOChargeRecord[] = logs.map((log: any) => ({
        id: `log-${log.id}`,
        display_id: log.id,
        account_no: log.account_no,
        date: log.created_at,
        amount: parseFloat(log.service_charge),
        type: 'Manual Charge',
        status: log.status,
        remarks: log.remarks,
        source: 'Log'
      }));

      const mappedOrders: SOChargeRecord[] = orders.map((order: any) => ({
        id: `order-${order.id}`,
        display_id: order.id,
        account_no: order.account_no,
        date: order.timestamp || order.created_at,
        amount: parseFloat(order.service_charge),
        type: order.concern || 'Service Order Charge',
        status: order.status === 'used' ? 'Used' : 'Unused',
        remarks: order.concern_remarks,
        source: 'Order',
        organization_id: order.organization_id
      }));

      const combined = [...mappedLogs, ...mappedOrders].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Try to fetch customer names for account numbers if needed
      // For now we rely on the display logic or further API calls if needed

      set({
        chargeRecords: combined,
        totalCount: combined.length,
        isLoading: false,
        lastUpdated: new Date()
      });
    } catch (err: any) {
      console.error('Failed to fetch SO charge records:', err);
      set({ error: err.message || 'Failed to load records', isLoading: false });
    }
  },

  refreshChargeRecords: async () => {
    await get().fetchChargeRecords(true, false);
  },

  silentRefresh: async () => {
    await get().fetchChargeRecords(true, true);
  }
}));

import { create } from 'zustand';
import { CommissionData, PayoutHistoryData, CommissionStats } from '../types/commission';
import { commissionService } from '../services/commissionService';

interface CommissionState {
    earnings: CommissionData[];
    // The whole of agent_commission_history for whoever is signed in, which is
    // the single list both the History screen and Agent Payout read.
    //
    // The Incentives and Bonus lists that used to sit beside it are gone: they
    // existed only for the History screen's Incentives / Bonus tabs, and those
    // tabs split one table three ways and hid any row whose `type` matched none
    // of them. Both endpoints were swept on every load for nothing else.
    payoutHistory: PayoutHistoryData[];
    stats: CommissionStats | null;
    totalEarnings: number;
    totalPayouts: number;
    isLoading: boolean;
    lastUpdated: Date | null;
    currentFetchId: number | null;

    fetchCommissions: (force?: boolean) => Promise<void>;
    fetchUpdates: () => Promise<void>;
    setData: (data: CommissionData[]) => void;
    setPayoutHistory: (history: PayoutHistoryData[]) => void;
    setStats: (stats: CommissionStats) => void;
}

export const useCommissionStore = create<CommissionState>((set, get) => ({
    earnings: [],
    payoutHistory: [],
    stats: null,
    totalEarnings: 0,
    totalPayouts: 0,
    isLoading: false,
    lastUpdated: null,
    currentFetchId: null,

    setData: (data) => set({ earnings: data }),
    setPayoutHistory: (history) => set({ payoutHistory: history }),
    setStats: (stats) => set({ stats }),

    fetchCommissions: async (force = false) => {
        const fetchId = Date.now();
        set({ currentFetchId: fetchId });

        const { earnings, payoutHistory } = get();
        if (!force && earnings.length > 0 && payoutHistory.length > 0) return;

        set({ isLoading: true });
        const CHUNK_SIZE = 2000;

        try {
            // 1. Fetch Earnings progressively
            let allEarnings: CommissionData[] = [];
            let earningsOffset = 0;
            let hasMoreEarnings = true;

            while (hasMoreEarnings) {
                if (get().currentFetchId !== fetchId) return;

                const res = await commissionService.getEarnings(CHUNK_SIZE, earningsOffset) as any;
                if (res.success) {
                    const newRecords = res.data;
                    allEarnings = [...allEarnings, ...newRecords];
                    
                    const totalServer = res.total || res.stats?.totalCount || 0;
                    set({ 
                        earnings: [...allEarnings], 
                        stats: res.stats,
                        totalEarnings: totalServer
                    });
                    
                    hasMoreEarnings = allEarnings.length < totalServer && newRecords.length > 0;
                    earningsOffset = allEarnings.length;
                    
                    // Hide main loader after first batch
                    if (earningsOffset === newRecords.length) set({ isLoading: false });
                } else {
                    hasMoreEarnings = false;
                }
            }

            // 2. Fetch Payout History progressively
            let allPayouts: PayoutHistoryData[] = [];
            let payoutsOffset = 0;
            let hasMorePayouts = true;

            while (hasMorePayouts) {
                if (get().currentFetchId !== fetchId) return;

                const res = await commissionService.getPayoutHistory(CHUNK_SIZE, payoutsOffset) as any;
                if (res.success) {
                    const newRecords = res.data;
                    allPayouts = [...allPayouts, ...newRecords];
                    
                    const totalServer = res.total || 0;
                    set({ 
                        payoutHistory: [...allPayouts],
                        totalPayouts: totalServer
                    });
                    
                    hasMorePayouts = allPayouts.length < totalServer && newRecords.length > 0;
                    payoutsOffset = allPayouts.length;
                    
                    set({ isLoading: false });
                } else {
                    hasMorePayouts = false;
                }
            }

            set({ lastUpdated: new Date() });
        } catch (error) {
            console.error('[CommissionStore] Fetch failed:', error);
        } finally {
            if (get().currentFetchId === fetchId) {
                set({ isLoading: false });
            }
        }
    },

    fetchUpdates: async () => {
        const { lastUpdated, totalEarnings, totalPayouts } = get();
        if (!lastUpdated) {
            await get().fetchCommissions(true);
            return;
        }

        try {
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');

            const [earningResRaw, historyResRaw] = await Promise.all([
                commissionService.getEarnings(1000, 0, formattedDate),
                commissionService.getPayoutHistory(1000, 0, formattedDate)
            ]);

            const earningRes = earningResRaw as any;
            const historyRes = historyResRaw as any;

            if (earningRes.success && earningRes.data.length > 0) {
                const updates = earningRes.data;
                set((state) => {
                    const map = new Map(state.earnings.map(i => [i.id, i]));
                    updates.forEach((u: any) => map.set(u.id, u));
                    return {
                        earnings: Array.from(map.values()).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()),
                        stats: earningRes.stats || state.stats,
                        totalEarnings: earningRes.total || totalEarnings
                    };
                });
            }

            if (historyRes.success && historyRes.data.length > 0) {
                const updates = historyRes.data;
                set((state) => {
                    const map = new Map(state.payoutHistory.map(i => [i.id, i]));
                    updates.forEach((u: any) => map.set(u.id, u));
                    return {
                        payoutHistory: Array.from(map.values()).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
                        totalPayouts: historyRes.total || totalPayouts
                    };
                });
            }

            set({ lastUpdated: new Date() });
        } catch (error) {
            console.error('[CommissionStore] Update failed:', error);
        }
    }
}));

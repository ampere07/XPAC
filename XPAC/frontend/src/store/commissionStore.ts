import { create } from 'zustand';
import { CommissionData, PayoutHistoryData, CommissionStats } from '../types/commission';
import { commissionService } from '../services/commissionService';

interface CommissionState {
    earnings: CommissionData[];
    payoutHistory: PayoutHistoryData[];
    incentiveHistory: any[];
    bonusHistory: any[];
    stats: CommissionStats | null;
    totalEarnings: number;
    totalPayouts: number;
    totalIncentives: number;
    totalBonus: number;
    isLoading: boolean;
    lastUpdated: Date | null;
    currentFetchId: number | null;

    fetchCommissions: (force?: boolean) => Promise<void>;
    fetchUpdates: () => Promise<void>;
    setData: (data: CommissionData[]) => void;
    setPayoutHistory: (history: PayoutHistoryData[]) => void;
    setIncentiveHistory: (history: any[]) => void;
    setBonusHistory: (history: any[]) => void;
    setStats: (stats: CommissionStats) => void;
}

export const useCommissionStore = create<CommissionState>((set, get) => ({
    earnings: [],
    payoutHistory: [],
    incentiveHistory: [],
    bonusHistory: [],
    stats: null,
    totalEarnings: 0,
    totalPayouts: 0,
    totalIncentives: 0,
    totalBonus: 0,
    isLoading: false,
    lastUpdated: null,
    currentFetchId: null,

    setData: (data) => set({ earnings: data }),
    setPayoutHistory: (history) => set({ payoutHistory: history }),
    setIncentiveHistory: (history) => set({ incentiveHistory: history }),
    setBonusHistory: (history) => set({ bonusHistory: history }),
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

            // 3. Fetch Incentive History (auto-awarded quota incentives) progressively
            let allIncentives: any[] = [];
            let incentivesOffset = 0;
            let hasMoreIncentives = true;

            while (hasMoreIncentives) {
                if (get().currentFetchId !== fetchId) return;

                const res = await commissionService.getIncentiveHistory(CHUNK_SIZE, incentivesOffset) as any;
                if (res.success) {
                    const newRecords = res.data;
                    allIncentives = [...allIncentives, ...newRecords];

                    const totalServer = res.total || 0;
                    set({
                        incentiveHistory: [...allIncentives],
                        totalIncentives: totalServer
                    });

                    hasMoreIncentives = allIncentives.length < totalServer && newRecords.length > 0;
                    incentivesOffset = allIncentives.length;

                    set({ isLoading: false });
                } else {
                    hasMoreIncentives = false;
                }
            }

            // 4. Fetch Bonus History (manual bonus add / payout) progressively
            let allBonus: any[] = [];
            let bonusOffset = 0;
            let hasMoreBonus = true;

            while (hasMoreBonus) {
                if (get().currentFetchId !== fetchId) return;

                const res = await commissionService.getBonusHistory(CHUNK_SIZE, bonusOffset) as any;
                if (res.success) {
                    const newRecords = res.data;
                    allBonus = [...allBonus, ...newRecords];

                    const totalServer = res.total || 0;
                    set({
                        bonusHistory: [...allBonus],
                        totalBonus: totalServer
                    });

                    hasMoreBonus = allBonus.length < totalServer && newRecords.length > 0;
                    bonusOffset = allBonus.length;

                    set({ isLoading: false });
                } else {
                    hasMoreBonus = false;
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
        const { lastUpdated, totalEarnings, totalPayouts, totalIncentives, totalBonus } = get();
        if (!lastUpdated) {
            await get().fetchCommissions(true);
            return;
        }

        try {
            const formattedDate = lastUpdated.toISOString().slice(0, 19).replace('T', ' ');

            const [earningResRaw, historyResRaw, incentiveResRaw, bonusResRaw] = await Promise.all([
                commissionService.getEarnings(1000, 0, formattedDate),
                commissionService.getPayoutHistory(1000, 0, formattedDate),
                commissionService.getIncentiveHistory(1000, 0, formattedDate),
                commissionService.getBonusHistory(1000, 0, formattedDate)
            ]);

            const earningRes = earningResRaw as any;
            const historyRes = historyResRaw as any;
            const incentiveRes = incentiveResRaw as any;
            const bonusRes = bonusResRaw as any;

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

            if (incentiveRes.success && incentiveRes.data.length > 0) {
                const updates = incentiveRes.data;
                set((state) => {
                    const map = new Map(state.incentiveHistory.map((i: any) => [i.id, i]));
                    updates.forEach((u: any) => map.set(u.id, u));
                    return {
                        incentiveHistory: Array.from(map.values()).sort((a: any, b: any) => new Date(b.processed_at || b.created_at || 0).getTime() - new Date(a.processed_at || a.created_at || 0).getTime()),
                        totalIncentives: incentiveRes.total || totalIncentives
                    };
                });
            }

            if (bonusRes.success && bonusRes.data.length > 0) {
                const updates = bonusRes.data;
                set((state) => {
                    const map = new Map(state.bonusHistory.map((i: any) => [i.id, i]));
                    updates.forEach((u: any) => map.set(u.id, u));
                    return {
                        bonusHistory: Array.from(map.values()).sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
                        totalBonus: bonusRes.total || totalBonus
                    };
                });
            }

            set({ lastUpdated: new Date() });
        } catch (error) {
            console.error('[CommissionStore] Update failed:', error);
        }
    }
}));

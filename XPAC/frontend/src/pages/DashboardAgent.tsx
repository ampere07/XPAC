import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, RefreshCw, Loader2, Timer } from 'lucide-react';
import { agentPortalService } from '../services/commissionService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useJobOrderStore } from '../store/jobOrderStore';
import {
    ACHIEVEMENT_TIERS,
    AchievementTier,
    AgentIdentity,
    clockSkewFrom,
    createAgentReferralMatcher,
    formatCountdown,
    getOnsiteStatus,
    getStoredAgentIdentity,
    isDoneOnsiteStatus,
    isFailedOnsiteStatus,
    isInProgressOnsiteStatus,
    isOnOrAfterAgentStartDate,
    isRescheduleOnsiteStatus,
    millisUntilReset,
    parseResetsAt
} from '../utils/agentReferral';

/**
 * How long is left in one tier's period.
 *
 * The tick lives here rather than on the dashboard so a second passing repaints
 * this pill alone. Held one level up it re-rendered the whole page — both
 * achievement cards, the balance card, the cashout list — once a second for a
 * line of text that changes.
 *
 * The instant it counts to is the server's, and the difference between the two
 * clocks is read fresh on every tick: a reply that lands mid-period corrects the
 * countdown without it having to be torn down.
 */
const ResetCountdown: React.FC<{
    resetsAt: number | null;
    skew: React.MutableRefObject<number>;
}> = ({ resetsAt, skew }) => {
    const read = useCallback(
        () => (resetsAt === null ? '' : formatCountdown(millisUntilReset(resetsAt, Date.now() + skew.current))),
        [resetsAt, skew]
    );

    const [label, setLabel] = useState(read);

    useEffect(() => {
        const render = () => setLabel(read());
        render();

        const tick = window.setInterval(render, 1000);
        return () => window.clearInterval(tick);
    }, [read]);

    if (!label) return <div className="mb-6" />;

    return (
        <div className="mb-6 mt-3 flex items-center gap-2 rounded-full bg-slate-50 px-3.5 py-1.5 ring-1 ring-slate-100">
            <Timer size={14} className="shrink-0 text-slate-400" />
            <span className="text-xs text-slate-500">Resets in</span>
            <span className="font-mono text-xs font-bold tabular-nums text-slate-700">{label}</span>
        </div>
    );
};

/**
 * One achievement tier as the server reports it.
 *
 * The count is bounded to the current week or month server side — the dashboard
 * cannot work that out from the job order list alone, because a referral's
 * completion date decides which period it belongs to.
 */
interface ServerTier {
    key: 'weekly' | 'monthly';
    label: string;
    target: number;
    reward: number;
    onboarded: number;
    reached: boolean;
    claimed: boolean;
    claimable: boolean;
    /** When this tier's count returns to zero, in epoch milliseconds. */
    resetsAt: number | null;
    /**
     * True when a claim set this cycle going rather than the calendar.
     *
     * Claiming early ends the cycle there and starts a fresh one of the same
     * length, so the cycle no longer runs Monday to Sunday and calling it "this
     * week" would be wrong.
     */
    anchored: boolean;
}

/**
 * How long after a reset falls due before asking the server for the new period.
 *
 * Also the shortest gap between those attempts, so a small clock difference
 * turns into one or two quiet retries rather than a burst of requests.
 */
const RESET_RELOAD_GRACE_MS = 3000;

interface DashboardAgentProps {
    onNavigate?: (section: string, extra?: string) => void;
}

interface Cashout {
    id: number | string;
    ref_number?: string;
    total_amount?: number | string;
    created_at?: string;
}

// The agent view is presented in light mode in both clients so the gradient balance
// card renders identically on the web and in the mobile app.
const PAGE_BG = '#f9fafb';

const formatCurrency = (amount: number): string => {
    const isNegative = amount < 0;
    const formatted = Math.abs(amount).toFixed(0).replace(/\d(?=(\d{3})+$)/g, '$&,');
    return `₱${isNegative ? '-' : ''}${formatted}`;
};

const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

// Three-quarter-arc speedometer matching the mobile achievement gauge.
const AchievementGauge: React.FC<{ value: number; target: number; color: string }> = ({ value, target, color }) => {
    const size = 220;
    const radius = (size - 30) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const arcLength = circumference * 0.75;
    const progress = target > 0 ? Math.min(Math.max(value / target, 0), 1) : 0;

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <g transform={`rotate(135 ${center} ${center})`}>
                    <circle
                        cx={center}
                        cy={center}
                        r={radius}
                        stroke="#e2e8f0"
                        strokeWidth={30}
                        strokeDasharray={`${arcLength} ${circumference}`}
                        fill="none"
                        strokeLinecap="round"
                    />
                    <circle
                        cx={center}
                        cy={center}
                        r={radius}
                        stroke={color}
                        strokeWidth={30}
                        strokeDasharray={`${arcLength} ${circumference}`}
                        strokeDashoffset={arcLength * (1 - progress)}
                        fill="none"
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
                    />
                </g>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-extrabold leading-none text-slate-900">{value}</span>
                <span className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">Onboarded</span>
            </div>
        </div>
    );
};

const DashboardAgent: React.FC<DashboardAgentProps> = ({ onNavigate }) => {
    const [identity] = useState<AgentIdentity>(() => getStoredAgentIdentity());
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    const { jobOrders, silentRefresh } = useJobOrderStore();

    const [cashouts, setCashouts] = useState<Cashout[]>([]);
    const [agentBalance, setAgentBalance] = useState(0);
    /** Commission earned from approved job orders — agent_balance.commission_value. */
    const [agentCommission, setAgentCommission] = useState(0);
    const [agentIncentives, setAgentIncentives] = useState(0);
    const [agentBonus, setAgentBonus] = useState(0);
    const [agentAchievement, setAgentAchievement] = useState(0);

    /** Tier state as the server reports it: period-bounded counts and claim state. */
    const [serverTiers, setServerTiers] = useState<ServerTier[]>([]);
    /** Device-to-server clock difference, applied before every comparison. */
    const clockSkew = useRef(0);
    /** When a reload was last triggered by a rollover, to space out retries. */
    const lastResetReload = useRef(0);
    /** Which achievement card is showing. 0 is Weekly, the default on load. */
    const [activeTier, setActiveTier] = useState(0);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const swipeStartX = useRef<number | null>(null);

    const [isClaiming, setIsClaiming] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    /** Which face of the card is showing: Wallet, Referrals or Applications. */
    const [activeCardTab, setActiveCardTab] = useState(0);
    /** Whether the headline figure's breakdown is open. */
    const [isCardExpanded, setIsCardExpanded] = useState(false);
    /** Masks the figures, for reading the card in public. */
    const [isAmountHidden, setIsAmountHidden] = useState(false);
    /** Applications this agent has raised, counted server side. */
    const [applicationCount, setApplicationCount] = useState(0);
    /**
     * The card body's height, which the active tab reproduces its gradient at.
     *
     * The gradient runs corner to corner, so the card's top edge is the palette
     * colour at the left and well darkened by the right. A tab can only look
     * like part of the card if it draws that same gradient at the same size and
     * shows the slice belonging to its own position.
     */
    const [cardBodyHeight, setCardBodyHeight] = useState(0);
    const cardBodyRef = useRef<HTMLDivElement | null>(null);

    const primaryColor = colorPalette?.primary || '#ef4444';

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                setColorPalette(await settingsColorPaletteService.getActive());
            } catch (err) {
                console.error('[DashboardAgent] Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();

        const handlePaletteUpdate = () => fetchColorPalette();
        window.addEventListener('palette-updated', handlePaletteUpdate);
        return () => window.removeEventListener('palette-updated', handlePaletteUpdate);
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            const response = await agentPortalService.getCommissionHistory();
            if (response?.success) {
                setCashouts(response.data || []);
                setAgentBalance(Number(response.balance ?? 0));
                // What the agent has earned in commission from approved job
                // orders. Its own column, separate from the spendable balance.
                setAgentCommission(Number(response.commission_value ?? 0));
                setAgentIncentives(Number(response.incentives ?? 0));
                setAgentBonus(Number(response.bonus ?? 0));
                setAgentAchievement(Number(response.achievement ?? 0));
            }
        } catch (err) {
            console.error('[DashboardAgent] Failed to fetch cashout history:', err);
        }
    }, []);

    const fetchApplicationCount = useCallback(async () => {
        try {
            const response = await agentPortalService.getApplicationCount();
            if (response?.success) setApplicationCount(Number(response.count) || 0);
        } catch (err) {
            console.error('[DashboardAgent] Failed to fetch application count:', err);
        }
    }, []);

    const fetchAchievements = useCallback(async (agentId: number) => {
        try {
            const response = await agentPortalService.getAchievements(agentId);

            // The server returns each tier already scoped to the current period,
            // with its target, reward, progress and whether it has been claimed.
            const tiersFromServer = (response as any)?.tiers;
            if (tiersFromServer && typeof tiersFromServer === 'object') {
                // Trust the server's clock over the device's for the countdown.
                clockSkew.current = clockSkewFrom((response as any)?.server_time, Date.now());

                setServerTiers(
                    Object.values(tiersFromServer).map((t: any) => ({
                        key: t.key,
                        label: t.label,
                        target: Number(t.target ?? 0),
                        reward: Number(t.reward ?? 0),
                        onboarded: Number(t.onboarded ?? 0),
                        reached: Boolean(t.reached),
                        claimed: Boolean(t.claimed),
                        claimable: Boolean(t.claimable),
                        resetsAt: parseResetsAt(t.resets_at),
                        anchored: Boolean(t.anchored),
                    }))
                );
            }
        } catch (err) {
            console.error('[DashboardAgent] Failed to fetch achievements:', err);
        }
    }, []);

    const loadAll = useCallback(async () => {
        const agentId = identity.id;
        await Promise.all([
            fetchHistory(),
            fetchApplicationCount(),
            agentId ? fetchAchievements(agentId) : Promise.resolve(),
            silentRefresh()
        ]);
    }, [identity.id, fetchHistory, fetchApplicationCount, fetchAchievements, silentRefresh]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await loadAll();
            if (!cancelled) setIsLoading(false);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity.id]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        try {
            await loadAll();
        } finally {
            setIsRefreshing(false);
        }
    }, [loadAll]);

    /**
     * Reloads the moment a period rolls over, so the count returns to zero and
     * the next countdown begins without anyone refreshing the page.
     *
     * Polled rather than set as a timer for the boundary: a monthly period can
     * be more than 24 days out, which overflows a browser timeout and would fire
     * it immediately. The poll reads the clock directly instead of through
     * state, so watching for the rollover costs no renders. If the server has
     * not moved on yet — its clock being a moment behind — the spacing below
     * turns that into a quiet retry every few seconds until it has.
     */
    useEffect(() => {
        if (!serverTiers.length) return;

        const check = () => {
            const now = Date.now();
            const serverNow = now + clockSkew.current;

            if (!serverTiers.some(t => t.resetsAt !== null && serverNow >= t.resetsAt)) return;
            if (now - lastResetReload.current < RESET_RELOAD_GRACE_MS) return;

            lastResetReload.current = now;
            loadAll();
        };

        check();

        const tick = window.setInterval(check, 1000);
        return () => window.clearInterval(tick);
    }, [serverTiers, loadAll]);

    /**
     * When each tier's period ends, keyed by tier.
     *
     * Weekly and monthly carry their own instant, so the two countdowns run
     * independently — the weekly one rolling over leaves the monthly one alone.
     */
    const resetsAtByTier = useMemo(() => {
        const out: Record<string, number | null> = {};
        serverTiers.forEach(tier => { out[tier.key] = tier.resetsAt; });
        return out;
    }, [serverTiers]);

    // Referral funnel counts, derived from the agent's own job orders exactly as the
    // mobile dashboard derives them.
    const { inProgressCount, onboardedCount, failedCount, rescheduleCount } = useMemo(() => {
        if (!identity.fullName && !identity.email) {
            return { inProgressCount: 0, onboardedCount: 0, failedCount: 0, rescheduleCount: 0 };
        }

        // Scoped to the programme start date, exactly as the Job Order page is.
        // Without this the tiles would count an agent's whole history while the
        // list below shows only what the programme covers, and neither those
        // figures nor the achievement count would reconcile with the other.
        //
        // One pass, and one status read per job order. The four tiles used to be
        // four separate scans of the list, each normalizing the same statuses
        // again — five walks of every job order the agent owns to produce four
        // numbers. A status belongs to at most one tile, so the buckets are
        // counted together and the else-if chain stops at the first match.
        const ownsReferral = createAgentReferralMatcher(identity.fullName, identity.email, identity.id);

        let inProgress = 0;
        let onboarded = 0;
        let failed = 0;
        let reschedule = 0;

        for (const jo of jobOrders as any[]) {
            if (!ownsReferral(jo.Referred_By || jo.referred_by || '')) continue;
            if (!isOnOrAfterAgentStartDate(jo)) continue;

            const status = getOnsiteStatus(jo);
            if (isInProgressOnsiteStatus(status)) inProgress++;
            else if (isDoneOnsiteStatus(status)) onboarded++;
            else if (isFailedOnsiteStatus(status)) failed++;
            else if (isRescheduleOnsiteStatus(status)) reschedule++;
        }

        return {
            inProgressCount: inProgress,
            onboardedCount: onboarded,
            failedCount: failed,
            rescheduleCount: reschedule
        };
    }, [jobOrders, identity.id, identity.fullName, identity.email]);

    // The tiers on offer. The server is the authority on targets and rewards, so
    // its figures win; the shared defaults cover the moment before they arrive.
    const tiers: AchievementTier[] = useMemo(() => {
        if (!serverTiers.length) return ACHIEVEMENT_TIERS;

        return ACHIEVEMENT_TIERS.map(fallback => {
            const fromServer = serverTiers.find(t => t.key === fallback.key);
            return fromServer
                ? { ...fallback, label: fromServer.label, target: fromServer.target, reward: fromServer.reward }
                : fallback;
        });
    }, [serverTiers]);

    /**
     * Progress toward one tier.
     *
     * The count comes from the server where it is available, because only the
     * server can bound it to the current week or month. Before that arrives —
     * and for an agent whose tiers have not loaded — it falls back to the same
     * onboarded figure the rest of this dashboard already shows, so the card is
     * never blank.
     */
    const tierProgress = useCallback((tier: AchievementTier) => {
        const fromServer = serverTiers.find(t => t.key === tier.key);
        const onboarded = fromServer ? fromServer.onboarded : onboardedCount;
        const capped = Math.min(onboarded, tier.target);
        const ratio = tier.target > 0 ? Math.min(onboarded / tier.target, 1) : 0;

        return {
            onboarded: capped,
            ratio,
            reached: fromServer ? fromServer.reached : onboarded >= tier.target,
            claimed: fromServer ? fromServer.claimed : false,
            claimable: fromServer ? fromServer.claimable : false,
            anchored: fromServer ? fromServer.anchored : false,
        };
    }, [serverTiers, onboardedCount]);

    /**
     * What to call the current cycle in the card's copy.
     *
     * A cycle that began when a reward was claimed no longer lines up with the
     * calendar, so "this week" would be wrong — the countdown beside it is the
     * honest answer in that case.
     */
    const cycleNoun = (tier: AchievementTier, anchored: boolean): string =>
        anchored ? 'in this cycle' : (tier.key === 'weekly' ? 'this week' : 'this month');

    const handleClaimReward = async (tier: AchievementTier) => {
        if (!identity.id || isClaiming) return;
        setIsClaiming(true);
        try {
            const response = await agentPortalService.claimAchievement({
                agent_id: identity.id,
                type: tier.key,
                milestone: tier.target
            });

            if (response?.success) {
                window.alert(
                    `Reward claimed! ${formatCurrency(tier.reward)} has been added to your balance ` +
                    `for reaching ${tier.target} onboards.`
                );
                // Reload both the balances and the tier state, so the card moves
                // straight to "Claimed" rather than offering the reward again.
                await loadAll();
            } else {
                window.alert(response?.message || 'Failed to claim reward.');
            }
        } catch (err: any) {
            window.alert(err?.response?.data?.message || 'An unexpected error occurred.');
        } finally {
            setIsClaiming(false);
        }
    };

    // ── Swipe between the two achievement cards ──────────────────────────────
    // Only one card is ever in view; dragging moves the track with the pointer
    // and settles on the nearer card when released.
    const SWIPE_THRESHOLD = 60;

    const onSwipeStart = (e: React.TouchEvent | React.MouseEvent) => {
        const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
        swipeStartX.current = x;
        setIsSwiping(true);
    };

    const onSwipeMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!isSwiping || swipeStartX.current === null) return;
        const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const delta = x - swipeStartX.current;

        // Resist dragging past the first or last card, so the edges feel solid.
        const atStart = activeTier === 0 && delta > 0;
        const atEnd = activeTier === tiers.length - 1 && delta < 0;
        setSwipeOffset(atStart || atEnd ? delta * 0.25 : delta);
    };

    const onSwipeEnd = () => {
        if (!isSwiping) return;

        if (swipeOffset <= -SWIPE_THRESHOLD && activeTier < tiers.length - 1) {
            setActiveTier(activeTier + 1);          // swipe left  → Monthly
        } else if (swipeOffset >= SWIPE_THRESHOLD && activeTier > 0) {
            setActiveTier(activeTier - 1);          // swipe right → Weekly
        }

        setIsSwiping(false);
        setSwipeOffset(0);
        swipeStartX.current = null;
    };

    const latestCashouts = useMemo(() => cashouts.slice(0, 5), [cashouts]);
    // Every bucket that can actually be cashed out, in the same order the payout
    // screen drains them. `achievement` is deliberately absent: a claimed reward
    // is already paid into `balance`, and that figure is only a lifetime
    // "rewards earned" total for the tile below — adding it would count the
    // reward twice.
    const totalBalance = agentCommission + agentBalance + agentIncentives + agentBonus;

    const displayName = identity.fullName || 'Agent';
    const initials = displayName.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase();

    /**
     * The three faces of the card, each a headline figure.
     *
     * Wallet and Referrals sum the parts listed under them, and `action` says
     * so: those two open, while Applications has nothing to break down and
     * offers the form instead. Wallet totals only what can actually be cashed
     * out — `achievement` is listed for reference but stays out of the total,
     * because a claimed reward is already paid into the balance and would
     * otherwise be counted twice.
     */
    const cardTabs = useMemo(() => [
        {
            key: 'wallet',
            label: 'Wallet',
            caption: 'AVAILABLE BALANCE',
            total: formatCurrency(totalBalance),
            action: 'expand' as const,
            items: [
                { label: 'Incentives', value: formatCurrency(agentIncentives) },
                // Commission earned from approved job orders, not the spendable
                // balance — those are separate columns and pay out separately.
                { label: 'Commission', value: formatCurrency(agentCommission) },
                { label: 'Bonus', value: formatCurrency(agentBonus) },
                { label: 'Achievement', value: formatCurrency(agentAchievement) },
            ],
        },
        {
            key: 'referrals',
            label: 'Referrals',
            caption: 'TOTAL REFERRALS',
            total: String(inProgressCount + onboardedCount + failedCount + rescheduleCount),
            action: 'expand' as const,
            items: [
                { label: 'In Progress', value: String(inProgressCount) },
                { label: 'Done', value: String(onboardedCount) },
                { label: 'Failed', value: String(failedCount) },
                { label: 'Reschedule', value: String(rescheduleCount) },
            ],
        },
        {
            key: 'applications',
            label: 'Applications',
            caption: 'APPLICATIONS SUBMITTED',
            total: String(applicationCount),
            action: 'apply' as const,
            items: [] as Array<{ label: string; value: string }>,
        },
    ], [totalBalance, agentIncentives, agentCommission, agentBonus, agentAchievement, inProgressCount, onboardedCount, failedCount, rescheduleCount, applicationCount]);

    const activeCard = cardTabs[Math.min(activeCardTab, cardTabs.length - 1)];

    // Applications has nothing to break down, so moving to it shuts the card.
    const selectCardTab = useCallback((index: number) => {
        if (cardTabs[index]?.action !== 'expand') setIsCardExpanded(false);
        setActiveCardTab(index);
    }, [cardTabs]);

    // The body's height is what the active tab's gradient copy is sized to, so
    // the two describe the same colour field. Re-read on resize, since the card
    // grows and shrinks as the breakdown opens.
    useEffect(() => {
        const el = cardBodyRef.current;
        if (!el) return;

        const measure = () => setCardBodyHeight(el.offsetHeight);
        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [isCardExpanded, activeCardTab]);

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center" style={{ backgroundColor: PAGE_BG }}>
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: primaryColor }} />
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto" style={{ backgroundColor: PAGE_BG }}>
            <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 md:px-8 md:py-8">
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-bold text-slate-900 md:text-2xl">Agent Dashboard</h1>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} style={{ color: primaryColor }} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </div>

                {/* Wallet, Referrals and Applications. The card shows one headline
                    figure per tab; where there is a breakdown behind it, it is a
                    click away. */}
                <div className="overflow-hidden rounded-xl bg-white">
                    <div className="flex items-end gap-2 bg-white px-2.5 pt-2.5">
                        {cardTabs.map((tab, i) => {
                            const isActive = i === activeCardTab;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => selectCardTab(i)}
                                    className="relative h-[38px] flex-1 overflow-hidden rounded-t-xl text-xs font-bold transition-colors"
                                    style={{ color: isActive ? '#ffffff' : primaryColor }}
                                >
                                    {/* The card's gradient at card size, shifted left
                                        by this tab's own position, so what shows
                                        through is the slice belonging to it. A flat
                                        fill could only match the card at one tab:
                                        the gradient runs corner to corner, so the
                                        card's top edge is the palette colour on the
                                        left and well darkened by the right. */}
                                    <span
                                        aria-hidden
                                        className="absolute left-0 top-0 transition-opacity duration-200"
                                        style={{
                                            width: `calc(${cardTabs.length} * 100% + ${(cardTabs.length - 1) * 8}px)`,
                                            height: Math.max(cardBodyHeight, 38),
                                            marginLeft: `calc(-${i} * (100% + 8px))`,
                                            background: `linear-gradient(135deg, ${primaryColor} 0%, #000000 100%)`,
                                            opacity: isActive ? 1 : 0,
                                        }}
                                    />
                                    <span className="relative">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div
                        ref={cardBodyRef}
                        className="rounded-b-3xl rounded-t-xl px-6 py-7 md:px-8"
                        style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #000000 100%)` }}
                    >
                        <div className="mb-5 flex items-center gap-3">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-base font-bold text-white">
                                {initials}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-base font-bold capitalize text-white">{displayName}</div>
                                <div className="truncate text-xs text-gray-200 opacity-90">
                                    Agent ID: {identity.username || 'N/A'}
                                </div>
                            </div>
                        </div>

                        <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-[11px] font-bold tracking-widest text-white/70">
                                {activeCard.caption}
                            </span>
                            <button
                                onClick={() => setIsAmountHidden(prev => !prev)}
                                className="text-white/75 transition hover:text-white"
                                title={isAmountHidden ? 'Show figures' : 'Hide figures'}
                            >
                                {isAmountHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-3xl font-bold text-white md:text-4xl">
                                {isAmountHidden ? '••••••' : activeCard.total}
                            </div>

                            {activeCard.action === 'expand' ? (
                                <button
                                    onClick={() => setIsCardExpanded(prev => !prev)}
                                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/35 bg-white/[0.18] text-white transition hover:bg-white/25"
                                    title={isCardExpanded ? 'Hide breakdown' : 'Show breakdown'}
                                >
                                    <ChevronDown
                                        size={20}
                                        className={`transition-transform duration-200 ${isCardExpanded ? 'rotate-180' : ''}`}
                                    />
                                </button>
                            ) : (
                                /* The count has no parts to show, so the tab offers
                                   the way to add to it instead. */
                                <button
                                    onClick={() => onNavigate?.('agent-application')}
                                    className="flex-shrink-0 rounded-xl border-2 border-white px-4 py-1.5 text-xl font-bold text-white transition hover:bg-white/10"
                                >
                                    Form
                                </button>
                            )}
                        </div>

                        {/* Height is animated through a grid row rather than a
                            max-height guess, so the card opens to exactly the space
                            the rows need whatever they contain. */}
                        <div
                            className={`grid transition-all duration-200 ease-out ${
                                isCardExpanded && activeCard.items.length > 0
                                    ? 'grid-rows-[1fr] opacity-100'
                                    : 'grid-rows-[0fr] opacity-0'
                            }`}
                        >
                            <div className="overflow-hidden">
                                <div className="mt-4 space-y-2.5 border-t border-white/20 pt-4">
                                    {activeCard.items.map(item => (
                                        <div key={item.label} className="flex items-center justify-between gap-3">
                                            <span className="text-[13px] text-white/75">{item.label}</span>
                                            <span className="text-[15px] font-bold text-white">
                                                {isAmountHidden ? '••••' : item.value}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Achievements — one card at a time, swipe between Weekly and Monthly */}
                <div
                    className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100"
                    onTouchStart={onSwipeStart}
                    onTouchMove={onSwipeMove}
                    onTouchEnd={onSwipeEnd}
                    onMouseDown={onSwipeStart}
                    onMouseMove={onSwipeMove}
                    onMouseUp={onSwipeEnd}
                    onMouseLeave={onSwipeEnd}
                >
                    {/* The track holds both cards side by side and slides; only the
                        active one is ever within the frame above. */}
                    <div
                        className="flex"
                        style={{
                            width: `${tiers.length * 100}%`,
                            transform: `translateX(calc(${-activeTier * (100 / tiers.length)}% + ${swipeOffset}px))`,
                            transition: isSwiping ? 'none' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                    >
                        {tiers.map((tier, index) => {
                            const progress = tierProgress(tier);
                            const percent = Math.round(progress.ratio * 100);

                            return (
                                <div
                                    key={tier.key}
                                    // shrink-0 keeps every page exactly one frame wide.
                                    // Without it a page whose content is wider than the
                                    // frame would be squeezed, and the slide would stop
                                    // landing squarely on each card.
                                    className="flex shrink-0 flex-col items-center p-6 select-none"
                                    style={{ width: `${100 / tiers.length}%` }}
                                    aria-hidden={index !== activeTier}
                                >
                                    <h2 className="text-center text-lg font-bold text-slate-800">{tier.label}</h2>
                                    <p className="mt-1 max-w-md text-center text-sm text-slate-500">
                                        Onboard {tier.target} referrals {cycleNoun(tier, progress.anchored)} to earn {formatCurrency(tier.reward)}.
                                    </p>

                                    {/* Time left in this period. Each tier counts down on its
                                        own clock, and the count returns to zero when it ends. */}
                                    <ResetCountdown resetsAt={resetsAtByTier[tier.key] ?? null} skew={clockSkew} />

                                    <AchievementGauge value={progress.onboarded} target={tier.target} color={primaryColor} />

                                    {/* Progress bar with the exact figures beside it */}
                                    <div className="mt-6 w-full">
                                        <div className="mb-1.5 flex items-baseline justify-between text-sm">
                                            <span className="font-semibold text-slate-700">
                                                {progress.onboarded} of {tier.target} onboards
                                            </span>
                                            <span className="font-bold" style={{ color: primaryColor }}>{percent}%</span>
                                        </div>
                                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                            <div
                                                className="h-full rounded-full transition-all duration-700 ease-out"
                                                style={{ width: `${percent}%`, backgroundColor: primaryColor }}
                                            />
                                        </div>
                                        <div className="mt-1.5 flex items-baseline justify-between text-xs text-slate-500">
                                            <span>
                                                {progress.reached
                                                    ? 'Target reached'
                                                    : `${tier.target - progress.onboarded} more to go`}
                                            </span>
                                            <span className="font-semibold text-slate-600">Reward {formatCurrency(tier.reward)}</span>
                                        </div>
                                    </div>

                                    {progress.claimable && (
                                        <button
                                            onClick={() => handleClaimReward(tier)}
                                            disabled={isClaiming}
                                            className="mt-4 flex w-full items-center justify-center rounded-xl py-3.5 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                                            style={{ backgroundColor: primaryColor }}
                                        >
                                            {isClaiming
                                                ? <Loader2 size={20} className="animate-spin" />
                                                : `Get Reward (${formatCurrency(tier.reward)})`}
                                        </button>
                                    )}

                                    {progress.claimed && (
                                        <p className="mt-4 w-full rounded-xl bg-emerald-50 py-3 text-center text-sm font-semibold text-emerald-700">
                                            Claimed {cycleNoun(tier, progress.anchored)}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Which card is showing, and a way to move between them without swiping */}
                    <div className="flex items-center justify-center gap-2 pb-5">
                        {tiers.map((tier, index) => (
                            <button
                                key={tier.key}
                                onClick={() => setActiveTier(index)}
                                aria-label={`Show ${tier.label}`}
                                aria-current={index === activeTier}
                                className="h-2 rounded-full transition-all"
                                style={{
                                    width: index === activeTier ? 22 : 8,
                                    backgroundColor: index === activeTier ? primaryColor : '#cbd5e1',
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Cashout history */}
                <div className="space-y-4">
                    <h2 className="text-lg font-bold text-slate-900">Cashout History</h2>
                    <div className="rounded-2xl bg-white px-5 shadow-sm ring-1 ring-slate-100">
                        {latestCashouts.length > 0 ? (
                            latestCashouts.map(cashout => (
                                <div
                                    key={cashout.id}
                                    className="flex items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-0"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-bold text-slate-800">
                                            Ref: {cashout.ref_number || `#${cashout.id}`}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-500">{formatDate(cashout.created_at)}</div>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                        <div className="text-sm font-extrabold text-slate-800">
                                            {formatCurrency(Number(cashout.total_amount ?? 0))}
                                        </div>
                                        <div className="mt-0.5 text-[10px] font-extrabold text-green-600">POSTED</div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="py-10 text-center text-sm text-gray-500">No cashouts found</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DashboardAgent;

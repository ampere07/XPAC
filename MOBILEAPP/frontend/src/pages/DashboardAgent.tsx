import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, useWindowDimensions, Animated, RefreshControl, StyleSheet, DeviceEventEmitter, Alert, PanResponder, AppState, Easing, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Eye, EyeOff, ChevronDown } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, G } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import { useCustomerDataContext } from '../contexts/CustomerDataContext';
import { useApplicationContext } from '../contexts/ApplicationContext';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { fetchAgentCommissionHistory, fetchAgentAchievements, claimAgentAchievement, fetchAgentApplicationCount } from '../services/api';
import {
    ACHIEVEMENT_TIERS,
    AchievementTier,
    clockSkewFrom,
    createAgentReferralMatcher,
    formatCountdown,
    getOnsiteStatus,
    isDoneOnsiteStatus,
    isFailedOnsiteStatus,
    isInProgressOnsiteStatus,
    isOnOrAfterAgentStartDate,
    isRescheduleOnsiteStatus,
    millisUntilReset,
    parseResetsAt
} from '../utils/agentReferral';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * How long is left in one tier's period.
 *
 * The tick lives here rather than on the dashboard so a second passing repaints
 * this pill alone. Held one level up it re-rendered the whole screen — two SVG
 * gauges, the balance card, the referral list — once a second for a line of
 * text that changes.
 *
 * The instant it counts to is the server's, and the difference between the two
 * clocks is read fresh on every tick: a reply that lands mid-period corrects
 * the countdown without it having to be torn down.
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

        const tick = setInterval(render, 1000);
        // Timers are suspended in the background, so the pill can be well behind
        // by the time the app comes forward; it is re-read rather than left to
        // catch up on the next tick.
        const sub = AppState.addEventListener('change', state => {
            if (state === 'active') render();
        });

        return () => {
            clearInterval(tick);
            sub.remove();
        };
    }, [read]);

    if (!label) return null;

    return (
        <View style={styles.resetPill}>
            <Text style={styles.resetPillLabel}>Resets in</Text>
            <Text style={styles.resetPillValue}>{label}</Text>
        </View>
    );
};

/**
 * One achievement tier as the server reports it.
 *
 * The count is bounded to the current week or month server side — the app
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

// The tab strip's geometry, shared by the strip, the tabs and the chip that
// slides between them. The chip is positioned rather than laid out, so it can
// only land on a tab if it is working from the same numbers.
const TAB_STRIP_PADDING = 10;
const TAB_GAP = 8;
const TAB_HEIGHT = 38;

// Required before LayoutAnimation does anything on Android under the old
// architecture. This app runs the new one, where it is neither needed nor
// present, so the call is made only if it is there to make.
if (Platform.OS === 'android') {
    UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

/**
 * How the card resizes as the breakdown opens and closes.
 *
 * The height change is handed to the native layout animator rather than driven
 * a frame at a time from JavaScript, which is what made it lag: `update` eases
 * the card and everything below it to its new size, while `create` and
 * `delete` fade the rows themselves as they come and go.
 */
const BREAKDOWN_TRANSITION: Parameters<typeof LayoutAnimation.configureNext>[0] = {
    duration: 220,
    create: { type: 'easeInEaseOut', property: 'opacity' },
    update: { type: 'easeInEaseOut' },
    delete: { type: 'easeInEaseOut', property: 'opacity' },
};

interface DashboardAgentProps {
    onNavigate?: (section: string, tab?: string) => void;
}

const DashboardAgent: React.FC<DashboardAgentProps> = ({ onNavigate }) => {
    const { width, height } = useWindowDimensions();
    const isMobile = width < 768;
    const isShort = height < 700;
    const { customerDetail, payments, isLoading: contextLoading, silentRefresh: customerRefresh } = useCustomerDataContext();
    const { silentRefresh: applicationsRefresh } = useApplicationContext();
    const { jobOrders, silentRefresh: jobOrdersRefresh } = useJobOrderContext();
    const [user, setUser] = useState<any>(null);
    const [cashouts, setCashouts] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [agentBalance, setAgentBalance] = useState<number>(0);
    /** Commission earned from approved job orders — agent_balance.commission_value. */
    const [agentCommission, setAgentCommission] = useState<number>(0);
    const [agentIncentives, setAgentIncentives] = useState<number>(0);
    const [agentBonus, setAgentBonus] = useState<number>(0);
    const [agentAchievement, setAgentAchievement] = useState<number>(0);
    /** Applications this agent has raised, counted server side. */
    const [applicationCount, setApplicationCount] = useState<number>(0);

    const latestCashouts = useMemo(() => {
        return (cashouts || []).slice(0, 5);
    }, [cashouts]);

    const formatDate = useCallback((dateStr?: string) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }, []);

    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
    const [refreshing, setRefreshing] = useState(false);
    /** Which side of the card is showing: 0 is Wallet, 1 is Referrals. */
    const [activeCardTab, setActiveCardTab] = useState(0);
    /** Whether the headline figure's breakdown is open. */
    const [isCardExpanded, setIsCardExpanded] = useState(false);
    /** The tab strip's measured width, which is what sets a tab's width. */
    const [tabStripWidth, setTabStripWidth] = useState(0);
    /** The gradient body's height, so the active tab can reproduce its gradient. */
    const [cardBodyHeight, setCardBodyHeight] = useState(0);
    /** Masks the figures, for reading the card in public. */
    const [isAmountHidden, setIsAmountHidden] = useState(false);

    /** Tier state as the server reports it: period-bounded counts and claim state. */
    const [serverTiers, setServerTiers] = useState<ServerTier[]>([]);
    /** Which achievement card is showing. 0 is Weekly, the default on load. */
    const [activeTier, setActiveTier] = useState(0);
    /** Measured width of the achievement card, so the slide lands exactly. */
    const [contentWidth, setContentWidth] = useState(0);
    const [isClaiming, setIsClaiming] = useState(false);

    /** Device-to-server clock difference, applied before every comparison. */
    const clockSkew = useRef(0);
    /** When a reload was last triggered by a rollover, to space out retries. */
    const lastResetReload = useRef(0);

    // The pan responder is created once, so it cannot read state directly
    // without going stale. These refs give it the current values.
    const activeTierRef = useRef(0);
    const cardWidthRef = useRef(0);
    const tierCountRef = useRef(ACHIEVEMENT_TIERS.length);

    const displayName = customerDetail?.fullName || user?.full_name || 'Agent';
    const initials = (customerDetail?.firstName && customerDetail?.lastName)
        ? `${customerDetail.firstName.charAt(0)}${customerDetail.lastName.charAt(0)}`.toUpperCase()
        : displayName.split(' ').map((n: any) => n[0]).join('').substring(0, 2).toUpperCase();
    const accountNo = customerDetail?.billingAccount?.accountNo || user?.username || 'N/A';
    const balance = stats ? Number(stats.total.replace(/[^0-9.]/g, '')) : Number(customerDetail?.billingAccount?.accountBalance || 0);

    const agentEmail = user?.email || '';
    const agentName = user?.full_name || '';

    const { referredCount, successfulInstalledCount, failedInstalledCount, rescheduleCount } = useMemo(() => {
        if (!agentEmail && !agentName && !user?.id) return { referredCount: 0, successfulInstalledCount: 0, failedInstalledCount: 0, rescheduleCount: 0 };

        // Scoped to the programme start date, exactly as the Job Order page is.
        // Without this the tiles would count an agent's whole history while the
        // list below shows only what the programme covers, and neither those
        // figures nor the achievement count would reconcile with the other.
        // One pass, and one status read per job order. The four tiles used to be
        // four separate scans of the list, each normalizing the same statuses
        // again — five walks of every job order the agent owns to produce four
        // numbers. A status belongs to at most one tile, so the buckets are
        // counted together and the else-if chain stops at the first match.
        //
        // The status lists are the shared predicates rather than literals copied
        // in here, so this screen and the web dashboard can only ever agree on
        // what counts as onboarded.
        const ownsReferral = createAgentReferralMatcher(agentName, agentEmail, user?.id ?? null);

        let inProgress = 0;
        let onboard = 0;
        let failed = 0;
        let reschedule = 0;

        for (const jo of jobOrders) {
            if (!ownsReferral(jo.Referred_By || jo.referred_by || '')) continue;
            if (!isOnOrAfterAgentStartDate(jo)) continue;

            const status = getOnsiteStatus(jo);
            if (isInProgressOnsiteStatus(status)) inProgress++;
            else if (isDoneOnsiteStatus(status)) onboard++;
            else if (isFailedOnsiteStatus(status)) failed++;
            else if (isRescheduleOnsiteStatus(status)) reschedule++;
        }

        return {
            referredCount: inProgress,
            successfulInstalledCount: onboard,
            failedInstalledCount: failed,
            rescheduleCount: reschedule
        };
    }, [jobOrders, user?.id, agentEmail, agentName]);

    // ---- Achievements (weekly and monthly onboarding tiers) ----
    const agentId = user?.id || 0;
    const onboardReferredCount = successfulInstalledCount;

    // The tiers on offer. The server is the authority on targets and rewards —
    // only it can bound the count to the current week or month — so its figures
    // win; the shared defaults cover the moment before they arrive.
    const tiers: AchievementTier[] = useMemo(() => {
        if (!serverTiers.length) return ACHIEVEMENT_TIERS;

        return ACHIEVEMENT_TIERS.map(fallback => {
            const fromServer = serverTiers.find(t => t.key === fallback.key);
            return fromServer
                ? { ...fallback, label: fromServer.label, target: fromServer.target, reward: fromServer.reward }
                : fallback;
        });
    }, [serverTiers]);

    /** Progress toward one tier, preferring the server's period-bounded count. */
    const tierProgress = useCallback((tier: AchievementTier) => {
        const fromServer = serverTiers.find(t => t.key === tier.key);
        const onboarded = fromServer ? fromServer.onboarded : onboardReferredCount;

        return {
            onboarded: Math.min(onboarded, tier.target),
            ratio: tier.target > 0 ? Math.min(onboarded / tier.target, 1) : 0,
            reached: fromServer ? fromServer.reached : onboarded >= tier.target,
            claimed: fromServer ? fromServer.claimed : false,
            claimable: fromServer ? fromServer.claimable : false,
            anchored: fromServer ? fromServer.anchored : false,
        };
    }, [serverTiers, onboardReferredCount]);

    /**
     * What to call the current cycle in the card's copy.
     *
     * A cycle that began when a reward was claimed no longer lines up with the
     * calendar, so "this week" would be wrong — the countdown beside it is the
     * honest answer in that case.
     */
    const cycleNoun = useCallback((tier: AchievementTier, anchored: boolean): string =>
        anchored ? 'in this cycle' : (tier.key === 'weekly' ? 'this week' : 'this month'), []);

    const activeTierDef = tiers[activeTier] ?? tiers[0];
    const activeProgress = tierProgress(activeTierDef);

    const gaugeAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        // Animate the arc to the active tier's progress, as a fraction, so the
        // same gauge serves both targets.
        Animated.timing(gaugeAnim, {
            toValue: activeProgress.ratio,
            duration: 1200,
            useNativeDriver: false,
        }).start();
    }, [activeProgress.ratio, activeTier]);

    const handleClaimReward = async (tier: AchievementTier) => {
        if (!agentId || isClaiming) return;
        setIsClaiming(true);
        try {
            const response = await claimAgentAchievement({
                agent_id: agentId,
                type: tier.key,
                milestone: tier.target,
            });
            if (response.success) {
                Alert.alert(
                    'Reward Claimed!',
                    `${formatCurrency(tier.reward)} has been added to your balance for reaching ${tier.target} onboards.`,
                    [{ text: 'OK' }]
                );
                // Reload balances and tier state together, so the card moves to
                // "Claimed" rather than offering the reward again.
                fetchHistory();
                if (agentId) fetchAchievements(agentId);
            } else {
                Alert.alert('Error', response.message || 'Failed to claim reward.');
            }
        } catch (error: any) {
            const errMsg = error.response?.data?.message || 'An unexpected error occurred.';
            Alert.alert('Error', errMsg);
        } finally {
            setIsClaiming(false);
        }
    };

    // Speedometer gauge geometry.
    //
    // Sized from the card it sits in rather than fixed at 220: a 320pt phone
    // leaves roughly 240pt inside the card's padding, so a fixed gauge all but
    // touches both edges, and on a tablet it sat marooned in the middle of a
    // card several times its width. Clamped at both ends — small enough that
    // the figure inside stays legible, large enough that it never dominates.
    // The fallback subtracts the ScrollView's own padding as well, so the first
    // frame is already the size the measurement will confirm and the gauge does
    // not visibly resize once the card has been laid out.
    const gaugeWidth = Math.round(
        Math.min(260, Math.max(150, (contentWidth > 0 ? contentWidth : width - (isMobile ? 32 : 48)) - 80))
    );
    // The band scales with the gauge, so the ring keeps its proportions instead
    // of closing over the figure in the middle at the small end.
    const gaugeStroke = Math.round(gaugeWidth * (30 / 220));
    const gaugeR = (gaugeWidth - gaugeStroke) / 2;
    const gaugeCx = gaugeWidth / 2;
    const gaugeCy = gaugeWidth / 2;
    const gaugeCircumference = 2 * Math.PI * gaugeR;
    const gaugeArcLength = gaugeCircumference * 0.75;
    // Memoised because interpolate() builds a new animated node each call, and
    // a fresh node on every render means the old one is torn off the value and
    // a new one attached for no change in what is drawn.
    const gaugeDashoffset = useMemo(() => gaugeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [gaugeArcLength, 0],
        extrapolate: 'clamp'
    }), [gaugeAnim, gaugeArcLength]);

    // ── Swipe between the two achievement cards ──────────────────────────────
    // Only one card is ever shown. The track holds both and slides; releasing
    // past the threshold settles on the neighbouring card.
    const cardWidth = Math.max(1, contentWidth);
    const slideAnim = useRef(new Animated.Value(0)).current;

    // Keep the refs the gesture reads in step with the rendered state.
    useEffect(() => { activeTierRef.current = activeTier; }, [activeTier]);
    useEffect(() => { cardWidthRef.current = cardWidth; }, [cardWidth]);
    useEffect(() => { tierCountRef.current = tiers.length; }, [tiers.length]);

    useEffect(() => {
        Animated.timing(slideAnim, {
            toValue: -activeTier * cardWidth,
            duration: 320,
            useNativeDriver: true,
        }).start();
    }, [activeTier, cardWidth]);

    const swipeResponder = useRef(
        PanResponder.create({
            // Claim the gesture only once it is clearly horizontal, so the page
            // can still be scrolled vertically through the card.
            onMoveShouldSetPanResponder: (_evt, gesture) =>
                Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
            onPanResponderMove: (_evt, gesture) => {
                const base = -activeTierRef.current * cardWidthRef.current;
                const atStart = activeTierRef.current === 0 && gesture.dx > 0;
                const atEnd = activeTierRef.current === tierCountRef.current - 1 && gesture.dx < 0;
                // Resist dragging past the ends so the edges feel solid.
                slideAnim.setValue(base + (atStart || atEnd ? gesture.dx * 0.25 : gesture.dx));
            },
            onPanResponderRelease: (_evt, gesture) => {
                const threshold = 60;
                let next = activeTierRef.current;

                if (gesture.dx <= -threshold && next < tierCountRef.current - 1) {
                    next += 1;                       // swipe left  → Monthly
                } else if (gesture.dx >= threshold && next > 0) {
                    next -= 1;                       // swipe right → Weekly
                }

                setActiveTier(next);
                Animated.timing(slideAnim, {
                    toValue: -next * cardWidthRef.current,
                    duration: 320,
                    useNativeDriver: true,
                }).start();
            },
        })
    ).current;

    const claimButtonColor = colorPalette?.primary || '#ef4444';

    // The chevron turns over on the native driver — a transform, so no JavaScript
    // runs per frame — for the same span the layout transition takes, which keeps
    // the arrow and the card's growth in step.
    const expandAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(expandAnim, {
            toValue: isCardExpanded ? 1 : 0,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [isCardExpanded, expandAnim]);

    // Announces the resize to the native layout animator, then makes the change
    // that causes it — the two have to land in the same commit, so this is done
    // on the press rather than in an effect reacting to it.
    const toggleBreakdown = useCallback(() => {
        LayoutAnimation.configureNext(BREAKDOWN_TRANSITION);
        setIsCardExpanded(prev => !prev);
    }, []);

    const chevronSpin = useMemo(() => ({
        transform: [{
            rotate: expandAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }),
        }],
    }), [expandAnim]);

    // Every bucket that can actually be cashed out, in the same order the payout
    // screen drains them. `achievement` is deliberately absent: a claimed reward
    // is already paid into `balance`, and that figure is only a lifetime
    // "rewards earned" total for the tile — adding it would count it twice.
    const totalBalance = agentCommission + agentBalance + agentIncentives + agentBonus;

    const fetchHistory = useCallback(async () => {
        try {
            const response = await fetchAgentCommissionHistory();
            if (response.success) {
                setCashouts(response.data);
                setAgentBalance(response.balance !== undefined ? Number(response.balance) : 0);
                // What the agent has earned in commission from approved job
                // orders. Its own column, separate from the spendable balance.
                setAgentCommission(response.commission_value !== undefined ? Number(response.commission_value) : 0);
                setAgentIncentives(response.incentives !== undefined ? Number(response.incentives) : 0);
                setAgentBonus(response.bonus !== undefined ? Number(response.bonus) : 0);
                setAgentAchievement(response.achievement !== undefined ? Number(response.achievement) : 0);
            }
        } catch (error) {
            console.error('Failed to fetch cashout history:', error);
        }
    }, []);

    /**
     * The agent's own application total.
     *
     * Asked for as a figure rather than counted from a list: /applications is
     * scoped to an organisation, not to a caller, and an agent is refused it.
     */
    const fetchApplicationCount = useCallback(async () => {
        try {
            const response = await fetchAgentApplicationCount();
            if (response?.success) setApplicationCount(Number(response.count) || 0);
        } catch (error) {
            console.error('Failed to fetch application count:', error);
        }
    }, []);

    const fetchAchievements = useCallback(async (agentId: number) => {
        try {
            const response = await fetchAgentAchievements(agentId);

            // The server returns each tier already scoped to the current period,
            // with its target, reward, progress and whether it has been claimed.
            const tiersFromServer = response?.tiers;
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
        } catch (error) {
            console.error('Failed to fetch achievements:', error);
        }
    }, []);

    useEffect(() => {
        const loadUser = async () => {
            try {
                const storedUser = await AsyncStorage.getItem('authData');
                if (storedUser) {
                    const parsed = JSON.parse(storedUser);
                    setUser(parsed);
                    if (parsed?.id) fetchAchievements(parsed.id);
                }
            } catch (e) {
                console.error('Failed to parse auth data:', e);
            }
        };
        loadUser();
        customerRefresh();
        applicationsRefresh();
        jobOrdersRefresh();
        fetchHistory();
        fetchApplicationCount();
    }, [fetchHistory, fetchAchievements, fetchApplicationCount]);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();

        const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
            setColorPalette(newPalette);
        });

        return () => paletteSub.remove();
    }, []);

    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                customerRefresh(),
                applicationsRefresh(),
                jobOrdersRefresh(),
                fetchHistory(),
                fetchApplicationCount(),
                // Pull-to-refresh brings the achievement counts down with
                // everything else, rather than leaving them a period behind.
                user?.id ? fetchAchievements(user.id) : Promise.resolve(),
            ]);
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setRefreshing(false);
        }
    }, [customerRefresh, applicationsRefresh, jobOrdersRefresh, fetchHistory, fetchApplicationCount, fetchAchievements, user?.id]);

    /**
     * Reloads the moment a period rolls over, so the count returns to zero and
     * the next countdown begins without anyone pulling to refresh.
     *
     * Polled rather than set as a timer for the boundary: a monthly period can
     * be more than 24 days out, which overflows a timeout and would fire it
     * immediately. The poll reads the clock directly instead of through state,
     * so watching for the rollover costs no renders. If the server has not moved
     * on yet — its clock being a moment behind — the spacing below turns that
     * into a quiet retry every few seconds until it has.
     */
    useEffect(() => {
        if (!serverTiers.length || !user?.id) return;

        const check = () => {
            const now = Date.now();
            const serverNow = now + clockSkew.current;

            if (!serverTiers.some(t => t.resetsAt !== null && serverNow >= t.resetsAt)) return;
            if (now - lastResetReload.current < RESET_RELOAD_GRACE_MS) return;

            lastResetReload.current = now;
            fetchAchievements(user.id);
            jobOrdersRefresh();
        };

        check();

        const tick = setInterval(check, 1000);
        // A period that rolled over while the app was in the background is
        // caught the moment it comes forward, not on the next tick.
        const sub = AppState.addEventListener('change', state => {
            if (state === 'active') check();
        });

        return () => {
            clearInterval(tick);
            sub.remove();
        };
    }, [serverTiers, user?.id, fetchAchievements, jobOrdersRefresh]);

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

    const formatCurrency = useCallback((amount: number) => {
        const isNegative = amount < 0;
        const formatted = Math.abs(amount).toFixed(0).replace(/\d(?=(\d{3})+$)/g, '$&,');
        return `₱${isNegative ? '-' : ''}${formatted}`;
    }, []);

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
                // balance — separate columns that pay out separately.
                { label: 'Commission', value: formatCurrency(agentCommission) },
                { label: 'Bonus', value: formatCurrency(agentBonus) },
                { label: 'Achievement', value: formatCurrency(agentAchievement) },
            ],
        },
        {
            key: 'referrals',
            label: 'Referrals',
            caption: 'TOTAL REFERRALS',
            total: String(referredCount + successfulInstalledCount + failedInstalledCount + rescheduleCount),
            action: 'expand' as const,
            items: [
                { label: 'In Progress', value: String(referredCount) },
                { label: 'Done', value: String(successfulInstalledCount) },
                { label: 'Failed', value: String(failedInstalledCount) },
                { label: 'Reschedule', value: String(rescheduleCount) },
            ],
        },
        {
            key: 'applications',
            label: 'Applications',
            caption: 'SUBMITTED',
            total: String(applicationCount),
            action: 'apply' as const,
            items: [],
        },
    ], [totalBalance, agentIncentives, agentCommission, agentBonus, agentAchievement, referredCount, successfulInstalledCount, failedInstalledCount, rescheduleCount, applicationCount, formatCurrency]);

    const activeCard = cardTabs[Math.min(activeCardTab, cardTabs.length - 1)];

    // The headline figure's size, read by the button beside it too so the two
    // are set in the same type and line up as a pair.
    const paletteColor = colorPalette?.primary || '#ef4444';

    // Tabs share the strip evenly, so a tab's width falls out of the measured
    // strip rather than being fixed: three tabs today, and the chip still lands
    // squarely on them if a fourth is ever added.
    const tabWidth = tabStripWidth > 0
        ? (tabStripWidth - TAB_STRIP_PADDING * 2 - TAB_GAP * (cardTabs.length - 1)) / cardTabs.length
        : 0;

    // The colour slides between tabs instead of jumping. translateX takes the
    // native driver, so the glide runs on the UI thread.
    const tabIndicatorAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (tabWidth <= 0) return;

        Animated.timing(tabIndicatorAnim, {
            toValue: activeCardTab * (tabWidth + TAB_GAP),
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [activeCardTab, tabWidth, tabIndicatorAnim]);
    const headlineFontSize = isMobile ? (isShort ? 30 : 36) : 42;
    const applyFontSize = Math.round(headlineFontSize * 0.55);

    // Applications has nothing to break down, so moving to it shuts the card.
    // Announced first, so it eases closed rather than vanishing.
    const selectCardTab = useCallback((index: number) => {
        if (isCardExpanded && cardTabs[index]?.action !== 'expand') {
            LayoutAnimation.configureNext(BREAKDOWN_TRANSITION);
            setIsCardExpanded(false);
        }
        setActiveCardTab(index);
    }, [isCardExpanded, cardTabs]);

    if (contextLoading && !customerDetail) return (
        <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#111827" />
        </View>
    );

    return (
        <View style={styles.container}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                    paddingTop: !isMobile ? 16 : (isShort ? 20 : 60),
                    paddingHorizontal: isMobile ? 16 : 24,
                    paddingBottom: 100,
                    gap: isShort ? 16 : 24,
                    // On a tablet the cards otherwise run the full width of the
                    // screen, which leaves the balance figure at one edge and
                    // its button at the other. Held to a phone-like column and
                    // centred, the layout reads the same at every size.
                    width: '100%',
                    maxWidth: 640,
                    alignSelf: 'center',
                }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[colorPalette?.primary || '#ef4444']}
                        tintColor={colorPalette?.primary || '#ef4444'}
                    />
                }
            >
                <View style={styles.contentGap}>
                    <View style={{ gap: 16 }}>
                        <View style={styles.balanceCard}>
                            {/* Wallet, Referrals and Applications. The card shows one
                                headline figure per tab; where there is a breakdown
                                behind it, it is a tap away. */}
                            <View
                                style={styles.tabStrip}
                                onLayout={e => setTabStripWidth(e.nativeEvent.layout.width)}
                            >
                                {/* The active tab, drawn before the tabs so it passes
                                    behind their labels.

                                    It carries the card's gradient at card size and
                                    slides the opposite way inside its own clip, so
                                    what shows through is the slice of that gradient
                                    belonging to this tab's position. A flat fill
                                    could only ever match the card at one tab: the
                                    gradient runs corner to corner, so the card's top
                                    edge is the palette colour on the left and well
                                    darkened by the right. */}
                                {tabWidth > 0 && (
                                    <Animated.View
                                        pointerEvents="none"
                                        style={[
                                            styles.tabIndicator,
                                            { width: tabWidth, transform: [{ translateX: tabIndicatorAnim }] },
                                        ]}
                                    >
                                        <Animated.View
                                            style={{
                                                width: tabStripWidth,
                                                height: Math.max(cardBodyHeight, TAB_HEIGHT),
                                                transform: [{
                                                    translateX: Animated.multiply(
                                                        Animated.add(tabIndicatorAnim, TAB_STRIP_PADDING),
                                                        -1
                                                    ),
                                                }],
                                            }}
                                        >
                                            <LinearGradient
                                                colors={[paletteColor, '#000000']}
                                                start={{ x: 0, y: 0 }}
                                                end={{ x: 1, y: 1 }}
                                                style={{ flex: 1 }}
                                            />
                                        </Animated.View>
                                    </Animated.View>
                                )}

                                {cardTabs.map((tab, i) => {
                                    const isActive = i === activeCardTab;
                                    return (
                                        <Pressable
                                            key={tab.key}
                                            onPress={() => selectCardTab(i)}
                                            style={styles.tabItem}
                                        >
                                            <Text
                                                allowFontScaling={false}
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={[styles.tabLabel, { color: isActive ? '#ffffff' : paletteColor }]}
                                            >
                                                {tab.label}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>

                            <LinearGradient
                                colors={[colorPalette?.primary || '#ef4444', '#000000']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={[styles.gradientInner, { paddingHorizontal: 0, paddingBottom: isShort ? 20 : 28 }]}
                                onLayout={e => setCardBodyHeight(e.nativeEvent.layout.height)}
                            >
                                <View style={{ paddingHorizontal: isMobile ? 20 : 28, paddingTop: isShort ? 14 : 20 }}>
                                    <View style={[styles.profileRow, { marginBottom: isShort ? 12 : 20 }]}>
                                        <View style={[styles.initialsCircle, { width: isShort ? 40 : 46, height: isShort ? 40 : 46, borderRadius: isShort ? 20 : 23 }]}>
                                            <Text style={[styles.initialsText, { fontSize: isShort ? 16 : 18 }]}>{initials}</Text>
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text
                                                allowFontScaling={false}
                                                numberOfLines={1}
                                                adjustsFontSizeToFit
                                                style={[styles.customerNameText, { fontSize: isShort ? 15 : 17 }]}
                                            >
                                                {displayName}
                                            </Text>
                                            <Text allowFontScaling={false} style={styles.customerAccountText}>Agent ID: {accountNo}</Text>
                                        </View>
                                    </View>

                                    <View style={styles.balanceCaptionRow}>
                                        <Text allowFontScaling={false} style={styles.balanceCaption}>{activeCard.caption}</Text>
                                        <Pressable
                                            onPress={() => setIsAmountHidden(prev => !prev)}
                                            hitSlop={10}
                                            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                                        >
                                            {isAmountHidden
                                                ? <EyeOff size={15} color="rgba(255,255,255,0.75)" />
                                                : <Eye size={15} color="rgba(255,255,255,0.75)" />}
                                        </Pressable>
                                    </View>

                                    <View style={styles.balanceRow}>
                                        <Text
                                            numberOfLines={1}
                                            adjustsFontSizeToFit
                                            minimumFontScale={0.4}
                                            allowFontScaling={false}
                                            style={[styles.balanceAmountText, { flexShrink: 1, fontSize: headlineFontSize }]}
                                        >
                                            {isAmountHidden ? '••••••' : activeCard.total}
                                        </Text>
                                        {activeCard.action === 'expand' ? (
                                            /* Opens the breakdown the headline figure sums up. */
                                            <Pressable
                                                onPress={toggleBreakdown}
                                                style={({ pressed }) => [styles.cardActionBtn, { opacity: pressed ? 0.6 : 1 }]}
                                            >
                                                <Animated.View style={chevronSpin}>
                                                    <ChevronDown size={20} color="#ffffff" />
                                                </Animated.View>
                                            </Pressable>
                                        ) : (
                                            /* The count has no parts to show, so the tab
                                               offers the way to add to it instead. */
                                            <Pressable onPress={() => onNavigate && onNavigate('Application')}>
                                                {({ pressed }) => (
                                                    <View style={[
                                                        {
                                                            backgroundColor: 'transparent',
                                                            paddingHorizontal: 16,
                                                            paddingVertical: 6,
                                                            borderRadius: 12,
                                                            borderWidth: 1,
                                                            borderColor: '#ffffff',
                                                        },
                                                        pressed && { opacity: 0.7, backgroundColor: 'rgba(255,255,255,0.1)' },
                                                    ]}>
                                                        <Text
                                                            allowFontScaling={false}
                                                            style={{ color: '#ffffff', fontWeight: 'bold', fontSize: applyFontSize }}
                                                        >
                                                            Form
                                                        </Text>
                                                    </View>
                                                )}
                                            </Pressable>
                                        )}
                                    </View>

                                    {isCardExpanded && activeCard.items.length > 0 && (
                                        <View style={styles.breakdown}>
                                            {activeCard.items.map(item => (
                                                <View key={item.label} style={styles.breakdownRow}>
                                                    <Text allowFontScaling={false} numberOfLines={1} style={styles.breakdownLabel}>{item.label}</Text>
                                                    <Text
                                                        allowFontScaling={false}
                                                        numberOfLines={1}
                                                        adjustsFontSizeToFit
                                                        minimumFontScale={0.6}
                                                        style={styles.breakdownValue}
                                                    >
                                                        {isAmountHidden ? '••••' : item.value}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            </LinearGradient>
                        </View>

                        {/* Achievements — one card at a time, swipe between Weekly and Monthly */}
                        <View style={styles.sectionGap}>
                            {/* alignItems is reset to 'stretch': the card centres its
                                children, which would centre the two-page track itself
                                and leave every page half a card out of position. Each
                                page centres its own content instead. The width is
                                measured here, on the element the pages actually fill. */}
                            <View
                                style={[styles.achievementCard, { overflow: 'hidden', paddingHorizontal: 0, alignItems: 'stretch' }]}
                                onLayout={e => setContentWidth(e.nativeEvent.layout.width)}
                            >
                                {/* Rendered once the card has been measured. Laying the
                                    pages out against a placeholder width would squeeze
                                    them for a frame before snapping into place. */}
                                {contentWidth > 0 && (
                                    <Animated.View
                                        style={{
                                            flexDirection: 'row',
                                            width: cardWidth * tiers.length,
                                            transform: [{ translateX: slideAnim }],
                                        }}
                                        {...swipeResponder.panHandlers}
                                    >
                                        {tiers.map(tier => {
                                            const progress = tierProgress(tier);
                                            const percent = Math.round(progress.ratio * 100);
                                            const isActive = tier.key === activeTierDef.key;

                                            return (
                                                <View key={tier.key} style={{ width: cardWidth, paddingHorizontal: 20, alignItems: 'center' }}>
                                                    <Text style={styles.achievementTitle}>{tier.label}</Text>
                                                    <Text style={styles.achievementDesc}>
                                                        Onboard {tier.target} referrals {cycleNoun(tier, progress.anchored)} to earn {formatCurrency(tier.reward)}.
                                                    </Text>

                                                    {/* Time left in this period. Each tier counts down on its
                                                    own clock, and the count returns to zero when it ends. */}
                                                    <ResetCountdown resetsAt={resetsAtByTier[tier.key] ?? null} skew={clockSkew} />

                                                    <View style={styles.gaugeWrapper}>
                                                        <View style={{ width: gaugeWidth, height: gaugeWidth, position: 'relative' }}>
                                                            <Svg width={gaugeWidth} height={gaugeWidth} viewBox={`0 0 ${gaugeWidth} ${gaugeWidth}`}>
                                                                <G rotation="135" origin={`${gaugeCx}, ${gaugeCy}`}>
                                                                    <Circle
                                                                        cx={gaugeCx}
                                                                        cy={gaugeCy}
                                                                        r={gaugeR}
                                                                        stroke="#e2e8f0"
                                                                        strokeWidth={gaugeStroke}
                                                                        strokeDasharray={`${gaugeArcLength}, ${gaugeCircumference}`}
                                                                        fill="none"
                                                                        strokeLinecap="round"
                                                                    />
                                                                    {/* Only the visible card animates the arc; the other
                                                                    renders its progress statically so both read correctly. */}
                                                                    {isActive ? (
                                                                        <AnimatedCircle
                                                                            cx={gaugeCx}
                                                                            cy={gaugeCy}
                                                                            r={gaugeR}
                                                                            stroke={colorPalette?.primary || '#ef4444'}
                                                                            strokeWidth={gaugeStroke}
                                                                            strokeDasharray={`${gaugeArcLength}, ${gaugeCircumference}`}
                                                                            strokeDashoffset={gaugeDashoffset}
                                                                            fill="none"
                                                                            strokeLinecap="round"
                                                                        />
                                                                    ) : (
                                                                        <Circle
                                                                            cx={gaugeCx}
                                                                            cy={gaugeCy}
                                                                            r={gaugeR}
                                                                            stroke={colorPalette?.primary || '#ef4444'}
                                                                            strokeWidth={gaugeStroke}
                                                                            strokeDasharray={`${gaugeArcLength}, ${gaugeCircumference}`}
                                                                            strokeDashoffset={gaugeArcLength * (1 - progress.ratio)}
                                                                            fill="none"
                                                                            strokeLinecap="round"
                                                                        />
                                                                    )}
                                                                </G>
                                                            </Svg>
                                                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                                                                <Text style={styles.gaugeValueText}>{progress.onboarded}</Text>
                                                                <Text style={styles.gaugeValueLabel}>Onboarded</Text>
                                                            </View>
                                                        </View>
                                                    </View>

                                                    {/* Progress bar with the exact figures beside it */}
                                                    <View style={{ width: '100%', marginTop: 20 }}>
                                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                                                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155' }}>
                                                                {progress.onboarded} of {tier.target} onboards
                                                            </Text>
                                                            <Text style={{ fontSize: 13, fontWeight: '700', color: colorPalette?.primary || '#ef4444' }}>
                                                                {percent}%
                                                            </Text>
                                                        </View>
                                                        <View style={{ height: 10, borderRadius: 999, backgroundColor: '#f1f5f9', overflow: 'hidden' }}>
                                                            <View style={{
                                                                width: `${percent}%`,
                                                                height: '100%',
                                                                borderRadius: 999,
                                                                backgroundColor: colorPalette?.primary || '#ef4444',
                                                            }} />
                                                        </View>
                                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                                                            <Text style={{ fontSize: 12, color: '#64748b' }}>
                                                                {progress.reached ? 'Target reached' : `${tier.target - progress.onboarded} more to go`}
                                                            </Text>
                                                            <Text style={{ fontSize: 12, fontWeight: '600', color: '#475569' }}>
                                                                Reward {formatCurrency(tier.reward)}
                                                            </Text>
                                                        </View>
                                                    </View>

                                                    {progress.claimable && (
                                                        <Pressable
                                                            style={({ pressed }) => [
                                                                styles.claimBtn,
                                                                { backgroundColor: claimButtonColor, opacity: pressed ? 0.8 : 1 }
                                                            ]}
                                                            onPress={() => handleClaimReward(tier)}
                                                            disabled={isClaiming}
                                                        >
                                                            {isClaiming ? (
                                                                <ActivityIndicator size="small" color="#ffffff" />
                                                            ) : (
                                                                <Text style={styles.claimBtnText}>Get Reward ({formatCurrency(tier.reward)})</Text>
                                                            )}
                                                        </Pressable>
                                                    )}

                                                    {progress.claimed && (
                                                        <View style={{ marginTop: 12, borderRadius: 12, backgroundColor: '#ecfdf5', paddingVertical: 12, alignSelf: 'stretch' }}>
                                                            <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: '600', color: '#047857' }}>
                                                                Claimed {cycleNoun(tier, progress.anchored)}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                            );
                                        })}
                                    </Animated.View>
                                )}

                                {/* Which card is showing, and a tap target to move between them */}
                                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18 }}>
                                    {tiers.map((tier, index) => (
                                        <Pressable
                                            key={tier.key}
                                            onPress={() => setActiveTier(index)}
                                            accessibilityLabel={`Show ${tier.label}`}
                                            hitSlop={8}
                                        >
                                            <View style={{
                                                height: 8,
                                                width: index === activeTier ? 22 : 8,
                                                borderRadius: 999,
                                                backgroundColor: index === activeTier ? (colorPalette?.primary || '#ef4444') : '#cbd5e1',
                                            }} />
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        </View>
                    </View>

                    {/* Cashout History Section */}
                    <View style={styles.sectionGap}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Cashout History</Text>
                        </View>

                        <View style={styles.referralContent}>
                            {latestCashouts.length > 0 ? (
                                latestCashouts.map((cashout: any) => (
                                    <View key={cashout.id} style={styles.paymentItem}>
                                        <View style={{ flex: 1.5 }}>
                                            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.paymentRef}>Ref: {cashout.ref_number}</Text>
                                            <Text style={styles.paymentDate}>{dayjs(cashout.created_at).format('MMM DD, YYYY')}</Text>
                                        </View>
                                        <View style={styles.alignEnd}>
                                            <Text style={styles.paymentAmountValue}>{formatCurrency(Number(cashout.total_amount))}</Text>
                                            <View style={[styles.statusBadgeSmall, { backgroundColor: 'transparent' }]}>
                                                <Text style={[
                                                    styles.statusTextSmall,
                                                    { color: '#16a34a' }
                                                ]}>
                                                    {'POSTED'}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <View style={styles.emptyReferrals}>
                                    <Text style={styles.emptyReferralsText}>No cashouts found</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    loadingContainer: { padding: 32, flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
    container: { flex: 1, backgroundColor: '#f9fafb', position: 'relative' },
    contentGap: { gap: 32 },
    balanceCard: { borderRadius: 24, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: '#ffffff', overflow: 'hidden' },
    // Its top corners are its own now that the tabs sit above rather than over
    // it: a gentle curve tucking under the strip, against the 24 the bottom of
    // the card keeps.
    gradientInner: { borderRadius: 24, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 24, position: 'relative', overflow: 'hidden' },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    initialsCircle: { backgroundColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' },
    initialsText: { color: '#ffffff', fontWeight: 'bold' },
    customerNameText: { color: '#ffffff', fontWeight: 'bold', textTransform: 'capitalize' },
    customerAccountText: { color: '#e5e7eb', fontSize: 11, opacity: 0.9 },
    billingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 },
    billingLeft: { flex: 1, minWidth: 120 },
    balanceLabel: { color: '#e5e7eb', fontSize: 12, marginBottom: 4 },
    // The tab row sits flush with the top of the gradient; the selected tab
    // lifts out of it in white and reads as the front of the card.
    // A white band across the top of the card, holding one chip per tab. The
    // padding is what the chips' shadows need to fall into; without it they are
    // cast straight onto the band's edges and read as dirt rather than depth.
    tabStrip: { flexDirection: 'row', alignItems: 'flex-end', gap: TAB_GAP, backgroundColor: '#ffffff', borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: TAB_STRIP_PADDING, paddingTop: TAB_STRIP_PADDING },
    // A tap target and a label. The fill behind it belongs to the chip, which is
    // one view for all three tabs so it can travel between them.
    tabItem: { flex: 1, height: TAB_HEIGHT, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    tabIndicator: {
        position: 'absolute',
        left: TAB_STRIP_PADDING,
        top: TAB_STRIP_PADDING,
        height: TAB_HEIGHT,
        // Clips the card-sized gradient inside it down to this one tab.
        overflow: 'hidden',
        // Rounded at the top only, and the strip has no padding beneath it, so
        // the chip runs into the card body rather than floating above it.
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        // Cast upwards, away from the join: a downward shadow would fall across
        // the card the tabs are supposed to be part of. No elevation with it —
        // on Android that would raise the chip over the labels it sits behind.
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
    },
    // The fill and the label colour are set per tab, from the palette.
    tabLabel: { fontSize: 12, fontWeight: '700' },
    balanceCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    balanceCaption: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
    cardActionBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.18)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.35)', width: 36, height: 36, borderRadius: 999 },
    // A concrete radius, not the 999 the chevron beside it uses: a radius far
    // larger than the box is what stopped the stroke drawing, and this is the
    // geometry the button had on the card it moved off, where it drew fine.
    breakdown: { paddingTop: 16, paddingBottom: 2, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.2)', gap: 10 },
    breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    breakdownLabel: { color: 'rgba(255, 255, 255, 0.75)', fontSize: 13 },
    breakdownValue: { color: '#ffffff', fontSize: 15, fontWeight: '700', textAlign: 'right' },
    balanceAmountText: { fontWeight: 'bold', color: '#ffffff' },
    sectionGap: { gap: 16 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
    achievementCard: { backgroundColor: '#f9fafb', borderRadius: 24, padding: 20, alignItems: 'center' },
    achievementTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', textAlign: 'center', marginBottom: 6 },
    achievementDesc: { fontSize: 14, color: '#64748b', lineHeight: 20, textAlign: 'center', marginBottom: 12 },
    // The reset countdown, sized to hug its text so it stays centred on the page.
    resetPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        gap: 6,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#f1f5f9',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 6,
        marginBottom: 20,
    },
    resetPillLabel: { fontSize: 12, color: '#94a3b8' },
    resetPillValue: { fontSize: 12, fontWeight: '700', color: '#334155', fontVariant: ['tabular-nums'] },
    gaugeWrapper: { alignItems: 'center', marginBottom: 12 },
    gaugeValueText: { fontSize: 48, fontWeight: '800', color: '#0f172a', lineHeight: 56 },
    gaugeValueLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginTop: -4 },
    claimBtn: { backgroundColor: '#ef4444', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12, alignSelf: 'stretch' },
    claimBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
    referralContent: { gap: 12, paddingBottom: 8 },
    paymentItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        backgroundColor: 'transparent',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9'
    },
    paymentRef: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
    paymentDate: { fontSize: 12, color: '#64748b', marginTop: 2 },
    paymentAmountValue: { fontSize: 15, fontWeight: '800', color: '#1e293b', textAlign: 'right' },
    statusBadgeSmall: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4, alignSelf: 'flex-end' },
    statusTextSmall: { fontSize: 10, fontWeight: '800' },
    alignEnd: { alignItems: 'flex-end' },
    emptyReferrals: { padding: 40, alignItems: 'center', justifyContent: 'center' },
    emptyReferralsText: { color: '#6b7280', fontSize: 14 },
    sectionHeaderBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    filterContainer: { flexDirection: 'row', gap: 8 },
    dropdownBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
    dropdownBtnText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
    dropdownMenu: { position: 'absolute', top: 38, right: 0, backgroundColor: '#ffffff', borderRadius: 12, padding: 4, minWidth: 120, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5, zIndex: 1000, borderWidth: 1, borderColor: '#f1f5f9' },
    dropdownItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    dropdownItemText: { fontSize: 12, color: '#64748b' },
    filterBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f9fafb' },
    filterText: { fontSize: 12, color: '#64748b' },
    graphWrapper: { backgroundColor: '#f9fafb', borderRadius: 24, padding: 12 },
    graphBody: { flexDirection: 'row', height: 160, width: '100%' },
    yAxis: { width: 40, height: 160, justifyContent: 'space-between', paddingVertical: 0, marginRight: 4 },
    yAxisLabel: { fontSize: 8, color: '#94a3b8', fontWeight: '600', textAlign: 'right' },
    graphContainer: { flex: 1, height: 160 },
    xAxisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginLeft: 44, paddingHorizontal: 0 },
    labelItem: { fontSize: 8, color: '#94a3b8', fontWeight: '600', textAlign: 'center', width: 24 },

    // Modal Styles
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    tooltipCard: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 300, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 10 },
    tooltipHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    tooltipTitle: { fontSize: 14, fontWeight: '600', color: '#64748b' },
    tooltipBody: { gap: 4, marginBottom: 20 },
    tooltipLabel: { fontSize: 12, color: '#94a3b8' },
    tooltipValue: { fontSize: 28, fontWeight: '800' },
    tooltipFooter: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12 },
    tooltipHint: { fontSize: 10, color: '#cbd5e1', textAlign: 'center' },
});

export default DashboardAgent;

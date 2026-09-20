import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, DeviceEventEmitter, Pressable, ActivityIndicator, Alert, Animated } from 'react-native';
import { CheckCircle } from 'lucide-react-native';
import Svg, { Circle, G } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { createAgentReferralMatcher, getOnsiteStatus, isDoneOnsiteStatus } from '../utils/agentReferral';
import { useJobOrderContext } from '../contexts/JobOrderContext';
import { 
    fetchAgentAchievements, 
    claimAgentAchievement 
} from '../services/api';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const Achievement: React.FC = () => {
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
    const [user, setUser] = useState<any>(null);
    const { jobOrders, silentRefresh: jobOrdersRefresh } = useJobOrderContext();
    const [isClaiming, setIsClaiming] = useState(false);
    const [claimedMilestones, setClaimedMilestones] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);

    const agentEmail = user?.email || '';
    const agentName = user?.full_name || user?.name || '';
    const agentId = user?.id || 0;

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

    useEffect(() => {
        const checkAchievements = async (id: number) => {
            try {
                const response = await fetchAgentAchievements(id);
                if (response && response.data) {
                    const claims = response.data.map((item: any) => item.milestone);
                    setClaimedMilestones(claims);
                }
            } catch (error) {
                console.error('Failed to fetch achievements from tracking table:', error);
            } finally {
                setLoading(false);
            }
        };

        const initUser = async () => {
            try {
                const authData = await AsyncStorage.getItem('authData');
                if (authData) {
                    const parsed = JSON.parse(authData);
                    setUser(parsed);
                    checkAchievements(parsed.id);
                } else {
                    setLoading(false);
                }
            } catch (e) {
                console.error('Failed to parse auth data:', e);
                setLoading(false);
            }
        };
        initUser();
        jobOrdersRefresh();
    }, [jobOrdersRefresh]);

    const onboardReferredCount = useMemo(() => {
        // The id alone is enough now: a referral stored as one carries no name.
        if (!agentEmail && !agentName && !agentId) return 0;

        // The shared rule, not a substring test of its own: a referral is now
        // stored as the agent's user id, which contains none of their name, and
        // `includes` would also have counted "Ana" as a match for "Joana".
        //
        // Built once and counted in one pass: this used to walk the whole job
        // order set twice and re-derive the agent's name for every row of it,
        // all to produce a single number.
        const ownsReferral = createAgentReferralMatcher(agentName, agentEmail, agentId);

        let onboarded = 0;
        for (const jo of jobOrders) {
            if (!ownsReferral(jo.Referred_By || jo.referred_by || '')) continue;
            if (isDoneOnsiteStatus(getOnsiteStatus(jo))) onboarded++;
        }
        return onboarded;
    }, [jobOrders, agentEmail, agentName, agentId]);

    const target = 30;
    
    const possibleMilestones = [];
    for (let i = target; i <= onboardReferredCount; i += target) {
        possibleMilestones.push(i);
    }
    
    // The first milestone they qualify for but haven't claimed yet
    const pendingMilestone = possibleMilestones.find(m => !claimedMilestones.includes(m));

    const handleClaimReward = async () => {
        if (!agentId || !pendingMilestone) return;
        setIsClaiming(true);
        try {
            const payload = {
                agent_id: agentId,
                milestone: pendingMilestone,
                amount: 1500
            };
            
            const response = await claimAgentAchievement(payload);
            if (response.success) {
                setClaimedMilestones(prev => [...prev, pendingMilestone]);
                Alert.alert("Reward Claimed!", `₱1,500 has been added to your achievement rewards for hitting ${pendingMilestone} onboards.`, [{ text: "OK" }]);
            } else {
                Alert.alert("Error", response.message || "Failed to claim reward.");
            }
        } catch (error: any) {
            console.error("Error claiming reward:", error);
            const errMsg = error.response?.data?.message || "An unexpected error occurred.";
            Alert.alert("Error", errMsg);
        } finally {
            setIsClaiming(false);
        }
    };

    // If there is a pending milestone, gauge is full (30/30)
    // Otherwise it shows the remainder towards the NEXT milestone
    const progress = pendingMilestone ? target : (onboardReferredCount % target);
    const isAchieved = !!pendingMilestone;

    // Animation for speedometer gauge
    const animValue = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!loading) {
            Animated.timing(animValue, {
                toValue: progress,
                duration: 1200,
                useNativeDriver: false, // Must be false for SVG attributes
            }).start();
        }
    }, [progress, loading]);

    // Speedometer layout values
    const containerWidth = 280;
    const containerHeight = 240; // Crop the bottom a bit
    const r = (containerWidth - 30) / 2; // Radius
    const cx = containerWidth / 2; // Center X
    const cy = containerWidth / 2; // Center Y
    const circumference = 2 * Math.PI * r;
    const arcLength = circumference * 0.75; // 270 degrees

    const strokeDashoffset = animValue.interpolate({
        inputRange: [0, target],
        outputRange: [arcLength, 0],
        extrapolate: 'clamp'
    });

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={colorPalette?.primary || '#7c3aed'} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.headerBar}>
                <Text style={styles.headerTitle}>Achievements</Text>
            </View>
            <View style={styles.content}>
                
                <View style={styles.card}>
                    <View style={[styles.cardHeader, { justifyContent: 'center' }]}>
                        <View style={{ flex: 1, alignItems: 'center' }}>
                            <Text style={[styles.cardTitle, { textAlign: 'center' }]}>30 Onboard Referrals</Text>
                            <Text style={[styles.cardDesc, { textAlign: 'center' }]}>Refer 30 customers and have them successfully onboarded.</Text>
                        </View>
                    </View>

                    {/* Speedometer Gauge */}
                    <View style={styles.gaugeWrapper}>
                        <View style={{ width: containerWidth, height: containerHeight, position: 'relative' }}>
                            <Svg width={containerWidth} height={containerWidth} viewBox={`0 0 ${containerWidth} ${containerWidth}`}>
                                <G rotation="135" origin={`${cx}, ${cy}`}>
                                    {/* Background Track */}
                                    <Circle
                                        cx={cx}
                                        cy={cy}
                                        r={r}
                                        stroke="#e2e8f0"
                                        strokeWidth={30}
                                        strokeDasharray={`${arcLength}, ${circumference}`}
                                        fill="none"
                                        strokeLinecap="round"
                                    />
                                    {/* Foreground Progress */}
                                    <AnimatedCircle
                                        cx={cx}
                                        cy={cy}
                                        r={r}
                                        stroke={colorPalette?.primary || '#7c3aed'}
                                        strokeWidth={30}
                                        strokeDasharray={`${arcLength}, ${circumference}`}
                                        strokeDashoffset={strokeDashoffset}
                                        fill="none"
                                        strokeLinecap="round"
                                    />
                                </G>
                            </Svg>

                            {/* Value Display (Inside the gap) */}
                            <View style={{
                                position: 'absolute',
                                bottom: -20, // Moved downwards
                                left: 0,
                                width: '100%',
                                alignItems: 'center'
                            }}>
                                <Text style={styles.valueText}>
                                    {progress}
                                </Text>
                                <Text style={styles.valueLabel}>
                                    Onboarded
                                </Text>
                            </View>
                        </View>
                    </View>

                    {isAchieved && (
                        <Pressable 
                            style={({ pressed }) => [
                                styles.claimBtn,
                                { backgroundColor: colorPalette?.primary || '#7c3aed' },
                                pressed && { opacity: 0.8 }
                            ]}
                            onPress={handleClaimReward}
                            disabled={isClaiming}
                        >
                            {isClaiming ? (
                                <ActivityIndicator size="small" color="#ffffff" />
                            ) : (
                                <Text style={styles.claimBtnText}>Get Reward (₱1,500)</Text>
                            )}
                        </Pressable>
                    )}
                </View>

            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: 60,
        paddingBottom: 16,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0f172a',
        textAlign: 'center',
    },
    content: {
        flex: 1,
        padding: 24,
    },
    card: {
        padding: 20,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 40,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1e293b',
        marginBottom: 8,
    },
    cardDesc: {
        fontSize: 14,
        color: '#64748b',
        lineHeight: 20,
    },
    gaugeWrapper: {
        alignItems: 'center',
        marginBottom: 20,
    },
    valueText: {
        fontSize: 48,
        fontWeight: '800',
        color: '#0f172a',
        lineHeight: 56,
    },
    valueLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginTop: -4,
    },
    claimBtn: {
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
    },
    claimBtnText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700',
    },
    claimedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 129, 0.3)',
        marginTop: 20,
    },
    claimedText: {
        color: '#10b981',
        fontSize: 16,
        fontWeight: '700',
    }
});

export default Achievement;

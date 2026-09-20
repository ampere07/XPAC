import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    Animated,
    PanResponder,
    StyleSheet,
    useWindowDimensions,
    ActivityIndicator,
    Alert,
    ScrollView
} from 'react-native';
import { LogIn, LogOut, Info } from 'lucide-react-native';
import { techInOutService } from '../services/techInOutService';
import { ColorPalette } from '../services/settingsColorPaletteService';

interface TimeInOutModalProps {
    visible: boolean;
    onClose: () => void;
    userData: any;
    colorPalette: ColorPalette | null;
    isMandatory?: boolean;
}

interface SwipeButtonProps {
    onComplete: () => void;
    label: string;
    color: string;
    icon: any;
    width: number;
    isLoading: boolean;
}

const SwipeButton: React.FC<SwipeButtonProps> = ({ onComplete, label, color, icon: Icon, width, isLoading }) => {
    const pan = useRef(new Animated.Value(0)).current;
    const buttonWidth = width - 48; // modal padding
    const thumbSize = 48;
    const padding = 4;
    const maxSwipe = buttonWidth - thumbSize - (padding * 2);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => !isLoading,
            onMoveShouldSetPanResponder: () => !isLoading,
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dx > 0 && gestureState.dx <= maxSwipe) {
                    pan.setValue(gestureState.dx);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dx >= maxSwipe * 0.7) {
                    Animated.timing(pan, {
                        toValue: maxSwipe,
                        duration: 150,
                        useNativeDriver: true,
                    }).start(() => {
                        onComplete();
                        // Reset back after completion
                        setTimeout(() => {
                            Animated.spring(pan, {
                                toValue: 0,
                                useNativeDriver: true,
                                bounciness: 0,
                            }).start();
                        }, 1000);
                    });
                } else {
                    Animated.spring(pan, {
                        toValue: 0,
                        useNativeDriver: true,
                        bounciness: 0,
                        speed: 20
                    }).start();
                }
            },
        })
    ).current;

    const opacity = pan.interpolate({
        inputRange: [0, maxSwipe * 0.5],
        outputRange: [1, 0],
        extrapolate: 'clamp'
    });

    return (
        <View style={[styles.swipeContainer, { width: buttonWidth, backgroundColor: color + '15', borderColor: color + '30' }]}>
            <Animated.View style={[styles.swipeTextContainer, { opacity }]}>
                <Text style={[styles.swipeText, { color }]}>{label}</Text>
            </Animated.View>
            
            <Animated.View
                {...panResponder.panHandlers}
                style={[
                    styles.swipeThumb,
                    { 
                        backgroundColor: color,
                        transform: [{ translateX: pan }]
                    }
                ]}
            >
                {isLoading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                    <Icon size={20} color="#ffffff" />
                )}
            </Animated.View>
        </View>
    );
};

const TimeInOutModal: React.FC<TimeInOutModalProps> = ({ visible, onClose, userData, colorPalette, isMandatory }) => {
    const { width } = useWindowDimensions();
    const pan = useRef(new Animated.ValueXY()).current;

    // States
    const [isLoading, setIsLoading] = useState(false);
    const [statusData, setStatusData] = useState<any>(null);
    const primaryColor = colorPalette?.primary || '#ef4444';

    // Check if the user is currently timed in
    const isCurrentlyTimedIn = !!statusData?.time_in && !statusData?.time_out;
    const canClose = !isMandatory || isCurrentlyTimedIn;

    // Helper to get User ID safely
    const getUserId = () => {
        return userData?.id || userData?.user_id || userData?.user?.id;
    };

    // Fetch Status Logic
    const fetchStatus = async () => {
        const userId = getUserId();
        if (!userId) return;

        setIsLoading(true);
        try {
            const response = await techInOutService.getStatus(userId);
            if (response.success) {
                setStatusData(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (visible) {
            fetchStatus();
            pan.setValue({ x: 0, y: 0 }); // Reset pan position
        }
    }, [visible]);

    const handleTimeIn = async () => {
        const userId = getUserId();
        if (!userId) return;
        setIsLoading(true);
        try {
            const response = await techInOutService.timeIn(userId);
            if (response.success) {
                setStatusData(response.data);
                Alert.alert('Success', 'You have timed in successfully.');
            }
        } catch (error: any) {
            const errDetail = error.response?.data?.message || error.response?.data?.error || error.message || 'Unknown error';
            Alert.alert('Error', `Failed to Time In: ${errDetail}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTimeOut = async () => {
        const userId = getUserId();
        if (!userId) return;
        if (!statusData?.time_in) {
            Alert.alert('Error', 'You must time in first.');
            return;
        }
        setIsLoading(true);
        try {
            const response = await techInOutService.timeOut(userId);
            if (response.success) {
                setStatusData(response.data);
                Alert.alert('Success', 'You have timed out successfully.');
            }
        } catch (error: any) {
            const errDetail = error.response?.data?.message || error.response?.data?.error || error.message || 'Unknown error';
            Alert.alert('Error', `Failed to Time Out: ${errDetail}`);
        } finally {
            setIsLoading(false);
        }
    };

    const formatTime = (dateStr: string | null) => {
        if (!dateStr) return '--:--';
        try {
            const date = new Date(dateStr);
            let hours = date.getHours();
            const minutes = date.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            const strMinutes = minutes < 10 ? '0' + minutes : minutes;
            return `${hours}:${strMinutes} ${ampm}`;
        } catch {
            return '--:--';
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-- --';
        try {
            const date = new Date(dateStr);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        } catch {
            return '-- --';
        }
    };

    const isTimeOutDisabled = !statusData?.time_in || !!statusData?.time_out;
    const isTimeInDisabled = !!statusData?.time_in && !statusData?.time_out;

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => canClose,
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return canClose && Math.abs(gestureState.dy) > 10;
            },
            onPanResponderMove: (_, gestureState) => {
                if (canClose && gestureState.dy > 0) {
                    pan.setValue({ x: 0, y: gestureState.dy });
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 120 && canClose) {
                    Animated.timing(pan, {
                        toValue: { x: 0, y: 1000 },
                        duration: 250,
                        useNativeDriver: true,
                    }).start(onClose);
                } else {
                    Animated.spring(pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: true,
                        bounciness: 0,
                        speed: 10
                    }).start();
                }
            },
        })
    ).current;

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <Pressable 
                    style={styles.modalBackdrop} 
                    onPress={() => { if (canClose) onClose(); }} 
                />
                <Animated.View style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}>

                    <View {...panResponder.panHandlers} style={styles.modalHeader}>
                        {canClose ? (
                            <Pressable onPress={onClose} style={styles.modalHandleBtn}>
                                <View style={styles.modalHandle} />
                            </Pressable>
                        ) : (
                            <View style={styles.modalHandleBtn}>
                                <View style={[styles.modalHandle, { opacity: 0.3 }]} />
                            </View>
                        )}
                        <Text style={styles.modalTitle}>Time In/Out</Text>
                    </View>

                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <View style={styles.contentContainer}>
                            {isLoading && !statusData ? (
                                <View style={styles.loaderWrap}>
                                    <ActivityIndicator size="large" color={primaryColor} />
                                    <Text style={styles.loaderText}>Connection to records...</Text>
                                </View>
                            ) : (
                                <View style={styles.body}>
                                    <View style={styles.statusCard}>
                                        <View style={styles.cardHeader}>
                                            <View style={styles.dateGroup}>
                                                <Text style={styles.cardLabel}>CURRENT STATUS</Text>
                                                <Text style={styles.cardDate}>{statusData ? formatDate(statusData.last_updated) : 'Welcome, Tech!'}</Text>
                                            </View>
                                            <View style={[styles.badge, { backgroundColor: (statusData?.time_in && !statusData?.time_out) ? '#10b98120' : '#6b728015' }]}>
                                                <Text style={[styles.badgeText, { color: (statusData?.time_in && !statusData?.time_out) ? '#10b981' : '#6b7280' }]}>
                                                    {(statusData?.time_in && !statusData?.time_out) ? 'ONLINE' : 'OFFLINE'}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.timeRow}>
                                            <View style={styles.timeItem}>
                                                <LogIn size={22} color="#10b981" />
                                                <View style={styles.timeTextWrap}>
                                                    <Text style={styles.timeLabel}>Time In</Text>
                                                    <Text style={[styles.timeValue, { color: statusData?.time_in ? '#111827' : '#9ca3af' }]}>
                                                        {formatTime(statusData?.time_in)}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.timeDivider} />
                                            <View style={styles.timeItem}>
                                                <LogOut size={22} color="#ef4444" />
                                                <View style={styles.timeTextWrap}>
                                                    <Text style={styles.timeLabel}>Time Out</Text>
                                                    <Text style={[styles.timeValue, { color: statusData?.time_out ? '#111827' : '#9ca3af' }]}>
                                                        {formatTime(statusData?.time_out)}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>
                                    </View>

                                    {/* Swipe Gestures Container */}
                                    <View style={styles.buttonContainer}>
                                        {!isCurrentlyTimedIn ? (
                                            <SwipeButton
                                                label="SWIPE TO TIME IN"
                                                color="#10b981"
                                                icon={LogIn}
                                                width={width}
                                                onComplete={handleTimeIn}
                                                isLoading={isLoading}
                                            />
                                        ) : (
                                            <SwipeButton
                                                label="SWIPE TO TIME OUT"
                                                color="#ef4444"
                                                icon={LogOut}
                                                width={width}
                                                onComplete={handleTimeOut}
                                                isLoading={isLoading}
                                            />
                                        )}
                                    </View>

                                </View>
                            )}
                        </View>
                        <View style={styles.spacer} />
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
    modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    modalSheet: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 40,
        borderTopRightRadius: 40,
        width: '100%',
        maxHeight: '85%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -15 },
        shadowOpacity: 0.1,
        shadowRadius: 40,
        elevation: 30
    },
    modalHeader: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        alignItems: 'center'
    },
    modalHandleBtn: {
        width: '100%',
        alignItems: 'center',
        paddingVertical: 8
    },
    modalHandle: {
        width: '20%',
        height: 3,
        backgroundColor: '#d1d5db',
        borderRadius: 2,
        marginBottom: 8
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827'
    },
    scrollContent: {
        flexGrow: 1,
    },
    contentContainer: {
        padding: 24,
        paddingTop: 0,
        alignItems: 'center'
    },
    body: {
        width: '100%',
    },
    loaderWrap: {
        paddingVertical: 40,
        alignItems: 'center',
        width: '100%'
    },
    loaderText: {
        fontSize: 14,
        color: '#6b7280',
        marginTop: 12
    },
    statusCard: {
        backgroundColor: '#f8fafc',
        borderRadius: 24,
        padding: 24,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        width: '100%',
        marginBottom: 20
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24
    },
    dateGroup: {
        flex: 1
    },
    cardLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94a3b8',
        letterSpacing: 1,
        marginBottom: 4
    },
    cardDate: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1e293b'
    },
    badge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 50,
        marginLeft: 10
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.5
    },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 24,
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9'
    },
    timeItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeTextWrap: {
        marginLeft: 14
    },
    timeLabel: {
        fontSize: 11,
        color: '#64748b',
        fontWeight: '600',
        marginBottom: 2
    },
    timeValue: {
        fontSize: 18,
        fontWeight: 'bold'
    },
    timeDivider: {
        width: 1,
        height: 48,
        backgroundColor: '#f1f5f9',
        marginHorizontal: 14
    },
    infoBox: {
        flexDirection: 'row',
        backgroundColor: '#eff6ff',
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        width: '100%',
        marginBottom: 24
    },
    infoText: {
        fontSize: 13,
        color: '#1e40af',
        flex: 1,
        lineHeight: 18,
        marginLeft: 12
    },
    buttonContainer: {
        width: '100%'
    },
    buttonWrapper: {
        width: '100%',
        marginBottom: 12,
        borderRadius: 50,
        overflow: 'hidden'
    },
    disabledButtonWrapper: {
        opacity: 0.4
    },
    timeInBtn: {
        height: 56,
        backgroundColor: '#10b981',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%'
    },
    timeOutBtn: {
        height: 56,
        backgroundColor: '#ef4444',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%'
    },
    btnText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
        letterSpacing: 1
    },
    swipeContainer: {
        height: 56,
        borderRadius: 28,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        position: 'relative',
        overflow: 'hidden'
    },
    swipeTextContainer: {
        position: 'absolute',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    swipeText: {
        fontSize: 14,
        fontWeight: '800',
        letterSpacing: 1,
    },
    swipeThumb: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
    spacer: {
        height: 40
    }
});

export default TimeInOutModal;

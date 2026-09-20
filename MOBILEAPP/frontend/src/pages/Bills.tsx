import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, Linking, useWindowDimensions, RefreshControl, Modal, PanResponder, Animated, StyleSheet, Platform, DeviceEventEmitter } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as WebBrowser from 'expo-web-browser';
import * as LinkingExpo from 'expo-linking';
import { Download, FileText, Clock, CheckCircle, File, ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { paymentService, PendingPayment } from '../services/paymentService';
import { useCustomerDataContext } from '../contexts/CustomerDataContext';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { API_BASE_URL, authFetch } from '../config/api';

interface SOARecord {
    id: number;
    statement_date?: string;
    statement_no?: string;
    print_link?: string;
    total_amount_due?: number;
}

interface InvoiceRecord {
    id: number;
    invoice_date?: string;
    invoice_balance?: number;
    print_link?: string;
    status?: string;
}

interface PaymentRecord {
    id: string;
    date: string;
    reference: string;
    amount: number;
    source: 'Online' | 'Manual';
    status?: string;
}

interface BillsProps {
    initialTab?: 'soa' | 'invoices' | 'payments';
}

const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
};

const formatCurrency = (amount: number) => {
    const isNegative = (amount || 0) < 0;
    const formatted = Math.abs(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
    return `₱${isNegative ? '-' : ''}${formatted}`;
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9fafb' },
    loadingContainer: { padding: 32, flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
    tabRow: { flexDirection: 'row', width: '100%', justifyContent: 'center', gap: 6, marginBottom: 0 },
    tabBase: {
        flex: 1, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 4,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        borderRadius: 12, position: 'relative',
    },
    tabActive: { 
        backgroundColor: '#ffffff', 
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2
    },
    tabInactive: { backgroundColor: 'transparent' },
    tabText: { fontSize: 13, fontWeight: '800' },
    tabTextActive: { color: '#111827' },
    tabTextInactive: { color: '#9ca3af' },
    tabIndicator: { position: 'absolute', bottom: 0, width: '50%', height: 3, borderRadius: 3 },
    contentContainer: {
        paddingHorizontal: 16, paddingTop: 0, paddingBottom: 120,
        backgroundColor: '#ffffff',
    },
    card: {
        paddingVertical: 18,
    },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    divider: { height: 1.5, backgroundColor: '#f1f5f9', marginVertical: 14 },
    labelText: { fontSize: 11, color: '#6b7280', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    valueText: { fontSize: 15, fontWeight: '800', color: '#111827', marginTop: 2 },
    amountText: { fontSize: 18, fontWeight: '900', marginTop: 2 },
    alignEnd: { alignItems: 'flex-end' },
    pdfBtnBase: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
    pdfBtnDisabled: { backgroundColor: '#f9fafb', borderColor: '#f1f5f9', opacity: 0.5 },
    pdfText: { fontSize: 13, fontWeight: '800' },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    statusText: { fontSize: 11, fontWeight: '800' },
    refContainer: { flex: 1, marginRight: 16 },
    refText: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#64748b', marginTop: 2 },
    paymentAmount: { fontSize: 18, fontWeight: '900', color: '#16a34a', marginTop: 2 },
    paginationRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 10, paddingBottom: 40, gap: 16 },
    paginationBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12, borderRadius: 12, minWidth: 40, justifyContent: 'center' },
    paginationBtnDisabled: { backgroundColor: '#f3f4f6', opacity: 0.5 },
    paginationText: { fontSize: 14, fontWeight: '800' },
    pageIndicator: { fontSize: 14, color: '#111827', fontWeight: '800' },
    emptyContainer: { paddingVertical: 80, alignItems: 'center', paddingHorizontal: 40 },
    emptyIconContainer: { padding: 24, borderRadius: 32, marginBottom: 20 },
    emptyTitle: { fontSize: 20, fontWeight: '800', color: '#6b7280', marginBottom: 8 },
    emptySubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22 },
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    modalSheet: {
        backgroundColor: '#ffffff', borderTopLeftRadius: 30, borderTopRightRadius: 30,
        width: '100%', maxHeight: '90%',
        shadowColor: '#000', shadowOffset: { width: 0, height: -15 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 20,
    },
    modalHeader: { paddingHorizontal: 24, paddingVertical: 16, alignItems: 'center' },
    modalHandle: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, marginBottom: 12 },
    modalTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
    modalContent: { padding: 24 },
    modalContentCenter: { padding: 32, alignItems: 'center' },
    verifyBox: { backgroundColor: '#f9fafb', padding: 20, borderRadius: 20, marginBottom: 24, borderWidth: 1, borderColor: '#f1f5f9' },
    verifyRow: { flexDirection: 'row', justifyContent: 'space-between' },
    verifyRowMb: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
    verifyLabel: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
    verifyValue: { fontWeight: '800', color: '#111827', fontSize: 15 },
    errorBox: { backgroundColor: '#fef2f2', padding: 14, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#fee2e2' },
    errorText: { color: '#ef4444', fontSize: 14, textAlign: 'center', fontWeight: '600' },
    inputLabel: { fontWeight: '700', marginBottom: 10, color: '#374151', fontSize: 15 },
    inputField: { width: '100%', paddingHorizontal: 16, paddingVertical: 16, borderRadius: 16, fontSize: 18, fontWeight: '700', borderWidth: 2, borderColor: '#e5e7eb', color: '#111827', backgroundColor: '#ffffff' },
    inputWrap: { marginBottom: 32 },
    primaryBtn: { paddingVertical: 18, borderRadius: 20, alignItems: 'center' },
    primaryBtnText: { color: '#ffffff', fontWeight: '900', fontSize: 16 },
    spacer: { height: 40 },
    successCircleLg: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    successCircleSm: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    successBox: { backgroundColor: '#f0fdf4', padding: 24, borderRadius: 20, marginBottom: 24, alignItems: 'center' },
    successTitle: { color: '#166534', fontWeight: '800', fontSize: 18, marginBottom: 4 },
    successRef: { color: '#15803d', fontWeight: '700', fontSize: 14 },
    paymentDescWrap: { marginBottom: 32, paddingHorizontal: 10 },
    paymentDesc: { textAlign: 'center', color: '#4b5563', fontSize: 15, lineHeight: 24 },
    paymentDescBold: { fontWeight: '800', color: '#111827' },
    openPortalBtn: { paddingVertical: 18, borderRadius: 20, backgroundColor: '#16a34a', alignItems: 'center', marginBottom: 16 },
    maybeLaterText: { color: '#6b7280', fontSize: 15, textAlign: 'center', fontWeight: '700' },
    pendingBox: { backgroundColor: '#fffbeb', padding: 20, borderRadius: 20, marginBottom: 24, borderLeftWidth: 6, borderLeftColor: '#f59e0b' },
    pendingLabel: { color: '#92400e', fontSize: 14, fontWeight: '600' },
    pendingAmount: { fontWeight: '900', color: '#92400e', fontSize: 18 },
    pendingDesc: { color: '#4b5563', marginBottom: 32, textAlign: 'center', fontSize: 15, lineHeight: 24, paddingHorizontal: 10 },
    pendingBtns: { gap: 14 },
    resumeBtn: { paddingVertical: 18, borderRadius: 20, alignItems: 'center' },
    cancelBtn: { paddingVertical: 18, borderRadius: 20, backgroundColor: '#f3f4f6', alignItems: 'center' },
    cancelBtnText: { color: '#4b5563', fontWeight: '800', fontSize: 16 },
    successDesc: { fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 32, lineHeight: 26, paddingHorizontal: 10 },
    successBtn: { paddingVertical: 18, borderRadius: 20, width: '100%', alignItems: 'center' },
    // Balance Card Styles
    balanceCard: { borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8, backgroundColor: '#ffffff' },
    gradientInner: { borderRadius: 24, paddingVertical: 24, paddingHorizontal: 24, position: 'relative', overflow: 'hidden' },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
    initialsCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' },
    initialsText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
    customerNameText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', textTransform: 'capitalize' },
    customerAccountText: { color: '#e5e7eb', fontSize: 11, opacity: 0.9 },
    billingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    billingLeft: { flex: 1 },
    billingRightCol: { alignItems: 'flex-end', gap: 12 },
    dueDateContainerCard: { alignItems: 'flex-end' },
    balanceLabelCard: { color: '#e5e7eb', fontSize: 11, marginBottom: 2 },
    balanceAmountTextCard: { fontWeight: 'bold', color: '#ffffff' },
    infoTextCard: { color: '#e5e7eb', fontSize: 11 },
    infoValueCard: { color: '#ffffff', fontWeight: 'bold', fontSize: 11 },
    payBtnCard: { borderWidth: 1, borderColor: '#ffffff', paddingHorizontal: 24, paddingVertical: 8, borderRadius: 12 },
    payBtnTextCard: { color: '#ffffff', fontWeight: 'bold', textAlign: 'center', fontSize: 13 },
});

const BillCard = React.memo(({ record, type, primaryColor, onDownload, isGenerating, isAnyGenerating }: { record: any, type: 'soa' | 'invoice', primaryColor: string, onDownload: (record: any) => void, isGenerating: boolean, isAnyGenerating?: boolean }) => {
    const isSoa = type === 'soa';
    const date = isSoa ? record.statement_date : record.invoice_date;
    const amount = isSoa ? record.total_amount_due : record.invoice_balance;
    const label = isSoa ? 'Statement Date' : 'Invoice Date';
    const amountLabel = isSoa ? 'Amount Due' : 'Balance';

    return (
        <View style={styles.card}>
            <View style={[styles.cardRow, { marginBottom: 14 }]}>
                <View>
                    <Text style={styles.labelText}>{label}</Text>
                    <Text style={styles.valueText}>{formatDate(date)}</Text>
                </View>
                <View style={styles.alignEnd}>
                    <Text style={styles.labelText}>Ref No.</Text>
                    <Text style={styles.valueText}>#{record.id}</Text>
                </View>
            </View>
            <View style={styles.cardRow}>
                <View>
                    <Text style={styles.labelText}>{amountLabel}</Text>
                    <Text style={[styles.amountText, { color: isSoa ? primaryColor : '#111827' }]}>
                        {formatCurrency(amount || 0)}
                    </Text>
                </View>
                {isSoa ? (
                    <Pressable
                        onPress={() => onDownload(record)}
                        disabled={isAnyGenerating}
                        style={[styles.pdfBtnBase, { backgroundColor: primaryColor + '10', borderColor: primaryColor + '20' }, isAnyGenerating && { opacity: 0.5 }]}
                    >
                        {isGenerating ? (
                            <ActivityIndicator size="small" color={primaryColor} />
                        ) : (
                            <Download width={14} height={14} color={primaryColor} />
                        )}
                        <Text style={[styles.pdfText, { color: primaryColor }]}>{isGenerating ? '...' : 'PDF'}</Text>
                    </Pressable>
                ) : (
                    <View style={[
                        styles.statusBadge, 
                        { backgroundColor: record.status?.toUpperCase() === 'PAID' ? '#f0fdf4' : record.status?.toUpperCase() === 'UNPAID' ? '#fef2f2' : '#f3f4f6' }
                    ]}>
                        <Text style={[
                            styles.statusText, 
                            { color: record.status?.toUpperCase() === 'PAID' ? '#15803d' : record.status?.toUpperCase() === 'UNPAID' ? '#ef4444' : '#374151' }
                        ]}>
                            {(record.status || 'UNKNOWN').toUpperCase()}
                        </Text>
                    </View>
                )}
            </View>
            <View style={styles.divider} />
        </View>
    );
});

const HistoryCard = React.memo(({ record }: { record: PaymentRecord }) => {
    const isPositive = record.status === 'Completed' || record.status === 'PAID';
    return (
        <View style={styles.card}>
            <View style={[styles.cardRow, { marginBottom: 14 }]}>
                <View>
                    <Text style={styles.labelText}>Payment Date</Text>
                    <Text style={styles.valueText}>{formatDate(record.date)}</Text>
                </View>
                <View style={[styles.alignEnd, { flex: 1, marginLeft: 16 }]}>
                    <Text style={styles.labelText}>Ref: {record.source}</Text>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={styles.refText}>{record.reference}</Text>
                </View>
            </View>
            <View style={styles.cardRow}>
                <View>
                    <Text style={styles.labelText}>Amount Paid</Text>
                    <Text style={styles.paymentAmount}>{formatCurrency(record.amount)}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: isPositive ? '#f0fdf4' : '#f3f4f6' }]}>
                    <Text style={[styles.statusText, { color: isPositive ? '#15803d' : '#374151' }]}>
                        {(record.status || 'Posted').toUpperCase()}
                    </Text>
                </View>
            </View>
            <View style={styles.divider} />
        </View>
    );
});

const Bills: React.FC<BillsProps> = ({ initialTab = 'soa' }) => {
    const { width, height } = useWindowDimensions();
    const isMobile = width < 768;
    const isShort = height < 700;
    const { customerDetail, payments: paymentRecords, soaRecords, invoiceRecords, isLoading: contextLoading, isBillsLoading, fetchBillsData, accountNo: resolvedAccountNo, silentRefresh } = useCustomerDataContext();
    const accountNo = customerDetail?.billingAccount?.accountNo || '';
    const balance = Number(customerDetail?.billingAccount?.accountBalance || 0);
    const [activeTab, setActiveTab] = useState<'soa' | 'invoices' | 'payments'>(initialTab);

    const [tabMeasurements, setTabMeasurements] = useState<Record<'soa' | 'invoices' | 'payments', { x: number, width: number }>>({
        soa: { x: 0, width: 0 },
        invoices: { x: 0, width: 0 },
        payments: { x: 0, width: 0 },
    });
    const slideAnim = React.useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const measurement = tabMeasurements[activeTab];
        if (measurement && measurement.width > 0) {
            Animated.spring(slideAnim, {
                toValue: measurement.x,
                useNativeDriver: false,
                tension: 65,
                friction: 10
            }).start();
        }
    }, [activeTab, tabMeasurements, slideAnim]);

    const [user, setUser] = useState<any>(null);
    const [displayName, setDisplayName] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
    const primaryColor = colorPalette?.primary || '#ef4444';
    const [refreshing, setRefreshing] = useState(false);
    const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
    const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [showPaymentLinkModal, setShowPaymentLinkModal] = useState(false);
    const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
    const [showPendingPaymentModal, setShowPendingPaymentModal] = useState(false);
    const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [isGeneratingPDF, setIsGeneratingPDF] = useState<number | null>(null);

    const ITEMS_PER_PAGE = 5;
    const [currentPage, setCurrentPage] = useState(0);

    const pan = React.useRef(new Animated.ValueXY()).current;

    // Reset pan position when modals open
    useEffect(() => {
        if (showPaymentVerifyModal || showPaymentLinkModal || showPendingPaymentModal || showSuccessModal) {
            pan.setValue({ x: 0, y: 0 });
        }
    }, [showPaymentVerifyModal, showPaymentLinkModal, showPendingPaymentModal, showSuccessModal]);

    const panResponder = React.useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 0,
            onPanResponderMove: Animated.event([null, { dy: pan.y }], { useNativeDriver: false }),
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 150) {
                    if (showPaymentVerifyModal) handleCloseVerifyModal();
                    else if (showPaymentLinkModal) handleCancelPaymentLink();
                    else if (showPendingPaymentModal) handleCancelPendingPayment();
                    else if (showSuccessModal) setShowSuccessModal(false);
                } else {
                    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
                }
            }
        })
    ).current;

    useEffect(() => {
        let cancelled = false;
        const initLoad = async () => {
            const [authResult, paletteResult] = await Promise.allSettled([
                AsyncStorage.getItem('authData'),
                settingsColorPaletteService.getActive(),
            ]);
            if (cancelled) return;
            if (authResult.status === 'fulfilled' && authResult.value) {
                try {
                    const parsedUser = JSON.parse(authResult.value);
                    setUser(parsedUser);
                    setDisplayName(parsedUser.full_name || 'Customer');
                } catch (error) { }
            }
            if (paletteResult.status === 'fulfilled') {
                setColorPalette(paletteResult.value);
            }
        };
        initLoad();
        silentRefresh();

        // Statements and invoices are no longer fetched at launch, so this screen
        // asks for its own. A no-op after the first visit — the context keeps them —
        // so returning to this tab does not re-request anything.
        void fetchBillsData();

        const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
            setColorPalette(newPalette);
        });

        return () => {
            cancelled = true;
            paletteSub.remove();
        };
    }, []);

    // The mount call above finds no account if this screen opened before the main
    // load resolved one, or while a failed load was still retrying. This picks it
    // up whenever it lands. fetchBillsData is a no-op once loaded, so this cannot
    // start a second request.
    useEffect(() => {
        if (resolvedAccountNo) {
            void fetchBillsData();
        }
    }, [resolvedAccountNo, fetchBillsData]);

    useEffect(() => {
        setCurrentPage(0);
    }, [activeTab]);

    const handleCloseVerifyModal = useCallback(() => {
        setShowPaymentVerifyModal(false);
        setPaymentAmount(balance);
    }, [balance]);

    const handleCancelPaymentLink = useCallback(() => {
        setShowPaymentLinkModal(false);
        setPaymentLinkData(null);
    }, []);

    const handleCancelPendingPayment = useCallback(() => {
        setShowPendingPaymentModal(false);
        setPendingPayment(null);
    }, []);

    const handlePayNow = useCallback(async () => {
        setErrorMessage('');
        setIsPaymentProcessing(true);
        try {
            const pending = await paymentService.checkPendingPayment(accountNo);
            if (pending && pending.payment_url) {
                setPendingPayment(pending);
                setShowPendingPaymentModal(true);
            } else {
                setPaymentAmount(balance);
                setShowPaymentVerifyModal(true);
            }
        } catch (error: any) {
            console.error('Error checking pending payment:', error);
            setPaymentAmount(balance);
            setShowPaymentVerifyModal(true);
        } finally {
            setIsPaymentProcessing(false);
        }
    }, [accountNo, balance]);

    const handleProceedToCheckout = useCallback(async () => {
        if (paymentAmount < 1) {
            setErrorMessage('Payment amount must be at least ₱1.00');
            return;
        }
        if (isPaymentProcessing) return;
        setIsPaymentProcessing(true);
        setErrorMessage('');
        try {
            const deepLink = LinkingExpo.createURL('payment-success');
            const xenditRedirectUrl = `${API_BASE_URL}/payments/redirect?to=${encodeURIComponent(deepLink)}`;
            const response = await paymentService.createPayment(accountNo, paymentAmount, xenditRedirectUrl);
            if (response.status === 'success' && response.payment_url) {
                setShowPaymentVerifyModal(false);
                setPaymentLinkData({
                    referenceNo: response.reference_no || '',
                    amount: response.amount || paymentAmount,
                    paymentUrl: response.payment_url
                });
                setShowPaymentLinkModal(true);
            } else {
                throw new Error(response.message || 'Failed to create payment link');
            }
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to create payment.');
        } finally {
            setIsPaymentProcessing(false);
        }
    }, [accountNo, paymentAmount, isPaymentProcessing]);

    const handleOpenPaymentLink = useCallback(async () => {
        const url = paymentLinkData?.paymentUrl || pendingPayment?.payment_url;
        const refNo = paymentLinkData?.referenceNo || pendingPayment?.reference_no || '';
        if (url) {
            try {
                const deepLink = LinkingExpo.createURL('payment-success');
                await WebBrowser.openAuthSessionAsync(url, deepLink);

                await silentRefresh();

                setShowPaymentLinkModal(false);
                setShowPendingPaymentModal(false);
                setPaymentLinkData(null);
                setPendingPayment(null);

                // Verify actual payment status from Xendit before showing success
                if (refNo) {
                    try {
                        const statusRes = await paymentService.checkPaymentStatus(refNo);
                        if (statusRes.status === 'success' && statusRes.payment?.status === 'PAID') {
                            setShowSuccessModal(true);
                        }
                    } catch (err) {
                        console.error('Error checking payment status:', err);
                    }
                }
            } catch (error) {
                console.error('Error opening browser:', error);
                Linking.openURL(url);
            }
        }
    }, [paymentLinkData, pendingPayment, silentRefresh]);

    const handleResumePendingPayment = handleOpenPaymentLink;

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            // allSettled: a failed statement list must not stop the payments on
            // this same screen from refreshing.
            await Promise.allSettled([silentRefresh(), fetchBillsData(true)]);
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setRefreshing(false);
        }
    }, [silentRefresh, fetchBillsData]);

    if (contextLoading && !customerDetail) return (
        <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#111827" />
        </View>
    );

    const handleDownloadPDF = async (record: SOARecord) => {
        if (record.print_link) {
            Linking.openURL(record.print_link);
            return;
        }

        setIsGeneratingPDF(record.id);
        try {
            const response = await authFetch(`${API_BASE_URL}/statement-of-accounts/${record.id}/generate-pdf`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                }
            });
            const result = await response.json();
            const pdfUrl = result.pdf_url || result.data?.url || result.data?.print_link;
            if (result.success && pdfUrl) {
                Linking.openURL(pdfUrl);
                // Silently refresh to update the list with the new print_link
                await silentRefresh();
            } else {
                console.error('PDF Generation failed:', result.message);
                // Fallback or alert if needed
            }
        } catch (error) {
            console.error('Error generating PDF:', error);
        } finally {
            setIsGeneratingPDF(null);
        }
    };

    const currentRecords = useMemo(() => {
        if (activeTab === 'soa') return soaRecords;
        if (activeTab === 'invoices') return invoiceRecords;
        return paymentRecords;
    }, [activeTab, soaRecords, invoiceRecords, paymentRecords]);

    const paginatedData = useMemo(() => {
        const start = currentPage * ITEMS_PER_PAGE;
        return currentRecords.slice(start, start + ITEMS_PER_PAGE);
    }, [currentRecords, currentPage]);

    const totalPages = Math.max(1, Math.ceil(currentRecords.length / ITEMS_PER_PAGE));

    const renderPagination = useCallback(() => {
        if (currentRecords.length <= ITEMS_PER_PAGE) return null;
        const isPrevDisabled = currentPage === 0;
        const isNextDisabled = currentPage >= totalPages - 1;
        return (
            <View style={styles.paginationRow}>
                <Pressable
                    onPress={() => setCurrentPage(Math.max(0, currentPage - 1))}
                    disabled={isPrevDisabled}
                    style={[styles.paginationBtn, isPrevDisabled ? styles.paginationBtnDisabled : { backgroundColor: primaryColor + '10' }]}
                >
                    <Text style={[styles.paginationText, {
                        color: isPrevDisabled ? '#9ca3af' : primaryColor,
                        fontSize: 18,
                        fontWeight: 'bold'
                    }]}>{"<"}</Text>
                </Pressable>

                <Text style={styles.pageIndicator}>
                    {currentPage + 1} / {totalPages}
                </Text>

                <Pressable
                    onPress={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                    disabled={isNextDisabled}
                    style={[styles.paginationBtn, isNextDisabled ? styles.paginationBtnDisabled : { backgroundColor: primaryColor + '10' }]}
                >
                    <Text style={[styles.paginationText, {
                        color: isNextDisabled ? '#9ca3af' : primaryColor,
                        fontSize: 18,
                        fontWeight: 'bold'
                    }]}>{">"}</Text>
                </Pressable>
            </View>
        );
    }, [primaryColor, currentPage, totalPages, currentRecords.length]);

    return (
        <View style={styles.container}>
            <View style={{ paddingHorizontal: isMobile ? 16 : 24, paddingTop: isMobile ? (isShort ? 20 : 60) : 16, gap: isShort ? 12 : 20 }}>
                

                <View style={[styles.tabRow, { position: 'relative' }]}>
                    <Animated.View style={[
                        styles.tabActive,
                        {
                            position: 'absolute',
                            height: '100%',
                            width: tabMeasurements[activeTab]?.width || 0,
                            left: 0,
                            bottom: 0,
                            opacity: tabMeasurements[activeTab]?.width > 0 ? 1 : 0,
                            transform: [{ translateX: slideAnim }],
                            alignItems: 'center',
                        }
                    ]}>
                        <View style={[styles.tabIndicator, { backgroundColor: colorPalette?.primary || '#ef4444' }]} />
                    </Animated.View>

                    <Pressable
                        onLayout={(e) => {
                            const { x, width } = e.nativeEvent.layout;
                            setTabMeasurements(prev => ({ ...prev, soa: { x, width } }));
                        }}
                        onPress={() => setActiveTab('soa')}
                        style={[styles.tabBase, { zIndex: 5, backgroundColor: 'transparent' }]}
                    >
                        <FileText width={16} height={16} color={activeTab === 'soa' ? (colorPalette?.primary || '#ef4444') : '#9ca3af'} />
                        <Text style={[styles.tabText, activeTab === 'soa' ? styles.tabTextActive : styles.tabTextInactive]}>SOA</Text>
                    </Pressable>
                    <Pressable
                        onLayout={(e) => {
                            const { x, width } = e.nativeEvent.layout;
                            setTabMeasurements(prev => ({ ...prev, invoices: { x, width } }));
                        }}
                        onPress={() => setActiveTab('invoices')}
                        style={[styles.tabBase, { zIndex: 5, backgroundColor: 'transparent' }]}
                    >
                        <File width={16} height={16} color={activeTab === 'invoices' ? (colorPalette?.primary || '#ef4444') : '#9ca3af'} />
                        <Text style={[styles.tabText, activeTab === 'invoices' ? styles.tabTextActive : styles.tabTextInactive]}>Invoices</Text>
                    </Pressable>
                    <Pressable
                        onLayout={(e) => {
                            const { x, width } = e.nativeEvent.layout;
                            setTabMeasurements(prev => ({ ...prev, payments: { x, width } }));
                        }}
                        onPress={() => setActiveTab('payments')}
                        style={[styles.tabBase, { zIndex: 5, backgroundColor: 'transparent' }]}
                    >
                        <Clock width={16} height={16} color={activeTab === 'payments' ? (colorPalette?.primary || '#ef4444') : '#9ca3af'} />
                        <Text style={[styles.tabText, activeTab === 'payments' ? styles.tabTextActive : styles.tabTextInactive]}>History</Text>
                    </Pressable>
                </View>
            </View>

            <FlashList
                data={paginatedData as any[]}
                style={{ flex: 1, backgroundColor: '#ffffff' }}
                keyExtractor={(item: any) => String(item.id)}
                contentContainerStyle={styles.contentContainer}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[primaryColor]}
                        tintColor={primaryColor}
                    />
                }
                ListEmptyComponent={() => (
                    <View style={styles.emptyContainer}>
                        {/* Statements and invoices arrive after this screen opens now,
                            so an empty list mid-load has to read as loading — not as
                            "you have no invoices", which is a different and alarming
                            thing to tell a customer. */}
                        {isBillsLoading && activeTab !== 'payments' ? (
                            <ActivityIndicator size="small" color={primaryColor} />
                        ) : (
                            <Text style={styles.emptyTitle}>
                                {activeTab === 'soa' ? 'No Statements' : activeTab === 'invoices' ? 'No Invoices' : 'No History'}
                            </Text>
                        )}
                    </View>
                )}
                renderItem={({ item }) => (
                    activeTab === 'payments'
                        ? <HistoryCard record={item as any} />
                        : <BillCard 
                            record={item} 
                            type={activeTab === 'soa' ? 'soa' : 'invoice'} 
                            primaryColor={primaryColor} 
                            onDownload={handleDownloadPDF}
                            isGenerating={isGeneratingPDF === item.id}
                            isAnyGenerating={isGeneratingPDF !== null}
                          />
                )}
                ListFooterComponent={renderPagination}
            />

            <Modal
                visible={showPaymentVerifyModal}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={handleCloseVerifyModal}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} onPress={handleCloseVerifyModal} />
                    <Animated.View
                        {...panResponder.panHandlers}
                        style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHandle} />
                            <Text style={styles.modalTitle}>Confirm Payment</Text>
                        </View>
                        <ScrollView contentContainerStyle={styles.modalContent}>
                            <View style={styles.verifyBox}>
                                <View style={styles.verifyRowMb}>
                                    <Text style={styles.verifyLabel}>Account Name</Text>
                                    <Text style={styles.verifyValue}>{displayName}</Text>
                                </View>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.verifyLabel}>Account Balance</Text>
                                    <Text style={[styles.verifyValue, { fontWeight: 'bold', color: balance > 0 ? (colorPalette?.primary || '#ef4444') : '#16a34a' }]}>
                                        {formatCurrency(balance)}
                                    </Text>
                                </View>
                            </View>

                            {errorMessage && (
                                <View style={styles.errorBox}>
                                    <Text style={styles.errorText}>{errorMessage}</Text>
                                </View>
                            )}

                            <View style={styles.inputWrap}>
                                <Text style={styles.inputLabel}>Payment Amount</Text>
                                <TextInput
                                    keyboardType="decimal-pad"
                                    value={paymentAmount.toString()}
                                    onChangeText={(val) => setPaymentAmount(parseFloat(val) || 0)}
                                    placeholder="0.00"
                                    style={styles.inputField}
                                />
                            </View>

                            <Pressable
                                onPress={handleProceedToCheckout}
                                disabled={isPaymentProcessing || paymentAmount < 1}
                                style={[styles.primaryBtn, {
                                    backgroundColor: colorPalette?.primary || '#ef4444',
                                    opacity: (isPaymentProcessing || paymentAmount < 1) ? 0.6 : 1,
                                    shadowColor: colorPalette?.primary || '#ef4444',
                                    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5
                                }]}
                            >
                                <Text style={styles.primaryBtnText}>
                                    {isPaymentProcessing ? 'Processing...' : 'Proceed to Payment'}
                                </Text>
                            </Pressable>
                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* Payment Link Modal */}
            <Modal
                visible={showPaymentLinkModal && !!paymentLinkData}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={handleCancelPaymentLink}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} onPress={handleCancelPaymentLink} />
                    <Animated.View
                        {...panResponder.panHandlers}
                        style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHandle} />
                            <Text style={styles.modalTitle}>Payment Link Created!</Text>
                        </View>
                        <ScrollView contentContainerStyle={styles.modalContent}>
                            <View style={styles.successBox}>
                                <View style={styles.successCircleSm}>
                                    <CheckCircle size={32} color="#16a34a" />
                                </View>
                                <Text style={styles.successTitle}>Ready to Pay</Text>
                                <Text style={styles.successRef}>{paymentLinkData?.referenceNo}</Text>
                            </View>

                            <View style={styles.paymentDescWrap}>
                                <Text style={styles.paymentDesc}>
                                    Your payment link for <Text style={styles.paymentDescBold}>{formatCurrency(paymentLinkData?.amount || 0)}</Text> is ready. Click below to open the payment portal.
                                </Text>
                            </View>

                            <Pressable onPress={handleOpenPaymentLink} style={styles.openPortalBtn}>
                                <Text style={styles.primaryBtnText}>Open Payment Portal</Text>
                            </Pressable>

                            <Pressable onPress={handleCancelPaymentLink}>
                                <Text style={styles.maybeLaterText}>Maybe Later</Text>
                            </Pressable>
                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* Pending Payment Modal */}
            <Modal
                visible={showPendingPaymentModal && !!pendingPayment}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={handleCancelPendingPayment}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} onPress={handleCancelPendingPayment} />
                    <Animated.View
                        {...panResponder.panHandlers}
                        style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHandle} />
                            <Text style={styles.modalTitle}>Pending Payment Found</Text>
                        </View>
                        <ScrollView contentContainerStyle={styles.modalContent}>
                            <View style={styles.pendingBox}>
                                <View style={styles.verifyRow}>
                                    <Text style={styles.pendingLabel}>Amount</Text>
                                    <Text style={styles.pendingAmount}>
                                        {formatCurrency(pendingPayment?.amount || 0)}
                                    </Text>
                                </View>
                            </View>

                            <Text style={styles.pendingDesc}>
                                You have an active payment session. Would you like to resume it now?
                            </Text>

                            <View style={styles.pendingBtns}>
                                <Pressable
                                    onPress={handleResumePendingPayment}
                                    style={[styles.resumeBtn, { backgroundColor: colorPalette?.primary || '#0f172a' }]}
                                >
                                    <Text style={styles.primaryBtnText}>Resume Payment</Text>
                                </Pressable>
                                <Pressable onPress={handleCancelPendingPayment} style={styles.cancelBtn}>
                                    <Text style={styles.cancelBtnText}>Cancel</Text>
                                </Pressable>
                            </View>
                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* Success Modal */}
            <Modal
                visible={showSuccessModal}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={() => { }} // User must explicitly close via button
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalBackdrop} />
                    <Animated.View
                        {...panResponder.panHandlers}
                        style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHandle} />
                            <Text style={styles.modalTitle}>Payment Successful!</Text>
                        </View>
                        <ScrollView contentContainerStyle={styles.modalContentCenter}>
                            <View style={styles.successCircleLg}>
                                <CheckCircle size={48} color="#16a34a" />
                            </View>
                            <Text style={styles.successDesc}>
                                Thank you! Your payment has been processed successfully. Your balance will be updated shortly.
                            </Text>
                            <Pressable
                                onPress={() => setShowSuccessModal(false)}
                                style={[styles.successBtn, { backgroundColor: colorPalette?.primary || '#ef4444' }]}
                            >
                                <Text style={styles.primaryBtnText}>Great!</Text>
                            </Pressable>
                            <View style={styles.spacer} />
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* Loading Modal for PDF Generation */}
            <Modal
                visible={isGeneratingPDF !== null}
                transparent={true}
                animationType="fade"
                statusBarTranslucent={true}
            >
                <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
                    <View style={[styles.modalBackdrop, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
                    <View style={{ backgroundColor: 'white', padding: 32, borderRadius: 24, alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, width: '80%', maxWidth: 320 }}>
                        <ActivityIndicator size="large" color={primaryColor} />
                        <Text style={{ marginTop: 20, fontSize: 18, fontWeight: '800', color: '#111827' }}>Generating PDF</Text>
                        <Text style={{ marginTop: 8, fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 }}>Please wait a moment while we prepare your document...</Text>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

export default Bills;

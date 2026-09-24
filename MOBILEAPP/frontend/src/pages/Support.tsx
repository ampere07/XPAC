import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, ActivityIndicator, Linking, useWindowDimensions, Animated, PanResponder, RefreshControl, KeyboardAvoidingView, Platform, StyleSheet, DeviceEventEmitter } from 'react-native';
import { FileText, Upload, Clock, CheckCircle, Plus, X, ChevronLeft, ChevronRight, MessageSquare, AlertCircle } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as LinkingExpo from 'expo-linking';
import { paymentService, PendingPayment } from '../services/paymentService';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { FlashList } from '@shopify/flash-list';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { createServiceOrder } from '../services/serviceOrderService';
import { useCustomerDataContext } from '../contexts/CustomerDataContext';
import * as WebBrowser from 'expo-web-browser';
import SupportDetails from '../components/SupportDetails';
import ImagePreview from '../components/ImagePreview';
import apiClient from '../config/api';

interface SupportRequest {
  id: string;
  date: string;
  requestId: string;
  issue: string;
  issueDetails: string;
  status: string;
  statusNote: string;
  assignedEmail: string;
  visitNote: string;
  visitInfo: {
    status: string;
  };
}

interface SupportProps {
  forceLightMode?: boolean;
}

const formatCurrency = (amount: number) => {
  const isNegative = (amount || 0) < 0;
  const formatted = Math.abs(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  return `₱${isNegative ? '-' : ''}${formatted}`;
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const SupportCard = React.memo<{
  request: SupportRequest;
  primaryColor: string;
  onPress: (request: SupportRequest) => void;
}>(({ request, primaryColor, onPress }) => {
  return (
    <View style={s.card}>
      {/* Header Row */}
      <View style={s.cardHeaderRow}>
        <View style={s.cardHeaderLeft}>
          <Text style={s.ticketId}>#{request.requestId}</Text>
          <View style={[s.dateBadge, { backgroundColor: primaryColor + '10' }]}>
            <Text style={[s.dateText, { color: primaryColor }]}>{request.date}</Text>
          </View>
        </View>
        <View style={s.statusBadge}>
          <Text style={s.statusText}>{request.status}</Text>
        </View>
      </View>

      {/* Issue Section */}
      <View style={s.issueSection}>
        <Text style={s.issueTitle}>{request.issue}</Text>
        <Text style={s.issueDetails} numberOfLines={2}>
          {request.issueDetails}
        </Text>
      </View>

      <View style={s.cardFooterRow}>
        <View style={s.visitRow}>
          <CheckCircle size={14} color={request.visitInfo.status === 'Done' ? '#10b981' : '#9ca3af'} />
          <Text style={s.visitText}>
            Visit: {request.visitInfo.status}
          </Text>
        </View>
        <Pressable
          onPress={() => onPress(request)}
          style={[s.detailsBtn, { borderColor: primaryColor + '40' }]}
        >
          <Text style={[s.detailsBtnText, { color: primaryColor }]}>Details</Text>
        </Pressable>
      </View>
    </View>
  );
});

const Support: React.FC<SupportProps> = ({ forceLightMode }) => {
  const { width, height } = useWindowDimensions();
  const isMobile = width < 768;
  const isShort = height < 700;
  const { customerDetail, serviceOrders: requests, isLoading: contextLoading, silentRefresh } = useCustomerDataContext();
  const userAccountNo = customerDetail?.billingAccount?.accountNo || '';
  const balance = Number(customerDetail?.billingAccount?.accountBalance || 0);
  const displayName = customerDetail?.fullName || 'Customer';
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
  const primaryColor = colorPalette?.primary || '#ef4444';
  const [selectedConcern, setSelectedConcern] = useState<string>('No Internet');
  const [details, setDetails] = useState<string>('');
  const [image4File, setImage4File] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitMessage, setSubmitMessage] = useState<string>('');
  const [cooldownTime, setCooldownTime] = useState<number>(0);

  // Check ticket submission limits: 5 per day, 1 hour interval
  const MAX_TICKETS_PER_DAY = 5;
  const COOLDOWN_HOURS = 1;

  const todayTicketInfo = useMemo(() => {
    if (!requests || requests.length === 0) return { count: 0, lastSubmitTime: null as Date | null };
    const today = new Date();
    const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
    let count = 0;
    let lastSubmitTime: Date | null = null;
    for (const req of requests) {
      if (req.date === todayStr) {
        count++;
        if (!lastSubmitTime) {
          // First match is the latest since requests are sorted newest-first.
          // Use the precise submission timestamp so the cooldown reflects the
          // actual submit time — NOT "now" (which would show a bogus fresh
          // countdown on every page open even without submitting).
          const raw = (req as any).rawTimestamp || (req as any).timestamp || (req as any).created_at;
          if (raw) {
            const parsed = new Date(raw);
            if (!isNaN(parsed.getTime())) lastSubmitTime = parsed;
          }
          // Fallback: the ticket's calendar date at midnight (never the current
          // moment). A ticket created earlier today will then be well past the
          // 1-hour cooldown instead of restarting it.
          if (!lastSubmitTime && req.date) {
            const [mm, dd, yyyy] = req.date.split('/').map((n) => parseInt(n, 10));
            if (mm && dd && yyyy) {
              const midnight = new Date(yyyy, mm - 1, dd);
              if (!isNaN(midnight.getTime())) lastSubmitTime = midnight;
            }
          }
        }
      }
    }
    return { count, lastSubmitTime };
  }, [requests]);

  const hasReachedDailyLimit = todayTicketInfo.count >= MAX_TICKETS_PER_DAY;

  const cooldownRemaining = useMemo(() => {
    if (!todayTicketInfo.lastSubmitTime) return 0;
    const now = new Date();
    const elapsed = now.getTime() - todayTicketInfo.lastSubmitTime.getTime();
    const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
    return Math.max(0, cooldownMs - elapsed);
  }, [todayTicketInfo.lastSubmitTime, cooldownTime]); // cooldownTime triggers re-compute

  const isInCooldown = cooldownRemaining > 0;
  const remainingRequests = (hasReachedDailyLimit || isInCooldown) ? 0 : MAX_TICKETS_PER_DAY - todayTicketInfo.count;

  // Countdown timer
  useEffect(() => {
    if (!isInCooldown) return;
    const timer = setInterval(() => {
      setCooldownTime(prev => prev + 1); // trigger re-render to update cooldownRemaining
    }, 1000);
    return () => clearInterval(timer);
  }, [isInCooldown]);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showLoadingModal, setShowLoadingModal] = useState<boolean>(false);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [showNewRequestModal, setShowNewRequestModal] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Payment States
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [showPaymentVerifyModal, setShowPaymentVerifyModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [showPaymentLinkModal, setShowPaymentLinkModal] = useState(false);
  const [paymentLinkData, setPaymentLinkData] = useState<{ referenceNo: string; amount: number; paymentUrl: string } | null>(null);
  const [showPendingPaymentModal, setShowPendingPaymentModal] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPaymentSuccessModal, setShowPaymentSuccessModal] = useState(false);

  const ITEMS_PER_PAGE = 5;
  const [currentPage, setCurrentPage] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [selectedRequest, setSelectedRequest] = useState<SupportRequest | null>(null);

  const concernOptions = [
    'No Internet',
    'Slow Internet',
    'Intermittent Connection',
    'Router Issue',
    'Cable Problem',
    'Port Issue',
    'Others'
  ];

  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          pan.setValue({ x: 0, y: gestureState.dy });
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120) {
          // Smoothly animate off screen before closing
          Animated.timing(pan, {
            toValue: { x: 0, y: 1000 },
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            setShowNewRequestModal(false);
          });
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

  // Handle modal state changes to ensure pan is reset correctly
  useEffect(() => {
    if (showNewRequestModal) {
      pan.setValue({ x: 0, y: 0 });
    }
  }, [showNewRequestModal]);



  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    const initPage = async () => {
      try {
        const [activePalette, authData] = await Promise.all([
          settingsColorPaletteService.getActive(),
          AsyncStorage.getItem('authData')
        ]);
        setColorPalette(activePalette);
        if (authData) {
          const user = JSON.parse(authData);
          setUser(user);
          setUserEmail(user.email || '');
        }
      } catch (err) {
        console.error('Support page init error:', err);
      }
    };
    initPage();

    const paletteSub = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      setColorPalette(newPalette);
    });

    return () => paletteSub.remove();
  }, []);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await silentRefresh();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [silentRefresh]);

  const handleSubmit = async () => {
    if (!details.trim()) {
      setSubmitMessage('Please provide details about your issue');
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }

    if (!userAccountNo) {
      setSubmitMessage('Account number not found. Please log in again.');
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }

    if (hasReachedDailyLimit) {
      setSubmitMessage(`Daily limit of ${MAX_TICKETS_PER_DAY} tickets reached. Please try again tomorrow.`);
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }

    if (isInCooldown) {
      const mins = Math.ceil(cooldownRemaining / 60000);
      setSubmitMessage(`Please wait ${mins} minute${mins !== 1 ? 's' : ''} before submitting another ticket.`);
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }

    setShowNewRequestModal(false);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    setShowConfirmModal(false);
    setShowLoadingModal(true);

    try {
      let image4Url = '';
      if (image4File) {
        const fd = new FormData();
        fd.append('file', {
          uri: image4File.uri,
          name: image4File.name || `image4_${Date.now()}.jpg`,
          type: image4File.type || 'image/jpeg'
        } as any);

        const uploadRes = await apiClient.post('/google-drive/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        if (uploadRes.data?.success) {
          image4Url = uploadRes.data.data.url;
        } else {
          throw new Error(uploadRes.data?.message || 'Failed to upload image');
        }
      }

      const newServiceOrder = {
        account_no: userAccountNo,
        concern: selectedConcern,
        concern_remarks: details,
        created_by_user: userEmail,
        requested_by: userEmail,
        support_status: 'Open',
        image4: image4Url || undefined
      };

      console.log('[Support] Submitting service order:', newServiceOrder);
      const response = await createServiceOrder(newServiceOrder);
      console.log('[Support] Submit response:', response);

      if (response.success) {
        setShowLoadingModal(false);
        setShowSuccessModal(true);
        await silentRefresh();
        setDetails('');
        setImage4File(null);
      } else {
        setShowLoadingModal(false);
        setSubmitMessage(response.message || 'Failed to submit request. Please try again.');
        setTimeout(() => setSubmitMessage(''), 3000);
      }
    } catch (error: any) {
      console.error('Failed to submit request:', error);
      setShowLoadingModal(false);
      setSubmitMessage(error.message || 'Failed to submit request. Please try again.');
      setTimeout(() => setSubmitMessage(''), 3000);
    }
  };

  // Payment Handlers
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
      const pending = await paymentService.checkPendingPayment(userAccountNo);
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
  }, [userAccountNo, balance]);

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
      const response = await paymentService.createPayment(userAccountNo, paymentAmount, deepLink);
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
  }, [userAccountNo, paymentAmount, isPaymentProcessing]);

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
        if (refNo) {
          try {
            const statusRes = await paymentService.checkPaymentStatus(refNo);
            if (statusRes.status === 'success' && statusRes.payment?.status === 'PAID') {
              setShowPaymentSuccessModal(true);
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

  const handleOpenChat = async () => {
    const webUrl = 'https://m.me/gowiserzc';
    const messengerAppUrl = 'fb-messenger://user-thread/';
    try {
      const canOpenMessenger = await Linking.canOpenURL(messengerAppUrl);
      if (canOpenMessenger) {
        await Linking.openURL(webUrl);
      } else {
        await WebBrowser.openBrowserAsync(webUrl);
      }
    } catch (error) {
      await WebBrowser.openBrowserAsync(webUrl);
    }
  };

  const handleRequestPlanUpdate = handleOpenChat;

  const latestRequest = useMemo(() => {
    return requests.length > 0 ? [requests[0]] : [];
  }, [requests]);

  const totalPages = Math.max(1, Math.ceil(requests.length / ITEMS_PER_PAGE));

  const renderPagination = useCallback(() => {
    if (requests.length <= ITEMS_PER_PAGE) return null;
    const primary = colorPalette?.primary || '#ef4444';
    const isPrevDisabled = currentPage === 0;
    const isNextDisabled = currentPage >= totalPages - 1;
    return (
      <View style={s.paginationRow}>
        <Pressable
          onPress={() => setCurrentPage(Math.max(0, currentPage - 1))}
          disabled={isPrevDisabled}
          style={[s.paginationBtn, isPrevDisabled ? s.paginationBtnDisabled : { backgroundColor: primary + '12' }, { minWidth: 40, justifyContent: 'center', paddingHorizontal: 8 }]}
        >
          <Text style={[s.paginationText, {
            color: isPrevDisabled ? '#9ca3af' : primary,
            fontSize: 18,
            fontWeight: 'bold'
          }]}>{"<"}</Text>
        </Pressable>
        <Text style={s.pageIndicator}>{currentPage + 1} / {totalPages}</Text>
        <Pressable
          onPress={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
          disabled={isNextDisabled}
          style={[s.paginationBtn, isNextDisabled ? s.paginationBtnDisabled : { backgroundColor: primary + '12' }, { minWidth: 40, justifyContent: 'center', paddingHorizontal: 8 }]}
        >
          <Text style={[s.paginationText, {
            color: isNextDisabled ? '#9ca3af' : primary,
            fontSize: 18,
            fontWeight: 'bold'
          }]}>{">"}</Text>
        </Pressable>
      </View>
    );
  }, [colorPalette, currentPage, totalPages, requests.length]);

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: isMobile ? (isShort ? 20 : 60) : 20, gap: isShort ? 12 : 24, paddingHorizontal: isMobile ? 16 : 24 }]}>


        <View style={s.titleContainer}>
          <Text style={s.title}>Support Center</Text>
        </View>
        <Text style={s.subtitle}>Track and manage your service requests</Text>
      </View>

      <FlashList
        data={latestRequest}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={{
          paddingHorizontal: isMobile ? 16 : 24,
          paddingBottom: 120,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[primaryColor]}
            tintColor={primaryColor}
          />
        }
        ListEmptyComponent={() => (
          contextLoading ? (
            <View style={s.emptyState}>
              <ActivityIndicator size="large" color={primaryColor} />
              <Text style={s.emptyText}>Loading records...</Text>
            </View>
          ) : (
            <View style={s.emptyState}>
              <Text style={s.emptyTitle}>No Requests Yet</Text>
              <Text style={s.emptySubtitle}>If you have any issues with your connection, please submit a ticket.</Text>
            </View>
          )
        )}
        renderItem={({ item }) => (
          <SupportCard
            request={item}
            primaryColor={primaryColor}
            onPress={setSelectedRequest}
          />
        )}
      />

      {/* Support Details View */}
      {selectedRequest && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]}>
          <SupportDetails
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
          />
        </View>
      )}

      {/* Floating Action Button */}
      <Pressable
        onPress={() => setShowNewRequestModal(true)}
        style={{
          position: 'absolute',
          bottom: isMobile ? 110 : 30,
          right: isMobile ? 20 : 30,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colorPalette?.primary || '#ef4444',
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 6,
          elevation: 8
        }}
      >
        <Plus size={28} color="#ffffff" />
      </Pressable >


      {/* New Request Modal */}
      <Modal
        visible={showNewRequestModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNewRequestModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }}>
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }} />
          <KeyboardAvoidingView
            behavior="padding"
            style={{ flex: 1 }}
          >
            <Animated.View
              style={{
                backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                flex: 1,
                padding: 24,
                transform: [{ translateY: pan.y }]
              }}
            >
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 24,
                paddingTop: Platform.OS === 'ios' ? 40 : 10, // Account for notch
              }}>
                <Pressable
                  onPress={() => setShowNewRequestModal(false)}
                  style={{ padding: 8 }}
                >
                  <Text style={{ color: colorPalette?.primary || '#ef4444', fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Text style={{
                  fontSize: 18,
                  fontWeight: '600',
                  color: isDarkMode ? '#ffffff' : '#111827',
                  flex: 1,
                  textAlign: 'center',
                  marginRight: 60 // Offset for the cancel button to center the title
                }}>
                  New Request
                </Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 16 }}>
                  <Text style={{
                    fontSize: 14,
                    fontWeight: '500',
                    marginBottom: 8,
                    color: isDarkMode ? '#d1d5db' : '#374151'
                  }}>
                    Concern
                  </Text>
                  <View style={{
                    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                    borderWidth: 1,
                    borderColor: isDarkMode ? '#374151' : '#d1d5db',
                    borderRadius: 4
                  }}>
                    <Picker
                      selectedValue={selectedConcern}
                      onValueChange={(value) => setSelectedConcern(value)}
                      style={{
                        color: isDarkMode ? '#ffffff' : '#111827'
                      }}
                    >
                      {concernOptions.map((option) => (
                        <Picker.Item key={option} label={option} value={option} />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={{ marginBottom: 24 }}>
                  <Text style={{
                    fontSize: 14,
                    fontWeight: '500',
                    marginBottom: 8,
                    color: isDarkMode ? '#d1d5db' : '#374151'
                  }}>
                    Details
                  </Text>
                  <TextInput
                    value={details}
                    onChangeText={setDetails}
                    placeholder="Describe your issue..."
                    placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    style={{
                      width: '100%',
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 4,
                      borderWidth: 1,
                      backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                      color: isDarkMode ? '#ffffff' : '#111827',
                      borderColor: isDarkMode ? '#374151' : '#d1d5db',
                      minHeight: 120
                    }}
                  />
                </View>

                <View style={{ marginBottom: 24 }}>
                  <ImagePreview
                    label="Upload Image (Optional)"
                    imageUrl={image4File?.uri || null}
                    onUpload={(file) => {
                      setImage4File(file);
                    }}
                    isDarkMode={isDarkMode}
                    colorPrimary={primaryColor}
                  />
                </View>

                <Pressable
                  onPress={handleSubmit}
                  disabled={isSubmitting || remainingRequests <= 0}
                  style={{
                    width: '100%',
                    paddingVertical: 12,
                    borderRadius: 4,
                    alignItems: 'center',
                    backgroundColor: (isSubmitting || remainingRequests <= 0) ? '#6b7280' : (colorPalette?.primary || '#1e40af'),
                    opacity: (isSubmitting || remainingRequests <= 0) ? 0.5 : 1
                  }}
                >
                  <Text style={{
                    color: 'white',
                    fontWeight: '500'
                  }}>
                    SUBMIT TICKET
                  </Text>
                </Pressable>

                <View style={{
                  marginTop: 12,
                  alignItems: 'center'
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Clock size={14} color={isDarkMode ? '#9ca3af' : '#4b5563'} style={{ marginRight: 4 }} />
                    <Text style={{
                      fontSize: 14,
                      color: isDarkMode ? '#9ca3af' : '#4b5563'
                    }}>
                      {hasReachedDailyLimit
                        ? `Daily limit reached (${todayTicketInfo.count}/${MAX_TICKETS_PER_DAY}).`
                        : isInCooldown
                          ? `Next ticket available in ${Math.floor(cooldownRemaining / 60000)}m ${Math.floor((cooldownRemaining % 60000) / 1000)}s`
                          : `Limit: ${MAX_TICKETS_PER_DAY} requests/day. (${todayTicketInfo.count}/${MAX_TICKETS_PER_DAY} used)`}
                    </Text>
                  </View>
                </View>

                {submitMessage && (
                  <View style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 4,
                    backgroundColor: submitMessage.includes('Failed') || submitMessage.includes('limit') || submitMessage.includes('not found')
                      ? (colorPalette?.primary || '#ef4444') + '15'
                      : '#10b98115'
                  }}>
                    <Text style={{
                      fontSize: 14,
                      textAlign: 'center',
                      color: submitMessage.includes('Failed') || submitMessage.includes('limit') || submitMessage.includes('not found')
                        ? colorPalette?.primary || '#ef4444'
                        : '#10b981'
                    }}>
                      {submitMessage}
                    </Text>
                  </View>
                )}

                <Pressable
                  onPress={handleRequestPlanUpdate}
                  style={{
                    width: '100%',
                    marginTop: 16,
                    paddingVertical: 12,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: isDarkMode ? '#374151' : '#d1d5db',
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center'
                  }}
                >
                  <Upload size={16} color={isDarkMode ? '#d1d5db' : '#374151'} style={{ marginRight: 8 }} />
                  <Text style={{
                    fontWeight: '500',
                    color: isDarkMode ? '#d1d5db' : '#374151'
                  }}>
                    Request Plan Update
                  </Text>
                </Pressable>
              </ScrollView>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Confirm Modal */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'transparent',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <View style={{
            backgroundColor: isDarkMode ? '#111827' : '#ffffff',
            borderRadius: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 12,
            padding: 24,
            maxWidth: 448,
            width: '90%'
          }}>
            <View style={{ marginBottom: 16 }}>
              <Text style={{
                fontSize: 20,
                fontWeight: '600',
                color: isDarkMode ? '#ffffff' : '#111827'
              }}>
                Confirm Submission
              </Text>
            </View>
            <Text style={{
              marginBottom: 24,
              color: isDarkMode ? '#d1d5db' : '#374151'
            }}>
              Are you sure you want to submit this support ticket?
            </Text>
            <View style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 4,
              backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6'
            }}>
              <Text style={{
                fontSize: 14,
                fontWeight: '500',
                marginBottom: 4,
                color: isDarkMode ? '#d1d5db' : '#374151'
              }}>
                Concern: {selectedConcern}
              </Text>
              <Text style={{
                fontSize: 14,
                color: isDarkMode ? '#9ca3af' : '#4b5563'
              }}>
                Details: {details.substring(0, 100)}{details.length > 100 ? '...' : ''}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={() => setShowConfirmModal(false)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 4,
                  alignItems: 'center',
                  backgroundColor: isDarkMode ? '#1f2937' : '#e5e7eb'
                }}
              >
                <Text style={{
                  fontWeight: '500',
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmSubmit}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 4,
                  alignItems: 'center',
                  backgroundColor: colorPalette?.primary || '#ef4444'
                }}
              >
                <Text style={{
                  fontWeight: '500',
                  color: 'white'
                }}>
                  Confirm
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Loading Modal */}
      <Modal
        visible={showLoadingModal}
        transparent
        animationType="fade"
      >
        <View style={{
          flex: 1,
          backgroundColor: 'transparent',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <View style={{
            backgroundColor: isDarkMode ? '#111827' : '#ffffff',
            borderRadius: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 12,
            padding: 32,
            maxWidth: 384,
            width: '90%'
          }}>
            <View style={{ flexDirection: 'column', alignItems: 'center' }}>
              <ActivityIndicator
                size="large"
                color={colorPalette?.primary || '#ef4444'}
                style={{ marginBottom: 16 }}
              />
              <Text style={{
                fontSize: 20,
                fontWeight: '600',
                marginBottom: 8,
                color: isDarkMode ? '#ffffff' : '#111827'
              }}>
                Submitting Ticket
              </Text>
              <Text style={{
                fontSize: 14,
                color: isDarkMode ? '#9ca3af' : '#4b5563'
              }}>
                Please wait...
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSuccessModal(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'transparent',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <View style={{
            backgroundColor: isDarkMode ? '#111827' : '#ffffff',
            borderRadius: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 12,
            padding: 24,
            maxWidth: 448,
            width: '90%'
          }}>
            <View style={{ flexDirection: 'column', alignItems: 'center' }}>
              <View style={{
                borderRadius: 9999,
                padding: 12,
                marginBottom: 16,
                backgroundColor: `${colorPalette?.primary || '#ef4444'}33`
              }}>
                <CheckCircle
                  size={48}
                  color={colorPalette?.primary || '#ef4444'}
                />
              </View>
              <Text style={{
                fontSize: 20,
                fontWeight: '600',
                marginBottom: 8,
                color: isDarkMode ? '#ffffff' : '#111827'
              }}>
                Ticket Submitted Successfully
              </Text>
              <Text style={{
                fontSize: 14,
                textAlign: 'center',
                marginBottom: 24,
                color: isDarkMode ? '#9ca3af' : '#4b5563'
              }}>
                Your support ticket has been created. We will get back to you soon.
              </Text>
              <Pressable
                onPress={() => setShowSuccessModal(false)}
                style={{
                  width: '100%',
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 4,
                  alignItems: 'center',
                  backgroundColor: colorPalette?.primary || '#ef4444'
                }}
              >
                <Text style={{
                  fontWeight: '500',
                  color: 'white'
                }}>
                  OK
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {/* Payment Modals */}
      <Modal
        visible={showPaymentVerifyModal}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={handleCloseVerifyModal}
      >
        <View style={s.modalOverlayPay}>
          <Pressable style={s.modalBackdropPay} onPress={handleCloseVerifyModal} />
          <Animated.View style={[s.modalSheetPay, { transform: [{ translateY: pan.y }] }]}>
            <View {...panResponder.panHandlers} style={s.modalHeaderPay}>
              <View style={s.modalHandlePay} />
              <Text style={s.modalTitlePay}>Confirm Payment</Text>
            </View>
            <ScrollView contentContainerStyle={s.modalContentPay} keyboardShouldPersistTaps="handled">
              <View style={s.verifyBoxPay}>
                <View style={s.verifyRowMbPay}>
                  <Text style={s.verifyLabelPay}>Account Name</Text>
                  <Text style={s.verifyValuePay}>{displayName}</Text>
                </View>
                <View style={s.verifyRowPay}>
                  <Text style={s.verifyLabelPay}>Current Balance</Text>
                  <Text style={[s.verifyValuePay, { fontWeight: 'bold', color: balance > 0 ? primaryColor : '#16a34a' }]}>
                    {formatCurrency(balance)}
                  </Text>
                </View>
              </View>

              {errorMessage && (
                <View style={[s.errorBoxPay, { backgroundColor: primaryColor + '15', borderColor: primaryColor + '30' }]}>
                  <Text style={[s.errorTextPay, { color: primaryColor }]}>{errorMessage}</Text>
                </View>
              )}

              <View style={s.inputWrapPay}>
                <Text style={s.inputLabelPay}>Payment Amount</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  value={paymentAmount.toString()}
                  onChangeText={(val) => setPaymentAmount(parseFloat(val) || 0)}
                  placeholder="0.00"
                  style={s.inputFieldPay}
                />
              </View>

              <Pressable
                onPress={handleProceedToCheckout}
                disabled={isPaymentProcessing || paymentAmount < 1}
                style={[s.primaryBtnPay, { backgroundColor: primaryColor, opacity: (isPaymentProcessing || paymentAmount < 1) ? 0.5 : 1 }]}
              >
                <Text style={s.primaryBtnTextPay}>
                  {isPaymentProcessing ? 'Processing...' : 'Pay Now'}
                </Text>
              </Pressable>
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={showPaymentLinkModal && !!paymentLinkData}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={handleCancelPaymentLink}
      >
        <View style={s.modalOverlayPay}>
          <Pressable style={s.modalBackdropPay} onPress={handleCancelPaymentLink} />
          <Animated.View style={[s.modalSheetPay, { transform: [{ translateY: pan.y }] }]}>
            <View {...panResponder.panHandlers} style={s.modalHeaderPay}>
              <View style={s.modalHandlePay} />
              <Text style={s.modalTitlePay}>Payment Link Created!</Text>
            </View>
            <ScrollView contentContainerStyle={s.modalContentPay}>
              <View style={s.verifyBoxPay}>
                <View style={s.verifyRowMbPay}>
                  <Text style={s.verifyLabelPay}>Reference No.</Text>
                  <Text style={s.verifyValuePay}>{paymentLinkData?.referenceNo}</Text>
                </View>
                <View style={s.verifyRowPay}>
                  <Text style={s.verifyLabelPay}>Amount</Text>
                  <Text style={[s.verifyValuePay, { fontWeight: 'bold', color: primaryColor }]}>
                    {formatCurrency(paymentLinkData?.amount || 0)}
                  </Text>
                </View>
              </View>
              <Text style={s.linkDescPay}>Please click the button below to complete your payment.</Text>
              <Pressable onPress={handleOpenPaymentLink} style={[s.primaryBtnPay, { backgroundColor: '#16a34a', marginBottom: 12 }]}>
                <Text style={s.primaryBtnTextPay}>Open Payment Portal</Text>
              </Pressable>
              <Pressable onPress={handleCancelPaymentLink}>
                <Text style={s.closeTextPay}>Maybe Later</Text>
              </Pressable>
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={showPendingPaymentModal && !!pendingPayment}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={handleCancelPendingPayment}
      >
        <View style={s.modalOverlayPay}>
          <Pressable style={s.modalBackdropPay} onPress={handleCancelPendingPayment} />
          <Animated.View style={[s.modalSheetPay, { transform: [{ translateY: pan.y }] }]}>
            <View {...panResponder.panHandlers} style={s.modalHeaderPay}>
              <View style={s.modalHandlePay} />
              <Text style={s.modalTitlePay}>Pending Payment Found</Text>
            </View>
            <ScrollView contentContainerStyle={s.modalContentPay}>
              <View style={s.pendingBoxPay}>
                <View style={s.verifyRowPay}>
                  <Text style={s.pendingLabelPay}>Amount Due</Text>
                  <Text style={s.pendingAmountPay}>{formatCurrency(pendingPayment?.amount || 0)}</Text>
                </View>
              </View>
              <Text style={s.pendingDescPay}>You have a pending payment session. Would you like to resume it?</Text>
              <View style={{ gap: 12 }}>
                <Pressable onPress={handleResumePendingPayment} style={[s.primaryBtnPay, { backgroundColor: primaryColor }]}>
                  <Text style={s.primaryBtnTextPay}>Resume Payment</Text>
                </Pressable>
                <Pressable onPress={handleCancelPendingPayment} style={s.cancelBtnPay}>
                  <Text style={s.cancelBtnTextPay}>Cancel</Text>
                </Pressable>
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={showPaymentSuccessModal}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowPaymentSuccessModal(false)}
      >
        <View style={s.modalOverlayPay}>
          <Pressable style={s.modalBackdropPay} onPress={() => setShowPaymentSuccessModal(false)} />
          <Animated.View style={[s.modalSheetPay, { transform: [{ translateY: pan.y }] }]}>
            <View {...panResponder.panHandlers} style={s.modalHeaderPay}>
              <View style={s.modalHandlePay} />
              <Text style={s.modalTitlePay}>Payment Successful!</Text>
            </View>
            <ScrollView contentContainerStyle={s.modalContentCenterPay} keyboardShouldPersistTaps="handled">
              <View style={s.successCirclePay}>
                <CheckCircle size={48} color="#16a34a" />
              </View>
              <Text style={s.successDescPay}>
                Thank you! Your payment has been processed successfully. Your balance will be updated shortly.
              </Text>
              <Pressable onPress={() => setShowPaymentSuccessModal(false)} style={[s.primaryBtnPay, { backgroundColor: primaryColor, width: '100%' }]}>
                <Text style={s.primaryBtnTextPay}>Great!</Text>
              </Pressable>
              <View style={{ height: 40 }} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { paddingHorizontal: 24, paddingBottom: 20, alignItems: 'center' },
  titleContainer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  card: {
    backgroundColor: '#ffffff', borderRadius: 16, padding: 18, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 4,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ticketId: { fontSize: 16, fontWeight: '800', color: '#111827' },
  dateBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  dateText: { fontSize: 11, fontWeight: '700' },
  statusBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  issueSection: { marginBottom: 16 },
  issueTitle: { fontSize: 15, fontWeight: '700', color: '#1f2937', marginBottom: 4 },
  issueDetails: { fontSize: 13, color: '#4b5563', lineHeight: 20 },
  cardFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 14 },
  visitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  detailsBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5 },
  detailsBtnText: { fontSize: 12, fontWeight: '700' },
  emptyState: { paddingVertical: 80, alignItems: 'center', width: '100%', paddingHorizontal: 40 },
  emptyIconContainer: { padding: 24, borderRadius: 32, marginBottom: 20 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: '#6b7280', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22 },
  emptyText: { marginTop: 16, color: '#6b7280', fontSize: 14 },
  paginationRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 10, paddingBottom: 40, gap: 16 },
  paginationBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  paginationBtnDisabled: { backgroundColor: '#f3f4f6', opacity: 0.5 },
  paginationText: { fontSize: 14, fontWeight: '700' },
  pageIndicator: { fontSize: 14, color: '#111827', fontWeight: '700' },
  // Balance Card Styles
  balanceCard: { borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8, backgroundColor: '#ffffff', marginBottom: 8, width: '100%' },
  gradientInner: { borderRadius: 24, paddingHorizontal: 24, position: 'relative', overflow: 'hidden' },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  initialsCircle: { backgroundColor: 'rgba(255, 255, 255, 0.15)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.3)' },
  initialsText: { color: '#ffffff', fontWeight: 'bold' },
  customerNameText: { color: '#ffffff', fontWeight: 'bold', textTransform: 'capitalize' },
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
  payBtnInner: { alignItems: 'center' },
  payBtnTextCard: { color: '#ffffff', fontWeight: 'bold', textAlign: 'center', fontSize: 13 },
  // Payment Modal Styles
  modalOverlayPay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalBackdropPay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  modalSheetPay: { backgroundColor: '#ffffff', borderTopLeftRadius: 32, borderTopRightRadius: 32, width: '100%', maxHeight: '90%' },
  modalHeaderPay: { padding: 24, alignItems: 'center' },
  modalHandlePay: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, marginBottom: 12 },
  modalTitlePay: { fontSize: 20, fontWeight: '800', color: '#111827' },
  modalContentPay: { padding: 24 },
  modalContentCenterPay: { padding: 32, alignItems: 'center' },
  verifyBoxPay: { backgroundColor: '#f9fafb', padding: 20, borderRadius: 20, marginBottom: 24, borderWidth: 1, borderColor: '#f1f5f9' },
  verifyRowMbPay: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  verifyRowPay: { flexDirection: 'row', justifyContent: 'space-between' },
  verifyLabelPay: { color: '#6b7280', fontSize: 14 },
  verifyValuePay: { fontWeight: '700', color: '#111827' },
  inputWrapPay: { marginBottom: 24 },
  inputLabelPay: { fontWeight: '600', marginBottom: 8, color: '#374151' },
  inputFieldPay: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, padding: 12, fontSize: 16, color: '#111827' },
  primaryBtnPay: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryBtnTextPay: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
  errorBoxPay: { padding: 12, borderRadius: 8, marginBottom: 24, borderWidth: 1 },
  errorTextPay: { fontSize: 14, textAlign: 'center' },
  linkDescPay: { color: '#4b5563', marginBottom: 24, textAlign: 'center' },
  closeTextPay: { color: '#6b7280', textAlign: 'center', fontWeight: '600' },
  pendingBoxPay: { backgroundColor: '#fffbeb', padding: 16, borderRadius: 12, marginBottom: 24, borderLeftWidth: 4, borderLeftColor: '#f59e0b' },
  pendingLabelPay: { color: '#92400e', fontSize: 14 },
  pendingAmountPay: { fontWeight: 'bold', color: '#92400e' },
  pendingDescPay: { color: '#4b5563', marginBottom: 32, textAlign: 'center' },
  cancelBtnPay: { paddingVertical: 14, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center' },
  cancelBtnTextPay: { color: '#4b5563', fontWeight: 'bold' },
  successCirclePay: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#dcfce7', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  successDescPay: { fontSize: 16, color: '#4b5563', textAlign: 'center', marginBottom: 32, lineHeight: 24 },
});


export default Support;

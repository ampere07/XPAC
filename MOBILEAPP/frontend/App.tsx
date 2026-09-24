import React, { useState, useEffect, useRef } from 'react';
import './global.css';
import Login from './src/pages/Login';
import Dashboard from './src/pages/Dashboard';
import { UserData } from './src/types/api';
import apiClient, { initializeCsrf, loadCookies, clearCookies } from './src/config/api';
import { userSettingsService } from './src/services/userSettingsService';
import PaymentResultModal from './src/components/PaymentResultModal';
import SplashScreen from './src/components/SplashScreen';
import { settingsColorPaletteService } from './src/services/settingsColorPaletteService';
import { PaymentSuccessProvider } from './src/contexts/PaymentSuccessContext';
import IdleWarningModal from './src/modals/IdleWarningModal';
import AutoTimeOutWarningModal from './src/modals/AutoTimeOutWarningModal';
import { techInOutService } from './src/services/techInOutService';

import { View, AppState, PanResponder, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as NavigationBar from 'expo-navigation-bar';
import { getAppVersionConfig, compareVersions } from './src/services/appVersionService';
import { version as currentVersion } from './package.json';
import ForceUpdateModal from './src/modals/ForceUpdateModal';
import { StatusBar } from 'expo-status-bar';
import ErrorBoundary from './src/components/ErrorBoundary';
import LocationDisclosureHost from './src/components/LocationDisclosureHost';

const IDLE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours in ms
const WARNING_TIMEOUT = 1.5 * 60 * 60 * 1000; // 1.5 hours in ms

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isForceUpdate, setIsForceUpdate] = useState(false);
  const [versionConfig, setVersionConfig] = useState<any>(null);
  const [showPaymentResult, setShowPaymentResult] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');

  const [showIdleWarning, _setShowIdleWarning] = useState(false);
  const isWarningVisible = useRef(false);

  const [showAutoTimeOutWarning, setShowAutoTimeOutWarning] = useState(false);
  const lastShownSlots = useRef<{ date: string; slots: string[] }>({ date: '', slots: [] });

  const setShowIdleWarning = (visible: boolean) => {
    isWarningVisible.current = visible;
    _setShowIdleWarning(visible);
  };

  const lastInteractionTime = useRef<number>(Date.now());
  const logoutTimer = useRef<NodeJS.Timeout | null>(null);
  const warningTimer = useRef<NodeJS.Timeout | null>(null);

  const handleLogout = async () => {
    // Tell the server first. Dropping the local cookies alone leaves the session and the
    // recaller cookie alive server-side, and for technicians it also leaves their one allowed
    // session slot claimed — so their next sign-in on this same device would ask them to
    // confirm a takeover of themselves. Failure here must still clear the client, so the user
    // is never stuck signed in.
    try {
      await apiClient.post('/logout');
    } catch (error) {
      console.error('[App] Server logout failed; clearing local session anyway:', error);
    }

    // Remove user data and cookies from AsyncStorage
    await AsyncStorage.removeItem('authData');
    await AsyncStorage.removeItem('authToken');
    await clearCookies();
    setUserData(null);
    setIsLoggedIn(false);
    setShowIdleWarning(false);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
  };

  const resetTimer = () => {
    lastInteractionTime.current = Date.now();
    if (warningTimer.current) {
      clearTimeout(warningTimer.current);
    }
    if (logoutTimer.current) {
      clearTimeout(logoutTimer.current);
    }

    if (isWarningVisible.current) {
      setShowIdleWarning(false);
    }

    if (isLoggedIn) {
      warningTimer.current = setTimeout(() => {
        setShowIdleWarning(true);
      }, WARNING_TIMEOUT);

      logoutTimer.current = setTimeout(() => {
        handleLogout();
      }, IDLE_TIMEOUT);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      resetTimer();
    } else {
      if (warningTimer.current) clearTimeout(warningTimer.current);
      if (logoutTimer.current) clearTimeout(logoutTimer.current);
    }
  }, [isLoggedIn]);

  // ─── Auto Time-Out Reminder ────────────────────────────────────────────────
  // Fires at exactly 9:00 PM and 9:10 PM (PH time) if the technician is still
  // timed in. Tracks which slots have already been shown today so it only fires
  // once per slot per day.
  useEffect(() => {
    if (!isLoggedIn) return;

    const checkAutoTimeOut = async () => {
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (!authData) return;

        const parsedUser = JSON.parse(authData);
        const role = (parsedUser.role || '').toLowerCase();
        const roleId = Number(parsedUser.role_id);
        const isTechnician = role === 'technician' || roleId === 2;
        if (!isTechnician) return;

        // Get PH time (UTC+8)
        const now = new Date();
        const phOffset = 8 * 60; // minutes
        const phTime = new Date(now.getTime() + (phOffset + now.getTimezoneOffset()) * 60000);
        const hours = phTime.getHours();
        const minutes = phTime.getMinutes();
        const todayStr = phTime.toDateString();

        // Determine which slot we're in (if any)
        let currentSlot: string | null = null;
        if (hours === 21 && minutes === 0) currentSlot = '21:00';
        if (hours === 21 && minutes === 10) currentSlot = '21:10';

        if (!currentSlot) return;

        // Reset slot tracking on a new day
        if (lastShownSlots.current.date !== todayStr) {
          lastShownSlots.current = { date: todayStr, slots: [] };
        }

        // Skip if this slot was already shown today
        if (lastShownSlots.current.slots.includes(currentSlot)) return;

        // Verify the technician has an active time-in
        const userId = parsedUser.id || parsedUser.user_id;
        if (!userId) return;

        const response = await techInOutService.getStatus(userId);
        if (response.success && response.data?.time_in && !response.data?.time_out) {
          // Mark slot as shown and display warning
          lastShownSlots.current.slots.push(currentSlot);
          setShowAutoTimeOutWarning(true);
        }
      } catch (e) {
        // Silently swallow — this is a background check
      }
    };

    // Check immediately, then every 30 seconds
    checkAutoTimeOut();
    const intervalId = setInterval(checkAutoTimeOut, 30_000);
    return () => clearInterval(intervalId);
  }, [isLoggedIn]);
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync("hidden");
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && isLoggedIn) {
        const timeSinceLastInteraction = Date.now() - lastInteractionTime.current;
        if (timeSinceLastInteraction >= IDLE_TIMEOUT) {
          handleLogout();
        } else if (timeSinceLastInteraction >= WARNING_TIMEOUT) {
          // Warning window
          setShowIdleWarning(true);

          if (warningTimer.current) clearTimeout(warningTimer.current);
          if (logoutTimer.current) clearTimeout(logoutTimer.current);

          const remainingTime = IDLE_TIMEOUT - timeSinceLastInteraction;
          logoutTimer.current = setTimeout(() => {
            handleLogout();
          }, remainingTime > 0 ? remainingTime : 0);
        } else {
          resetTimer();
        }
      }
    });

    return () => {
      subscription.remove();
      if (warningTimer.current) clearTimeout(warningTimer.current);
      if (logoutTimer.current) clearTimeout(logoutTimer.current);
    };
  }, [isLoggedIn]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        if (!isWarningVisible.current) {
          resetTimer();
        }
        return false;
      },
      onMoveShouldSetPanResponderCapture: () => {
        if (!isWarningVisible.current) {
          resetTimer();
        }
        return false;
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  useEffect(() => {
    const initialize = async () => {
      // Check for payment result in URL
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const { queryParams } = Linking.parse(url);
          if (queryParams?.payment && queryParams?.ref) {
            setPaymentSuccess(queryParams.payment === 'success');
            setPaymentRef(queryParams.ref as string);
            setShowPaymentResult(true);
          }
        }
      } catch (e) {
        console.error('Failed to parse linking URL:', e);
      }

      // App Version Check
      try {
        const config = await getAppVersionConfig();
        setVersionConfig(config);
        
        const compareMin = compareVersions(currentVersion, config.min_version);

        if (compareMin < 0) {
          // Current version is BELOW minimum required → Force update
          setIsForceUpdate(true);
          setShowUpdateModal(true);
        }
        // No modal shown if current version meets or exceeds min_version
      } catch (error) {
        console.error('Failed to check app version:', error);
      }


      // Initialize CSRF cookie and check auth status
      try {
        await loadCookies();
        await initializeCsrf();
      } catch (error) {
        console.error('Failed to initialize CSRF or load cookies:', error);
      }

      // Pre-load the active configuration before rendering the app structure
      // This eliminates the styling FOUC (Flash of Unstyled Content) on the Login & Dashboard screens.
      try {
        await settingsColorPaletteService.getActive();
      } catch (error) {
        console.error('Failed to preload color palette:', error);
      }

      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const parsedUser = JSON.parse(authData);
          setUserData(parsedUser);
          setIsLoggedIn(true);
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
        await AsyncStorage.removeItem('authData');
      }

      setIsLoading(false);
    };

    initialize();
  }, []);

  const handleLogin = async (user: UserData) => {
    setUserData(user);
    // Show loading screen while applying theme
    setIsLoggingIn(true);

    try {
      // Store user data in AsyncStorage
      await AsyncStorage.setItem('authData', JSON.stringify(user));

      // Always set theme to light
      await AsyncStorage.setItem('theme', 'light');

      // Longer delay to ensure theme is fully applied
      await new Promise(resolve => setTimeout(resolve, 600));

    } catch (e) {
      console.error('Login error:', e);
    }

    setIsLoggingIn(false);
    setIsLoggedIn(true);
    resetTimer(); // Start the timer when logged in
  };

  // Show loading state while checking authentication or logging in
  if (isLoading || isLoggingIn) {
    return <SplashScreen />;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary resetKey={isLoggedIn ? 'in' : 'out'}>
      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      <StatusBar hidden={true} />
      {isLoggedIn ? (
        <PaymentSuccessProvider>
          <Dashboard onLogout={handleLogout} />
          <PaymentResultModal
            isOpen={showPaymentResult}
            onClose={() => setShowPaymentResult(false)}
            success={paymentSuccess}
            referenceNo={paymentRef}
            isDarkMode={false}
          />
          <IdleWarningModal
            visible={showIdleWarning}
            onStayLoggedIn={resetTimer}
            onLogout={handleLogout}
            countdown={30}
          />
          <AutoTimeOutWarningModal
            visible={showAutoTimeOutWarning}
            onClose={() => setShowAutoTimeOutWarning(false)}
            userData={userData}
          />
        </PaymentSuccessProvider>
      ) : (
        <Login onLogin={handleLogin} />
      )}

      {/* Google Play requires a prominent disclosure immediately before any location permission
          request. Mounted here, outside the logged-in branch, so services/locationGateway can show
          it from any screen and for any role. */}
      <LocationDisclosureHost />

      {versionConfig && (
        <ForceUpdateModal
          visible={showUpdateModal}
          playstoreUrl={versionConfig.playstore_url}
          latestVersion={versionConfig.latest_version}
          isForce={isForceUpdate}
          onClose={() => setShowUpdateModal(false)}
        />
      )}
    </View>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default App;

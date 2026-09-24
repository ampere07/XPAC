import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundLocationTrackingEnabled } from '../config/featureFlags';
import { requestBackgroundPermission, requestForegroundPermission } from '../services/locationGateway';
import { startTechLocationUpdates, stopTechLocationUpdates } from '../services/locationTask';

function isTechnician(user: any): boolean {
  if (!user) return false;
  const role = (user.role || '').toString().toLowerCase();
  const roleId = Number(user.role_id);
  return role === 'technician' || roleId === 2;
}

/**
 * Starts continuous GPS reporting for the logged-in technician and keeps it running while the app
 * is open — including in the background — via the OS location task (see services/locationTask).
 *
 * Permission is requested for a logged-in technician and nobody else: prompting a customer or an
 * office user for their location would be both useless and alarming. Tracking stops on logout
 * (unmount).
 *
 * The prominent disclosure Google Play requires is shown by services/locationGateway, which every
 * request below goes through — this hook never calls Location.request*PermissionsAsync() itself.
 *
 * Mounted unconditionally by Dashboard, so the guards run in this order and all four must pass:
 * the feature flag, then the technician role check, then the disclosure, then the OS permission.
 */
export function useLocationTracking() {
  useEffect(() => {
    // Kill switch for a Play Store build that cannot ship location permissions. Read before the
    // async work so the cleanup below stays consistent with what actually ran.
    if (!isBackgroundLocationTrackingEnabled()) return;

    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        const user = raw ? JSON.parse(raw) : null;

        // Permission prompt + tracking are strictly technician-only.
        if (!isTechnician(user)) return;

        // reAskIfDeclined: false — this runs automatically on every launch, so someone who has
        // already turned the disclosure down is not asked again.
        const status = await requestForegroundPermission('useLocationTracking', {
          reAskIfDeclined: false,
        });
        if (status !== 'granted') {
          console.warn('[location] foreground permission not granted:', status);
          return;
        }

        // Background permission lets updates continue when the app is minimized.
        // If denied, tracking still works while the app is in the foreground.
        await requestBackgroundPermission('useLocationTracking').catch(() => null);

        if (cancelled) return;
        await startTechLocationUpdates();
      } catch (e) {
        // Tracking stays off. This is almost always a native-manifest problem —
        // startLocationUpdatesAsync() needs FOREGROUND_SERVICE / FOREGROUND_SERVICE_LOCATION
        // (Android 14+) and ACCESS_BACKGROUND_LOCATION, which only the expo-location config
        // plugin in app.json adds. Never swallow this silently: without the log there is no
        // signal at all that the technician is not reporting.
        console.warn('[location] failed to start technician tracking:', e);
      }
    })();

    return () => {
      cancelled = true;
      // Stop when the technician logs out (Dashboard unmounts).
      stopTechLocationUpdates();
    };
  }, []);
}

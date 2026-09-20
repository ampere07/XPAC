import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startTechLocationUpdates, stopTechLocationUpdates } from '../services/locationTask';
import { ensureLocationPermission } from '../services/locationConsent';

function isTechnician(user: any): boolean {
  if (!user) return false;
  const role = (user.role || '').toString().toLowerCase();
  const roleId = Number(user.role_id);
  return role === 'technician' || roleId === 2;
}

/**
 * Starts continuous GPS reporting for the logged-in technician and keeps it running —
 * including in the background — via the OS location task (see services/locationTask.ts).
 *
 * Permission is obtained through ensureLocationPermission(), which shows the in-app
 * prominent disclosure before asking the OS, as Google Play's User Data policy requires.
 * This hook never calls Location.request*PermissionsAsync() itself.
 *
 * Tracking is technician-only and stops on logout (unmount).
 */
export function useLocationTracking() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem('authData');
        const user = raw ? JSON.parse(raw) : null;

        // Disclosure and tracking are strictly technician-only.
        if (!isTechnician(user)) return;

        // background: duty tracking has to keep reporting when the app is minimised.
        // reAskIfDeclined: false — this runs automatically on every launch, so someone
        // who already said no is not asked again.
        const granted = await ensureLocationPermission({
          background: true,
          reAskIfDeclined: false,
        });

        if (!granted || cancelled) return;

        // Starts even if only foreground was granted; background simply extends it.
        await startTechLocationUpdates();
      } catch {
        // Setup failure -> tracking simply stays off.
      }
    })();

    return () => {
      cancelled = true;
      // Stop when the technician logs out (Dashboard unmounts).
      stopTechLocationUpdates();
    };
  }, []);
}

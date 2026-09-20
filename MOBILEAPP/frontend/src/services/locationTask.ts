import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { technicianLocationService } from './technicianLocationService';

// Cadence for the OS-driven location "cron". Kept well under the backend's
// 2-minute stale window so an active technician stays "online".
export const TECH_LOCATION_TASK = 'atss-tech-location-task';
// Life360-like cadence: report every ~10s. distanceInterval 0 means "report on the
// time interval even when standing still", so a technician stays reliably "online"
// (not just when moving). Trade-off: higher battery use — acceptable for on-duty techs.
const TIME_INTERVAL_MS = 10_000; // ~10s
const DISTANCE_INTERVAL_M = 0;   // 0 = time-based (also fires on movement)

function isLoggedInTechnician(user: any): boolean {
  if (!user) return false;
  const role = (user.role || '').toString().toLowerCase();
  const roleId = Number(user.role_id);
  return role === 'technician' || roleId === 2;
}

/**
 * Background/foreground location task. The OS delivers batched positions here
 * (even when the app is minimized). Defined at module scope so it is registered
 * whenever the app is launched, including background relaunches.
 */
TaskManager.defineTask(TECH_LOCATION_TASK, async ({ data, error }: any) => {
  if (error) return;
  const locations = data?.locations;
  if (!locations || locations.length === 0) return;

  try {
    // Only report while a technician is still logged in; skip after logout.
    const [raw, token] = await Promise.all([
      AsyncStorage.getItem('authData'),
      AsyncStorage.getItem('authToken'),
    ]);
    const user = raw ? JSON.parse(raw) : null;
    if (!token || !isLoggedInTechnician(user)) return;

    const latest = locations[locations.length - 1];
    const { latitude, longitude, accuracy, speed, heading } = latest.coords;

    await technicianLocationService.updateLocation({
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      speed: speed ?? null,
      heading: heading ?? null,
    });
  } catch (e) {
    // Network loss / transient error: the next OS location tick will retry.
  }
});

/**
 * Begin continuous location updates (idempotent). Requires foreground location
 * permission granted; background permission enables minimized-app updates.
 */
export async function startTechLocationUpdates(): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(TECH_LOCATION_TASK).catch(() => false);
  if (already) return;

  await Location.startLocationUpdatesAsync(TECH_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: TIME_INTERVAL_MS,
    distanceInterval: DISTANCE_INTERVAL_M,
    // Keep delivering even when the device is stationary (iOS pauses by default).
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    // iOS: show the blue status bar so the OS keeps the app alive in the background.
    showsBackgroundLocationIndicator: true,
    // Android: a persistent foreground-service notification is what keeps location
    // flowing when the app is backgrounded AND after it is swiped from recents.
    foregroundService: {
      notificationTitle: 'ATSS location sharing active',
      notificationBody: 'Sharing your live location with dispatch while you are on duty.',
      notificationColor: '#7c3aed',
      killServiceOnDestroy: false,
    },
  });
}

/** Stop location updates (idempotent). Called on logout. */
export async function stopTechLocationUpdates(): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(TECH_LOCATION_TASK).catch(() => false);
  if (already) {
    await Location.stopLocationUpdatesAsync(TECH_LOCATION_TASK).catch(() => { });
  }
}

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackgroundLocationTrackingEnabled } from '../config/featureFlags';
import { technicianLocationService } from './technicianLocationService';

/**
 * Technician background-location task.
 *
 * The OS owns the schedule: `Location.startLocationUpdatesAsync` registers the task below, and
 * Android keeps it alive through a persistent foreground-service notification so positions keep
 * flowing when the app is backgrounded and even after it is swiped from recents.
 *
 * Everything here is gated on config/featureFlags, which is the kill switch for a Play Store
 * submission that cannot carry location permissions.
 */

// Cadence for the OS-driven location "cron". Kept well under the backend's
// 2-minute stale window so an active technician stays "online".
export const TECH_LOCATION_TASK = 'gowiser-tech-location-task';
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
 * Throttled failure logging for the task body.
 *
 * The task fires every ~10s, so an unthrottled log would emit six lines a minute for the whole of
 * a tunnel or a dead-zone — enough to bury anything else in the log. One line per minute still
 * proves the loop is alive and failing, which is the diagnostic that matters.
 */
const FAILURE_LOG_INTERVAL_MS = 60_000;
let lastFailureLoggedAt = 0;
const logTaskFailure = (message: string, error: unknown): void => {
  const now = Date.now();
  if (now - lastFailureLoggedAt < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureLoggedAt = now;
  console.warn(`[location] ${message} (throttled to one report per minute):`, error);
};

/**
 * Background/foreground location task. The OS delivers batched positions here
 * (even when the app is minimized). Defined at module scope so it is registered
 * whenever the app is launched, including background relaunches.
 *
 * Guarded by isTaskDefined so a Fast Refresh in development — which re-executes this module —
 * cannot register the handler a second time.
 */
if (!TaskManager.isTaskDefined(TECH_LOCATION_TASK)) {
  TaskManager.defineTask(TECH_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) {
      logTaskFailure('background location task reported an error', error);
      return;
    }
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

      // Only the newest fix of the batch is sent. The OS hands back every position it buffered
      // while the app was asleep, and posting all of them would write a burst of near-identical
      // rows for a journey the trail already reconstructs from its own heartbeat rule.
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
      // Network loss / transient error: the next OS location tick will retry, and the server
      // treats a replayed position as a no-op, so there is nothing to roll back or de-duplicate.
      logTaskFailure('failed to report technician position', e);
    }
  });
}

/**
 * Serializes concurrent start attempts.
 *
 * `hasStartedLocationUpdatesAsync` is an await, so two callers (a remount racing the first mount)
 * can both observe "not started" before either has started, and both proceed to register — which
 * on Android can surface a second foreground-service notification. Sharing the in-flight promise
 * means the second caller awaits the first rather than repeating its work.
 */
let startInFlight: Promise<void> | null = null;

/**
 * Begin continuous location updates.
 *
 * Idempotent in both directions: it returns early when the OS already has the task running, and
 * concurrent callers share one attempt. Safe to call on every mount.
 */
export async function startTechLocationUpdates(): Promise<void> {
  if (!isBackgroundLocationTrackingEnabled()) return;
  if (startInFlight) return startInFlight;

  startInFlight = (async () => {
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
        notificationTitle: 'GOWISER location sharing active',
        notificationBody: 'Sharing your live location with dispatch while you are on duty.',
        notificationColor: '#7c3aed',
        killServiceOnDestroy: false,
      },
    });
  })();

  try {
    await startInFlight;
  } finally {
    // Cleared either way: a failed attempt must not latch and block every later retry.
    startInFlight = null;
  }
}

/**
 * Stop location updates. Called on logout.
 *
 * Idempotent, and deliberately NOT gated on the feature flag: a device upgrading from a build that
 * did register the OS task carries that registration across the update, so the stop path has to
 * stay reachable to tear it down even if tracking has since been switched off in JavaScript.
 */
export async function stopTechLocationUpdates(): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(TECH_LOCATION_TASK).catch(() => false);
  if (already) {
    await Location.stopLocationUpdatesAsync(TECH_LOCATION_TASK).catch((e) => {
      console.warn('[location] failed to stop technician tracking:', e);
    });
  }
}

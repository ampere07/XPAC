/**
 * The app's single seam onto device geolocation.
 *
 * Every screen goes through this module rather than importing `expo-location` directly. That
 * indirection buys two things: there is exactly ONE file to audit to see every way the app can
 * reach a geolocation API, and exactly ONE file to change if the capability has to be withdrawn
 * again for a Play Store submission (see config/featureFlags).
 *
 * Fails closed by design. Nothing here throws: a permission request resolves to a status and
 * `getCurrentPosition()` resolves to null. A caller that forgets to check the flag — or hits a
 * denied permission, a switched-off GPS radio, or a fix that never arrives — lands in the same
 * "location unavailable" branch it already has, instead of crashing a screen.
 *
 * It is also where Google Play's prominent-disclosure requirement is met. Because every screen
 * already comes through here, the disclosure is shown from the two request functions below rather
 * than from each caller — so there is no way to reach a native location prompt without it, and no
 * screen has to remember the rule. See services/locationConsent.
 */

import * as Location from 'expo-location';
import { LOCATION_SERVICES_ENABLED } from '../config/featureFlags';
import { requireDisclosure } from './locationConsent';

export interface Coordinates {
    latitude: number;
    longitude: number;
}

/**
 * 'unavailable' is NOT the same as 'denied': it means this build has no location capability, or
 * the device's location services are switched off entirely, so re-prompting the user is pointless.
 * Callers may use the distinction to word their message; all of them must treat both as failure.
 */
export type LocationPermissionStatus = 'granted' | 'denied' | 'unavailable';

/** Whether any location call can succeed. Use this to hide GPS-only affordances. */
export const isLocationAvailable = (): boolean => LOCATION_SERVICES_ENABLED;

/**
 * Logged once per app run rather than per call: a map screen can ask on every pan, and a repeated
 * warning would bury everything else in the log without adding information.
 */
let hasWarnedDisabled = false;
const warnDisabledOnce = (caller: string): void => {
    if (hasWarnedDisabled) return;
    hasWarnedDisabled = true;
    console.info(
        `[location] disabled for this build; "${caller}" and every later location request will ` +
        'resolve as unavailable. See src/config/featureFlags.ts.'
    );
};

export interface PermissionRequestOptions {
    /**
     * Show the disclosure again to someone who declined it before. Leave it true for anything the
     * user explicitly initiated — pressing "use my current location" is a clear request, so
     * re-asking is appropriate. Pass false from automatic flows, which must not nag.
     */
    reAskIfDeclined?: boolean;
}

/**
 * Request foreground ("while using the app") location permission, showing the prominent disclosure
 * first whenever the OS is actually going to prompt.
 *
 * Safe to call repeatedly: an already-granted permission short-circuits before the disclosure, and
 * once the OS has recorded a decision it returns the stored answer without showing its dialog
 * again — so screens may still call this on every mount.
 */
export async function requestForegroundPermission(
    caller = 'requestForegroundPermission',
    options: PermissionRequestOptions = {}
): Promise<LocationPermissionStatus> {
    if (!LOCATION_SERVICES_ENABLED) {
        warnDisabledOnce(caller);
        return 'unavailable';
    }

    try {
        const current = await Location.getForegroundPermissionsAsync();

        // Already granted: the disclosure was shown before this was granted, so there is nothing
        // left to disclose and no prompt to precede.
        if (current.status === Location.PermissionStatus.GRANTED) return 'granted';

        // Permanently denied at OS level. Asking again does nothing and shows no prompt, so there
        // is no request for a disclosure to precede — and no reason to interrupt the user with one.
        if (!current.canAskAgain) return 'denied';

        const disclosed = await requireDisclosure('disclosure', options);
        if (!disclosed) return 'denied';

        // Consent given — now, and only now, ask the OS.
        const { status } = await Location.requestForegroundPermissionsAsync();
        return status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
    } catch (error) {
        // Almost always a native-manifest problem: the permission is not declared, so the OS
        // rejects the request outright. Logged rather than swallowed — silence here looks
        // identical to a user tapping "Deny", and the two need very different fixes.
        console.warn(`[location] foreground permission request failed (${caller}):`, error);
        return 'unavailable';
    }
}

/**
 * Request background ("always") location permission, explaining the OS settings screen first.
 *
 * Separate from the foreground request because Android grants the two separately and only offers
 * this one after foreground has been granted — so callers must request foreground FIRST. Only the
 * technician tracking path needs it; a denial there is not fatal, it just confines tracking to
 * while the app is open.
 *
 * Android 11+ shows no in-place prompt for this — it sends the user to a system settings page — so
 * without the lead-in stage of the disclosure most people never find "Allow all the time".
 */
export async function requestBackgroundPermission(
    caller = 'requestBackgroundPermission'
): Promise<LocationPermissionStatus> {
    if (!LOCATION_SERVICES_ENABLED) {
        warnDisabledOnce(caller);
        return 'unavailable';
    }

    try {
        const current = await Location.getBackgroundPermissionsAsync();
        if (current.status === Location.PermissionStatus.GRANTED) return 'granted';
        if (!current.canAskAgain) return 'denied';

        // Declining this stage refuses background only; the foreground grant already given stands.
        const disclosed = await requireDisclosure('background');
        if (!disclosed) return 'denied';

        const { status } = await Location.requestBackgroundPermissionsAsync();
        return status === Location.PermissionStatus.GRANTED ? 'granted' : 'denied';
    } catch (error) {
        console.warn(`[location] background permission request failed (${caller}):`, error);
        return 'unavailable';
    }
}

/**
 * Are the device's location services (the GPS radio itself) switched on?
 *
 * Distinct from permission: the app can hold a granted permission and still get nothing because
 * the user has location turned off system-wide. Worth checking separately so a screen can say
 * "turn on GPS" instead of the misleading "permission denied".
 */
export async function hasLocationServicesEnabled(): Promise<boolean> {
    if (!LOCATION_SERVICES_ENABLED) return false;

    try {
        return await Location.hasServicesEnabledAsync();
    } catch (error) {
        console.warn('[location] could not read location-services state:', error);
        // Assume ON: a failed probe must not block a fix attempt that might well succeed.
        return true;
    }
}

/**
 * Best-effort current position, or null when unavailable for ANY reason — disabled build, denied
 * permission, GPS off, or no fix. Callers must handle null; none of them may assume a fix.
 *
 * Tries the OS's last known position first. That is near-instant and usually accurate enough for
 * dropping a pin, whereas a cold `getCurrentPositionAsync` can block for seconds waiting on
 * satellites — so this is a real latency win on every screen that asks, not just a fallback.
 */
export async function getCurrentPosition(caller = 'getCurrentPosition'): Promise<Coordinates | null> {
    if (!LOCATION_SERVICES_ENABLED) {
        warnDisabledOnce(caller);
        return null;
    }

    try {
        const cached = await Location.getLastKnownPositionAsync({});
        if (cached) {
            return { latitude: cached.coords.latitude, longitude: cached.coords.longitude };
        }

        const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return fresh ? { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude } : null;
    } catch (error) {
        console.warn(`[location] could not resolve current position (${caller}):`, error);
        return null;
    }
}

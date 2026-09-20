import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The single gate every location request in the app must pass through.
 *
 * Google Play's User Data policy requires an in-app prominent disclosure immediately
 * before a location runtime permission is requested, anywhere in the app. Rather than
 * trusting each screen to remember that, no screen calls
 * Location.request*PermissionsAsync() directly any more — they call
 * ensureLocationPermission() here, which shows the disclosure first and only then asks
 * the OS.
 *
 * The disclosure itself is rendered by LocationDisclosureHost, mounted once at the root
 * of the app so it is available on every screen and for every role.
 */

/** Remembers that the user has seen the disclosure and made a choice. */
const CONSENT_KEY = 'locationDisclosureConsent';

export type LocationConsent = 'granted' | 'declined';
export type DisclosureStage = 'disclosure' | 'background';

type ShowDisclosure = (stage: DisclosureStage) => Promise<boolean>;

let showDisclosure: ShowDisclosure | null = null;

/** Called by LocationDisclosureHost on mount. */
export function registerDisclosureHost(fn: ShowDisclosure | null): void {
    showDisclosure = fn;
}

export async function getStoredConsent(): Promise<LocationConsent | null> {
    try {
        const value = await AsyncStorage.getItem(CONSENT_KEY);
        return value === 'granted' || value === 'declined' ? value : null;
    } catch {
        return null;
    }
}

async function setStoredConsent(value: LocationConsent): Promise<void> {
    try {
        await AsyncStorage.setItem(CONSENT_KEY, value);
    } catch {
        // Non-fatal: the user is simply asked again next time.
    }
}

interface EnsureOptions {
    /**
     * Also ask for background ("Allow all the time") permission. Only the technician
     * duty-tracking flow needs this; a one-off map lookup does not.
     */
    background?: boolean;
    /**
     * Show the disclosure again to someone who declined before. True for anything the
     * user explicitly initiated — pressing a locate button is a clear request, so
     * re-asking is appropriate. False for automatic flows, which must not nag.
     */
    reAskIfDeclined?: boolean;
}

/**
 * Ensures foreground location permission, showing the disclosure first when needed.
 *
 * @returns true when foreground permission is granted and location may be read.
 */
export async function ensureLocationPermission(options: EnsureOptions = {}): Promise<boolean> {
    const { background = false, reAskIfDeclined = true } = options;

    try {
        const current = await Location.getForegroundPermissionsAsync();

        // Already granted: the disclosure was shown before this was granted, so there is
        // nothing to disclose again for foreground use.
        if (current.status === 'granted') {
            if (background) await ensureBackgroundPermission();
            return true;
        }

        // Permanently denied at OS level — asking again would do nothing, and the OS
        // will not show a prompt, so there is no request to precede with a disclosure.
        if (!current.canAskAgain) return false;

        const stored = await getStoredConsent();
        if (stored === 'declined' && !reAskIfDeclined) return false;

        // No disclosure host mounted means we cannot disclose, and without a disclosure
        // we must not request. Failing closed keeps the app compliant.
        if (!showDisclosure) return false;

        const accepted = await showDisclosure('disclosure');
        if (!accepted) {
            await setStoredConsent('declined');
            return false;
        }

        await setStoredConsent('granted');

        // Consent given — now, and only now, ask the OS.
        const result = await Location.requestForegroundPermissionsAsync();
        if (result.status !== 'granted') return false;

        if (background) await ensureBackgroundPermission();
        return true;
    } catch {
        return false;
    }
}

/**
 * Requests background location, explaining the OS settings screen first.
 *
 * Android 11+ does not show an in-place prompt for this — it sends the user to a system
 * settings page — so without a lead-in most people never find "Allow all the time".
 *
 * @returns true when background permission ends up granted.
 */
export async function ensureBackgroundPermission(): Promise<boolean> {
    try {
        const current = await Location.getBackgroundPermissionsAsync();
        if (current.status === 'granted') return true;
        if (!current.canAskAgain) return false;

        if (showDisclosure) {
            const proceed = await showDisclosure('background');
            // Declining the background step is not a refusal of location altogether;
            // the foreground grant already given stays in force.
            if (!proceed) return false;
        }

        const result = await Location.requestBackgroundPermissionsAsync();
        return result.status === 'granted';
    } catch {
        return false;
    }
}

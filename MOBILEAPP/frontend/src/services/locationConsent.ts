/**
 * Consent side of the location gate: the prominent disclosure and the user's answer to it.
 *
 * Google Play's User Data policy requires an in-app prominent disclosure IMMEDIATELY BEFORE a
 * location runtime permission is requested, anywhere in the app — a privacy policy or a store
 * listing does not satisfy it. Screens are not trusted to remember that: they already go through
 * services/locationGateway for every geolocation call, and the gateway now shows this disclosure
 * before it reaches the OS. Nothing else in the app should import this module.
 *
 * Deliberately free of any `expo-location` import. The gateway owns the OS-permission state and
 * imports this module; keeping the dependency one-way avoids a require cycle between the two, and
 * leaves this file readable as "what we tell the user and what they answered" on its own.
 *
 * The disclosure UI itself is rendered by components/LocationDisclosureHost, mounted once at the
 * root of the app so it is reachable from every screen and for every role.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Remembers that the user has seen the disclosure and made a choice. */
const CONSENT_KEY = 'locationDisclosureConsent';

export type LocationConsent = 'granted' | 'declined';

/**
 * 'disclosure' is the main notice shown before the foreground prompt. 'background' is the short
 * lead-in shown before Android hands the user off to its own settings screen for "Allow all the
 * time" — without it, most people never find the option once they get there.
 */
export type DisclosureStage = 'disclosure' | 'background';

type ShowDisclosure = (stage: DisclosureStage) => Promise<boolean>;

let showDisclosure: ShowDisclosure | null = null;

/** Called by LocationDisclosureHost on mount, and with null on unmount. */
export function registerDisclosureHost(fn: ShowDisclosure | null): void {
    showDisclosure = fn;
}

export async function getStoredConsent(): Promise<LocationConsent | null> {
    try {
        const value = await AsyncStorage.getItem(CONSENT_KEY);
        return value === 'granted' || value === 'declined' ? value : null;
    } catch {
        // Storage failure is non-fatal: the user is simply asked again next time.
        return null;
    }
}

async function setStoredConsent(value: LocationConsent): Promise<void> {
    try {
        await AsyncStorage.setItem(CONSENT_KEY, value);
    } catch {
        // See above — losing the answer costs one extra prompt, nothing more.
    }
}

interface DisclosureOptions {
    /**
     * Show the disclosure again to someone who declined it before. True for anything the user
     * explicitly initiated — pressing "use my current location" is a clear request, so re-asking is
     * appropriate. False for automatic flows, which must not nag.
     */
    reAskIfDeclined?: boolean;
}

/**
 * Show the prominent disclosure and report whether the caller may now ask the OS.
 *
 * Fails closed: with no host mounted there is no way to disclose, and without a disclosure the app
 * must not request. Returning false there keeps the build compliant even if the host is ever
 * dropped from the tree by mistake.
 *
 * @returns true only when the user gave an affirmative answer and the OS prompt may follow.
 */
export async function requireDisclosure(
    stage: DisclosureStage,
    { reAskIfDeclined = true }: DisclosureOptions = {}
): Promise<boolean> {
    // The background stage is a lead-in, not the notice itself: the user has already accepted the
    // disclosure to get this far, so a previous "declined" (for foreground) does not apply and
    // there is nothing new to persist. Skipping it is a skip of background only.
    if (stage === 'background') {
        if (!showDisclosure) return false;
        return showDisclosure('background');
    }

    const stored = await getStoredConsent();
    if (stored === 'declined' && !reAskIfDeclined) return false;

    if (!showDisclosure) {
        console.warn(
            '[location] no disclosure host mounted; refusing to request permission. ' +
            'LocationDisclosureHost must be mounted at the app root.'
        );
        return false;
    }

    const accepted = await showDisclosure('disclosure');
    await setStoredConsent(accepted ? 'granted' : 'declined');
    return accepted;
}

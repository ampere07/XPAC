import { Platform } from 'react-native';
import { API_BASE_URL } from '../config/api';

/**
 * Report a client-side failure to the server so it can be read later.
 *
 * The customer dashboard fetches its balance from the phone. When that fails it
 * fails on the phone — nothing reaches the server, so nothing is logged, and the
 * only evidence is a console line on a device nobody will ever attach a debugger
 * to. The endpoint answers correctly for anyone who calls it directly, so the
 * fault cannot be reproduced from the other end either.
 *
 * This closes that gap: what the app saw goes into
 * storage/logs/customer-dashboard.log on the server.
 *
 * The web app has a counterpart at
 * ATSS2_0/frontend/src/services/clientLogService.ts. Same endpoint, same event
 * names, same one-report-per-session rule — deliberately not shared code, because
 * the two differ where the platforms do: no `credentials: 'include'` (React
 * Native's fetch has no cookie jar to include and the flag is meaningless here),
 * no `keepalive` (unsupported by RN's fetch, and there is no page unload to
 * survive), and the platform/version go into the context since there is no
 * user-agent worth reading on the server side.
 *
 * Three rules, because this runs inside a failure path and must never make
 * things worse:
 *
 *   1. It never throws. Every error is swallowed — the caller is already
 *      handling a failure and cannot be handed a second one.
 *   2. It is never awaited by anything the customer is waiting on. Fire it and
 *      carry on; a slow log must not delay a retry.
 *   3. It uses bare fetch rather than the app's apiClient. The failure being
 *      reported may well be apiClient's own — an interceptor, a dead token, a
 *      base URL that does not resolve — and a reporter routed through the thing
 *      that just broke reports nothing.
 */

/** Matches ClientLogController::ALLOWED_EVENTS. Anything else is ignored server side. */
export type ClientLogEvent =
    | 'pay-summary-failed'
    | 'pay-summary-empty'
    | 'pay-summary-recovered'
    | 'customer-detail-failed'
    | 'balance-unavailable';

/**
 * One report per event per session, so a retry loop cannot flood the log.
 *
 * Keyed on the event and account together: the same fault for two different
 * customers is two facts worth having, the same fault reported eleven times by
 * one retry loop is not.
 */
const reported = new Set<string>();

export const reportClientEvent = (
    event: ClientLogEvent,
    context: Record<string, string | number | boolean | null | undefined> = {},
): void => {
    try {
        const key = `${event}:${context.accountNo ?? ''}`;
        if (reported.has(key)) return;
        reported.add(key);

        const base = (API_BASE_URL || '').replace(/\/$/, '');
        if (!base) return;

        // Deliberately not awaited, and its rejection is swallowed: an unhandled
        // rejection here would surface as an error in a screen that is already
        // coping with one.
        void fetch(`${base}/client-log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event,
                context: {
                    ...context,
                    platform: Platform.OS,
                    platformVersion: String(Platform.Version ?? ''),
                },
            }),
        }).catch(() => { /* reporting is best effort, never load-bearing */ });
    } catch {
        /* never let logging break the thing it is logging */
    }
};

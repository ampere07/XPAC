/**
 * Report a client-side failure to the server so it can be read later.
 *
 * The customer dashboard fetches its balance from the browser. When that fails
 * it fails on the customer's device — nothing reaches the server, so nothing is
 * logged, and the only evidence is a console line on a phone belonging to
 * somebody who will never open a console. The endpoint answers correctly for
 * anyone who tries it directly, so the fault cannot be reproduced from the other
 * end either.
 *
 * This closes that gap: what the browser saw goes into
 * storage/logs/customer-dashboard.log on the server.
 *
 * Three rules, because this runs inside a failure path and must never make
 * things worse:
 *
 *   1. It never throws. Every error is swallowed — the caller is already
 *      handling a failure and cannot be handed a second one.
 *   2. It is never awaited by anything the customer is waiting on. Fire it and
 *      carry on; a slow log must not delay a retry.
 *   3. It uses bare fetch with keepalive rather than the app's apiClient. The
 *      failure being reported may well be apiClient's own — an interceptor, a
 *      dead token, a base URL that does not resolve — and a reporter routed
 *      through the thing that just broke reports nothing. keepalive also lets
 *      the request survive the page being closed.
 */

/** Matches ClientLogController::ALLOWED_EVENTS. Anything else is ignored server side. */
export type ClientLogEvent =
    | 'pay-summary-failed'
    | 'pay-summary-empty'
    | 'pay-summary-recovered'
    | 'customer-detail-failed'
    | 'balance-unavailable';

/**
 * The same base the API client uses, resolved independently so a broken
 * apiClient cannot take the reporter down with it.
 */
const apiBase = (): string => {
    const base = process.env.REACT_APP_API_BASE_URL
        || process.env.REACT_APP_API_URL
        || '';
    return base.replace(/\/$/, '');
};

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

        const url = `${apiBase()}/client-log`;
        if (!url || url === '/client-log') return;

        // Deliberately not awaited, and its rejection is swallowed: an
        // unhandled rejection here would surface as an error in a page that is
        // already coping with one.
        void fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, context }),
            keepalive: true,
            credentials: 'include',
        }).catch(() => { /* reporting is best effort, never load-bearing */ });
    } catch {
        /* never let logging break the thing it is logging */
    }
};

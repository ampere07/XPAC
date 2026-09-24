/**
 * Thin wrapper around the Meta Pixel's global `fbq`.
 *
 * The pixel script is loaded by the snippet in public/index.html. Ad blockers
 * routinely block connect.facebook.net, which leaves `window.fbq` undefined —
 * calling it unguarded would throw and abort whatever we were doing (such as
 * showing the user their submission succeeded). Tracking is best-effort only:
 * a failure here must never surface to the applicant.
 *
 * `options.eventID` is the Meta deduplication key. It is unused by the browser
 * pixel on its own, but if the backend later reports the same conversion through
 * the Conversions API under the same id, Meta counts the two as one event.
 */
export const trackPixelEvent = (
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string }
): void => {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      if (options) {
        window.fbq('track', event, params ?? {}, options);
      } else {
        window.fbq('track', event, params);
      }
    }
  } catch (error) {
    console.warn('Meta Pixel event failed:', event, error);
  }
};

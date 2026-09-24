/**
 * Thin wrapper around the Meta Pixel's global `fbq`.
 *
 * The pixel script is loaded by the snippet in public/index.html. Ad blockers
 * routinely block connect.facebook.net, which leaves `window.fbq` undefined —
 * calling it unguarded would throw and abort whatever we were doing (such as
 * signing the user in). Tracking is best-effort only: a failure here must never
 * surface to the user or interrupt the flow it is attached to.
 */
const send = (
  kind: 'track',
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string }
): void => {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      if (options) {
        window.fbq(kind, event, params ?? {}, options);
      } else {
        window.fbq(kind, event, params);
      }
    }
  } catch (error) {
    console.warn('Meta Pixel event failed:', event, error);
  }
};

/** Report a pixel event via fbq('track', ...). */
export const trackPixelEvent = (
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string }
): void => send('track', event, params, options);

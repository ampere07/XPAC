/// <reference types="react-scripts" />

declare module 'html2pdf.js';

/*
 * The Meta Pixel installs `fbq` on window from the snippet in public/index.html.
 * It is absent whenever an ad blocker drops connect.facebook.net, so every call
 * site must guard on it — see utils/metaPixel.ts.
 */
interface Window {
  fbq?: (...args: any[]) => void;
}

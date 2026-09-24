declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module 'leaflet/dist/leaflet.css';

/*
 * The Meta Pixel installs `fbq` on window from the snippet in public/index.html.
 * It is absent whenever an ad blocker drops connect.facebook.net, so every call
 * site must guard on it — see trackPixelEvent in utils/metaPixel.ts.
 */
interface Window {
  fbq?: (...args: any[]) => void;
}

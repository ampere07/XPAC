/**
 * Build-time feature switches.
 *
 * ── Location services: ON ─────────────────────────────────────────────────────────────────────
 * Technician GPS reporting and the "use my current location" affordances are live. The switches
 * below stay in place as a deliberate kill switch: Google Play requires a Location Permissions
 * declaration, and a separate Foreground Service (location) declaration, for any build whose
 * manifest carries ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION / ACCESS_BACKGROUND_LOCATION or a
 * `location` foreground-service type. If a submission is ever rejected on those grounds, this file
 * is how the capability comes back out without unpicking call sites.
 *
 * Play also requires an in-app prominent disclosure immediately before each location permission
 * request. That is not a flag — it is enforced in services/locationGateway, which shows
 * modals/LocationDisclosureModal before it reaches any native prompt.
 *
 * These flags govern the JAVASCRIPT only. The permissions are in the manifest because
 * `expo-location` (whose own AndroidManifest declares both location permissions and a
 * `foregroundServiceType="location"` service) is installed and configured through the app.json
 * plugin list. Flipping a flag to false stops every runtime call but does NOT clean the manifest.
 *
 * ── Disabling again (all five steps, in order) ────────────────────────────────────────────────
 *   1. Flip the flags below to false. The app stops reading position immediately; nothing crashes,
 *      because the gateway fails closed (see services/locationGateway).
 *   2. Remove the `expo-location` plugin block from app.json.
 *   3. Move the five location / foreground-service permissions in app.json out of `permissions`
 *      and into `blockedPermissions`.
 *   4. `npm uninstall expo-location expo-task-manager` — required, not optional: an installed
 *      Expo module is autolinked and its manifest merged even if no JavaScript imports it.
 *   5. `npx expo prebuild --clean -p android`, rebuild, and confirm the generated
 *      android/app/src/main/AndroidManifest.xml carries no ACCESS_*_LOCATION and no
 *      foregroundServiceType="location".
 */

/** Reading the device's position at all: "Get My Location" buttons, map self-centring. */
export const LOCATION_SERVICES_ENABLED = true;

/**
 * Continuous technician GPS reporting through the OS background location task and its Android
 * foreground service. Strictly narrower than LOCATION_SERVICES_ENABLED — background tracking can
 * never run while location services as a whole are off, which is what the helper below enforces.
 */
export const BACKGROUND_LOCATION_TRACKING_ENABLED = true;

/** True only when background tracking is permitted AND location services are available at all. */
export const isBackgroundLocationTrackingEnabled = (): boolean =>
    LOCATION_SERVICES_ENABLED && BACKGROUND_LOCATION_TRACKING_ENABLED;

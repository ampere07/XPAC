<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Technician Location Tracking
    |--------------------------------------------------------------------------
    |
    | Master switch for GPS ingest, enabled to match the mobile build that reports
    | positions (see MOBILEAPP/frontend/src/config/featureFlags.ts). Both halves have
    | to agree: the app only posts when its own flags are on, and the server only
    | accepts when this one is.
    |
    | Kept as a switch rather than deleted so ingest can be stopped from the server
    | alone — during an incident, or for a Play Store build that must ship without
    | location permissions — without waiting on an app release. Setting
    | LOCATION_TRACKING_ENABLED=false in .env takes effect on the next config cache
    | rebuild and means a stale APK still in the field cannot keep writing GPS rows.
    |
    | Only the WRITE path is gated either way. The admin monitoring map's read
    | endpoints (/technician-locations and the trail endpoint) stay available so
    | existing history remains viewable, and cron:mark-stale-locations keeps running
    | so positions age out to "stale" on their own rather than sitting on the map
    | looking live forever.
    |
    */

    'location_tracking' => [
        'enabled' => env('LOCATION_TRACKING_ENABLED', true),
    ],
];

<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => [
        'https://apply.atssfiber.ph',
        'https://backend1.atssfiber.ph',
    ],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    /*
    | How long a browser may reuse a preflight result.
    |
    | At 0 every cross-origin POST/PATCH paid for a second round trip to
    | backend1.atssfiber.ph before the real request could start. On a phone
    | inside an in-app browser that is the difference between a form that
    | submits and one that appears to hang. A day is what the SPA backend
    | already uses.
    */
    'max_age' => 86400,

    'supports_credentials' => true,

];

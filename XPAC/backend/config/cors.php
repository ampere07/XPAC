<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    */

    'paths' => [
        'api/*',
        'sanctum/csrf-cookie',
    ],

    'allowed_methods' => ['*'],

    'allowed_origins' => [
        'https://sync.atssfiber.ph',
        'https://backend.atssfiber.ph',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*', 'X-Skip-Auth-Error'],

    'exposed_headers' => [],

    'max_age' => 86400,

    'supports_credentials' => true,
];


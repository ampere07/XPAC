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
        'https://sync.gowiser.ph',
        'https://backend.gowiser.ph',
    ],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*', 'X-Skip-Auth-Error'],

    'exposed_headers' => [],

    'max_age' => 86400,

    'supports_credentials' => true,
];


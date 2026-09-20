<?php

return [
    'google' => [
        'folder_id' => env('GOOGLE_DRIVE_FOLDER_ID'),
        'client_id' => env('GOOGLE_DRIVE_CLIENT_ID'),
        'client_email' => env('GOOGLE_DRIVE_CLIENT_EMAIL'),
        'private_key_id' => env('GOOGLE_DRIVE_PRIVATE_KEY_ID'),
        'private_key' => str_replace('\\n', "\n", env('GOOGLE_DRIVE_PRIVATE_KEY')),
        'project_id' => env('GOOGLE_DRIVE_PROJECT_ID'),
    ],
];

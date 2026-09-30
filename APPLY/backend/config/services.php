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

    // Read by ResendEmailService. Needed for mail sent directly from this app (the
    // email verification code); queued application emails are sent the same way.
    'resend' => [
        'api_key' => env('RESEND_API_KEY'),
    ],
];

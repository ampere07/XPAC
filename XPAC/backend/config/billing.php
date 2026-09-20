<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Billing Configuration
    |--------------------------------------------------------------------------
    |
    | This file contains all billing-related configuration settings including
    | generation schedules, due date calculations, and notification settings.
    |
    */

    'advance_generation_days' => env('BILLING_ADVANCE_GENERATION_DAYS', 7),
    
    'due_days_add' => env('BILLING_DUE_DAYS_ADD', 7),
    
    'overdue_offset' => env('BILLING_OVERDUE_OFFSET', 1),
    
    'dc_notice_offset' => env('BILLING_DC_NOTICE_OFFSET', 3),
    
    'dc_actual_offset' => env('BILLING_DC_ACTUAL_OFFSET', 4),
    
    /*
    |--------------------------------------------------------------------------
    | Notification Settings
    |--------------------------------------------------------------------------
    */

    'notifications' => [
        'auto_send_email' => env('BILLING_AUTO_SEND_EMAIL', true),
        'auto_send_sms' => env('BILLING_AUTO_SEND_SMS', true),
        'include_pdf_attachment' => env('BILLING_INCLUDE_PDF', true),
    ],

    /*
    |--------------------------------------------------------------------------
    | PDF Settings
    |--------------------------------------------------------------------------
    */

    'pdf' => [
        'storage_path' => 'billing',
        'organize_by_date' => true,
        'date_format' => 'Y/m/d',
    ],

    /*
    |--------------------------------------------------------------------------
    | Template Codes
    |--------------------------------------------------------------------------
    */

    'templates' => [
        'soa_pdf' => 'SOA_DESIGN',
        'soa_email' => 'SOA_TEMPLATE',
        'invoice_pdf' => 'INVOICE_DESIGN',
        'invoice_email' => 'SOA_TEMPLATE',
        'overdue_pdf' => 'OVERDUE_DESIGN',
        'overdue_email' => 'OVERDUE_DESIGN',
        'dc_notice_pdf' => 'DCNOTICE_DESIGN',
        'dc_notice_email' => 'DCNOTICE_DESIGN',
    ],

    /*
    |--------------------------------------------------------------------------
    | Scheduled Jobs
    |--------------------------------------------------------------------------
    */

    'schedule' => [
        'daily_generation' => '02:00', // 2 AM
        'overdue_notices' => '08:00', // 8 AM
        'dc_notices' => '09:00', // 9 AM
        'email_queue_process' => '*/5', // Every 5 minutes
    ],
];

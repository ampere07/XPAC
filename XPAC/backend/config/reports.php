<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Brand printed on report documents
    |--------------------------------------------------------------------------
    |
    | Kept separate from APP_NAME on purpose — APP_NAME is the Laravel instance
    | name and is not safe to print on documents that go out to recipients.
    |
    */
    'brand' => env('REPORTS_BRAND', 'ATSS FIBER'),

    /*
    |--------------------------------------------------------------------------
    | PDF detail-listing row cap
    |--------------------------------------------------------------------------
    |
    | dompdf builds an in-memory cell map for every table it renders, so a very
    | large detail table exhausts PHP's memory long before it produces a usable
    | document (a 21k-row transaction table is also ~600 printed pages).
    |
    | Counts, subtotals and grand totals are always computed in SQL across the
    | COMPLETE result set and are therefore unaffected by this cap. When the cap
    | bites, the PDF states how many records it matched, how many it printed,
    | and points the reader at the CSV export for the full row-level listing.
    |
    */
    'pdf_row_limit' => (int) env('REPORTS_PDF_ROW_LIMIT', 350),

    /*
    |--------------------------------------------------------------------------
    | Memory ceiling while rendering
    |--------------------------------------------------------------------------
    |
    | Raised for the duration of a render and restored afterwards, so a report
    | does not die on a php.ini default of 128M.
    |
    */
    'pdf_memory_limit' => env('REPORTS_PDF_MEMORY_LIMIT', '768M'),

    /*
    |--------------------------------------------------------------------------
    | Scheduled dispatch
    |--------------------------------------------------------------------------
    |
    | catch_up_minutes  How late a scheduled run may still fire. The queueing
    |                   command runs every minute, but a missed tick (deploy,
    |                   overlapping run, host hiccup) must not silently skip a
    |                   report for a whole day/month/year. Combined with the
    |                   report_dispatches ledger this gives at-least-once
    |                   delivery without duplicates.
    |
    | attachment_ttl_hours  How long a generated attachment is kept before the
    |                       cleanup sweep removes it.
    |
    */
    'catch_up_minutes'     => (int) env('REPORTS_CATCH_UP_MINUTES', 30),
    'attachment_ttl_hours' => (int) env('REPORTS_ATTACHMENT_TTL_HOURS', 48),

    /*
    |--------------------------------------------------------------------------
    | Email
    |--------------------------------------------------------------------------
    */
    'mail' => [
        'from'      => env('REPORTS_MAIL_FROM', 'billing@atssfiber.ph'),
        'reply_to'  => env('REPORTS_MAIL_REPLY_TO', 'billing@atssfiber.ph'),
        'from_name' => env('REPORTS_MAIL_FROM_NAME', 'ATSS Fiber Reports'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Timezone all report schedules are interpreted in
    |--------------------------------------------------------------------------
    */
    'timezone' => env('REPORTS_TIMEZONE', 'Asia/Manila'),

    /*
    |--------------------------------------------------------------------------
    | Collation used to normalise UNION-based reports
    |--------------------------------------------------------------------------
    |
    | Combined Transactions unions `transactions` (utf8mb4_unicode_ci) with
    | `payment_portal_logs` (utf8mb4_general_ci). MariaDB/MySQL reject a UNION
    | whose branches carry different collations ("Illegal mix of collations"), so
    | every string column in the union is explicitly converted to this one.
    |
    | Must be a collation of the utf8mb4 character set that exists on the server.
    |
    */
    'union_collation' => env('REPORTS_UNION_COLLATION', 'utf8mb4_general_ci'),

];

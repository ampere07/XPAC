<?php

/*
 * The fixed lines printed on a paid invoice PDF (App\Services\PaidInvoicePdfService).
 * Defaults are the ones on the current invoice layout; override them in .env.
 */
return [
    'confirmation_email' => env('INVOICE_PDF_CONFIRMATION_EMAIL', 'cb@xpacsconnect.ph'),
    'confirmation_contact' => env('INVOICE_PDF_CONFIRMATION_CONTACT', '9338138918'),

    // Google Drive folder the PDFs go in, one sub-folder per account.
    'drive_folder' => env('INVOICE_PDF_DRIVE_FOLDER', 'Invoices'),
];

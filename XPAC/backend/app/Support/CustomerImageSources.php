<?php

namespace App\Support;

/**
 * Every place an image belonging to a customer is stored, for the Customer Images page
 * (App\Services\CustomerImageService).
 *
 * One entry per table. To add a source, add an entry here — nothing else changes:
 *
 *   'key'      unique id, used by the page's source filter
 *   'label'    what the page shows on each image ("Service Order")
 *   'table'    the table the URLs live in
 *   'id'       its primary key (the "related record" shown with each image)
 *   'date'     columns tried, in order, for the image's date
 *   'link'     how a row reaches the customer's billing account:
 *                ['type' => 'account_no', 'column' => 'account_no']  ba.account_no = t.column
 *                ['type' => 'account_id', 'column' => 'account_id']  ba.id = t.column
 *                ['type' => 'customer']                              ba.customer_id = t.id
 *                ['type' => 'job_order', 'column' => 'id']           job_orders.application_id = t.column, ba.id = job_orders.account_id
 *                ['type' => 'lcpnap', 'column' => 'lcpnap_name']     technical_details.lcpnap = t.column, ba.id = technical_details.account_id
 *   'columns'  URL column => label of the image it holds
 *   'type_column' (optional) a column whose value names the image instead of the column label
 *
 * Columns that do not exist on a database are skipped, so an entry may name a column a given
 * deployment has not migrated yet. `php artisan customer-images:scan` lists image-like columns
 * in the database that no entry covers.
 */
final class CustomerImageSources
{
    public const SOURCES = [
        [
            'key' => 'customer',
            'label' => 'Customer Profile',
            'table' => 'customers',
            'id' => 'id',
            'date' => ['updated_at', 'created_at'],
            'link' => ['type' => 'customer'],
            'columns' => [
                'house_front_picture_url' => 'House Front',
                'government_valid_id_url' => 'Government ID',
                'second_government_valid_id_url' => 'Second Government ID',
                'proof_of_billing_url' => 'Proof of Billing',
                'other_isp_bill_url' => 'Other ISP Bill',
                'document_attachment_url' => 'Document Attachment',
            ],
        ],
        [
            'key' => 'application',
            'label' => 'Application',
            'table' => 'applications',
            'id' => 'id',
            'date' => ['created_at', 'timestamp'],
            'link' => ['type' => 'job_order', 'column' => 'id'],
            'columns' => [
                'house_front_picture_url' => 'House Front',
                'government_valid_id_url' => 'Government ID',
                'second_government_valid_id_url' => 'Second Government ID',
                'proof_of_billing_url' => 'Proof of Billing',
                'other_isp_bill_url' => 'Other ISP Bill',
                'document_attachment_url' => 'Document Attachment',
                'nearest_landmark1_url' => 'Nearest Landmark 1',
                'nearest_landmark2_url' => 'Nearest Landmark 2',
                'promo_url' => 'Promo',
            ],
        ],
        [
            'key' => 'application_visit',
            'label' => 'Application Visit',
            'table' => 'application_visits',
            'id' => 'id',
            'date' => ['timestamp', 'created_at'],
            'link' => ['type' => 'job_order', 'column' => 'application_id'],
            'columns' => [
                'house_front_picture_url' => 'House Front',
                'image1_url' => 'Image 1',
                'image2_url' => 'Image 2',
                'image3_url' => 'Image 3',
            ],
        ],
        [
            'key' => 'job_order',
            'label' => 'Job Order',
            'table' => 'job_orders',
            'id' => 'id',
            'date' => ['date_installed', 'timestamp', 'created_at'],
            'link' => ['type' => 'account_id', 'column' => 'account_id'],
            'columns' => [
                'setup_image_url' => 'Setup',
                'speedtest_image_url' => 'Speed Test',
                'box_reading_image_url' => 'Box Reading',
                'router_reading_image_url' => 'Router Reading',
                'port_label_image_url' => 'Port Label',
                'house_front_picture_url' => 'House Front',
                'client_tagging_url' => 'Client Tagging',
                'proof_image_url' => 'Proof',
                'signed_contract_image_url' => 'Signed Contract',
                'client_signature_url' => 'Client Signature',
                'other_photos_url' => 'Other Photos',
            ],
        ],
        [
            'key' => 'service_order',
            'label' => 'Service Order',
            'table' => 'service_orders',
            'id' => 'id',
            'date' => ['timestamp', 'created_at'],
            'link' => ['type' => 'account_no', 'column' => 'account_no'],
            'columns' => [
                'image1_url' => 'Image 1',
                'image2_url' => 'Image 2',
                'image3_url' => 'Image 3',
                'image4' => 'Image 4',
                'setup_image_url' => 'Setup',
                'speedtest_image_url' => 'Speed Test',
                'box_reading_image_url' => 'Box Reading',
                'router_reading_image_url' => 'Router Reading',
                'proof_image_url' => 'Proof',
                'client_signature_url' => 'Client Signature',
            ],
        ],
        [
            'key' => 'payment',
            'label' => 'Proof of Payment',
            'table' => 'transactions',
            'id' => 'id',
            'date' => ['payment_date', 'created_at'],
            'link' => ['type' => 'account_no', 'column' => 'account_no'],
            'columns' => [
                'image_url' => 'Payment Proof',
                'proof_payment_url' => 'Payment Proof',
            ],
        ],
        [
            'key' => 'attachment',
            'label' => 'Customer Attachment',
            'table' => 'attachments',
            'id' => 'id',
            'date' => ['created_at'],
            'link' => ['type' => 'account_id', 'column' => 'account_id'],
            'columns' => [
                'file_url' => 'Attachment',
            ],
            'type_column' => 'attachment_type',
        ],
        [
            'key' => 'lcpnap',
            'label' => 'LCP/NAP',
            'table' => 'lcpnap',
            'id' => 'id',
            'date' => ['modified_date', 'created_at'],
            'link' => ['type' => 'lcpnap', 'column' => 'lcpnap_name'],
            'columns' => [
                'image1_url' => 'LCP/NAP Image 1',
                'image2_url' => 'LCP/NAP Image 2',
                'reading_image_url' => 'LCP/NAP Reading',
            ],
        ],
    ];

    /** Column-name pattern the scan command treats as "probably an image". */
    public const IMAGE_COLUMN_PATTERN = '/(image|img|photo|picture|signature|proof|attachment|screenshot|selfie|valid_id|_url$)/i';
}

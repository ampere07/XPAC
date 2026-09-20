<?php

namespace App\Services;

use Dompdf\Dompdf;
use Dompdf\Options;
use App\Models\EmailTemplate;
use App\Models\BillingAccount;
use App\Models\Invoice;
use App\Models\StatementOfAccount;
use Illuminate\Support\Facades\Log;

class GoogleDrivePdfGenerationService
{
    protected Dompdf $dompdf;
    protected Options $options;
    protected GoogleDriveService $googleDriveService;

    public function __construct(GoogleDriveService $googleDriveService)
    {
        $this->googleDriveService = $googleDriveService;

        $this->options = new Options();
        $this->options->set('isHtml5ParserEnabled', true);
        $this->options->set('isRemoteEnabled', true);
        $this->options->set('defaultFont', 'Helvetica');
        $this->options->set('dpi', 96);

        $this->dompdf = new Dompdf($this->options);
    }

    public function generateBillingPdf(
        BillingAccount $account,
        ?Invoice $invoice = null,
        ?StatementOfAccount $soa = null
    ): array {
        try {
            $documentType = $invoice ? 'INVOICE' : 'SOA';
            $templateCode = $documentType . '_TEMPLATE';

            $pdfData = $this->preparePdfData($account, $invoice, $soa);

            Log::info('GoogleDrive PDF data prepared', [
                'document_type' => $documentType,
                'account_no' => $account->account_no,
                'soa_id' => $soa?->id,
                'soa_is_null' => $soa === null,
                'data_keys' => array_keys($pdfData),
                'has_Due_Date' => isset($pdfData['Due_Date']),
                'Due_Date_value' => $pdfData['Due_Date'] ?? 'NOT SET',
                'has_Prev_Balance' => isset($pdfData['Prev_Balance']),
                'Prev_Balance_value' => $pdfData['Prev_Balance'] ?? 'NOT SET',
                'has_Amount_Discounts' => isset($pdfData['Amount_Discounts']),
                'Amount_Discounts_value' => $pdfData['Amount_Discounts'] ?? 'NOT SET',
                'Amount_Rebates_value' => $pdfData['Amount_Rebates'] ?? 'NOT SET',
            ]);

            $template = EmailTemplate::where('Template_Code', $templateCode)
                ->where('Is_Active', true)
                ->first();

            if (!$template) {
                throw new \Exception("PDF template {$templateCode} not found");
            }

            // Check what placeholders exist in the template
            preg_match_all('/\{\{([^}]+)\}\}/', $template->Body_HTML, $matches);
            Log::info('Template placeholders found', [
                'template_code' => $templateCode,
                'placeholders' => $matches[1] ?? [],
            ]);

            $html = $this->replacePlaceholders($template->Body_HTML, $pdfData);

            // Check if any unreplaced placeholders remain
            preg_match_all('/\{\{([^}]+)\}\}/', $html, $remainingMatches);
            if (!empty($remainingMatches[1])) {
                Log::warning('Unreplaced placeholders remain in template', [
                    'unreplaced' => $remainingMatches[1],
                ]);
            }

            $html = $this->addStrictCss() . $html;

            $this->dompdf->loadHtml($html);
            $this->dompdf->setPaper('A4', 'portrait');
            $this->dompdf->render();

            $pdfContent = $this->dompdf->output();

            $tempPath = sys_get_temp_dir() . '/' . uniqid('pdf_') . '.pdf';
            file_put_contents($tempPath, $pdfContent);

            $soaFolderId = $this->ensureSOAFolderExists();
            $accountFolderId = $this->ensureAccountFolderExists($soaFolderId, $account->account_no);

            $documentId = $invoice?->id ?? $soa?->id ?? uniqid();
            $filename = "{$documentType}-{$account->account_no}-{$documentId}.pdf";

            $googleDriveUrl = $this->googleDriveService->uploadFile(
                $tempPath,
                $accountFolderId,
                $filename,
                'application/pdf'
            );

            unlink($tempPath);

            Log::info('PDF generated and uploaded to Google Drive', [
                'document_type' => $documentType,
                'account_no' => $account->account_no,
                'google_drive_url' => $googleDriveUrl,
                'folder_id' => $accountFolderId
            ]);

            return [
                'success' => true,
                'url' => $googleDriveUrl,
                'folder_id' => $accountFolderId,
                'filename' => $filename,
                'account_no' => $account->account_no
            ];

        } catch (\Exception $e) {
            Log::error('PDF generation and upload failed', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    public function generateOverduePdf(Invoice $invoice): array
    {
        try {
            $account = $invoice->billingAccount;

            $pdfData = $this->prepareOverduePdfData($account, $invoice);

            $template = EmailTemplate::where('Template_Code', 'OVERDUE_DESIGN')
                ->where('Is_Active', true)
                ->first();

            if (!$template) {
                throw new \Exception("Overdue template not found");
            }

            $html = $this->replacePlaceholders($template->Body_HTML, $pdfData);
            $html = $this->addStrictCss() . $html;

            $this->dompdf->loadHtml($html);
            $this->dompdf->setPaper('A4', 'portrait');
            $this->dompdf->render();

            $pdfContent = $this->dompdf->output();

            $tempPath = sys_get_temp_dir() . '/' . uniqid('overdue_') . '.pdf';
            file_put_contents($tempPath, $pdfContent);

            $overdueFolderId = $this->ensureOverdueFolderExists();
            $accountFolderId = $this->ensureAccountFolderExists($overdueFolderId, $account->account_no);

            $filename = "OVERDUE-{$account->account_no}-{$invoice->id}.pdf";

            $googleDriveUrl = $this->googleDriveService->uploadFile(
                $tempPath,
                $accountFolderId,
                $filename,
                'application/pdf'
            );

            unlink($tempPath);

            return [
                'success' => true,
                'url' => $googleDriveUrl,
                'folder_id' => $accountFolderId,
                'filename' => $filename
            ];

        } catch (\Exception $e) {
            Log::error('Overdue PDF generation failed', [
                'invoice_id' => $invoice->id,
                'error' => $e->getMessage()
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    public function generateDcNoticePdf(Invoice $invoice): array
    {
        try {
            $account = $invoice->billingAccount;

            $pdfData = $this->prepareDcNoticePdfData($account, $invoice);

            $template = EmailTemplate::where('Template_Code', 'DCNOTICE_DESIGN')
                ->where('Is_Active', true)
                ->first();

            if (!$template) {
                throw new \Exception("DC Notice template not found");
            }

            $html = $this->replacePlaceholders($template->Body_HTML, $pdfData);
            $html = $this->addStrictCss() . $html;

            $this->dompdf->loadHtml($html);
            $this->dompdf->setPaper('A4', 'portrait');
            $this->dompdf->render();

            $pdfContent = $this->dompdf->output();

            $tempPath = sys_get_temp_dir() . '/' . uniqid('dcnotice_') . '.pdf';
            file_put_contents($tempPath, $pdfContent);

            $dcNoticeFolderId = $this->ensureDcNoticeFolderExists();
            $accountFolderId = $this->ensureAccountFolderExists($dcNoticeFolderId, $account->account_no);

            $filename = "DCNOTICE-{$account->account_no}-{$invoice->id}.pdf";

            $googleDriveUrl = $this->googleDriveService->uploadFile(
                $tempPath,
                $accountFolderId,
                $filename,
                'application/pdf'
            );

            unlink($tempPath);

            return [
                'success' => true,
                'url' => $googleDriveUrl,
                'folder_id' => $accountFolderId,
                'filename' => $filename
            ];

        } catch (\Exception $e) {
            Log::error('DC Notice PDF generation failed', [
                'invoice_id' => $invoice->id,
                'error' => $e->getMessage()
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    protected function ensureSOAFolderExists(): string
    {
        $soaFolderId = $this->googleDriveService->findFolder('Statement of Account');

        if (!$soaFolderId) {
            $soaFolderId = $this->googleDriveService->createFolder('Statement of Account');
            Log::info('Created Statement of Account folder in Google Drive', [
                'folder_id' => $soaFolderId
            ]);
        }

        return $soaFolderId;
    }

    protected function ensureOverdueFolderExists(): string
    {
        $overdueFolderId = $this->googleDriveService->findFolder('Overdue Notices');

        if (!$overdueFolderId) {
            $overdueFolderId = $this->googleDriveService->createFolder('Overdue Notices');
            Log::info('Created Overdue Notices folder in Google Drive', [
                'folder_id' => $overdueFolderId
            ]);
        }

        return $overdueFolderId;
    }

    protected function ensureDcNoticeFolderExists(): string
    {
        $dcNoticeFolderId = $this->googleDriveService->findFolder('DC Notices');

        if (!$dcNoticeFolderId) {
            $dcNoticeFolderId = $this->googleDriveService->createFolder('DC Notices');
            Log::info('Created DC Notices folder in Google Drive', [
                'folder_id' => $dcNoticeFolderId
            ]);
        }

        return $dcNoticeFolderId;
    }

    protected function ensureAccountFolderExists(string $parentFolderId, string $accountNo): string
    {
        $accountFolderId = $this->googleDriveService->findFolder($accountNo, $parentFolderId);

        if (!$accountFolderId) {
            $accountFolderId = $this->googleDriveService->createFolder($accountNo, $parentFolderId);
            Log::info('Created account folder in Google Drive', [
                'account_no' => $accountNo,
                'folder_id' => $accountFolderId,
                'parent_folder_id' => $parentFolderId
            ]);
        }

        return $accountFolderId;
    }

    public function getPdfFromGoogleDrive(string $accountNo, string $filename): ?array
    {
        try {
            $soaFolderId = $this->ensureSOAFolderExists();
            $accountFolderId = $this->googleDriveService->findFolder($accountNo, $soaFolderId);

            if (!$accountFolderId) {
                Log::warning('Account folder not found in Google Drive', [
                    'account_no' => $accountNo
                ]);
                return null;
            }

            $files = $this->googleDriveService->listFilesInFolder($accountFolderId);

            foreach ($files as $file) {
                if ($file->name === $filename) {
                    $fileId = $file->id;
                    $fileUrl = 'https://drive.google.com/file/d/' . $fileId . '/view';

                    Log::info('Found PDF in Google Drive', [
                        'account_no' => $accountNo,
                        'filename' => $filename,
                        'file_id' => $fileId
                    ]);

                    return [
                        'file_id' => $fileId,
                        'url' => $fileUrl,
                        'filename' => $filename
                    ];
                }
            }

            Log::warning('PDF file not found in Google Drive', [
                'account_no' => $accountNo,
                'filename' => $filename
            ]);

            return null;

        } catch (\Exception $e) {
            Log::error('Failed to retrieve PDF from Google Drive', [
                'account_no' => $accountNo,
                'filename' => $filename,
                'error' => $e->getMessage()
            ]);

            return null;
        }
    }

    public function downloadPdfFromGoogleDrive(string $fileId): ?string
    {
        try {
            $response = $this->googleDriveService->getService()->files->get($fileId, [
                'alt' => 'media',
                'supportsAllDrives' => true
            ]);

            $content = $response->getBody()->getContents();

            $tempPath = sys_get_temp_dir() . '/' . uniqid('download_') . '.pdf';
            file_put_contents($tempPath, $content);

            Log::info('Downloaded PDF from Google Drive', [
                'file_id' => $fileId,
                'temp_path' => $tempPath
            ]);

            return $tempPath;

        } catch (\Exception $e) {
            Log::error('Failed to download PDF from Google Drive', [
                'file_id' => $fileId,
                'error' => $e->getMessage()
            ]);

            return null;
        }
    }

    protected function preparePdfData(
        BillingAccount $account,
        ?Invoice $invoice,
        ?StatementOfAccount $soa
    ): array {
        $customer = $account->customer;
        $technicalDetail = $account->technicalDetails->first();

        $fullAddress = implode(', ', array_filter([
            $customer->address,
            $customer->location,
            $customer->barangay,
            $customer->city,
            $customer->region
        ]));

        $data = [
            'Full_Name' => $customer->full_name,
            'Address' => $fullAddress,
            'Street' => $customer->address,
            'Barangay' => $customer->barangay,
            'City' => $customer->city,
            'Province' => $customer->region,
            'Contact_No' => $customer->contact_number_primary,
            'Email' => $customer->email_address,
            'Account_No' => $account->account_no,
            'Plan' => $customer->desired_plan,
            'Statement_Date' => now()->format('F d, Y'),
            'Payment_Link' => config('app.payment_link', 'https://pay.example.com')
        ];

        if ($soa) {
            $dueDate = $soa->due_date ? \Carbon\Carbon::parse($soa->due_date) : null;
            $billingConfig = \App\Models\BillingConfig::first();
            $disconnectionDay = $billingConfig ? $billingConfig->disconnection_day : 0;
            $dcDate = $dueDate ? $dueDate->copy()->addDays($disconnectionDay) : null;

            // Period_End = current SOA's due date
            $periodEnd = $dueDate;

            // Period_Start = previous SOA's due date (or date_installed if first SOA)
            $previousSoa = StatementOfAccount::where('account_no', $account->account_no)
                ->where('id', '<', $soa->id)
                ->orderBy('id', 'desc')
                ->first();

            if ($previousSoa) {
                $periodStart = $previousSoa->due_date
                    ? \Carbon\Carbon::parse($previousSoa->due_date)
                    : null;
            } else {
                // If this is the only/first SOA, use the customer's installation date
                $periodStart = $account->date_installed
                    ? \Carbon\Carbon::parse($account->date_installed)
                    : null;
            }

            // If a reconnection pro-rate was applied, the coverage period begins on the
            // reconnection date (the first actually-billed day), not the previous SOA date.
            if (!empty($soa->pro_rate_start) && (float)($soa->pro_rate ?? 0) > 0) {
                $periodStart = \Carbon\Carbon::parse($soa->pro_rate_start);
            }

            $data = array_merge($data, [
                'Statement_Date' => $soa->statement_date ? \Carbon\Carbon::parse($soa->statement_date)->format('F d, Y') : '-',
                'SOA_No' => $soa->id,
                'Prev_Balance' => number_format((float)($soa->balance_from_previous_bill ?? 0), 2),
                'Prev_Payment' => number_format((float)($soa->payment_received_previous ?? 0), 2),
                'Rem_Balance' => number_format((float)($soa->remaining_balance_previous ?? 0), 2),
                'Monthly_Fee' => number_format((float)($soa->monthly_service_fee ?? 0), 2),
                'VAT' => number_format((float)($soa->vat ?? 0), 2),
                'Amount_Due' => number_format((float)($soa->amount_due ?? 0), 2),
                'Total_Due' => number_format((float)($soa->total_amount_due ?? 0), 2),
                'Due_Date' => $dueDate ? $dueDate->format('F d, Y') : '-',
                'Period_Start' => $periodStart ? $periodStart->format('m/d/Y') : '-',
                'Period_End' => $periodEnd ? $periodEnd->format('m/d/Y') : '-',
                'DC_Date' => $dcDate ? $dcDate->format('F d, Y') : '-',
                // Others and Basic Charges - Individual amounts (show only if > 0)
                'Amount_Discounts' => $soa->discounts > 0 ? number_format($soa->discounts, 2) : '',
                'Amount_Rebates' => $soa->rebate > 0 ? number_format($soa->rebate, 2) : '',
                'Amount_Service' => $soa->service_charge > 0 ? number_format($soa->service_charge, 2) : '',
                'Amount_Install' => $soa->staggered > 0 ? number_format($soa->staggered, 2) : '',
                // Others and Basic Charges - Labels (show only if amount > 0)
                'Label_Discounts' => $soa->discounts > 0 ? 'Discounts' : '',
                'Label_Rebates' => $soa->rebate > 0 ? 'Rebates' : '',
                'Label_Service' => $soa->service_charge > 0 ? 'Service Charge' : '',
                'Label_Staggered' => $soa->staggered > 0 ? 'Installment' : '',
                'Label_Install' => $soa->staggered > 0 ? 'Installment' : '', // Alias for backward compatibility
            ]);

            // Calculate Adjustment (total of service_charge + rebate + discounts + staggered)
            $adjustmentTotal = (float)($soa->service_charge ?? 0)
                + (float)($soa->rebate ?? 0)
                + (float)($soa->discounts ?? 0)
                + (float)($soa->staggered ?? 0);

            $data['Adjustment_Label'] = $adjustmentTotal > 0 ? 'Other and Basic Charges' : '';
            $data['Adjustment_Value'] = $adjustmentTotal > 0 ? number_format($adjustmentTotal, 2) : '';

            // Row templates for dynamic content (backward compatibility)
            $data['Row_Discounts'] = $soa->discounts > 0
                ? "<tr><td>- Discounts</td><td align='right'>" . number_format($soa->discounts, 2) . "</td></tr>"
                : "";
            $data['Row_Rebates'] = $soa->rebate > 0
                ? "<tr><td>- Rebates</td><td align='right'>" . number_format($soa->rebate, 2) . "</td></tr>"
                : "";
            $data['Row_Service'] = $soa->service_charge > 0
                ? "<tr><td>Service Charge</td><td align='right'>" . number_format($soa->service_charge, 2) . "</td></tr>"
                : "";
            $data['Row_Staggered'] = $soa->staggered > 0
                ? "<tr><td>Staggered Payment</td><td align='right'>" . number_format($soa->staggered, 2) . "</td></tr>"
                : "";
        }

        if ($invoice) {
            $dueDate = \Carbon\Carbon::parse($invoice->due_date);
            $invoiceDate = $invoice->invoice_date ? \Carbon\Carbon::parse($invoice->invoice_date) : null;

            $data = array_merge($data, [
                'Statement_Date' => $invoiceDate ? $invoiceDate->format('F d, Y') : '-',
                'Invoice_No' => $invoice->id,
                'Invoice_Balance' => number_format($invoice->invoice_balance, 2),
                'Total_Amount' => number_format($invoice->total_amount, 2),
                'Total_Due' => number_format($invoice->total_amount, 2),
                'Amount_Due' => number_format($invoice->total_amount, 2),
                'Due_Date' => $dueDate->format('F d, Y')
            ]);
        }

        return $data;
    }

    protected function prepareOverduePdfData(BillingAccount $account, Invoice $invoice): array
    {
        $customer = $account->customer;

        $fullAddress = implode(', ', array_filter([
            $customer->address,
            $customer->barangay,
            $customer->city
        ]));

        return [
            'Full_Name' => $customer->full_name,
            'Account_No' => $account->account_no,
            'Address' => $fullAddress,
            'Street' => $customer->address,
            'Barangay' => $customer->barangay,
            'City' => $customer->city,
            'Total_Due' => number_format($invoice->total_amount, 2),
            'Due_Date' => $invoice->due_date->format('F d, Y'),
            'Invoice_No' => $invoice->id,
            'Payment_Link' => config('app.payment_link', 'https://pay.example.com')
        ];
    }

    protected function prepareDcNoticePdfData(BillingAccount $account, Invoice $invoice): array
    {
        $customer = $account->customer;

        $fullAddress = implode(', ', array_filter([
            $customer->address,
            $customer->barangay,
            $customer->city
        ]));

        $dcDate = $invoice->due_date->copy()->addDays(4);

        return [
            'Full_Name' => $customer->full_name,
            'Account_No' => $account->account_no,
            'Address' => $fullAddress,
            'Street' => $customer->address,
            'Barangay' => $customer->barangay,
            'City' => $customer->city,
            'Total_Due' => number_format($invoice->total_amount, 2),
            'Due_Date' => $invoice->due_date->format('F d, Y'),
            'DC_Date' => $dcDate->format('F d, Y'),
            'Payment_Link' => config('app.payment_link', 'https://pay.example.com')
        ];
    }

    protected function replacePlaceholders(string $template, array $data): string
    {
        foreach ($data as $key => $value) {
            // Replace exact key: {{Key_Name}}
            $template = str_replace('{{' . $key . '}}', $value, $template);
            
            // Also replace space variant: {{Key Name}} (template may use spaces instead of underscores)
            $spaceKey = str_replace('_', ' ', $key);
            if ($spaceKey !== $key) {
                $template = str_replace('{{' . $spaceKey . '}}', $value, $template);
            }
            
            // Also replace underscore variant if key has spaces: {{Key_Name}}
            $underscoreKey = str_replace(' ', '_', $key);
            if ($underscoreKey !== $key) {
                $template = str_replace('{{' . $underscoreKey . '}}', $value, $template);
            }
        }
        return $template;
    }

    protected function addStrictCss(): string
    {
        return "
        <style>
            @page { margin: 0px; } 
            html, body { margin: 0px; padding: 0px; font-family: Helvetica, Arial, sans-serif; font-size: 10pt; }
            .full-width { width: 100%; display: block; }
            .content-wrap { padding: 20px 40px; } 
            table { width: 100%; border-collapse: collapse; border-spacing: 0; }
            td, th { padding: 4px; vertical-align: top; border: none; }
            table[border='1'] td, table[border='1'] th, .bordered td, .bordered th { border: 1px solid #000 !important; }
            p { margin: 0 0 8px 0; line-height: 1.3; }
            img { display: block; max-width: 100%; height: auto; }
        </style>";
    }
}



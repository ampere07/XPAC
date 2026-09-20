<?php

namespace App\Services;

use Dompdf\Dompdf;
use Dompdf\Options;
use App\Models\EmailTemplate;
use App\Models\BillingAccount;
use App\Models\Invoice;
use App\Models\StatementOfAccount;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class PdfGenerationService
{
    protected Dompdf $dompdf;
    protected Options $options;

    public function __construct()
    {
        $this->options = new Options();
        $this->options->set('isHtml5ParserEnabled', true);
        $this->options->set('isRemoteEnabled', true);
        $this->options->set('defaultFont', 'Helvetica');
        $this->options->set('dpi', 96);
        $this->options->set('chroot', storage_path('app/public'));

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
            
            Log::info('PDF data prepared for template', [
                'document_type' => $documentType,
                'account_no' => $account->account_no,
                'soa_id' => $soa?->id,
                'invoice_id' => $invoice?->id,
                'data_keys' => array_keys($pdfData),
                'sample_data' => [
                    'Amount_Discounts' => $pdfData['Amount_Discounts'] ?? 'not set',
                    'Amount_Rebates' => $pdfData['Amount_Rebates'] ?? 'not set',
                    'Amount_Service' => $pdfData['Amount_Service'] ?? 'not set',
                    'Amount_Install' => $pdfData['Amount_Install'] ?? 'not set',
                ]
            ]);
            
            $template = EmailTemplate::where('Template_Code', $templateCode)
                ->where('Is_Active', true)
                ->first();

            if (!$template) {
                throw new \Exception("PDF template {$templateCode} not found or not active");
            }

            $html = $this->replacePlaceholders($template->Body_HTML, $pdfData);
            
            // Debug log to check replacement
            Log::info('Template replacement check', [
                'template_contains_Amount_Discounts' => strpos($template->Body_HTML, '{{Amount_Discounts}}') !== false,
                'template_contains_Amount_Rebates' => strpos($template->Body_HTML, '{{Amount_Rebates}}') !== false,
                'html_after_replacement_contains_placeholders' => strpos($html, '{{Amount_Discounts}}') !== false,
                'sample_pdfData' => [
                    'Amount_Discounts' => $pdfData['Amount_Discounts'] ?? 'MISSING',
                    'Amount_Rebates' => $pdfData['Amount_Rebates'] ?? 'MISSING',
                ]
            ]);
            
            $html = $this->addStrictCss() . $html;

            $this->dompdf->loadHtml($html);
            $this->dompdf->setPaper('A4', 'portrait');
            $this->dompdf->render();

            $folder = $documentType === 'SOA' ? 'soa' : 'invoices';
            $dateFolder = now()->format('Y/m/d');
            $fullFolder = "billing/{$folder}/{$dateFolder}";
            
            Storage::makeDirectory("public/{$fullFolder}");

            $documentId = $invoice?->id ?? $soa?->id ?? uniqid();
            $filename = "{$documentType}-{$account->account_no}-{$documentId}.pdf";
            $relativePath = "{$fullFolder}/{$filename}";
            $absolutePath = storage_path("app/public/{$relativePath}");

            file_put_contents($absolutePath, $this->dompdf->output());

            $url = asset("storage/{$relativePath}");

            Log::info('PDF generated successfully', [
                'document_type' => $documentType,
                'account_no' => $account->account_no,
                'path' => $absolutePath
            ]);

            return [
                'success' => true,
                'url' => $url,
                'path' => $absolutePath,
                'relative_path' => $relativePath
            ];

        } catch (\Exception $e) {
            Log::error('PDF generation failed', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
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

            $dateFolder = now()->format('Y/m/d');
            $fullFolder = "billing/overdue/{$dateFolder}";
            
            Storage::makeDirectory("public/{$fullFolder}");

            $filename = "OVERDUE-{$account->account_no}-{$invoice->id}.pdf";
            $relativePath = "{$fullFolder}/{$filename}";
            $absolutePath = storage_path("app/public/{$relativePath}");

            file_put_contents($absolutePath, $this->dompdf->output());

            $url = asset("storage/{$relativePath}");

            return [
                'success' => true,
                'url' => $url,
                'path' => $absolutePath,
                'relative_path' => $relativePath
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

            $dateFolder = now()->format('Y/m/d');
            $fullFolder = "billing/dc_notice/{$dateFolder}";
            
            Storage::makeDirectory("public/{$fullFolder}");

            $filename = "DCNOTICE-{$account->account_no}-{$invoice->id}.pdf";
            $relativePath = "{$fullFolder}/{$filename}";
            $absolutePath = storage_path("app/public/{$relativePath}");

            file_put_contents($absolutePath, $this->dompdf->output());

            $url = asset("storage/{$relativePath}");

            return [
                'success' => true,
                'url' => $url,
                'path' => $absolutePath,
                'relative_path' => $relativePath
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
            $billingConfig = \App\Models\BillingConfig::first();
            $billingDay = $account->billing_day;
            $statementDate = \Carbon\Carbon::parse($soa->statement_date);
            $daysInMonth = $statementDate->daysInMonth;
            
            // Calculate Due Date based on billing_config.due_date_day
            $dueDateDay = $billingConfig ? $billingConfig->due_date_day : 0;
            $calculatedDueDay = $dueDateDay == 0 ? $billingDay : $billingDay + $dueDateDay;
            
            if ($calculatedDueDay > $daysInMonth) {
                $dueDate = $statementDate->copy()->addMonth()->day($calculatedDueDay - $daysInMonth);
            } else {
                $dueDate = $statementDate->copy()->day($calculatedDueDay);
            }
            
            // Calculate DC Date by adding disconnection_day to the calculated due date
            $disconnectionDay = $billingConfig ? $billingConfig->disconnection_day : 0;
            $dcDate = $dueDate->copy()->addDays($disconnectionDay);
            
            // Period_End = current SOA's due date (already calculated above)
            $periodEnd = $dueDate;

            // Period_Start = previous SOA's due date (calculated using same billing config logic)
            $previousSoa = StatementOfAccount::where('account_no', $account->account_no)
                ->where('id', '<', $soa->id)
                ->orderBy('id', 'desc')
                ->first();

            if ($previousSoa) {
                // Calculate the previous SOA's due date using the same billing config logic
                $prevStatementDate = \Carbon\Carbon::parse($previousSoa->statement_date);
                $prevDaysInMonth = $prevStatementDate->daysInMonth;
                $prevCalculatedDueDay = $dueDateDay == 0 ? $billingDay : $billingDay + $dueDateDay;
                if ($prevCalculatedDueDay > $prevDaysInMonth) {
                    $periodStart = $prevStatementDate->copy()->addMonth()->day($prevCalculatedDueDay - $prevDaysInMonth);
                } else {
                    $periodStart = $prevStatementDate->copy()->day($prevCalculatedDueDay);
                }
            } else {
                // If this is the only/first SOA, use the customer's installation date
                $periodStart = $account->date_installed
                    ? \Carbon\Carbon::parse($account->date_installed)
                    : null;
            }

            $data = array_merge($data, [
                'Statement_Date' => $statementDate->format('F d, Y'),
                'SOA_No' => $soa->id,
                'Prev_Balance' => number_format($soa->balance_from_previous_bill, 2),
                'Prev_Payment' => number_format($soa->payment_received_previous, 2),
                'Rem_Balance' => number_format($soa->remaining_balance_previous, 2),
                'Monthly_Fee' => number_format($soa->monthly_service_fee, 2),
                'VAT' => number_format($soa->vat, 2),
                'Amount_Due' => number_format($soa->amount_due, 2),
                'Total_Due' => number_format($soa->total_amount_due, 2),
                'Due_Date' => $dueDate->format('F d, Y'),
                'Period_Start' => $periodStart ? $periodStart->format('m/d/Y') : '-',
                'Period_End' => $periodEnd->format('m/d/Y'),
                'DC_Date' => $dcDate->format('F d, Y'),
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
                'Label_Install' => $soa->staggered > 0 ? 'Installment' : '' // Alias for backward compatibility
            ]);

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
            $billingConfig = \App\Models\BillingConfig::first();
            $billingDay = $account->billing_day;
            $statementDate = $invoice->invoice_date ? \Carbon\Carbon::parse($invoice->invoice_date) : now();
            $daysInMonth = $statementDate->daysInMonth;
            
            $dueDateDay = $billingConfig ? $billingConfig->due_date_day : 0;
            $calculatedDueDay = $dueDateDay == 0 ? $billingDay : $billingDay + $dueDateDay;
            
            if ($calculatedDueDay > $daysInMonth) {
                $dueDate = $statementDate->copy()->addMonth()->day($calculatedDueDay - $daysInMonth);
            } else {
                $dueDate = $statementDate->copy()->day($calculatedDueDay);
            }
            
            $data = array_merge($data, [
                'Statement_Date' => $statementDate->format('F d, Y'),
                'Invoice_No' => $invoice->id,
                'Invoice_Balance' => number_format($invoice->invoice_balance, 2),
                'Total_Amount' => number_format($invoice->total_amount, 2),
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
            $template = str_replace('{{' . $key . '}}', $value, $template);
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


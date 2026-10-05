<?php

namespace App\Services;

use App\Models\Invoice;
use Carbon\Carbon;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The PDF of a paid invoice: rendered in the invoice layout (To / Account No / Invoice No /
 * dates, the item table, the amount in words, payment details and a PAID stamp), uploaded to
 * Google Drive under Invoices/<account_no>/, and its link stored in invoices.pdf_url.
 *
 * Called when a payment marks an invoice Paid (TransactionController::updateInvoiceDetails and
 * PaymentWorkerService::updateBilling) through {@see generateAfterCommit()}, and on demand from
 * POST /invoices/{id}/generate-pdf.
 */
class PaidInvoicePdfService
{
    public function __construct(private GoogleDriveService $googleDriveService)
    {
    }

    /**
     * Generate PDFs for these invoices once the surrounding transaction commits.
     *
     * After the commit, because the Drive upload cannot be rolled back: a PDF for a payment that
     * then fails to commit would show an invoice as PAID that is not. With no transaction open it
     * runs straight away; on a rollback it never runs. Never throws — a missing PDF must never
     * fail a payment, and the PDF can be made later from the Bills page.
     *
     * @param  array<int, int|string>  $invoiceIds
     */
    public static function generateAfterCommit(array $invoiceIds): void
    {
        $invoiceIds = array_values(array_unique(array_filter(array_map('intval', $invoiceIds))));
        if (empty($invoiceIds)) {
            return;
        }

        try {
            DB::afterCommit(function () use ($invoiceIds) {
                $service = app(self::class);
                foreach ($invoiceIds as $invoiceId) {
                    $service->generate($invoiceId);
                }
            });
        } catch (\Throwable $e) {
            Log::error('[PAID INVOICE PDF] Could not schedule PDF generation', [
                'invoice_ids' => $invoiceIds,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Render, upload and record the PDF for one paid invoice.
     *
     * Skips an invoice that is not Paid, or that already has a PDF unless $force is set (a
     * payment never re-renders one that exists).
     *
     * @return array{success: bool, url?: string, skipped?: bool, message?: string}
     */
    public function generate(int $invoiceId, bool $force = false): array
    {
        try {
            $invoice = Invoice::with(['billingAccount.customer', 'billingAccount.technicalDetails'])->find($invoiceId);

            if (!$invoice) {
                return ['success' => false, 'message' => "Invoice {$invoiceId} not found."];
            }

            if (strtolower((string) $invoice->status) !== 'paid') {
                return ['success' => false, 'skipped' => true, 'message' => 'Only paid invoices get a PDF.'];
            }

            if (!$force && !empty($invoice->pdf_url)) {
                return ['success' => true, 'skipped' => true, 'url' => $invoice->pdf_url];
            }

            $pdf = $this->render($invoice);

            $tempPath = sys_get_temp_dir() . '/' . uniqid('invoice_') . '.pdf';
            file_put_contents($tempPath, $pdf);

            try {
                $rootFolder = config('invoice_pdf.drive_folder', 'Invoices');
                $rootId = $this->googleDriveService->findFolder($rootFolder)
                    ?: $this->googleDriveService->createFolder($rootFolder);
                $accountFolderId = $this->googleDriveService->findFolder($invoice->account_no, $rootId)
                    ?: $this->googleDriveService->createFolder($invoice->account_no, $rootId);

                $url = $this->googleDriveService->uploadFile(
                    $tempPath,
                    $accountFolderId,
                    "INVOICE-{$invoice->account_no}-{$invoice->id}.pdf",
                    'application/pdf'
                );
            } finally {
                @unlink($tempPath);
            }

            if (empty($url)) {
                throw new \Exception('Google Drive did not return a link for the uploaded PDF');
            }

            DB::table('invoices')->where('id', $invoice->id)->update([
                'pdf_url' => $url,
                'updated_at' => now(),
            ]);

            Log::info('[PAID INVOICE PDF] Generated', [
                'invoice_id' => $invoice->id,
                'account_no' => $invoice->account_no,
                'url' => $url,
            ]);

            return ['success' => true, 'url' => $url];
        } catch (\Throwable $e) {
            Log::error('[PAID INVOICE PDF] Generation failed', [
                'invoice_id' => $invoiceId,
                'error' => $e->getMessage(),
            ]);

            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    /** The PDF bytes for an invoice, in the paid invoice layout. */
    public function render(Invoice $invoice): string
    {
        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'Helvetica');

        // A fresh renderer per document: Dompdf instances are single-use.
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($this->html($invoice));
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();

        return $dompdf->output();
    }

    protected function html(Invoice $invoice): string
    {
        $e = fn ($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES, 'UTF-8');
        $money = fn ($v) => number_format((float) $v, 2) === number_format(round((float) $v), 2)
            ? number_format((float) $v, 0)
            : number_format((float) $v, 2);

        $account = $invoice->billingAccount;
        $customer = $account?->customer;
        $username = optional($account?->technicalDetails?->first())->username;

        // "To" is the account name the invoice has always carried (the PPPoE name), falling back
        // to the customer's own name.
        $toName = $username ?: ($customer?->full_name ?? $invoice->account_no);
        $address = implode(' ', array_filter([
            $customer?->address,
            $customer?->barangay,
            $customer?->city,
        ]));

        $invoiceDate = $invoice->invoice_date ? Carbon::parse($invoice->invoice_date) : null;
        $dueDate = $invoice->due_date ? Carbon::parse($invoice->due_date) : null;

        // Line items. The plan line carries the monthly fee and any discount/rebate; the other
        // charges each get their own line, so the lines add up to total_amount.
        $planName = trim(explode(' - ', (string) ($customer?->desired_plan ?? ''))[0]) ?: 'Internet Service';
        $total = (float) ($invoice->total_amount ?? 0);
        $vat = (float) ($invoice->vat ?? 0);
        $serviceCharge = (float) ($invoice->service_charge ?? 0);
        $staggered = (float) ($invoice->staggered ?? 0);
        $discount = (float) ($invoice->discounts ?? 0) + (float) ($invoice->rebate ?? 0);
        $planPrice = (float) ($invoice->invoice_balance ?? 0);
        if ($planPrice <= 0) {
            $planPrice = $total - $vat - $serviceCharge - $staggered + $discount;
        }

        $items = [[$planName . ' Home Plan', $planPrice, $discount]];
        if ($serviceCharge > 0) {
            $items[] = ['Service Charge', $serviceCharge, 0];
        }
        if ($staggered > 0) {
            $items[] = ['Installment', $staggered, 0];
        }
        if ($vat > 0) {
            $items[] = ['VAT', $vat, 0];
        }

        $rows = '';
        foreach ($items as $i => [$label, $price, $disc]) {
            $rows .= '<tr class="item">'
                . '<td class="c">' . ($i + 1) . '.</td>'
                . '<td>' . $e($label) . '</td>'
                . '<td class="c">1</td>'
                . '<td class="r">' . $money($price) . '</td>'
                . '<td class="r">' . ($disc > 0 ? $money($disc) : '-') . '</td>'
                . '<td class="r">' . $money($price - $disc) . '</td>'
                . '</tr>';
        }

        $words = self::amountInWords($total);
        $email = $e(config('invoice_pdf.confirmation_email'));
        $contact = $e(config('invoice_pdf.confirmation_contact'));

        return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            @page { margin: 40px 55px; }
            body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #222; }
            table { border-collapse: collapse; }
            .title { font-size: 30pt; font-weight: bold; color: #0b1a8c; text-align: right; }
            .to-name { font-size: 14pt; font-weight: bold; }
            .meta td { padding: 2px 4px; vertical-align: top; }
            .meta .k { font-weight: bold; text-align: right; white-space: nowrap; }
            .items { width: 100%; margin-top: 8px; }
            .items th { text-align: left; padding: 8px 6px; border-top: 1px solid #ddd; border-bottom: 2px solid #ccc; }
            .items td { padding: 10px 6px; border-bottom: 1px solid #ddd; }
            .items .c { text-align: center; }
            .items .r { text-align: right; }
            .total td { border-bottom: none; font-weight: bold; padding-top: 10px; }
            .words { font-style: italic; margin-top: 24px; }
            .block { margin-top: 18px; }
            .block b { display: block; }
            .stamp { position: absolute; left: 150px; top: 490px; width: 300px; padding: 18px 0;
                     border: 2px dashed #1a8c2e; color: #1a8c2e; font-size: 30pt; text-align: center;
                     transform: rotate(-15deg); letter-spacing: 2px; }
        </style></head><body>'
            . '<div class="title">INVOICE</div>'
            . '<table style="width:100%; margin-top: 6px;"><tr>'
            . '<td style="width:55%; vertical-align: top;">'
            . '<div>To :</div>'
            . '<div class="to-name">' . $e($toName) . '</div>'
            . '<div style="margin-top: 4px;">' . $e($customer?->contact_number_primary) . '</div>'
            . '<div style="margin-top: 4px;">' . $e($address) . '</div>'
            . '</td>'
            . '<td style="width:45%; vertical-align: top;"><table class="meta" style="margin-left:auto;">'
            . '<tr><td class="k">Account No :</td><td>' . $e($invoice->account_no) . '</td></tr>'
            . '<tr><td class="k">Invoice No :</td><td>' . $e($invoice->id) . '</td></tr>'
            . '<tr><td class="k">Date Invoice :</td><td>' . $e($invoiceDate?->format('F d, Y') ?? '-') . '</td></tr>'
            . '<tr><td class="k">Due Date :</td><td>' . $e($dueDate?->format('F d, Y') ?? '-') . '</td></tr>'
            . '</table></td>'
            . '</tr></table>'
            . '<div style="margin-top: 26px;">Period ' . $e($invoiceDate?->format('F Y') ?? '-') . '</div>'
            . '<table class="items"><thead><tr>'
            . '<th class="c" style="width:7%;">No</th><th style="width:38%;">Items</th><th class="c" style="width:10%;">Qty</th>'
            . '<th class="r" style="width:15%;">Price</th><th class="r" style="width:15%;">Discount</th><th class="r" style="width:15%;">Total</th>'
            . '</tr></thead><tbody>'
            . $rows
            . '<tr class="total"><td colspan="5" class="r">Total</td><td class="r">' . $money($total) . '</td></tr>'
            . '</tbody></table>'
            . '<div class="words">* Count : ' . $e($words) . '</div>'
            . '<div class="block"><b>Payment Confirmation :</b>Email : ' . $email . '<br>Contact : ' . $contact . '</div>'
            . '<div class="stamp">PAID</div>'
            . '</body></html>';
    }

    /** "one thousand", "one thousand two hundred and 50/100" — the amount written out. */
    public static function amountInWords(float $amount): string
    {
        $amount = round(abs($amount), 2);
        $whole = (int) floor($amount);
        $cents = (int) round(($amount - $whole) * 100);

        $words = $whole === 0 ? 'zero' : self::integerInWords($whole);

        return $cents > 0 ? sprintf('%s and %02d/100', $words, $cents) : $words;
    }

    private static function integerInWords(int $n): string
    {
        $ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        $tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

        $belowThousand = function (int $n) use ($ones, $tens): string {
            $parts = [];
            if ($n >= 100) {
                $parts[] = $ones[intdiv($n, 100)] . ' hundred';
                $n %= 100;
            }
            if ($n >= 20) {
                $parts[] = $tens[intdiv($n, 10)] . ($n % 10 ? '-' . $ones[$n % 10] : '');
            } elseif ($n > 0) {
                $parts[] = $ones[$n];
            }
            return implode(' ', $parts);
        };

        $scales = [1000000000 => 'billion', 1000000 => 'million', 1000 => 'thousand'];
        $parts = [];
        foreach ($scales as $value => $name) {
            if ($n >= $value) {
                $parts[] = $belowThousand(intdiv($n, $value)) . ' ' . $name;
                $n %= $value;
            }
        }
        if ($n > 0) {
            $parts[] = $belowThousand($n);
        }

        return implode(' ', $parts);
    }
}

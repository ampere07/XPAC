<?php

namespace App\Services;

use App\Models\BillingAccount;
use Carbon\Carbon;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Emails a prepaid customer a Statement of Account PDF after a successful payment.
 *
 * The coverage runs from the payment date to the account's prepaid expiry AS IT STANDS AFTER the
 * payment — so it must be called after the renewal, which is why both callers
 * (TransactionController after approval, PaymentWorkerService after settlement) invoke it last.
 *
 * The PDF is the SOA_TEMPLATE in email_templates — the same template, placeholders and rendering
 * as the billing SOA — filled with prepaid values (see placeholders()). Prepaid accounts get no
 * statement_of_accounts row (their only bill is the initial one), so the values come from the
 * payment and the renewed account rather than from a statement record. If SOA_TEMPLATE is missing
 * or inactive, a built-in layout is used instead so the customer still receives a statement.
 *
 * Never throws: the payment is already done, and a PDF or email problem must not undo it.
 */
class PrepaidSoaService
{
    /**
     * @param array{amount: float, paid_at: Carbon, reference?: ?string, method?: ?string,
     *              discount?: float, rebate?: float, months?: int, source: string} $payment
     */
    public function sendForPayment(string $accountNo, array $payment): bool
    {
        try {
            $account = BillingAccount::with('customer')->where('account_no', $accountNo)->first();
            if (!$account || !BillingAccount::isPrepaidType($account->generation_type)) {
                return false;   // Prepaid only.
            }

            $customer = $account->customer;
            $email = trim((string) ($customer->email_address ?? ''));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                Log::info('[PREPAID SOA] Not sent: no usable customer email', ['account_no' => $accountNo]);
                return false;
            }

            if (empty($account->prepaid_expires_at)) {
                Log::info('[PREPAID SOA] Not sent: no prepaid period to state', ['account_no' => $accountNo]);
                return false;
            }

            $paidAt = $payment['paid_at'] instanceof Carbon ? $payment['paid_at'] : Carbon::parse($payment['paid_at']);
            $expiry = Carbon::parse($account->prepaid_expires_at);
            $data = $this->placeholders($account, $paidAt, $expiry, $payment);

            $pdfPath = $this->renderPdf($data, $accountNo);
            if ($pdfPath === null) {
                return false;
            }

            app(EmailQueueService::class)->queueEmail([
                'account_no' => $accountNo,
                'recipient_email' => $email,
                'subject' => "Statement of Account - {$data['Coverage_From']} to {$data['Coverage_To']}",
                'body_html' => $this->emailBody($data),
                'attachment_path' => $pdfPath,
            ]);

            Log::info('[PREPAID SOA] Queued', [
                'account_no' => $accountNo,
                'coverage' => "{$data['Coverage_From']} - {$data['Coverage_To']}",
                'source' => $payment['source'],
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::error('[PREPAID SOA] Failed for ' . $accountNo . ': ' . $e->getMessage());
            return false;
        }
    }

    /**
     * The values the SOA shows.
     *
     * Keyed first by the placeholder names SOA_TEMPLATE already uses — the same keys
     * GoogleDrivePdfGenerationService::preparePdfData() fills for a billing SOA — given prepaid
     * meanings: the coverage is Period_Start (payment date) to Period_End (expiry), the payment is
     * Prev_Payment, the plan period is Monthly_Fee, and Due_Date is the expiry (pay again by then).
     * Then a few extra keys (Coverage_*, Amount_Paid, …) for the email body and the fallback layout.
     */
    private function placeholders(BillingAccount $account, Carbon $paidAt, Carbon $expiry, array $payment): array
    {
        $customer = $account->customer;
        $num = fn ($v) => number_format((float) $v, 2);
        $plan = app(PrepaidPlanChangeService::class)->currentPlanFor($account);
        $months = max(1, (int) ($payment['months'] ?? 1));
        $discount = (float) ($payment['discount'] ?? 0);
        $rebate = (float) ($payment['rebate'] ?? 0);
        $amountPaid = (float) ($payment['amount'] ?? 0);
        $balanceAfter = max(0.0, (float) $account->account_balance);
        $balanceBefore = isset($payment['balance_before']) ? max(0.0, (float) $payment['balance_before']) : null;
        $planPeriod = $plan && (float) $plan->price > 0 ? (float) $plan->price * $months : 0.0;
        $days = (int) $paidAt->copy()->startOfDay()->diffInDays($expiry->copy()->startOfDay()) + 1;
        $address = implode(', ', array_filter([
            $customer->address ?? null, $customer->location ?? null, $customer->barangay ?? null,
            $customer->city ?? null, $customer->region ?? null,
        ], fn ($p) => filled($p)));

        return [
            // ── SOA_TEMPLATE placeholders (same names as the billing SOA) ──
            'Full_Name' => trim((string) ($customer->full_name ?? '')) ?: '-',
            'Address' => $address ?: '-',
            'Street' => $customer->address ?? '',
            'Barangay' => $customer->barangay ?? '',
            'City' => $customer->city ?? '',
            'Province' => $customer->region ?? '',
            'Contact_No' => $customer->contact_number_primary ?? '-',
            'Email' => $customer->email_address ?? '',
            'Account_No' => $account->account_no,
            'Plan' => $plan->plan_name ?? ($customer->desired_plan ?? '-'),
            'Statement_Date' => Carbon::now()->format('F d, Y'),
            'Payment_Link' => config('app.payment_link', 'https://sync.xpacsconnect.ph'),
            'SOA_No' => filled($payment['reference'] ?? null) ? (string) $payment['reference'] : '-',
            'Prev_Balance' => $num($balanceBefore ?? ($balanceAfter + $amountPaid)),
            'Prev_Payment' => $num($amountPaid),
            'Rem_Balance' => $num($balanceAfter),
            'Monthly_Fee' => $num($planPeriod),
            'VAT' => $num(0),
            'Amount_Due' => $num($balanceAfter),
            'Total_Due' => $num($balanceAfter),
            'Due_Date' => $expiry->format('F d, Y'),
            'Period_Start' => $paidAt->format('m/d/Y'),
            'Period_End' => $expiry->format('m/d/Y'),
            // Prepaid service is restricted the day after expiry (no grace period).
            'DC_Date' => $expiry->copy()->addDay()->format('F d, Y'),
            'Amount_Discounts' => $discount > 0 ? $num($discount) : '',
            'Label_Discounts' => $discount > 0 ? 'Discounts' : '',
            'Amount_Rebates' => $rebate > 0 ? $num($rebate) : '',
            'Label_Rebates' => $rebate > 0 ? 'Rebates' : '',
            'Amount_Service' => '', 'Label_Service' => '',
            'Amount_Install' => '', 'Label_Install' => '', 'Label_Staggered' => '',
            'Adjustment_Label' => ($discount + $rebate) > 0 ? 'Other and Basic Charges' : '',
            'Adjustment_Value' => ($discount + $rebate) > 0 ? $num($discount + $rebate) : '',
            'Row_Discounts' => $discount > 0 ? "<tr><td>- Discounts</td><td align='right'>" . $num($discount) . "</td></tr>" : '',
            'Row_Rebates' => $rebate > 0 ? "<tr><td>- Rebates</td><td align='right'>" . $num($rebate) . "</td></tr>" : '',
            'Row_Service' => '', 'Row_Staggered' => '',

            // ── Extra keys: email body and the fallback layout ──
            'Company_Name' => DB::table('form_ui')->value('brand_name') ?: 'Your ISP',
            'Plan_Price' => $plan && (float) $plan->price > 0 ? '₱' . $num($plan->price) : '-',
            'Months' => (string) $months,
            'Payment_Date' => $paidAt->format('F j, Y'),
            'Amount_Paid' => '₱' . $num($amountPaid),
            'Discount' => $discount > 0 ? '₱' . $num($discount) : '-',
            'Rebate' => $rebate > 0 ? '₱' . $num($rebate) : '-',
            'Reference_No' => filled($payment['reference'] ?? null) ? (string) $payment['reference'] : '-',
            'Payment_Method' => filled($payment['method'] ?? null) ? (string) $payment['method'] : '-',
            'Coverage_From' => $paidAt->format('F j, Y'),
            'Coverage_To' => $expiry->format('F j, Y'),
            'Coverage_Days' => (string) $days,
            'Account_Balance' => '₱' . $num($balanceAfter),
        ];
    }

    /**
     * Render to a file the email queue attaches (and deletes once sent). Null on failure.
     *
     * The SOA_TEMPLATE in email_templates, rendered exactly as the billing SOA renders it
     * (GoogleDrivePdfGenerationService::renderTemplatePdf). If that template is missing or
     * inactive, the built-in layout below is used so the customer still gets a statement.
     */
    private function renderPdf(array $data, string $accountNo): ?string
    {
        try {
            try {
                $pdf = app(GoogleDrivePdfGenerationService::class)->renderTemplatePdf('SOA_TEMPLATE', $data);
            } catch (\Throwable $templateError) {
                Log::warning('[PREPAID SOA] SOA_TEMPLATE unavailable, using the built-in layout: ' . $templateError->getMessage(), [
                    'account_no' => $accountNo,
                ]);

                $options = new Options();
                $options->set('isHtml5ParserEnabled', true);
                $options->set('defaultFont', 'DejaVu Sans');   // Has the ₱ glyph; Helvetica does not.
                $dompdf = new Dompdf($options);
                $dompdf->loadHtml($this->builtInHtml($data), 'UTF-8');
                $dompdf->setPaper('A4', 'portrait');
                $dompdf->render();
                $pdf = $dompdf->output();
            }

            $dir = storage_path('app/temp/prepaid-soa');
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            $path = $dir . '/SOA-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $accountNo) . '-' . date('Ymd-His') . '-' . substr(uniqid(), -5) . '.pdf';
            file_put_contents($path, $pdf);

            return $path;
        } catch (\Throwable $e) {
            Log::error('[PREPAID SOA] PDF render failed for ' . $accountNo . ': ' . $e->getMessage());
            return null;
        }
    }

    private function builtInHtml(array $d): string
    {
        $e = fn ($k) => e($d[$k] ?? '-');
        $row = fn ($label, $key) => "<tr><td class=\"l\">{$label}</td><td class=\"v\">{$e($key)}</td></tr>";

        return <<<HTML
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: "DejaVu Sans", sans-serif; font-size: 11px; color: #111; margin: 28px; }
  .head { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .brand { font-size: 18px; font-weight: bold; }
  .title { font-size: 15px; font-weight: bold; letter-spacing: 1px; margin-top: 6px; }
  .muted { color: #555; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 6px; border-bottom: 1px solid #e5e5e5; }
  td.l { width: 40%; color: #444; }
  td.v { font-weight: bold; }
  .coverage { margin-top: 16px; border: 2px solid #111; padding: 10px 12px; }
  .coverage .big { font-size: 15px; font-weight: bold; }
  .note { margin-top: 22px; font-size: 9px; color: #666; }
</style></head><body>
  <div class="head">
    <div class="brand">{$e('Company_Name')}</div>
    <div class="title">STATEMENT OF ACCOUNT</div>
    <div class="muted">Statement date: {$e('Statement_Date')}</div>
  </div>

  <h3>Account</h3>
  <table>
    {$row('Account No.', 'Account_No')}
    {$row('Name', 'Full_Name')}
    {$row('Address', 'Address')}
    {$row('Contact No.', 'Contact_No')}
    {$row('Plan', 'Plan')}
    {$row('Plan Price (per period)', 'Plan_Price')}
  </table>

  <div class="coverage">
    <div class="muted">COVERAGE PERIOD</div>
    <div class="big">{$e('Coverage_From')} &ndash; {$e('Coverage_To')}</div>
    <div class="muted">{$e('Coverage_Days')} day(s) of prepaid service</div>
  </div>

  <h3>Payment</h3>
  <table>
    {$row('Payment Date', 'Payment_Date')}
    {$row('Amount Paid', 'Amount_Paid')}
    {$row('Discount', 'Discount')}
    {$row('Rebate', 'Rebate')}
    {$row('Months Paid', 'Months')}
    {$row('Payment Method', 'Payment_Method')}
    {$row('Reference No.', 'Reference_No')}
    {$row('Remaining Balance', 'Account_Balance')}
  </table>

  <div class="note">This statement covers your prepaid service from the payment date to the expiration date shown above.
  Service continues through the expiration date. Pay again on or before that date to keep your connection uninterrupted.</div>
</body></html>
HTML;
    }

    private function emailBody(array $d): string
    {
        $e = fn ($k) => e($d[$k] ?? '-');

        return "<p>Hi {$e('Full_Name')},</p>"
            . "<p>Thank you for your payment of <strong>{$e('Amount_Paid')}</strong> on {$e('Payment_Date')}.</p>"
            . "<p>Your prepaid service for account <strong>{$e('Account_No')}</strong> now runs from "
            . "<strong>{$e('Coverage_From')}</strong> to <strong>{$e('Coverage_To')}</strong>. "
            . "Your Statement of Account is attached.</p>"
            . "<p>{$e('Company_Name')}</p>";
    }
}

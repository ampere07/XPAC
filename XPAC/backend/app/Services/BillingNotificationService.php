<?php

namespace App\Services;

use App\Models\BillingAccount;
use App\Models\Invoice;
use App\Models\StatementOfAccount;
use App\Models\SMSTemplate;
use App\Models\BillingConfig;
use App\Services\EmailQueueService;
use App\Services\SmsQueueService;
use App\Services\ItexmoSmsService;
use App\Services\GoogleDrivePdfGenerationService;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class BillingNotificationService
{
    protected EmailQueueService $emailQueueService;
    protected SmsQueueService $smsQueueService;
    protected ItexmoSmsService $smsService;
    protected GoogleDrivePdfGenerationService $pdfService;

    public function __construct(
        EmailQueueService $emailQueueService,
        SmsQueueService $smsQueueService,
        ItexmoSmsService $smsService,
        GoogleDrivePdfGenerationService $pdfService
    ) {
        $this->emailQueueService = $emailQueueService;
        $this->smsQueueService = $smsQueueService;
        $this->smsService = $smsService;
        $this->pdfService = $pdfService;
    }

    public function notifyBillingGenerated(
        BillingAccount $account,
        ?Invoice $invoice = null,
        ?StatementOfAccount $soa = null,
        ?string $timeSent = null
    ): array {
        $results = [
            'email_queued' => false,
            'sms_sent' => false,
            'pdf_generated' => false,
            'errors' => []
        ];

        try {
            $customer = $account->customer;

            if (!$customer) {
                throw new \Exception("Customer not found for account {$account->account_no}");
            }

            // PDF generation is for SOA only — Invoice does not have a PDF template.
            // Also reuse existing print_link if SOA PDF was already generated during SOA creation.
            $pdfResult = ['success' => false, 'url' => null, 'filename' => null, 'folder_id' => null];

            if ($soa) {
                if (!empty($soa->print_link)) {
                    // SOA PDF was already generated in createEnhancedStatement — reuse it
                    $pdfResult = [
                        'success' => true,
                        'url' => $soa->print_link,
                        'filename' => 'SOA_' . $account->account_no . '.pdf',
                        'folder_id' => null
                    ];
                    $results['pdf_generated'] = true;
                    $results['pdf_url'] = $soa->print_link;

                    Log::info('Using existing SOA PDF link', [
                        'account_no' => $account->account_no,
                        'print_link' => $soa->print_link
                    ]);
                } else {
                    // Generate PDF for SOA only (pass null for invoice)
                    $pdfResult = $this->pdfService->generateBillingPdf($account, null, $soa);

                    if ($pdfResult['success']) {
                        $results['pdf_generated'] = true;
                        $results['pdf_url'] = $pdfResult['url'];
                        $results['google_drive_file_id'] = $pdfResult['folder_id'];
                        $results['filename'] = $pdfResult['filename'];
                        $this->updateSoaPdfLink($soa, $pdfResult['url']);
                    } else {
                        $results['errors'][] = "SOA PDF generation failed: " . $pdfResult['error'];
                        Log::warning('SOA PDF generation failed, continuing with email/SMS', [
                            'account_no' => $account->account_no,
                            'error' => $pdfResult['error']
                        ]);
                    }
                }
            }

            // Prepare SMS Message
            $smsMessage = null;
            if ($customer->contact_number_primary) {
                $smsMessage = $this->generateBillingSmsMessage($account, $invoice, $soa);
            }

            // Always proceed to email — do NOT block on PDF failure
            if ($customer->email_address) {
                $emailQueued = $this->queueBillingEmail($account, $invoice, $soa, $pdfResult, $timeSent);
                $results['email_queued'] = $emailQueued;
            } else {
                Log::warning('Customer has no email address', [
                    'account_no' => $account->account_no,
                    'customer_id' => $customer->id
                ]);
                $results['errors'][] = 'Customer has no email address';
            }

            Log::info('Checking SMS requirements', [
                'account_no' => $account->account_no,
                'has_contact' => !empty($customer->contact_number_primary),
                'sms_message_exists' => !empty($smsMessage),
                'time_sent' => $timeSent
            ]);

            // Always proceed to SMS — do NOT block on PDF or email failure
            // If timeSent is provided, SMS is handled by the dedicated SMS queue.
            if ($customer->contact_number_primary) {
                if (empty($timeSent) && $smsMessage) {
                    $smsResult = $this->smsService->send([
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $smsMessage
                    ]);
                    $results['sms_sent'] = $smsResult['success'];
                    
                    if (!$smsResult['success']) {
                        $results['errors'][] = "SMS failed: " . ($smsResult['error'] ?? 'Unknown');
                    }
                } elseif ($smsMessage) {
                    // SMS will be sent via dedicated queue if timeSent is present
                    $this->smsQueueService->queueSms([
                        'account_no' => $account->account_no,
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $smsMessage,
                        'time_sent' => $timeSent
                    ]);
                    $results['sms_sent'] = true;
                    Log::info('SMS queued in dedicated SMS queue', ['account_no' => $account->account_no]);
                }
            } else {
                Log::warning('Customer has no phone number', [
                    'account_no' => $account->account_no,
                    'customer_id' => $customer->id
                ]);
                $results['errors'][] = 'Customer has no phone number';
            }

            Log::info('Billing notification completed', [
                'account_no' => $account->account_no,
                'email_queued' => $results['email_queued'],
                'sms_sent' => $results['sms_sent'],
                'pdf_generated' => $results['pdf_generated']
            ]);

        } catch (\Exception $e) {
            $results['errors'][] = $e->getMessage();
            Log::error('Billing notification failed', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
        }

        return $results;
    }

    /**
     * Tell a PREPAID customer their service period has lapsed and what it costs to renew.
     *
     * Prepaid renewals raise no SOA and no invoice — the customer renews by paying for whichever
     * plan they pick at checkout, so there is no document to bill against and none to attach.
     * This notice is what replaces that bill.
     *
     * SMS only, deliberately. This used to also send an email that reused the SOA_TEMPLATE code
     * (there being no prepaid-specific template) to "stand in for a bill", but that meant a
     * routine SOA_TEMPLATE deactivation — a postpaid-only config choice — surfaced as a "template
     * not found" error for every prepaid customer, since prepaid accounts were never supposed to
     * depend on SOA/invoice infrastructure at all. Prepaid accounts do not use SOA_TEMPLATE, full
     * stop; the renewal amount and due date now travel to the customer via SMS only.
     *
     * No PDF is produced: {@see notifyBillingGenerated()} only generates one for an SOA, and there
     * is no SOA here.
     *
     * Never throws; failures come back in `errors`.
     *
     * @param  Carbon       $expiresAt      the lapsed prepaid_expires_at, shown as the due date
     * @param  float        $renewalAmount  what settles the renewal, VAT/withholding applied
     * @param  string|null  $timeSent       when set, SMS goes to the queue instead of sending now
     * @return array{email_queued: bool, sms_sent: bool, errors: array}
     */
    public function notifyPrepaidExpiry(
        BillingAccount $account,
        Carbon $expiresAt,
        float $renewalAmount,
        ?string $timeSent = null
    ): array {
        $results = [
            'email_queued' => false,
            'sms_sent' => false,
            'errors' => []
        ];

        try {
            $customer = $account->customer;

            if (!$customer) {
                throw new \Exception("Customer not found for account {$account->account_no}");
            }

            // No SOA_TEMPLATE email for prepaid accounts — see the method docblock. Deliberately
            // no template lookup at all (not even to check Is_Active), so a disabled or missing
            // SOA_TEMPLATE never affects a prepaid customer or their logs. This is expected
            // behavior, not a delivery failure, so it does not add to `errors`.
            if (BillingAccount::isPrepaidType($account->generation_type)) {
                Log::info('Prepaid expiry notice: SOA_TEMPLATE email intentionally skipped for prepaid account', [
                    'account_no' => $account->account_no
                ]);
            }

            if ($customer->contact_number_primary) {
                $smsMessage = $this->generatePrepaidExpirySmsMessage($account, $expiresAt, $renewalAmount);

                if ($smsMessage) {
                    if (empty($timeSent)) {
                        $smsResult = $this->smsService->send([
                            'contact_no' => $customer->contact_number_primary,
                            'message' => $smsMessage
                        ]);
                        $results['sms_sent'] = $smsResult['success'];

                        if (!$smsResult['success']) {
                            $results['errors'][] = "SMS failed: " . ($smsResult['error'] ?? 'Unknown');
                        }
                    } else {
                        $this->smsQueueService->queueSms([
                            'account_no' => $account->account_no,
                            'contact_no' => $customer->contact_number_primary,
                            'message' => $smsMessage,
                            'time_sent' => $timeSent
                        ]);
                        $results['sms_sent'] = true;
                    }
                }
            } else {
                $results['errors'][] = 'Customer has no phone number';
                Log::warning('Prepaid expiry notice: customer has no phone number', [
                    'account_no' => $account->account_no
                ]);
            }

            Log::info('Prepaid expiry notification completed', [
                'account_no' => $account->account_no,
                'expires_at' => $expiresAt->toDateTimeString(),
                'renewal_amount' => $renewalAmount,
                'email_queued' => $results['email_queued'],
                'sms_sent' => $results['sms_sent']
            ]);

        } catch (\Exception $e) {
            $results['errors'][] = $e->getMessage();
            Log::error('Prepaid expiry notification failed', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
        }

        return $results;
    }

    /**
     * SMS body for a prepaid lapse notice, from the same template a generated bill uses.
     *
     * Returns null when the template is missing or inactive, which the caller treats as "no SMS"
     * rather than an error — same as {@see generateBillingSmsMessage()}.
     */
    protected function generatePrepaidExpirySmsMessage(
        BillingAccount $account,
        Carbon $expiresAt,
        float $renewalAmount
    ): ?string {
        try {
            $customer = $account->customer;

            $template = DB::table('sms_templates')
                ->where('template_type', 'StatementofAccount')
                ->where('is_active', 1)
                ->first();

            if (!$template) {
                Log::warning('Prepaid expiry SMS skipped: StatementofAccount template not found or inactive', [
                    'account_no' => $account->account_no
                ]);
                return null;
            }

            $paymentLink = config('app.payment_link', 'https://sync.gowiser.ph');
            $planNameRaw = $account->plan ? $account->plan->plan_name : ($customer->desired_plan ?? 'N/A');
            $planNameFormatted = str_replace('₱', 'P', $planNameRaw);
            $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));
            $amount = number_format($renewalAmount, 2);

            $message = $template->message_content;
            $message = str_replace('{{customer_name}}', $customerName, $message);
            $message = str_replace('{{account_no}}', $account->account_no, $message);
            $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
            $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
            $message = str_replace('{{amount_due}}', $amount, $message);
            $message = str_replace('{{total_amount}}', $amount, $message);
            $message = str_replace('{{total_due}}', $amount, $message);
            $message = str_replace('{{amount}}', $amount, $message);
            $message = str_replace('{{balance}}', $amount, $message);
            $message = str_replace('{{due_date}}', $expiresAt->format('M d, Y'), $message);
            $message = str_replace('{{payment_link}}', $paymentLink, $message);

            // No statement exists, so the SOA date placeholders fall back to today — the same
            // fallback generateBillingSmsMessage() uses when an SOA has no statement_date.
            $todayStr = date('M d, Y');
            $message = str_replace('{{soa_date}}', $todayStr, $message);
            $message = str_replace('{{soa_data}}', $todayStr, $message);

            return $this->replaceGlobalVariables($message);
        } catch (\Exception $e) {
            Log::error('Failed to generate prepaid expiry SMS message', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
            return null;
        }
    }

    /**
     * Warn a PREPAID customer their service period is ABOUT to lapse, days before it does.
     *
     * The counterpart to {@see notifyPrepaidExpiry()}, which fires only once the period has already
     * gone — by then the customer is usually restricted. This is the heads-up that lets them renew
     * before anything is cut, sent `billing_config.prepaid_pre_expiry_days` ahead of
     * prepaid_expires_at.
     *
     * SMS only, like the lapse notice this precedes — see {@see notifyPrepaidExpiry()} for why
     * prepaid notices carry no email.
     *
     * Uses its own 'PrepaidPreExpiry' template so operations can word the early warning differently
     * from the lapse notice, and falls back to a built-in standardized message when that template is
     * missing or has been deactivated — see {@see generatePrepaidPreExpirySmsMessage()} — so a fresh
     * install that has not yet configured its templates still warns customers rather than silently
     * sending nothing.
     *
     * Never throws: failures come back in `errors` so one account cannot abort a batch scan.
     *
     * @param  Carbon       $expiresAt      the upcoming prepaid_expires_at, shown as the due date
     * @param  float        $renewalAmount  what settles the renewal, VAT/withholding applied
     * @param  string|null  $timeSent       when set, SMS goes to the queue instead of sending now
     * @return array{sms_sent: bool, sms_queued: bool, errors: array}
     */
    public function notifyPrepaidPreExpiry(
        BillingAccount $account,
        Carbon $expiresAt,
        float $renewalAmount,
        ?string $timeSent = null
    ): array {
        $results = [
            'sms_sent' => false,
            'sms_queued' => false,
            'errors' => []
        ];

        try {
            $customer = $account->customer;

            if (!$customer) {
                throw new \Exception("Customer not found for account {$account->account_no}");
            }

            if (empty($customer->contact_number_primary)) {
                $results['errors'][] = 'Customer has no phone number';
                Log::warning('Prepaid pre-expiry notice: customer has no phone number', [
                    'account_no' => $account->account_no
                ]);

                return $results;
            }

            $smsMessage = $this->generatePrepaidPreExpirySmsMessage($account, $expiresAt);

            if (!$smsMessage) {
                $results['errors'][] = 'No usable SMS template for the prepaid pre-expiry notice';

                return $results;
            }

            if (empty($timeSent)) {
                $smsResult = $this->smsService->send([
                    'contact_no' => $customer->contact_number_primary,
                    'message' => $smsMessage
                ]);
                $results['sms_sent'] = $smsResult['success'];

                if (!$smsResult['success']) {
                    $results['errors'][] = "SMS failed: " . ($smsResult['error'] ?? 'Unknown');
                }
            } else {
                $this->smsQueueService->queueSms([
                    'account_no' => $account->account_no,
                    'contact_no' => $customer->contact_number_primary,
                    'message' => $smsMessage,
                    'time_sent' => $timeSent
                ]);
                $results['sms_sent'] = true;
                $results['sms_queued'] = true;
            }

            Log::info('Prepaid pre-expiry notification completed', [
                'account_no' => $account->account_no,
                'expires_at' => $expiresAt->toDateTimeString(),
                'renewal_amount' => $renewalAmount,
                'sms_sent' => $results['sms_sent'],
                'sms_queued' => $results['sms_queued']
            ]);

        } catch (\Exception $e) {
            $results['errors'][] = $e->getMessage();
            Log::error('Prepaid pre-expiry notification failed', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
        }

        return $results;
    }

    /**
     * The standardized pre-expiry SMS body, used whenever no active 'PrepaidPreExpiry' template is
     * configured. Deliberately carries no price/amount placeholder — a pre-expiry warning is not a
     * bill, and account_no/plan_name/due_date are all that is needed to tell the customer their
     * plan is about to lapse.
     */
    protected const PREPAID_PRE_EXPIRY_SMS_TEMPLATE =
        'Dear {{customer_name}}, your prepaid plan ({{plan_name}}) for account {{account_no}} will expire on {{due_date}}. Renew early at sync.gowiser.ph to avoid service interruption.';

    /**
     * SMS body for the prepaid pre-expiry warning.
     *
     * Prefers the dedicated 'PrepaidPreExpiry' template and falls back to the standardized
     * {@see PREPAID_PRE_EXPIRY_SMS_TEMPLATE} when that template is missing or inactive, so this
     * warning never depends on the unrelated postpaid billing template set (and never needs a
     * renewal amount) to render.
     *
     * Only ever returns null on an unexpected exception — there is always a message to send.
     */
    protected function generatePrepaidPreExpirySmsMessage(
        BillingAccount $account,
        Carbon $expiresAt
    ): ?string {
        try {
            $customer = $account->customer;

            $template = DB::table('sms_templates')
                ->where('template_type', 'PrepaidPreExpiry')
                ->where('is_active', 1)
                ->first();

            $messageContent = $template?->message_content ?? self::PREPAID_PRE_EXPIRY_SMS_TEMPLATE;

            if (!$template) {
                Log::info('Prepaid pre-expiry SMS falling back to the built-in standardized template', [
                    'account_no' => $account->account_no
                ]);
            }

            $planName = $account->plan?->plan_name ?? $customer->desired_plan ?? 'N/A';
            $planNameFormatted = str_replace('₱', 'P', $planName);
            $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));

            $message = str_replace('{{customer_name}}', $customerName, $messageContent);
            $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
            $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
            $message = str_replace('{{account_no}}', $account->account_no, $message);
            $message = str_replace('{{due_date}}', $expiresAt->format('M d, Y'), $message);

            return $this->replaceGlobalVariables($message);
        } catch (\Exception $e) {
            Log::error('Failed to generate prepaid pre-expiry SMS message', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
            return null;
        }
    }

    public function notifyOverdue(Invoice $invoice): array
    {
        $results = [
            'email_queued' => false,
            'sms_sent' => false,
            'pdf_generated' => false,
            'errors' => []
        ];

        try {
            $account = $invoice->billingAccount;
            $customer = $account->customer;

            if (!$customer) {
                throw new \Exception("Customer not found for invoice {$invoice->id}");
            }

            $pdfUrl = null;
            $filename = null;
            

            if ($customer->email_address) {
                $emailData = $this->prepareEmailData($account, $invoice, null);
                
                $templateCode = config('billing.templates.overdue_email', 'OVERDUE_DESIGN');
                
                // Set the time to send at 8:00 AM GMT+8 (Asia/Manila)
                $timeSent = \Carbon\Carbon::now('Asia/Manila')->setTime(8, 0, 0)->format('Y-m-d H:i:s');
                
                // Prepare SMS Message for queueing
                $smsMessage = null;
                if ($customer->contact_number_primary) {
                    $smsMessage = $this->generateOverdueSmsMessage($account, $invoice);
                }

                $emailQueued = $this->emailQueueService->queueFromTemplate(
                    $templateCode,
                    array_merge($emailData, [
                        'recipient_email' => $customer->email_address,
                        'google_drive_url' => $pdfUrl,
                        'filename' => $filename,
                        'time_sent' => $timeSent
                    ])
                );
                
                if ($emailQueued === null) {
                    $results['errors'][] = "Email template '{$templateCode}' not found.";
                    Log::error("Overdue Email template '{$templateCode}' not found", ['account_no' => $account->account_no]);
                } else {
                    Log::info("Overdue Email queued successfully for 8 AM", ['account_no' => $account->account_no, 'recipient' => $customer->email_address]);
                }
                
                $results['email_queued'] = $emailQueued !== null;
            } else {
                Log::warning("Skipping Overdue Email: Customer has no email address", ['account_no' => $account->account_no]);
            }

            // SMS is now handled by the dedicated SMS queue
            if ($customer->contact_number_primary && $smsMessage) {
                $this->smsQueueService->queueSms([
                    'account_no' => $account->account_no,
                    'contact_no' => $customer->contact_number_primary,
                    'message' => $smsMessage,
                    'time_sent' => $timeSent
                ]);
                $results['sms_sent'] = true; 
            } else {
                Log::warning("Skipping Overdue SMS: Customer has no contact number", ['account_no' => $account->account_no]);
                $results['errors'][] = 'Customer has no phone number';
            }



        } catch (\Exception $e) {
            $results['errors'][] = $e->getMessage();
            Log::error('Overdue notification failed', [
                'invoice_id' => $invoice->id,
                'error' => $e->getMessage()
            ]);
        }

        return $results;
    }

    public function notifyDcNotice(Invoice $invoice): array
    {
        $results = [
            'email_queued' => false,
            'sms_sent' => false,
            'pdf_generated' => false,
            'errors' => []
        ];

        try {
            $account = $invoice->billingAccount;
            $customer = $account->customer;

            if (!$customer) {
                throw new \Exception("Customer not found for invoice {$invoice->id}");
            }

            $pdfUrl = null;
            $filename = null;
            

            if ($customer->email_address) {
                $emailData = $this->prepareEmailData($account, $invoice, null);
                
                $templateCode = config('billing.templates.dc_notice_email', 'DCNOTICE_DESIGN');
                
                // Set the time to send at 8:00 AM GMT+8 (Asia/Manila)
                $timeSent = \Carbon\Carbon::now('Asia/Manila')->setTime(8, 0, 0)->format('Y-m-d H:i:s');
                
                // Prepare SMS Message for queueing
                $smsMessage = null;
                if ($customer->contact_number_primary) {
                    $smsMessage = $this->generateDcNoticeSmsMessage($account, $invoice);
                }

                $emailQueued = $this->emailQueueService->queueFromTemplate(
                    $templateCode,
                    array_merge($emailData, [
                        'recipient_email' => $customer->email_address,
                        'google_drive_url' => $pdfUrl,
                        'filename' => $filename,
                        'time_sent' => $timeSent
                    ])
                );
                
                if ($emailQueued === null) {
                    $results['errors'][] = "Email template '{$templateCode}' not found.";
                    Log::error("DC Notice Email template '{$templateCode}' not found", ['account_no' => $account->account_no]);
                } else {
                    Log::info("DC Notice Email queued successfully for 8 AM", ['account_no' => $account->account_no, 'recipient' => $customer->email_address]);
                }
                
                $results['email_queued'] = $emailQueued !== null;
            } else {
                Log::warning("Skipping DC Notice Email: Customer has no email address", ['account_no' => $account->account_no]);
            }

            // SMS is now handled by the dedicated SMS queue
            if ($customer->contact_number_primary && $smsMessage) {
                $this->smsQueueService->queueSms([
                    'account_no' => $account->account_no,
                    'contact_no' => $customer->contact_number_primary,
                    'message' => $smsMessage,
                    'time_sent' => $timeSent
                ]);
                $results['sms_sent'] = true;
            } else {
                Log::warning("Skipping DC Notice SMS: Customer has no contact number", ['account_no' => $account->account_no]);
                $results['errors'][] = 'Customer has no phone number';
            }


        } catch (\Exception $e) {
            $results['errors'][] = $e->getMessage();
            Log::error('DC Notice notification failed', [
                'invoice_id' => $invoice->id,
                'error' => $e->getMessage()
            ]);
        }

        return $results;
    }
    protected function queueBillingEmail(
        BillingAccount $account,
        ?Invoice $invoice,
        ?StatementOfAccount $soa,
        array $pdfResult,
        ?string $timeSent = null
    ): bool {
        $customer = $account->customer;
        $tempPdfPath = null;

        try {
            // Prepaid accounts have no SOA/invoice to email — this path exists for postpaid
            // monthly billing only. Guards against a prepaid account reaching here by mistake
            // (e.g. an upstream caller failing to filter by generation_type) rather than
            // attempting a SOA/invoice template lookup that was never meant to apply to them.
            if (BillingAccount::isPrepaidType($account->generation_type)) {
                Log::info('Billing email skipped: prepaid account has no SOA/invoice to send', [
                    'account_no' => $account->account_no
                ]);
                return false;
            }

            // Determine Document Type and Template
            $templateCode = $soa
                ? config('billing.templates.soa_email', 'SOA_DESIGN_EMAIL')
                : config('billing.templates.invoice_email', 'INVOICE_DESIGN_EMAIL');
                
            // Prepare Data for Template
            $emailData = $this->prepareEmailData($account, $invoice, $soa);
            
            // Handle PDF Attachment (only if PDF was successfully generated)
            if (($pdfResult['success'] ?? false) && !empty($pdfResult['url'])) {
                if (config('billing.notifications.include_pdf_attachment', true)) {
                    $fileUrl = $pdfResult['url'];
                    preg_match('/\/d\/(.*?)\//', $fileUrl, $matches);
                    $fileId = $matches[1] ?? null;

                    if ($fileId) {
                        // This creates a temp file
                        $tempPdfPath = $this->pdfService->downloadPdfFromGoogleDrive($fileId);
                    }
                }
            }

            $emailQueued = $this->emailQueueService->queueFromTemplate(
                $templateCode,
                array_merge($emailData, [
                    'recipient_email' => $customer->email_address,
                    'google_drive_url' => $pdfResult['url'] ?? null,
                    'filename' => $pdfResult['filename'] ?? null,
                    'attachment_path' => $tempPdfPath, // Pass the temp path if it exists
                    'time_sent' => $timeSent
                ])
            );
            
            if ($emailQueued === null) {
                Log::error("Email template '{$templateCode}' not found for account {$account->account_no}");
                return false;
            }

            // DO NOT delete temp file here - let email processor delete it after sending
            // The temp file will be cleaned up by the email processor

            return true;
            
        } catch (\Exception $e) {
            Log::error('Failed to queue billing email', [
                'account_no' => $account->account_no,
                'error' => $e->getMessage()
            ]);
            
            if ($tempPdfPath && file_exists($tempPdfPath)) {
                unlink($tempPdfPath);
            }
            
            return false;
        }
    }

    protected function generateBillingSmsMessage(BillingAccount $account, ?Invoice $invoice, ?StatementOfAccount $soa): ?string
    {
        try {
            $customer = $account->customer;
            $template = DB::table('sms_templates')
                ->where('template_type', 'StatementofAccount')
                ->where('is_active', 1)
                ->first();
                
            if ($template) {
                $totalDue = $soa ? $soa->total_amount_due : $invoice->total_amount;
                $amountDue = $soa ? $soa->amount_due : $invoice->total_amount;
                $dueDate = $soa ? $soa->due_date : $invoice->due_date;
                $paymentLink = config('app.payment_link', 'https://sync.gowiser.ph');
                
                $message = $template->message_content;
                
                $planNameRaw = $account->plan ? $account->plan->plan_name : ($account->customer->desired_plan ?? 'N/A');
                $planNameFormatted = str_replace('₱', 'P', $planNameRaw);
                $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));

                $message = str_replace('{{customer_name}}', $customerName, $message);
                $message = str_replace('{{account_no}}', $account->account_no, $message);
                $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                $message = str_replace('{{amount_due}}', number_format($amountDue, 2), $message);
                $message = str_replace('{{total_amount}}', number_format($totalDue, 2), $message);
                $message = str_replace('{{total_due}}', number_format($totalDue, 2), $message);
                $message = str_replace('{{amount}}', number_format($amountDue, 2), $message);
                $message = str_replace('{{balance}}', number_format($totalDue, 2), $message);
                $message = str_replace('{{due_date}}', $dueDate->format('M d, Y'), $message);
                $message = str_replace('{{payment_link}}', $paymentLink, $message);
                
                $soaDateStr = $soa && $soa->statement_date ? $soa->statement_date->format('M d, Y') : date('M d, Y');
                $message = str_replace('{{soa_date}}', $soaDateStr, $message);
                $message = str_replace('{{soa_data}}', $soaDateStr, $message);
                
                return $this->replaceGlobalVariables($message);
            }
            
            Log::warning('SOA SMS Template not found or inactive', ['template_type' => 'SOA']);
            return null;
        } catch (\Exception $e) {
            Log::error('Failed to generate billing SMS message', [
                'error' => $e->getMessage(),
                'account_no' => $account->account_no
            ]);
            return null;
        }
    }

    protected function sendBillingSms(BillingAccount $account, ?Invoice $invoice, ?StatementOfAccount $soa): array
    {
        try {
            $customer = $account->customer;
            
            if ($customer && !empty($customer->contact_number_primary)) {
                $message = $this->generateBillingSmsMessage($account, $invoice, $soa);
                    
                if ($message) {
                    $result = $this->smsService->send([
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $message
                    ]);
                    
                    if ($result['success']) {
                        Log::info('Billing SMS sent', [
                            'account_no' => $account->account_no
                        ]);
                        return ['success' => true];
                    } else {
                        Log::error('Billing SMS Failed: ' . ($result['error'] ?? 'Unknown error'));
                        return ['success' => false, 'error' => $result['error'] ?? 'Unknown error'];
                    }
                } else {
                    Log::warning('Billing SMS Template not found or inactive');
                    return ['success' => false, 'error' => 'Template not found'];
                }
            } else {
                return ['success' => false, 'error' => 'No contact number'];
            }
        } catch (\Exception $e) {
            Log::error('Failed to send billing SMS: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    protected function generateOverdueSmsMessage(BillingAccount $account, Invoice $invoice): ?string
    {
        try {
            $customer = $account->customer;
            $template = DB::table('sms_templates')
                ->where('template_type', 'Overdue')
                ->where('is_active', 1)
                ->first();
                
            if ($template) {
                $message = $template->message_content;
                
                $planNameRaw = $account->plan ? $account->plan->plan_name : ($account->customer->desired_plan ?? 'N/A');
                $planNameFormatted = str_replace('₱', 'P', $planNameRaw);
                $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));

                $message = str_replace('{{customer_name}}', $customerName, $message);
                $message = str_replace('{{account_no}}', $account->account_no, $message);
                $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                $message = str_replace('{{amount_due}}', number_format($invoice->total_amount, 2), $message);
                $message = str_replace('{{amount}}', number_format($invoice->total_amount, 2), $message);
                $message = str_replace('{{balance}}', number_format($invoice->total_amount, 2), $message);
                $message = str_replace('{{due_date}}', $invoice->due_date->format('M d, Y'), $message);
                
                return $this->replaceGlobalVariables($message);
            }
            return null;
        } catch (\Exception $e) {
            Log::error('Failed to generate overdue SMS message: ' . $e->getMessage());
            return null;
        }
    }

    protected function sendOverdueSms(BillingAccount $account, Invoice $invoice): array
    {
        try {
            $customer = $account->customer;
            
            if ($customer && !empty($customer->contact_number_primary)) {
                $message = $this->generateOverdueSmsMessage($account, $invoice);
                    
                if ($message) {
                    $result = $this->smsService->send([
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $message
                    ]);
                    
                    if ($result['success']) {
                        Log::info('Overdue SMS sent', [
                            'account_no' => $account->account_no,
                            'invoice_id' => $invoice->id
                        ]);
                        return ['success' => true];
                    } else {
                        Log::error('Overdue SMS Failed: ' . ($result['error'] ?? 'Unknown error'));
                        return ['success' => false, 'error' => $result['error'] ?? 'Unknown error'];
                    }
                } else {
                    Log::warning('Overdue SMS Template not found or inactive');
                    return ['success' => false, 'error' => 'Template not found'];
                }
            } else {
                return ['success' => false, 'error' => 'No contact number'];
            }
        } catch (\Exception $e) {
            Log::error('Failed to send overdue SMS: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    protected function generateDcNoticeSmsMessage(BillingAccount $account, Invoice $invoice): ?string
    {
        try {
            $customer = $account->customer;
            $template = DB::table('sms_templates')
                ->where('template_type', 'DCNotice')
                ->where('is_active', 1)
                ->first();
                
            if ($template) {
                $dcDate = $invoice->due_date->copy()->addDays(4);
                $message = $template->message_content;
                
                $planNameRaw = $account->plan ? $account->plan->plan_name : ($account->customer->desired_plan ?? 'N/A');
                $planNameFormatted = str_replace('₱', 'P', $planNameRaw);
                $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));

                $message = str_replace('{{customer_name}}', $customerName, $message);
                $message = str_replace('{{account_no}}', $account->account_no, $message);
                $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                $message = str_replace('{{amount_due}}', number_format($invoice->total_amount, 2), $message);
                $message = str_replace('{{amount}}', number_format($invoice->total_amount, 2), $message);
                $message = str_replace('{{balance}}', number_format($invoice->total_amount, 2), $message);
                $message = str_replace('{{dc_date}}', $dcDate->format('M d, Y'), $message);
                $message = str_replace('{{due_date}}', $invoice->due_date->format('M d, Y'), $message);
                
                return $this->replaceGlobalVariables($message);
            }
            return null;
        } catch (\Exception $e) {
            Log::error('Failed to generate DC Notice SMS message: ' . $e->getMessage());
            return null;
        }
    }

    protected function sendDcNoticeSms(BillingAccount $account, Invoice $invoice): array
    {
        try {
            $customer = $account->customer;
            
            if ($customer && !empty($customer->contact_number_primary)) {
                $message = $this->generateDcNoticeSmsMessage($account, $invoice);
                    
                if ($message) {
                    $result = $this->smsService->send([
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $message
                    ]);
                    
                    if ($result['success']) {
                        Log::info('DC Notice SMS sent', [
                            'account_no' => $account->account_no,
                            'invoice_id' => $invoice->id
                        ]);
                        return ['success' => true];
                    } else {
                        Log::error('DC Notice SMS Failed: ' . ($result['error'] ?? 'Unknown error'));
                        return ['success' => false, 'error' => $result['error'] ?? 'Unknown error'];
                    }
                } else {
                    Log::warning('DC Notice SMS Template not found or inactive');
                    return ['success' => false, 'error' => 'Template not found'];
                }
            } else {
                return ['success' => false, 'error' => 'No contact number'];
            }
        } catch (\Exception $e) {
            Log::error('Failed to send DC Notice SMS: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    protected function prepareEmailData(
        BillingAccount $account,
        ?Invoice $invoice,
        ?StatementOfAccount $soa
    ): array {
        $customer = $account->customer;

        $totalDue = $soa ? $soa->total_amount_due : ($invoice ? $invoice->total_amount : 0);
        $amountDue = $soa ? $soa->amount_due : ($invoice ? $invoice->total_amount : 0);
        $dueDate = $soa ? $soa->due_date : ($invoice ? $invoice->due_date : now());
        
        $billingConfig = BillingConfig::first();
        $disconnectionDay = $billingConfig ? $billingConfig->disconnection_day : 4;
        $dcDate = $dueDate->copy()->addDays($disconnectionDay); 

        $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));
        $planFormatted = str_replace('₱', 'P', $customer->desired_plan ?? '');

        // Common Data
        $data = [
            'Full_Name' => $customerName,
            'Address' => $customer->address,
            'Contact_No' => $customer->contact_number_primary,
            'Email' => $customer->email_address,
            'Account_No' => $account->account_no,
            'Plan' => $planFormatted,
            'Due_Date' => $dueDate->format('F j Y'),
            'DC_Date' => $dcDate->format('F j Y'),
            'Total_Due' => number_format($totalDue ?? 0, 2),
            'Amount_Due' => number_format($amountDue ?? 0, 2),
            'amount' => number_format($amountDue ?? 0, 2),
            'amount_due' => number_format($amountDue ?? 0, 2),
            'balance' => number_format($totalDue ?? 0, 2),
            'account_no' => $account->account_no,
            'customer_name' => $customerName,
            'total_amount' => number_format($totalDue ?? 0, 2),
            'due_date' => $dueDate->format('F j Y'),
            'plan' => $planFormatted,
            'plan_name' => $planFormatted,
            'plan_nam' => $planFormatted,
            'contact_no' => $customer->contact_number_primary
        ];

        if ($soa) {
            $data['SOA_No'] = $soa->id ?? '';
            $data['Statement_Date'] = $soa->statement_date ? $soa->statement_date->format('F j Y') : '';
            $data['Prev_Balance'] = number_format($soa->balance_from_previous_bill ?? 0, 2);
            $data['Prev_Payment'] = number_format($soa->payment_received_previous ?? 0, 2);
            $data['Rem_Balance'] = number_format($soa->remaining_balance_previous ?? 0, 2);
            // Calculate Period Start and End based on SOA history
            $periodEnd = $soa->statement_date;
            
            // Find the SOA immediately preceding the current one for this account
            $previousSoa = StatementOfAccount::where('account_no', $account->account_no)
                ->where('id', '<', $soa->id)
                ->orderBy('id', 'desc')
                ->first();

            if ($previousSoa) {
                $periodStart = $previousSoa->statement_date;
            } else {
                // If this is the only/first SOA, use the customer's installation date
                $periodStart = $account->date_installed;
            }

            $data['Period_Start'] = $periodStart ? $periodStart->format('m/d/Y') : '-'; 
            $data['Period_End'] = $periodEnd ? $periodEnd->format('m/d/Y') : '-'; 
        } elseif ($invoice) {
             // Invoice specific data
            $data['SOA_No'] = $invoice->id ?? ''; // Or N/A
            $data['Statement_Date'] = $invoice->invoice_date ? $invoice->invoice_date->format('F j Y') : '';
            $data['Prev_Balance'] = '0.00';
            $data['Prev_Payment'] = number_format($invoice->received_payment ?? 0, 2);
            $data['Rem_Balance'] = number_format($invoice->invoice_balance ?? 0, 2);
            
            // For invoice, we can try to find the latest SOA to get a period
            $latestSoa = StatementOfAccount::where('account_no', $account->account_no)
                ->orderBy('id', 'desc')
                ->first();
                
            if ($latestSoa) {
                $data['Period_End'] = $latestSoa->statement_date->format('m/d/Y');
                $prevSoa = StatementOfAccount::where('account_no', $account->account_no)
                    ->where('id', '<', $latestSoa->id)
                    ->orderBy('id', 'desc')
                    ->first();
                $data['Period_Start'] = $prevSoa ? $prevSoa->statement_date->format('m/d/Y') : ($account->date_installed ? $account->date_installed->format('m/d/Y') : '-');
            } else {
                $data['Period_Start'] = '-';
                $data['Period_End'] = '-';
            }
        }

        $data['soa_date'] = $data['Statement_Date'] ?? '';
        $data['soa_data'] = $data['Statement_Date'] ?? '';

        return $data;
    }

    protected function updateSoaPdfLink(StatementOfAccount $soa, string $url): void
    {
        try {
            $soa->update(['print_link' => $url]);
        } catch (\Exception $e) {
            Log::warning('Failed to update SOA PDF link', [
                'soa_id' => $soa->id,
                'error' => $e->getMessage()
            ]);
        }
    }
    private function replaceGlobalVariables(string $message): string
    {
        $portalUrl = 'sync.gowiser.ph';
        $brandName = \DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

        $message = str_replace('{{portal_url}}', $portalUrl, $message);
        $message = str_replace('{{company_name}}', $brandName, $message);

        return $message;
    }
}



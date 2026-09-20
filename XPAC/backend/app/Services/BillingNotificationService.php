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
                $paymentLink = config('app.payment_link', 'https://sync.atssfiber.ph');
                
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
        $portalUrl = 'sync.atssfiber.ph';
        $brandName = \DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

        $message = str_replace('{{portal_url}}', $portalUrl, $message);
        $message = str_replace('{{company_name}}', $brandName, $message);

        return $message;
    }
}



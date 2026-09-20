<?php

namespace App\Http\Controllers;

use App\Services\BillingNotificationService;
use App\Services\EnhancedBillingGenerationServiceWithNotifications;
use App\Models\Invoice;
use App\Models\BillingAccount;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;
use App\Events\OverdueUpdated;
use App\Events\DCNoticeUpdated;
use App\Events\InvoiceUpdated;
use App\Events\SOAUpdated;

class BillingNotificationController extends Controller
{
    protected BillingNotificationService $notificationService;
    protected EnhancedBillingGenerationServiceWithNotifications $billingService;

    public function __construct(
        BillingNotificationService $notificationService,
        EnhancedBillingGenerationServiceWithNotifications $billingService
    ) {
        $this->notificationService = $notificationService;
        $this->billingService = $billingService;
    }

    public function generateWithNotifications(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'billing_day' => 'required|integer|min:1|max:31',
                'generation_date' => 'nullable|date'
            ]);

            $userId = $request->user()->id ?? 1;
            $generationDate = $validated['generation_date'] 
                ? Carbon::parse($validated['generation_date']) 
                : Carbon::now();

            $soaResults = $this->billingService->generateSOAForBillingDay(
                $validated['billing_day'],
                $generationDate,
                $userId
            );

            $invoiceResults = $this->billingService->generateInvoicesForBillingDay(
                $validated['billing_day'],
                $generationDate,
                $userId
            );

            $totalGenerated = $soaResults['success'] + $invoiceResults['success'];

            event(new InvoiceUpdated(['action' => 'generated_with_notifications', 'count' => $invoiceResults['success']]));
            event(new SOAUpdated(['action' => 'generated_with_notifications', 'count' => $soaResults['success']]));

            return response()->json([
                'success' => true,
                'message' => "Generated {$totalGenerated} billing records with notifications",
                'data' => [
                    'soa' => $soaResults,
                    'invoices' => $invoiceResults
                ]
            ]);

        } catch (\Exception $e) {
            Log::error('Error generating billings with notifications', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to generate billings',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function sendOverdueNotices(Request $request): JsonResponse
    {
        try {
            $daysOverdue = $request->input('days_overdue', 1);
            $targetDueDate = Carbon::now()->subDays($daysOverdue)->format('Y-m-d');

            $invoices = Invoice::where('due_date', $targetDueDate)
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->with('billingAccount.customer')
                ->get();

            $results = [
                'success' => 0,
                'failed' => 0,
                'errors' => []
            ];

            foreach ($invoices as $invoice) {
                try {
                    $notificationResult = $this->notificationService->notifyOverdue($invoice);
                    
                    if (!empty($notificationResult['errors'])) {
                        $results['failed']++;
                        $results['errors'][] = [
                            'invoice_id' => $invoice->id,
                            'errors' => $notificationResult['errors']
                        ];
                    } else {
                        $results['success']++;
                    }
                } catch (\Exception $e) {
                    $results['failed']++;
                    $results['errors'][] = [
                        'invoice_id' => $invoice->id,
                        'error' => $e->getMessage()
                    ];
                }
            }

            event(new OverdueUpdated(['action' => 'notices_sent', 'count' => $results['success']]));

            return response()->json([
                'success' => true,
                'message' => "Processed {$results['success']} overdue notices",
                'data' => $results
            ]);

        } catch (\Exception $e) {
            Log::error('Error sending overdue notices', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to send overdue notices',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function sendDcNotices(Request $request): JsonResponse
    {
        try {
            $daysBeforeDc = $request->input('days_before_dc', 3);
            $targetDueDate = Carbon::now()->subDays($daysBeforeDc)->format('Y-m-d');

            $invoices = Invoice::where('due_date', $targetDueDate)
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->with('billingAccount.customer')
                ->get();

            $results = [
                'success' => 0,
                'failed' => 0,
                'errors' => []
            ];

            foreach ($invoices as $invoice) {
                try {
                    $notificationResult = $this->notificationService->notifyDcNotice($invoice);
                    
                    if (!empty($notificationResult['errors'])) {
                        $results['failed']++;
                        $results['errors'][] = [
                            'invoice_id' => $invoice->id,
                            'errors' => $notificationResult['errors']
                        ];
                    } else {
                        $results['success']++;
                    }
                } catch (\Exception $e) {
                    $results['failed']++;
                    $results['errors'][] = [
                        'invoice_id' => $invoice->id,
                        'error' => $e->getMessage()
                    ];
                }
            }

            event(new DCNoticeUpdated(['action' => 'notices_sent', 'count' => $results['success']]));

            return response()->json([
                'success' => true,
                'message' => "Processed {$results['success']} DC notices",
                'data' => $results
            ]);

        } catch (\Exception $e) {
            Log::error('Error sending DC notices', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to send DC notices',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function testNotification(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|string|exists:billing_accounts,account_no'
            ]);

            $account = BillingAccount::where('account_no', $validated['account_no'])
                ->with('customer', 'technicalDetails')
                ->firstOrFail();

            $latestInvoice = Invoice::where('account_no', $account->account_no)
                ->latest('invoice_date')
                ->first();

            if (!$latestInvoice) {
                return response()->json([
                    'success' => false,
                    'message' => 'No invoice found for this account'
                ], 404);
            }

            $result = $this->notificationService->notifyBillingGenerated(
                $account,
                $latestInvoice,
                null
            );

            return response()->json([
                'success' => true,
                'message' => 'Test notification sent',
                'data' => $result
            ]);

        } catch (\Exception $e) {
            Log::error('Error sending test notification', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to send test notification',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function retryFailedNotifications(Request $request): JsonResponse
    {
        try {
            $failedEmails = \App\Models\EmailQueue::where('status', 'failed')
                ->where('attempts', '<', 3)
                ->limit(50)
                ->get();

            $results = [
                'retried' => 0,
                'success' => 0,
                'failed' => 0
            ];

            foreach ($failedEmails as $email) {
                $email->resetToPending();
                $results['retried']++;
            }

            return response()->json([
                'success' => true,
                'message' => "Queued {$results['retried']} failed emails for retry",
                'data' => $results
            ]);

        } catch (\Exception $e) {
            Log::error('Error retrying failed notifications', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to retry notifications',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

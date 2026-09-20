<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\BillingNotificationService;
use App\Models\Invoice;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class SendOverdueNotices extends Command
{
    protected $signature = 'billing:send-overdue {--days=1 : Days overdue}';
    protected $description = 'Send overdue notices for unpaid invoices';

    protected BillingNotificationService $notificationService;

    public function __construct(BillingNotificationService $notificationService)
    {
        parent::__construct();
        $this->notificationService = $notificationService;
    }

    public function handle()
    {
        $daysOverdue = $this->option('days');
        $targetDueDate = Carbon::now()->subDays($daysOverdue)->format('Y-m-d');

        $this->info("Sending overdue notices for invoices due on: {$targetDueDate}");
        Log::info('Overdue notices job started', ['target_due_date' => $targetDueDate]);

        try {
            $invoices = Invoice::where('due_date', $targetDueDate)
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->with('billingAccount.customer')
                ->get();

            $this->info("Found {$invoices->count()} overdue invoices");

            $results = [
                'success' => 0,
                'failed' => 0
            ];

            foreach ($invoices as $invoice) {
                try {
                    $notificationResult = $this->notificationService->notifyOverdue($invoice);
                    
                    if (empty($notificationResult['errors'])) {
                        $results['success']++;
                        $this->line("✓ Sent overdue notice for invoice #{$invoice->id}");
                    } else {
                        $results['failed']++;
                        $this->error("✗ Failed to send overdue notice for invoice #{$invoice->id}");
                    }
                } catch (\Exception $e) {
                    $results['failed']++;
                    $this->error("✗ Error processing invoice #{$invoice->id}: " . $e->getMessage());
                }
            }

            Log::info('Overdue notices job completed', $results);

            $this->info("Overdue notices completed:");
            $this->info("  Success: {$results['success']}");
            $this->info("  Failed: {$results['failed']}");

            return 0;

        } catch (\Exception $e) {
            $this->error('Failed to send overdue notices: ' . $e->getMessage());
            Log::error('Overdue notices job failed', [
                'error' => $e->getMessage()
            ]);

            return 1;
        }
    }
}

<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\BillingNotificationService;
use App\Models\Invoice;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class SendDcNotices extends Command
{
    protected $signature = 'billing:send-dc-notices {--days=3 : Days before disconnection}';
    protected $description = 'Send disconnection notices for unpaid invoices';

    protected BillingNotificationService $notificationService;

    public function __construct(BillingNotificationService $notificationService)
    {
        parent::__construct();
        $this->notificationService = $notificationService;
    }

    public function handle()
    {
        $daysBeforeDc = $this->option('days');
        $targetDueDate = Carbon::now()->subDays($daysBeforeDc)->format('Y-m-d');

        $this->info("Sending DC notices for invoices due on: {$targetDueDate}");
        Log::info('DC notices job started', ['target_due_date' => $targetDueDate]);

        try {
            $invoices = Invoice::where('due_date', $targetDueDate)
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->with('billingAccount.customer')
                ->get();

            $this->info("Found {$invoices->count()} invoices for DC notice");

            $results = [
                'success' => 0,
                'failed' => 0
            ];

            foreach ($invoices as $invoice) {
                try {
                    $notificationResult = $this->notificationService->notifyDcNotice($invoice);
                    
                    if (empty($notificationResult['errors'])) {
                        $results['success']++;
                        $this->line("✓ Sent DC notice for invoice #{$invoice->id}");
                    } else {
                        $results['failed']++;
                        $this->error("✗ Failed to send DC notice for invoice #{$invoice->id}");
                    }
                } catch (\Exception $e) {
                    $results['failed']++;
                    $this->error("✗ Error processing invoice #{$invoice->id}: " . $e->getMessage());
                }
            }

            Log::info('DC notices job completed', $results);

            $this->info("DC notices completed:");
            $this->info("  Success: {$results['success']}");
            $this->info("  Failed: {$results['failed']}");

            return 0;

        } catch (\Exception $e) {
            $this->error('Failed to send DC notices: ' . $e->getMessage());
            Log::error('DC notices job failed', [
                'error' => $e->getMessage()
            ]);

            return 1;
        }
    }
}

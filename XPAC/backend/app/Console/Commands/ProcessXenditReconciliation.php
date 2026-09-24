<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\XenditReconciliationService;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Re-checks every payment we created but never saw settle.
 *
 * Safe to run as often as you like and safe to run twice at once. Each pass
 * only touches rows whose next_reconciliation_at has come due, and the one
 * action it can take — moving PENDING to QUEUED — is taken under
 * lockForUpdate() with the status re-read inside the lock. A row already moved
 * by the webhook is left alone, and posting itself is the payment worker's job,
 * so nothing here can double-credit an account.
 */
class ProcessXenditReconciliation extends Command
{
    protected $signature = 'cron:reconcile-xendit-payments';

    protected $description = 'Verify pending Xendit payments directly against the gateway, independent of webhooks';

    private XenditReconciliationService $reconciliation;

    public function __construct(XenditReconciliationService $reconciliation)
    {
        parent::__construct();
        $this->reconciliation = $reconciliation;
    }

    public function handle(): int
    {
        $this->info('===========================================');
        $this->info('Xendit Reconciliation Started: ' . now()->format('Y-m-d H:i:s'));
        $this->info('===========================================');

        try {
            $result = $this->reconciliation->reconcilePending();
        } catch (Throwable $e) {
            // The service already logged the detail to its own channel; this is
            // what makes the failure visible to whatever runs the schedule.
            Log::error('Xendit reconciliation command failed', ['error' => $e->getMessage()]);
            $this->error('Reconciliation failed: ' . $e->getMessage());
            return 1;
        }

        $this->newLine();
        $this->line("  Resolved:  {$result['success']}");
        $this->line("  Skipped:   {$result['skipped']}");
        $this->line("  Failed:    {$result['failed']}");

        foreach ($result['payments'] as $payment) {
            $this->line("    {$payment['reference_no']} => {$payment['outcome']}");
        }

        if (!empty($result['errors'])) {
            $this->newLine();
            $this->warn('Errors:');
            foreach ($result['errors'] as $error) {
                $this->warn('  ' . (is_array($error) ? ($error['reference_no'] . ': ' . $error['error']) : $error));
            }
        }

        $this->newLine();
        $this->info('===========================================');
        $this->info('Xendit Reconciliation Completed: ' . now()->format('Y-m-d H:i:s'));
        $this->info('===========================================');

        // A per-item failure is a reported outcome, not a failed run. Only a
        // total inability to sweep returns non-zero.
        return 0;
    }
}

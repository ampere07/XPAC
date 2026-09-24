<?php

namespace App\Console\Commands;

use App\Services\PrepaidPlanChangeService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Applies prepaid plan changes whose queued effective date has arrived.
 *
 * When a prepaid customer buys a different plan while still inside a period they already paid
 * for, the switch is held on billing_accounts.pending_plan_id / pending_plan_effective_at
 * (see PrepaidPlanChangeService). This command is what actually flips them over once that
 * period lapses.
 *
 * Scheduled hourly rather than daily: prepaid_expires_at carries a time-of-day, so an account
 * that lapses at 14:30 should switch that afternoon, not at the next midnight run.
 */
class ApplyPendingPrepaidPlans extends Command
{
    protected $signature = 'prepaid:apply-pending-plans';

    protected $description = 'Apply prepaid plan changes queued for accounts whose prepaid period has lapsed';

    public function handle(PrepaidPlanChangeService $service): int
    {
        // The service already writes a full banner/per-account trail to
        // storage/logs/prepaidplan/prepaid_plan_change.log and echoes it to stdout, so suppress
        // that echo here and render the roster as a table instead of printing everything twice.
        $results = $service->setCliEcho(false)->applyDuePendingPlans();

        $this->newLine();
        $this->info("Due: {$results['due']}   Applied: {$results['applied']}   Failed: {$results['failed']}");

        if (!empty($results['accounts'])) {
            $this->newLine();
            $this->info('Accounts updated:');
            $this->table(
                ['Account No', 'Customer', 'From', 'To', 'Scheduled For', 'RADIUS'],
                array_map(fn($row) => [
                    $row['account_no'],
                    $row['customer'] ?? '—',
                    $row['from_plan'],
                    $row['to_plan'],
                    $row['effective_at'],
                    $row['radius'],
                ], $results['accounts'])
            );
        }

        if (!empty($results['errors'])) {
            $this->newLine();
            $this->error('Accounts that failed:');
            foreach ($results['errors'] as $error) {
                $this->error("  {$error['account_no']}: {$error['error']}");
            }
        }

        $this->newLine();
        $this->line('Full log: storage/logs/prepaidplan/prepaid_plan_change.log');

        Log::info('[PREPAID PLAN] apply-pending-plans run complete', [
            'due' => $results['due'],
            'applied' => $results['applied'],
            'failed' => $results['failed'],
            'accounts' => array_column($results['accounts'], 'account_no'),
        ]);

        // Individual account failures are logged and reported but must not fail the scheduled
        // run — the next hour retries them.
        return self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use App\Services\AgentIncentiveService;

/**
 * Entry point for the agent quota incentive cron.
 *
 * IMPORTANT: this command is intentionally NOT registered on any schedule.
 * Configure when/how often it runs yourself (system crontab, scheduler, etc.):
 *
 *     php artisan cron:process-agent-incentives
 */
class ProcessAgentIncentives extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'cron:process-agent-incentives';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Award quota-based incentives to agents who reached their quota (idempotent).';

    /**
     * Execute the console command.
     */
    public function handle(AgentIncentiveService $service): int
    {
        $this->info('[AGENT INCENTIVES CRON] Starting...');

        try {
            $results = $service->process();
        } catch (\Throwable $e) {
            $this->error('[AGENT INCENTIVES CRON] Fatal error: ' . $e->getMessage());
            Log::channel('single')->error('[AGENT INCENTIVES CRON] Fatal error: ' . $e->getMessage(), [
                'trace' => $e->getTraceAsString(),
            ]);
            return self::FAILURE;
        }

        $this->info(sprintf(
            '[AGENT INCENTIVES CRON] Done — Evaluated: %d, Awarded: %d, Cycles: %d, Amount: %s, Job Orders Recorded: %d, Carried (unfinished quotas): %d, Agents Skipped: %d, Job Orders Skipped: %d, Errors: %d',
            $results['agents_processed'],
            $results['agents_awarded'],
            $results['incentive_awards'],
            number_format($results['amount_awarded'], 2),
            $results['job_orders_recorded'],
            $results['job_orders_carried'] ?? 0,
            $results['skipped'],
            $results['skipped_job_orders'],
            $results['errors']
        ));

        Log::channel('single')->info('[AGENT INCENTIVES CRON] Run completed', $results);

        return self::SUCCESS;
    }
}

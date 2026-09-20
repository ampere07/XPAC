<?php

namespace App\Console\Commands;

use App\Services\SmartOltReconciliationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * The background driver for the Tools suite.
 *
 * A tool job used to advance only while the operator's tab stayed open: the browser
 * polled process-job in a loop and each response applied one slice. Closing the tab,
 * losing the VPN or letting a laptop sleep therefore stopped a four-thousand-ONU
 * sweep wherever it happened to be, and it stayed stopped until someone reopened the
 * page. This command removes the browser from that path. It runs every minute, takes
 * the claim on whatever is live in `tool_jobs`, and steps it until it finishes, parks
 * on a SmartOLT quota stop, or the pass runs out of budget.
 *
 * The tool now only *starts* jobs and *polls* their progress. A sync kicked off at
 * 17:00 finishes overnight on its own, and reopening the page reattaches to whatever
 * state the sweep has reached.
 *
 * Why this and not a queue worker. `QUEUE_CONNECTION` on this deployment is `sync`,
 * so a dispatched job would run inline in the request that dispatched it — exactly
 * the browser-bound behaviour being fixed here — and there is no supervised worker to
 * change it to. The scheduler already runs on this host and drives every other sweep
 * in the system, so the job tier rides on it too.
 *
 * Safe to run repeatedly, and safe to overlap with an operator who still has the tool
 * open. It starts no work of its own; it only advances rows another caller created.
 * Each job is claimed with a conditional UPDATE before a step is applied, so a drain
 * pass and an open tab can never both run the same queue index — and every step is
 * checkpointed by index, so a pass killed mid-slice resumes rather than replays.
 * withoutOverlapping() on the schedule keeps two passes off the same estate; the
 * claim is what protects against everything the schedule cannot see.
 */
class DrainToolJobsCron extends Command
{
    protected $signature = 'cron:tool-jobs-drain
                            {--budget=50 : Seconds this pass may spend before it stops and lets the next one continue}
                            {--job= : Drive only this job id, for investigating one stuck sweep}';

    protected $description = 'Advance queued Tools background jobs so they run without an open browser tab';

    public function __construct(private SmartOltReconciliationService $service)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $log     = $this->channel();
        $started = microtime(true);

        // Kept under the one-minute schedule interval so consecutive passes do not
        // queue up behind each other; a job needing longer resumes on the next pass.
        $budget = max(5, min(300, (int) $this->option('budget')));
        $only   = $this->option('job') !== null ? (int) $this->option('job') : null;

        $log->info('=== Tool job drain started ===', [
            'timestamp' => now()->toDateTimeString(),
            'config'    => ['budget_seconds' => $budget, 'job_id' => $only],
        ]);

        try {
            $result = $only !== null
                ? $this->driveOne($only, $log)
                : $this->service->driveJobs(null, $budget);
        } catch (Throwable $e) {
            $log->error('Tool job drain failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            Log::error('cron:tool-jobs-drain failed', ['error' => $e->getMessage()]);

            $this->error('Drain failed: ' . $e->getMessage());

            return Command::FAILURE;
        }

        $this->report($result, $log, $started);

        // A job that failed is a reported outcome, not a failed run: the schedule must
        // not start alerting because one sweep out of several hit a bad ONU.
        return Command::SUCCESS;
    }

    /**
     * Drive a single job id, for the --job investigation path.
     *
     * @return array{success:int,failed:int,skipped:int,errors:array<int,mixed>,jobs:array<int,array<string,mixed>>}
     */
    private function driveOne(int $jobId, LoggerInterface $log): array
    {
        $result  = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'jobs' => []];
        $outcome = $this->service->processJob($jobId);
        $job     = $outcome['job'] ?? null;

        if (!is_array($job)) {
            $result['failed']++;
            $result['errors'][] = ['job_id' => $jobId, 'error' => $outcome['message'] ?? 'The job could not be read.'];
            $log->error('Targeted drive could not read the job.', ['job_id' => $jobId]);

            return $result;
        }

        // A skipped outcome means the claim was held elsewhere: reported, not retried,
        // because whoever holds it is already advancing this job.
        if (($outcome['skipped'] ?? false) === true) {
            $result['skipped']++;
        } elseif ($job['status'] === SmartOltReconciliationService::STATUS_FAILED) {
            $result['failed']++;
            $result['errors'][] = ['job_id' => $jobId, 'error' => $job['message']];
        } else {
            $result['success']++;
        }

        $result['jobs'][] = [
            'job_id'  => $jobId,
            'type'    => $job['type'],
            'status'  => $job['status'],
            'current' => $job['current'],
            'total'   => $job['total'],
            'steps'   => 1,
        ];

        return $result;
    }

    /**
     * @param array{success:int,failed:int,skipped:int,errors:array<int,mixed>,jobs:array<int,array<string,mixed>>} $result
     */
    private function report(array $result, LoggerInterface $log, float $started): void
    {
        $duration = round(microtime(true) - $started, 2);

        // Nothing live is the ordinary case, minute to minute. It is logged at debug
        // so the file stays a record of real work rather than 1,440 idle banners.
        if ($result['jobs'] === []) {
            $log->debug('=== Tool job drain completed: nothing live ===', ['duration_seconds' => $duration]);
            $this->info('No live jobs. (' . $duration . 's)');

            return;
        }

        foreach ($result['jobs'] as $job) {
            $line = sprintf(
                '  [#%d %s] %s %d/%d after %d step(s)',
                $job['job_id'],
                $job['type'],
                $job['status'],
                $job['current'],
                $job['total'],
                $job['steps']
            );

            $this->line($line);
            $log->info('Job advanced.', $job);
        }

        if (!empty($result['errors'])) {
            $this->newLine();
            $this->warn('Errors:');
            foreach ($result['errors'] as $error) {
                $this->warn('  ' . (is_array($error) ? json_encode($error) : $error));
            }
        }

        $log->info('=== Tool job drain completed ===', [
            'advanced'         => $result['success'],
            'skipped'          => $result['skipped'],
            'failed'           => $result['failed'],
            'errors'           => $result['errors'],
            'duration_seconds' => $duration,
        ]);

        $this->newLine();
        $this->info(sprintf(
            'Advanced %d, skipped %d, failed %d in %ss',
            $result['success'],
            $result['skipped'],
            $result['failed'],
            $duration
        ));
    }

    /**
     * Dedicated log file, matching the cron channel pattern used by the other sweeps:
     * a run must be reconstructable from this file alone.
     */
    private function channel(): LoggerInterface
    {
        try {
            $path = storage_path('logs/smartolt');
            if (!file_exists($path)) {
                mkdir($path, 0755, true);
            }

            return Log::build([
                'driver' => 'single',
                'path'   => $path . '/tool-jobs.log',
            ]);
        } catch (Throwable $e) {
            // An unwritable log directory must not stop the drain.
            return Log::channel('stack');
        }
    }
}

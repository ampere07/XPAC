<?php

namespace App\Console\Commands;

use App\Services\RadiusReconciliationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * The unattended nightly RADIUS pass.
 *
 * Audits every configured User Manager device against `billing_accounts` +
 * `technical_details`, then closes the three gaps that are safe to close without an
 * operator watching:
 *
 *   1. A PPPoE password the billing database never received is adopted from the
 *      device. Only when billing holds nothing — a password that differs on both
 *      sides is a real conflict and is left for a human, because the device could
 *      be the stale copy and overwriting billing would erase what the technician
 *      actually configured.
 *   2. A plan-group disagreement is settled in favour of whichever side is
 *      nominated as authoritative (--authority=billing pushes the plan onto the
 *      device; --authority=radius adopts the device's group as the plan label).
 *   3. An account billing has written off keeps its service withheld on the device.
 *
 * Deliberately not automated: creating a RADIUS account that does not exist,
 * deleting one with no billing record, and resolving a cross-server duplicate. Each
 * provisions or removes service on a judgement call and stays in the operator's
 * tool, where a person sees it first.
 *
 * Safe to run twice. Every mutation compares current state before writing and
 * reports `skipped` when the two sides already agree, so a second run the same
 * night ends with nothing applied and nothing failed. No queue entry is created and
 * no record is inserted, so a re-run cannot duplicate either.
 */
class RadiusReconcileDailyCron extends Command
{
    protected $signature = 'cron:radius-reconcile-daily
                            {--server= : A radius_config id to target, or omit for every device}
                            {--authority=billing : Which side wins a plan-group disagreement — billing or radius}
                            {--no-passwords : Skip adopting missing PPPoE passwords}
                            {--no-groups : Skip plan-group reconciliation}
                            {--no-restrict : Skip enforcing restriction on written-off accounts}
                            {--dry-run : Report what would change without writing anything}';

    protected $description = 'Reconcile MikroTik RADIUS accounts against billing: adopt missing passwords, settle plan groups, enforce restrictions';

    public function __construct(private RadiusReconciliationService $service)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $log     = $this->channel();
        $started = microtime(true);

        $authority = strtolower((string) $this->option('authority'));

        if (!in_array($authority, [RadiusReconciliationService::AUTHORITY_BILLING, RadiusReconciliationService::AUTHORITY_RADIUS], true)) {
            $this->error("Unknown --authority '{$authority}'. Use 'billing' or 'radius'.");

            return Command::FAILURE;
        }

        $options = [
            'authority'          => $authority,
            'sync_passwords'     => !$this->option('no-passwords'),
            'reconcile_groups'   => !$this->option('no-groups'),
            'enforce_restricted' => !$this->option('no-restrict'),
            'dry_run'            => (bool) $this->option('dry-run'),
            'server_id'          => $this->option('server') !== null ? (string) $this->option('server') : null,
        ];

        $this->info('===========================================');
        $this->info('RADIUS Daily Reconciliation: ' . now()->format('Y-m-d H:i:s'));
        $this->info('===========================================');

        $log->info('=== RADIUS daily reconciliation started ===', [
            'timestamp' => now()->toDateTimeString(),
            'config'    => $options,
        ]);

        try {
            $result = $this->service->runDailyReconciliation($options);
        } catch (Throwable $e) {
            $log->error('RADIUS daily reconciliation failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            Log::error('cron:radius-reconcile-daily failed', ['error' => $e->getMessage()]);

            $this->error('Reconciliation failed: ' . $e->getMessage());

            return Command::FAILURE;
        }

        $duration = round(microtime(true) - $started, 2);

        $this->newLine();
        $this->line("  Applied:  {$result['success']}");
        $this->line("  Skipped:  {$result['skipped']}");
        $this->line("  Failed:   {$result['failed']}");

        $summary = $result['summary'];
        $this->newLine();
        $this->line('  Estate: ' . ($summary['total'] ?? 0) . ' RADIUS account(s) across ' . ($summary['servers'] ?? 0) . ' device(s)');
        $this->line('          ' . ($summary['group_mismatch'] ?? 0) . ' group mismatch, '
            . ($summary['password_mismatch'] ?? 0) . ' password mismatch, '
            . ($summary['orphan_radius'] ?? 0) . ' rogue, '
            . ($summary['missing_radius'] ?? 0) . ' missing, '
            . ($summary['synced'] ?? 0) . ' in sync');

        foreach ($result['actions'] as $action) {
            $this->line("    {$action['username']} => {$action['action']} ({$action['outcome']})");
        }

        if (!empty($result['errors'])) {
            $this->newLine();
            $this->warn('Errors:');
            foreach ($result['errors'] as $error) {
                $this->warn('  ' . (is_array($error) ? json_encode($error) : $error));
            }
        }

        $log->info('=== RADIUS daily reconciliation completed ===', [
            'applied'          => $result['success'],
            'skipped'          => $result['skipped'],
            'failed'           => $result['failed'],
            'summary'          => $summary,
            'errors'           => $result['errors'],
            'duration_seconds' => $duration,
        ]);

        $this->newLine();
        $this->info('Completed in ' . $duration . 's');

        // Per-account failures are reported outcomes, not a failed run.
        return Command::SUCCESS;
    }

    /**
     * Dedicated log file, matching the cron channel pattern used by the other sweeps.
     */
    private function channel(): LoggerInterface
    {
        try {
            $path = storage_path('logs/radiusreconcile');
            if (!file_exists($path)) {
                mkdir($path, 0755, true);
            }

            return Log::build([
                'driver' => 'single',
                'path'   => $path . '/daily-reconcile.log',
            ]);
        } catch (Throwable $e) {
            return Log::channel('stack');
        }
    }
}

<?php

namespace App\Console\Commands;

use App\Models\Report;
use App\Services\ReportDispatchService;
use App\Support\ReportSettings;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class QueueScheduledReports extends Command
{
    protected $signature = 'reports:queue
                            {--report= : Dispatch only this report ID}
                            {--now= : Evaluate as if it were this time, e.g. "2026-07-30 17:40" (dry-run aid)}
                            {--dry-run : Report what would be dispatched without queueing anything}
                            {--force : Ignore the duplicate ledger and the Auto Send Report switch, and dispatch anyway (manual occurrence)}
                            {--no-cleanup : Skip the stale-attachment sweep}
                            {--no-lock : Run even if another instance holds the lock (diagnostics only)}';

    protected $description = 'Queue scheduled reports (PDF attached) into the email queue, exactly once per occurrence';

    /** Seconds a single run may hold the lock before it is considered dead. */
    private const LOCK_TTL = 600;

    /**
     * Self-contained overlap protection.
     *
     * Kernel.php declares ->withoutOverlapping(), but that only applies when the
     * scheduler (`schedule:run`) invokes the command. This deployment calls
     * `php artisan reports:queue` straight from crontab, where that guard does not
     * exist — so the lock lives in the command instead and protects both styles.
     *
     * Overlap is already safe from a correctness standpoint: report_dispatches has
     * a UNIQUE (report_id, occurrence_key) index, so a concurrent run cannot send
     * a duplicate email. This lock exists to stop two runs burning CPU rendering
     * the same PDFs, which matters because a large report takes several seconds
     * and the cron fires every minute.
     */
    public function handle(ReportDispatchService $dispatcher): int
    {
        if ($this->option('no-lock')) {
            return $this->run_($dispatcher);
        }

        $lock = Cache::lock('reports:queue', self::LOCK_TTL);

        if (!$lock->get()) {
            $this->info('Another reports:queue run is still in progress; exiting.');
            $dispatcher->logger()->info('Skipped run: lock held by another process.');

            // SUCCESS, not FAILURE: being already-running is normal and must not
            // spam cron mail or trip monitoring.
            return Command::SUCCESS;
        }

        try {
            return $this->run_($dispatcher);
        } finally {
            $lock->release();
        }
    }

    private function run_(ReportDispatchService $dispatcher): int
    {
        $logger   = $dispatcher->logger();
        $timezone = (string) config('reports.timezone', 'Asia/Manila');

        $now = $this->option('now')
            ? Carbon::parse($this->option('now'), $timezone)
            : Carbon::now($timezone);

        $dryRun = (bool) $this->option('dry-run');
        $force  = (bool) $this->option('force');

        $logger->info('--- reports:queue run started ---', [
            'now'      => $now->toDateTimeString(),
            'timezone' => $timezone,
            'dry_run'  => $dryRun,
            'force'    => $force,
        ]);

        // Master switch, toggled from the Reports page. --force is the operator
        // override: it already means "this is a deliberate manual send".
        if (!$force && !ReportSettings::autoSendEnabled()) {
            $logger->info('Automatic report sending is disabled; no reports processed.');
            $this->info('Auto Send Report is disabled. Skipping all scheduled reports.');

            // Housekeeping still runs: orphaned attachments are not "sending".
            $this->sweep($dispatcher);

            return Command::SUCCESS;
        }

        $due = $dispatcher->dueReports($now);

        if ($reportId = $this->option('report')) {
            $due = array_values(array_filter($due, fn ($d) => (int) $d['report']->id === (int) $reportId));

            // An explicit --report is an operator asking for THIS report; if its
            // schedule is not due right now, fall back to a manual occurrence so
            // the command is usable for verification and re-sends.
            if ($due === [] && $force) {
                $report = Report::find($reportId);
                if ($report) {
                    $due = [['report' => $report, 'occurrence' => $now, 'minutes_late' => 0]];
                }
            }
        }

        if ($due === []) {
            $logger->info('No reports due.', ['now' => $now->toDateTimeString()]);
            $this->info("No reports due at {$now->format('Y-m-d H:i')} ({$timezone}).");

            $this->sweep($dispatcher);

            return Command::SUCCESS;
        }

        $this->line("Due at {$now->format('Y-m-d H:i')} ({$timezone}): " . count($due) . ' report(s)');

        $stats = ['queued' => 0, 'emails' => 0, 'duplicate' => 0, 'failed' => 0, 'skipped' => 0];

        foreach ($due as $item) {
            /** @var Report $report */
            $report     = $item['report'];
            $occurrence = $item['occurrence'];
            $label      = "#{$report->id} \"{$report->report_name}\" ({$report->report_type})";

            if ($item['minutes_late'] > 1) {
                $logger->notice('Dispatching a late occurrence (catch-up window)', [
                    'report_id'    => $report->id,
                    'scheduled_at' => $occurrence->toDateTimeString(),
                    'minutes_late' => $item['minutes_late'],
                ]);
            }

            if ($dryRun) {
                $stats['skipped']++;
                $this->line(sprintf(
                    '  [dry-run] %s → %s | scheduled %s%s',
                    $label,
                    implode(', ', $report->recipients()) ?: '(no valid recipients)',
                    $occurrence->format('Y-m-d H:i'),
                    $item['minutes_late'] > 1 ? " ({$item['minutes_late']}m late)" : ''
                ));
                continue;
            }

            try {
                $result = $dispatcher->dispatch($report, $occurrence, $force ? 'manual' : 'schedule');
            } catch (\Throwable $e) {
                $stats['failed']++;
                $logger->error('Unhandled error while dispatching report', [
                    'report_id' => $report->id,
                    'error'     => $e->getMessage(),
                    'file'      => $e->getFile() . ':' . $e->getLine(),
                ]);
                $this->error("  {$label} → unhandled error: {$e->getMessage()}");
                continue;
            }

            switch ($result['status']) {
                case 'queued':
                case 'partial':
                    $stats['queued']++;
                    $stats['emails'] += $result['queued'];
                    $this->info("  {$label} → {$result['message']}");
                    break;

                case 'duplicate':
                    $stats['duplicate']++;
                    $this->line("  {$label} → already dispatched for this occurrence, skipped.");
                    break;

                // Nothing new to report yet — the rolling window has caught up
                // to today. Not a failure.
                case 'skipped':
                    $stats['skipped']++;
                    $this->line("  {$label} → {$result['message']}");
                    break;

                default:
                    $stats['failed']++;
                    $this->error("  {$label} → {$result['message']}");
                    break;
            }
        }

        $this->sweep($dispatcher);

        $summary = sprintf(
            'Dispatched %d report(s) as %d email(s). Duplicates skipped: %d. Skipped: %d. Failed: %d.',
            $stats['queued'], $stats['emails'], $stats['duplicate'], $stats['skipped'], $stats['failed']
        );

        $logger->info('--- reports:queue run finished ---', $stats);
        $this->info($summary);

        // A failure here must not mark the scheduled task as failed while other
        // reports went out fine; the ledger and log carry the detail.
        return Command::SUCCESS;
    }

    private function sweep(ReportDispatchService $dispatcher): void
    {
        if ($this->option('no-cleanup') || $this->option('dry-run')) {
            return;
        }

        try {
            $removed = $dispatcher->cleanupStaleAttachments();
            if ($removed > 0) {
                $this->line("Cleaned up {$removed} stale attachment(s).");
            }
        } catch (\Throwable $e) {
            $dispatcher->logger()->warning('Attachment cleanup failed', ['error' => $e->getMessage()]);
        }
    }
}

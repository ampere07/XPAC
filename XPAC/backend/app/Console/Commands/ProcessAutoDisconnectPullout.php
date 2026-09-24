<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\AutoDisconnectService;
use Carbon\Carbon;

class ProcessAutoDisconnectPullout extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'cron:auto-disconnect-pullout 
                            {--dc-only : Process only disconnections}
                            {--pullout-only : Process only pullout requests}
                            {--dry-run : Run without making changes}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Automatically disconnect overdue accounts and create pullout requests';

    /**
     * Auto disconnect service instance
     *
     * @var AutoDisconnectService
     */
    protected $autoDisconnectService;

    /**
     * Create a new command instance.
     *
     * @param AutoDisconnectService $autoDisconnectService
     */
    public function __construct(AutoDisconnectService $autoDisconnectService)
    {
        parent::__construct();
        $this->autoDisconnectService = $autoDisconnectService;
    }

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $startTime = Carbon::now();
        $this->info("╔════════════════════════════════════════════════════════╗");
        $this->info("║   STARTING AUTO DISCONNECT & PULLOUT PROCESS          ║");
        $this->info("╚════════════════════════════════════════════════════════╝");
        $this->info("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->newLine();

        $dcOnly = $this->option('dc-only');
        $pulloutOnly = $this->option('pullout-only');
        $dryRun = $this->option('dry-run');

        if ($dryRun) {
            $this->warn("[DRY RUN MODE] No changes will be made");
            $this->newLine();
        }

        try {
            $dcResult = null;
            $pulloutResult = null;
            $prepaidPulloutResult = null;

            // Process Auto Disconnection
            if (!$pulloutOnly) {
                $this->info("─────────────────────────────────────────────────────────");
                $this->info("[PROCESS] Processing Auto Disconnection...");
                $this->info("─────────────────────────────────────────────────────────");
                
                $dcResult = $this->autoDisconnectService->processAutoDisconnect();
                
                if ($dcResult['success']) {
                    $this->newLine();
                    $this->info("[SUCCESS] Auto Disconnection Complete:");
                    $this->table(
                        ['Metric', 'Count'],
                        [
                            ['Processed', $dcResult['processed']],
                            ['Skipped', $dcResult['skipped']],
                            ['Duration', $dcResult['duration'] . 's']
                        ]
                    );

                    if (!empty($dcResult['errors'])) {
                        $this->newLine();
                        $this->warn("[WARNING] Errors encountered:");
                        foreach ($dcResult['errors'] as $error) {
                            $this->line("   - " . $error);
                        }
                    }
                } else {
                    $this->error("[FAILED] Auto Disconnection Failed: " . ($dcResult['error'] ?? 'Unknown error'));
                    return 1;
                }

                $this->newLine();

                // Process Grace Period Charges (7-day delayed charging for DC'd accounts)
                $this->info("─────────────────────────────────────────────────────────");
                $this->info("[PROCESS] Processing Grace Period Charges...");
                $this->info("─────────────────────────────────────────────────────────");

                $graceResult = $this->autoDisconnectService->processGracePeriodCharge();

                if ($graceResult['success']) {
                    $this->newLine();
                    $this->info("[SUCCESS] Grace Period Charging Complete:");
                    $this->table(
                        ['Metric', 'Count'],
                        [
                            ['Charged', $graceResult['charged']],
                            ['Skipped', $graceResult['skipped']],
                            ['Duration', $graceResult['duration'] . 's']
                        ]
                    );

                    if (!empty($graceResult['errors'])) {
                        $this->newLine();
                        $this->warn("[WARNING] Errors encountered:");
                        foreach ($graceResult['errors'] as $error) {
                            $this->line("   - " . $error);
                        }
                    }
                } else {
                    $this->error("[FAILED] Grace Period Charging Failed: " . ($graceResult['error'] ?? 'Unknown error'));
                    return 1;
                }

                $this->newLine();

                // Process Prepaid Restrictions (prepaid customers are restricted once their
                // rolling prepaid service period expires; they are never part of the
                // overdue-based postpaid DC flow).
                $this->info("─────────────────────────────────────────────────────────");
                $this->info("[PROCESS] Processing Prepaid Period-Expiry Restrictions...");
                $this->info("─────────────────────────────────────────────────────────");

                $prepaidResult = $this->autoDisconnectService->processPrepaidRestrictions();

                if ($prepaidResult['success']) {
                    $this->newLine();
                    $this->info("[SUCCESS] Prepaid Restriction Complete:");
                    $this->table(
                        ['Metric', 'Count'],
                        [
                            ['Restricted', $prepaidResult['restricted']],
                            ['Queued', $prepaidResult['queued']],
                            ['Skipped', $prepaidResult['skipped']],
                            ['Duration', $prepaidResult['duration'] . 's']
                        ]
                    );

                    if (!empty($prepaidResult['errors'])) {
                        $this->newLine();
                        $this->warn("[WARNING] Errors encountered:");
                        foreach ($prepaidResult['errors'] as $error) {
                            $this->line("   - " . $error);
                        }
                    }
                } else {
                    // Non-fatal: log and continue so the pullout step still runs.
                    $this->warn("[WARNING] Prepaid Restriction reported a failure: " . ($prepaidResult['error'] ?? 'Unknown error'));
                }

                $this->newLine();
            }

            // Process Auto Pullout
            if (!$dcOnly) {
                $this->info("─────────────────────────────────────────────────────────");
                $this->info("[PROCESS] Processing Auto Pullout...");
                $this->info("─────────────────────────────────────────────────────────");
                
                $pulloutResult = $this->autoDisconnectService->processAutoPullout();
                
                if ($pulloutResult['success']) {
                    $this->newLine();
                    $this->info("[SUCCESS] Auto Pullout Complete:");
                    $this->table(
                        ['Metric', 'Count'],
                        [
                            ['Created', $pulloutResult['created']],
                            ['Skipped', $pulloutResult['skipped']],
                            ['Duration', $pulloutResult['duration'] . 's']
                        ]
                    );

                    if (!empty($pulloutResult['errors'])) {
                        $this->newLine();
                        $this->warn("[WARNING] Errors encountered:");
                        foreach ($pulloutResult['errors'] as $error) {
                            $this->line("   - " . $error);
                        }
                    }
                } else {
                    $this->error("[FAILED] Auto Pullout Failed: " . ($pulloutResult['error'] ?? 'Unknown error'));
                    return 1;
                }

                $this->newLine();

                // Process Prepaid Auto Pullout (prepaid accounts left Inactive for pullout_day days
                // past their expiry never renewed, so their equipment is scheduled for retrieval).
                $this->info("─────────────────────────────────────────────────────────");
                $this->info("[PROCESS] Processing Prepaid Auto Pullout...");
                $this->info("─────────────────────────────────────────────────────────");

                $prepaidPulloutResult = $this->autoDisconnectService->processPrepaidAutoPullout();

                if ($prepaidPulloutResult['success']) {
                    $this->newLine();
                    $this->info("[SUCCESS] Prepaid Auto Pullout Complete:");
                    $this->table(
                        ['Metric', 'Count'],
                        [
                            ['Created', $prepaidPulloutResult['created']],
                            ['Skipped', $prepaidPulloutResult['skipped']],
                            ['Duration', $prepaidPulloutResult['duration'] . 's']
                        ]
                    );
                } else {
                    // Non-fatal: the postpaid pullout has already run, so report and carry on.
                    $this->warn("[WARNING] Prepaid Auto Pullout reported a failure: " . ($prepaidPulloutResult['error'] ?? 'Unknown error'));
                }

                if (!empty($prepaidPulloutResult['errors'])) {
                    $this->newLine();
                    $this->warn("[WARNING] Errors encountered:");
                    foreach ($prepaidPulloutResult['errors'] as $error) {
                        $this->line("   - " . $error);
                    }
                }

                $this->newLine();
            }

            // Final Summary
            $endTime = Carbon::now();
            $totalDuration = $endTime->diffInSeconds($startTime);
            
            $this->info("╔════════════════════════════════════════════════════════╗");
            $this->info("║   PROCESS COMPLETED SUCCESSFULLY                      ║");
            $this->info("╚════════════════════════════════════════════════════════╝");
            $this->info("End Time: " . $endTime->format('Y-m-d H:i:s'));
            $this->info("Total Duration: {$totalDuration} seconds");
            
            if ($dcResult && $pulloutResult) {
                $summaryRows = [
                    ['Disconnections', $dcResult['processed'], $dcResult['skipped']],
                    ['Pullout Requests', $pulloutResult['created'], $pulloutResult['skipped']]
                ];

                if ($prepaidPulloutResult) {
                    $summaryRows[] = ['Prepaid Pullout Requests', $prepaidPulloutResult['created'], $prepaidPulloutResult['skipped']];
                }

                $this->newLine();
                $this->info("[SUMMARY] Overall Results:");
                $this->table(
                    ['Process', 'Success', 'Failed/Skipped'],
                    $summaryRows
                );
            }
            
            $this->newLine();
            return 0;

        } catch (\Exception $e) {
            $this->newLine();
            $this->error("╔════════════════════════════════════════════════════════╗");
            $this->error("║   CRITICAL ERROR                                       ║");
            $this->error("╚════════════════════════════════════════════════════════╝");
            $this->error("Error: " . $e->getMessage());
            $this->error("Trace: " . $e->getTraceAsString());
            $this->newLine();
            return 1;
        }
    }
}


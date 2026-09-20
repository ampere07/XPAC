<?php

namespace App\Console\Commands;

use App\Http\Controllers\CommissionController;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Records each weekly and monthly achievement period once it has ended.
 *
 * Achievement progress resets on its own — the count is derived from the
 * referrals inside the current period, so a new week or month begins at zero
 * without anything having to run. This command does not perform the reset; it
 * writes down what the period finished on, and the audit entry showing that the
 * count and any claim did not carry into the period that followed.
 *
 * Reading an agent's achievements closes their elapsed periods too, so an agent
 * who opens their dashboard is recorded without this command. It exists for the
 * ones who do not: without it, an agent who never opens the app would have no
 * closing record until the next time somebody looked, and a period older than
 * the lookback window would never be recorded at all.
 *
 * Safe to run as often as you like. A period already on file is skipped, so a
 * second run in the same day writes nothing and reports zero closures.
 *
 * IMPORTANT: like the other agent crons in this application, this command is
 * intentionally NOT registered on a schedule. Configure when it runs yourself
 * (system crontab, scheduler, etc.). Shortly after midnight is the natural
 * choice, since both period types turn at midnight:
 *
 *     php artisan cron:close-achievement-periods
 *
 * Options:
 *     --agent=ID   close one agent only, rather than everybody
 *     --dry-run    report what would be closed without writing anything
 */
class CloseAchievementPeriods extends Command
{
    protected $signature = 'cron:close-achievement-periods
                            {--agent= : Close periods for a single agent id}
                            {--dry-run : Report what would be closed without writing it}';

    protected $description = 'Record each ended weekly/monthly achievement period and audit that its progress did not carry over.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $this->info('[ACHIEVEMENT PERIODS] Starting...' . ($dryRun ? ' (dry run)' : ''));

        try {
            $agentIds = $this->agentIds();
        } catch (\Throwable $e) {
            $this->error('[ACHIEVEMENT PERIODS] Could not list agents: ' . $e->getMessage());
            Log::channel('single')->error('[ACHIEVEMENT PERIODS] Could not list agents: ' . $e->getMessage());
            return self::FAILURE;
        }

        if ($agentIds === []) {
            $this->info('[ACHIEVEMENT PERIODS] No agents to check.');
            return self::SUCCESS;
        }

        $controller = new CommissionController();
        $agentsWithClosures = 0;
        $closures = 0;
        $errors = 0;

        foreach ($agentIds as $agentId) {
            try {
                $agent = User::find($agentId);
                if (!$agent) {
                    continue;
                }

                if ($dryRun) {
                    // Nothing is written, so this reports the periods that are
                    // currently unrecorded rather than the ones it closed.
                    $pending = $this->pendingPeriodKeys($agent);
                    if ($pending !== []) {
                        $agentsWithClosures++;
                        $closures += count($pending);
                        $this->line("  agent {$agentId}: would close " . implode(', ', $pending));
                    }
                    continue;
                }

                $written = $controller->closeElapsedPeriods($agent, null, 'System (scheduled)');
                if ($written !== []) {
                    $agentsWithClosures++;
                    $closures += count($written);
                    $keys = array_map(fn ($p) => $p->period_type . ' ' . $p->period_key, $written);
                    $this->line("  agent {$agentId}: closed " . implode(', ', $keys));
                }
            } catch (\Throwable $e) {
                // One agent's failure must not stop the rest.
                $errors++;
                $this->warn("  agent {$agentId}: " . $e->getMessage());
                Log::channel('single')->warning("[ACHIEVEMENT PERIODS] Agent {$agentId}: " . $e->getMessage());
            }
        }

        $this->info(sprintf(
            '[ACHIEVEMENT PERIODS] Done — Agents checked: %d, Agents with closures: %d, Periods %s: %d, Errors: %d',
            count($agentIds),
            $agentsWithClosures,
            $dryRun ? 'pending' : 'closed',
            $closures,
            $errors
        ));

        return $errors > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Everyone who holds an agent balance.
     *
     * The same definition the incentive cron uses, so the two crons never
     * disagree about who counts as an agent.
     */
    private function agentIds(): array
    {
        $one = $this->option('agent');
        if ($one !== null && $one !== '') {
            return [(int) $one];
        }

        return DB::table('agent_balance')
            ->whereNotNull('agent_id')
            ->distinct()
            ->pluck('agent_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Which elapsed cycles have no closing record yet, for the dry run.
     *
     * Resolved the same way the closing walk resolves them, so a dry run and a
     * real run agree about what is outstanding — including for an agent whose
     * schedule was moved by an early claim.
     */
    private function pendingPeriodKeys($agent): array
    {
        $pending = [];
        $controller = new CommissionController();
        $now = \Carbon\Carbon::now();

        foreach (CommissionController::achievementTiers() as $key => $tier) {
            $periodType = $tier['period'] ?? $key;
            $anchors    = $controller->claimAnchors($agent, $periodType);

            // The cycle before the one currently running.
            $current  = $controller->currentCycle($agent, $periodType, $now);
            $previous = CommissionController::cycleAt($periodType, $anchors, $current['start']->copy()->subSecond());

            $exists = DB::table('agent_achievement_periods')
                ->where('agent_id', $agent->id)
                ->where('period_type', $periodType)
                ->where('period_key', $previous['key'])
                ->exists();

            if (!$exists) {
                $pending[] = "{$periodType} {$previous['key']}";
            }
        }

        return $pending;
    }
}

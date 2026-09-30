<?php

namespace App\Console\Commands;

use App\Services\AutoDisconnectService;
use Illuminate\Console\Command;

/**
 * Midday retry of the prepaid restriction step.
 *
 * Prepaid restriction falls due at 00:00 once the days left reach 0 — no grace
 * (AutoDisconnectService::PREPAID_GRACE_DAYS / PREPAID_RESTRICT_HOUR). The 02:00
 * cron:auto-disconnect-pullout run does the cutting off; this repeats just the
 * prepaid restriction step at 12:00 to catch anything it missed (server down,
 * RADIUS unreachable).
 *
 * Safe to repeat: only Active accounts past the cutoff are selected, and a
 * restricted account is Inactive and drops out, so no one is restricted twice.
 */
class RestrictExpiredPrepaid extends Command
{
    protected $signature = 'prepaid:restrict-expired';

    protected $description = 'Restrict prepaid accounts whose days left reached 0 (midday retry of the 02:00 sweep)';

    public function handle(AutoDisconnectService $autoDisconnectService): int
    {
        $this->info('[PROCESS] Processing Prepaid Period-Expiry Restrictions...');

        $result = $autoDisconnectService->processPrepaidRestrictions();

        if (!$result['success']) {
            $this->error('[FAILED] Prepaid restriction failed: ' . implode('; ', $result['errors'] ?? []));
            return Command::FAILURE;
        }

        $this->table(
            ['Metric', 'Count'],
            [
                ['Restricted', $result['restricted']],
                ['Queued', $result['queued']],
                ['Skipped', $result['skipped']],
                ['Duration', $result['duration'] . 's'],
            ]
        );

        return Command::SUCCESS;
    }
}

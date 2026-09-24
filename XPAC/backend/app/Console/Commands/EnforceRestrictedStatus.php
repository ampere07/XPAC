<?php

namespace App\Console\Commands;

use App\Services\ManualRadiusOperationsService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Finds accounts that billing says are not paying but RADIUS is still serving,
 * and — under an explicit flag — restricts them.
 *
 * The two systems drift. A billing status is set in the app; the RADIUS profile
 * is set by a separate call that can fail, be skipped during an outage, or be
 * undone by a manual reconnect nobody wrote down. What is left is an account
 * marked Inactive or Disconnected in the database whose PPPoE session is still
 * up — a customer receiving service that stopped being paid for, invisible
 * because every screen reports the billing status and believes it.
 *
 * This command asks the opposite question: of the accounts billing considers
 * unpaid, which are *not* in the Restricted group on the RADIUS server itself?
 *
 * ── Why it reads RADIUS rather than trusting the database ─────────────
 *
 * The drift is the whole point. Comparing the database against itself would
 * report zero every time. Each candidate is looked up on the live RADIUS servers
 * through the same service the app's own restrict button uses, so the answer is
 * about the network's actual state.
 *
 *     php artisan radius:enforce-restricted             # report only
 *     php artisan radius:enforce-restricted --commit    # actually restrict
 *     php artisan radius:enforce-restricted --commit --limit=25
 *
 * ── Blast radius ──────────────────────────────────────────────────────
 *
 * Restricting cuts a customer's service and kicks their live session. That is a
 * visible, outward-facing act, so:
 *
 *   - nothing happens without --commit;
 *   - --limit caps how many are touched in one run, and the first live run
 *     should use a small one;
 *   - statuses that mean "deliberately not billed" — VIP, Pullout — are excluded
 *     entirely rather than merely deprioritised. A VIP account is unpaid by
 *     design and cutting one off is the single worst outcome this command could
 *     produce;
 *   - every account touched is written to the log with its before state.
 *
 * Idempotent: an account already in the Restricted group is skipped, so a second
 * run restricts nobody. Safe to schedule once the reported list has been quiet
 * for a while.
 */
class EnforceRestrictedStatus extends Command
{
    protected $signature = 'radius:enforce-restricted
        {--commit : Apply the restriction. Without this nothing is changed.}
        {--limit=0 : Restrict at most this many in one run. 0 means no cap.}
        {--csv= : Where to write the row-by-row report.}';

    protected $description = 'Restrict RADIUS users whose billing account is unpaid but whose service is still active';

    /**
     * Billing statuses that mean the account should not be receiving service.
     *
     * Matched case-insensitively against `billing_status.status_name`.
     */
    private const UNPAID_STATUSES = [
        'inactive', 'disconnected', 'suspended', 'overdue', 'expired', 'cut off', 'cutoff',
    ];

    /**
     * Statuses that must never be restricted, whatever else is true.
     *
     * VIP and Pullout are both "not paying" and both entirely deliberate: one is
     * a free connection the company granted, the other is an account whose
     * equipment has already been pulled. Restricting either is the error this
     * list exists to prevent.
     */
    private const NEVER_RESTRICT = ['vip', 'pullout', 'pulled out', 'active'];

    public function __construct(private ManualRadiusOperationsService $radius)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $commit = (bool) $this->option('commit');
        $limit = max(0, (int) $this->option('limit'));

        $this->info('Finding unpaid accounts with a live PPPoE username…');

        $candidates = $this->unpaidWithUsername();

        if ($candidates === []) {
            $this->info('No unpaid account carries an active username. Nothing to enforce.');

            return self::SUCCESS;
        }

        $this->line(sprintf('%s account(s) to check against RADIUS.', number_format(count($candidates))));
        $this->newLine();

        $rows = [];
        $toRestrict = [];

        $bar = $this->output->createProgressBar(count($candidates));
        $bar->start();

        foreach ($candidates as $account) {
            $group = $this->radiusGroupFor($account->username);

            $row = [
                'account_no' => (string) $account->account_no,
                'username' => (string) $account->username,
                'customer' => trim(($account->first_name ?? '') . ' ' . ($account->last_name ?? '')),
                'billing_status' => (string) $account->status_name,
                'radius_group' => $group ?? '(not found / unreachable)',
                'action' => '',
            ];

            if ($group === null) {
                // Not found on any server, or every server was unreachable. Both
                // are reported and neither is acted on: restricting a user the
                // servers cannot confirm would be an operation issued blind.
                $row['action'] = 'skipped — could not read RADIUS';
            } elseif ($this->isRestricted($group)) {
                $row['action'] = 'already restricted';
            } else {
                $row['action'] = "would restrict (currently '{$group}')";
                $toRestrict[] = $account;
            }

            $rows[] = $row;
            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);

        $this->table(
            ['Result', 'Accounts'],
            [
                ['Unpaid with a username', number_format(count($candidates))],
                ['  → already Restricted in RADIUS', number_format(count(array_filter($rows, fn ($r) => $r['action'] === 'already restricted')))],
                ['  → still being served, need restricting', number_format(count($toRestrict))],
                ['  → could not be read from RADIUS', number_format(count(array_filter($rows, fn ($r) => str_starts_with($r['action'], 'skipped'))))],
            ]
        );

        $csv = $this->writeCsv($rows);
        $this->newLine();
        $this->line("Row-by-row report: {$csv}");
        $this->newLine();

        if (!$commit) {
            $this->warn('DRY RUN — no session was cut. Review the CSV, then re-run with --commit.');

            return self::SUCCESS;
        }

        if ($toRestrict === []) {
            $this->info('Nothing to restrict — RADIUS already agrees with billing.');

            return self::SUCCESS;
        }

        return $this->restrict($limit > 0 ? array_slice($toRestrict, 0, $limit) : $toRestrict);
    }

    /**
     * Unpaid accounts that still have a username, in one query.
     *
     * Joined rather than looped: the alternative is a query per account to find
     * its technical details and another for its status, which on a base this size
     * is the N+1 that makes a maintenance command take an hour.
     *
     * @return array<int,object>
     */
    private function unpaidWithUsername(): array
    {
        return DB::table('billing_accounts as ba')
            ->join('technical_details as td', 'td.account_id', '=', 'ba.id')
            ->join('billing_status as bs', 'bs.id', '=', 'ba.billing_status_id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->whereNotNull('td.username')
            ->where('td.username', '<>', '')
            ->whereIn(DB::raw('LOWER(TRIM(bs.status_name))'), self::UNPAID_STATUSES)
            // Belt and braces. The status cannot be both unpaid and VIP, but this
            // command cuts people off and the cost of the redundant clause is
            // nothing next to the cost of being wrong once.
            ->whereNotIn(DB::raw('LOWER(TRIM(bs.status_name))'), self::NEVER_RESTRICT)
            ->select(
                'ba.id',
                'ba.account_no',
                'td.username',
                'bs.status_name',
                'c.first_name',
                'c.last_name'
            )
            ->orderBy('ba.id')
            ->get()
            ->all();
    }

    /**
     * The group a username currently sits in on the live RADIUS servers, or null
     * when no server could answer.
     *
     * Null is deliberately not "no group". An unreachable server and a user in no
     * group are different facts, and collapsing them is how an outage turns into
     * a mass restriction.
     */
    private function radiusGroupFor(string $username): ?string
    {
        try {
            $located = $this->radius->findUserGroup($username);

            return $located === null ? null : (string) $located;
        } catch (Throwable $e) {
            Log::warning('radius:enforce-restricted lookup failed', [
                'username' => $username,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /** Both spellings the servers use for the restricted profile. */
    private function isRestricted(string $group): bool
    {
        $value = strtolower(trim($group));

        return $value === 'restricted' || $value === 'mikrotik-group:restricted';
    }

    /**
     * Applies the restriction, one account at a time.
     *
     * Not wrapped in a transaction, and that is deliberate: each iteration
     * performs a network call to a RADIUS server that a rollback cannot undo. A
     * database transaction around it would create exactly the illusion this
     * command must not create — a rolled-back run whose customers are still cut
     * off. Each account therefore succeeds or fails on its own and is reported
     * that way, and the whole run is safe to repeat.
     *
     * @param array<int,object> $accounts
     */
    private function restrict(array $accounts): int
    {
        $restricted = 0;
        $failed = 0;

        foreach ($accounts as $account) {
            try {
                $result = $this->radius->restrictedUser([
                    'accountNumber' => $account->account_no,
                    'username' => $account->username,
                    'remarks' => 'Automatic enforcement — billing status ' . $account->status_name,
                    'updatedBy' => 'radius:enforce-restricted',
                ]);

                // The service reports on `status`, not a boolean. Anything other
                // than an explicit success is treated as a failure, so a shape
                // this command does not recognise is never read as "it worked".
                if (($result['status'] ?? '') === 'success') {
                    $restricted++;

                    Log::warning('radius:enforce-restricted restricted an account', [
                        'account_no' => $account->account_no,
                        'username' => $account->username,
                        'billing_status' => $account->status_name,
                    ]);
                } else {
                    $failed++;
                    $this->error("  {$account->account_no}: " . ($result['message'] ?? 'unknown failure'));
                }
            } catch (Throwable $e) {
                $failed++;
                $this->error("  {$account->account_no}: " . $e->getMessage());

                Log::error('radius:enforce-restricted failed for an account', [
                    'account_no' => $account->account_no,
                    'username' => $account->username,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->newLine();
        $this->info("Restricted: {$restricted}   Failed: {$failed}");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    /** @param array<int,array<string,mixed>> $rows */
    private function writeCsv(array $rows): string
    {
        $path = (string) ($this->option('csv')
            ?: storage_path('app/restricted-enforcement-' . now()->format('Ymd-His') . '.csv'));

        $directory = dirname($path);

        if (!is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $handle = fopen($path, 'w');

        fputcsv($handle, ['account_no', 'username', 'customer', 'billing_status', 'radius_group', 'action']);

        foreach ($rows as $row) {
            fputcsv($handle, array_values($row));
        }

        fclose($handle);

        return $path;
    }
}

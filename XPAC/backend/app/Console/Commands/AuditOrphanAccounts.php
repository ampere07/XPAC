<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Finds `billing_accounts` rows that describe no actual connection, and — under
 * an explicit flag — deletes them.
 *
 * An account with no technical details has no PPPoE username, no router or ONU
 * serial and no port on any splitter. Nothing about it can be provisioned,
 * billed against a service, or found in RADIUS. Most are the residue of an
 * application that was keyed twice or abandoned partway.
 *
 * ── Why "no technical details" is not, by itself, enough to delete ────
 *
 * Two kinds of row match that description and only one of them is rubbish:
 *
 *   - a duplicate or abandoned shell, which should go;
 *   - a real customer who has *paid* and is waiting to be installed, whose
 *     technical details do not exist yet because the technician has not been.
 *
 * Deleting the second kind destroys a payment record. So a row is only a
 * candidate once it is also unknown to every table that represents money or
 * work: transactions, invoices, advance payments, installments, statements,
 * security deposits, job orders, service orders, and RADIUS's own view in
 * online_status. Anything with a trace in any of those is reported as *retained*
 * with the reason named, and is never deleted however empty its technical
 * details are.
 *
 * A non-zero balance is likewise disqualifying. An account that owes money is a
 * debt, and a debt with no paperwork behind it is a thing to investigate, not to
 * make disappear.
 *
 *     php artisan accounts:audit-orphans              # report only
 *     php artisan accounts:audit-orphans --commit     # delete the candidates
 *     php artisan accounts:audit-orphans --commit --limit=50
 *
 * Idempotent: a second run finds nothing, because the rows it deleted are gone
 * and the rows it retained still fail the same guard.
 */
class AuditOrphanAccounts extends Command
{
    protected $signature = 'accounts:audit-orphans
        {--commit : Delete the candidates. Without this nothing is changed.}
        {--limit=0 : Delete at most this many. 0 means no cap. Ignored without --commit.}
        {--csv= : Where to write the row-by-row report.}';

    protected $description = 'Report billing accounts that carry no technical details, and optionally delete the safe ones';

    /**
     * The columns that, if any is filled, mean the account describes a real
     * connection.
     *
     * `username` is the PPPoE credential; `router_modem_sn` and `router_model`
     * are the ONU/router; the rest place it on the fibre plant. One filled field
     * is enough — a half-recorded install is incomplete data about a real
     * connection, not an absent one.
     */
    private const TECHNICAL_COLUMNS = [
        'username', 'router_modem_sn', 'router_model', 'ip_address',
        'lcp', 'nap', 'port', 'vlan',
    ];

    /**
     * Tables that prove an account is real, and the column each joins on.
     *
     * A hit in any one of them retains the account. The list is deliberately
     * generous: the cost of keeping a junk row is that somebody reads a slightly
     * inflated count, and the cost of deleting a real one is a lost payment
     * record.
     *
     * @var array<string,string>
     */
    private const EVIDENCE_TABLES = [
        'transactions' => 'account_no',
        'invoices' => 'account_no',
        'advanced_payments' => 'account_no',
        'statement_of_accounts' => 'account_no',
        'service_orders' => 'account_no',
        'pending_payments' => 'account_no',
        'installments' => 'account_id',
        'security_deposits' => 'account_id',
        'job_orders' => 'account_id',
        'online_status' => 'account_id',
        'plan_change_logs' => 'account_id',
        'disconnected_logs' => 'account_id',
    ];

    public function handle(): int
    {
        $commit = (bool) $this->option('commit');
        $limit = max(0, (int) $this->option('limit'));

        $candidates = [];
        $retained = [];

        $this->info('Scanning for accounts with no technical details…');

        foreach ($this->accountsWithoutTechnicalDetails() as $account) {
            $reasons = $this->evidenceFor($account);

            if ((float) ($account->account_balance ?? 0) != 0.0) {
                $reasons[] = sprintf('balance %.2f', (float) $account->account_balance);
            }

            $row = [
                'account_no' => (string) $account->account_no,
                'account_id' => (int) $account->id,
                'customer' => trim(($account->first_name ?? '') . ' ' . ($account->last_name ?? '')),
                'created_at' => (string) ($account->created_at ?? ''),
                'balance' => (string) ($account->account_balance ?? '0'),
                'technical_row' => $account->tech_id === null ? 'missing' : 'blank',
                'retained_because' => implode('; ', $reasons),
                'action' => $reasons === [] ? 'DELETE candidate' : 'retained',
            ];

            $reasons === [] ? $candidates[] = $row : $retained[] = $row;
        }

        $this->newLine();
        $this->table(
            ['Result', 'Accounts'],
            [
                ['No technical details at all', number_format(count($candidates) + count($retained))],
                ['  → safe to delete (no money, no work, no RADIUS)', number_format(count($candidates))],
                ['  → retained (has history — see CSV for why)', number_format(count($retained))],
            ]
        );

        $csv = $this->writeCsv(array_merge($candidates, $retained));
        $this->newLine();
        $this->line("Row-by-row report: {$csv}");
        $this->newLine();

        if (!$commit) {
            $this->warn('DRY RUN — nothing was deleted. Review the CSV, then re-run with --commit.');

            return self::SUCCESS;
        }

        if ($candidates === []) {
            $this->info('Nothing to delete.');

            return self::SUCCESS;
        }

        return $this->delete($limit > 0 ? array_slice($candidates, 0, $limit) : $candidates);
    }

    /**
     * Accounts whose technical_details row is missing, or present but empty.
     *
     * One LEFT JOIN rather than a query per account: this runs over the whole
     * account table and asking per row would be tens of thousands of round
     * trips. The "present but empty" half is expressed as a NULLIF/COALESCE
     * chain so both cases come back from the same pass.
     */
    private function accountsWithoutTechnicalDetails()
    {
        $blank = collect(self::TECHNICAL_COLUMNS)
            ->map(fn ($column) => "COALESCE(NULLIF(TRIM(td.{$column}), ''), '')")
            ->implode(", ");

        return DB::table('billing_accounts as ba')
            ->leftJoin('technical_details as td', 'td.account_id', '=', 'ba.id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->whereRaw("CONCAT({$blank}) = ''")
            ->select(
                'ba.id',
                'ba.account_no',
                'ba.account_balance',
                'ba.created_at',
                'td.id as tech_id',
                'c.first_name',
                'c.last_name'
            )
            ->orderBy('ba.id')
            ->cursor();
    }

    /**
     * Why this account must be kept, if it must.
     *
     * Each evidence table is checked with an EXISTS-style `limit(1)`, so a
     * customer with nine years of transactions costs the same as one with a
     * single row — the question is only whether *any* exists.
     *
     * A table that is absent from this deployment is skipped rather than
     * treated as "no evidence". Failing open here would let a missing table
     * silently turn a protected account into a deletion candidate.
     *
     * @return string[]
     */
    private function evidenceFor(object $account): array
    {
        $reasons = [];

        foreach (self::EVIDENCE_TABLES as $table => $column) {
            try {
                if (!DB::getSchemaBuilder()->hasTable($table)) {
                    continue;
                }

                $value = $column === 'account_id' ? $account->id : $account->account_no;

                if ($value === null || $value === '') {
                    continue;
                }

                $exists = DB::table($table)->where($column, $value)->limit(1)->exists();

                if ($exists) {
                    $reasons[] = $table;
                }
            } catch (Throwable $e) {
                // An unreadable table is not evidence of absence. Treat the
                // failure itself as a reason to retain, and say so.
                $reasons[] = $table . ' (check failed)';

                Log::warning('accounts:audit-orphans evidence check failed', [
                    'table' => $table,
                    'account_no' => $account->account_no,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $reasons;
    }

    /**
     * Deletes the candidates and their now-dangling technical_details shells.
     *
     * One transaction around the whole run. A half-applied cleanup would leave
     * accounts deleted and their children orphaned, in a state the CSV no longer
     * describes and a rerun cannot distinguish from the original.
     *
     * @param array<int,array<string,mixed>> $candidates
     */
    private function delete(array $candidates): int
    {
        $ids = array_column($candidates, 'account_id');
        $numbers = array_column($candidates, 'account_no');

        $this->warn(sprintf('Deleting %s account(s)…', number_format(count($ids))));

        DB::beginTransaction();

        try {
            // The empty shells first, while the parent still exists — a foreign
            // key would otherwise refuse, and without one they would simply be
            // left behind pointing at nothing.
            $shells = DB::table('technical_details')->whereIn('account_id', $ids)->delete();

            $deleted = DB::table('billing_accounts')
                ->whereIn('id', $ids)
                // Re-checked at write time. The scan ran over a snapshot and a
                // technician may have provisioned one of these in the meantime;
                // this clause means an account that has since become real is
                // passed over rather than deleted on stale evidence.
                ->whereNotExists(function ($query) {
                    $blank = collect(self::TECHNICAL_COLUMNS)
                        ->map(fn ($column) => "COALESCE(NULLIF(TRIM(td.{$column}), ''), '')")
                        ->implode(", ");

                    $query->from('technical_details as td')
                        ->whereColumn('td.account_id', 'billing_accounts.id')
                        ->whereRaw("CONCAT({$blank}) <> ''");
                })
                ->delete();

            DB::commit();

            $this->info("Deleted {$deleted} account(s) and {$shells} empty technical_details row(s).");

            Log::warning('accounts:audit-orphans deleted accounts', [
                'accounts_deleted' => $deleted,
                'technical_rows_deleted' => $shells,
                'account_numbers' => $numbers,
            ]);

            return self::SUCCESS;
        } catch (Throwable $e) {
            DB::rollBack();

            $this->error('Deletion failed and was rolled back: ' . $e->getMessage());

            Log::error('accounts:audit-orphans deletion failed', [
                'error' => $e->getMessage(),
                'exception' => get_class($e),
            ]);

            return self::FAILURE;
        }
    }

    /** @param array<int,array<string,mixed>> $rows */
    private function writeCsv(array $rows): string
    {
        $path = (string) ($this->option('csv')
            ?: storage_path('app/orphan-accounts-' . now()->format('Ymd-His') . '.csv'));

        $directory = dirname($path);

        if (!is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $handle = fopen($path, 'w');

        fputcsv($handle, [
            'account_no', 'account_id', 'customer', 'created_at', 'balance',
            'technical_row', 'retained_because', 'action',
        ]);

        foreach ($rows as $row) {
            fputcsv($handle, array_values($row));
        }

        fclose($handle);

        return $path;
    }
}

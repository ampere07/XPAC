<?php

namespace App\Console\Commands;

use App\Services\PlanIdentity;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Reports — and on request repairs — accounts whose plan is not linked to
 * `plan_list`.
 *
 * Two populations are wrong in two different ways:
 *
 *   1. `billing_accounts.plan_id` is null, or points at a plan row that has since
 *      been renamed or deleted. The account is on a plan; the database has no
 *      idea which. Every figure grouped by plan quietly excludes it.
 *
 *   2. The free-text columns (`customers.desired_plan` and friends) hold a
 *      spelling that no longer matches any plan name — "PLAN-A" against a plan
 *      list that now says "PLAN A - 1500". Nothing is broken until something
 *      groups by that string, and then one plan reports as several.
 *
 * The repair for (1) is to infer the id from the free text and write it. That is
 * a real change to production data, so it does not happen by default: the
 * command reports, writes a CSV of every row it would touch, and only writes
 * under --commit. Run it, read the CSV, then run it again with the flag.
 *
 *     php artisan plans:audit                     # report only
 *     php artisan plans:audit --csv=storage/x.csv # report, custom CSV path
 *     php artisan plans:audit --commit            # actually backfill plan_id
 *
 * Idempotent. A second --commit run finds nothing left to do, because it only
 * ever targets rows whose plan_id is null or dangling, and it has just fixed the
 * ones it could. Rows it could not resolve are left exactly as they were —
 * repeatedly — and reported every time, which is the point: they need a person.
 */
class AuditPlanIdentifiers extends Command
{
    protected $signature = 'plans:audit
        {--commit : Write the inferred plan_id values. Without this nothing is changed.}
        {--csv= : Where to write the row-by-row report. Defaults to storage/app/plan-audit-<timestamp>.csv}
        {--chunk=500 : Rows per batch when backfilling.}';

    protected $description = 'Audit plan identifiers against plan_list, and optionally backfill billing_accounts.plan_id';

    public function handle(): int
    {
        $commit = (bool) $this->option('commit');
        $chunk = max(50, (int) $this->option('chunk'));

        $identity = PlanIdentity::make();

        if ($identity->all() === []) {
            $this->error('plan_list is empty — there is nothing to reconcile against.');

            return self::FAILURE;
        }

        $this->info(sprintf('Canonical plans: %d', count($identity->all())));
        $this->newLine();

        $rows = [];

        $this->auditFreeText($identity, $rows);
        $this->newLine();

        $broken = $this->auditAccounts($identity, $rows);
        $this->newLine();

        $csv = $this->writeCsv($rows);
        $this->line("Row-by-row report: {$csv}");
        $this->newLine();

        if (!$commit) {
            $this->warn('DRY RUN — nothing was written. Re-run with --commit to apply the backfill.');

            return self::SUCCESS;
        }

        return $this->backfill($broken, $chunk);
    }

    /**
     * How each free-text plan column resolves.
     *
     * Grouped in SQL, so the result is one row per *distinct string* — typically
     * a few dozen — rather than one per account. The whole point of the audit is
     * that the tail is small and nameable; pulling a million rows to discover
     * that would be its own bug.
     */
    private function auditFreeText(PlanIdentity $identity, array &$rows): void
    {
        $summary = [];

        foreach (PlanIdentity::FREE_TEXT_COLUMNS as $table => $column) {
            if (!$this->tableHasColumn($table, $column)) {
                $summary[] = [$table . '.' . $column, '—', '—', '—', 'table or column absent'];

                continue;
            }

            $distinct = DB::table($table)
                ->selectRaw("COALESCE(NULLIF(TRIM({$column}), ''), '') AS raw_plan")
                ->selectRaw('COUNT(*) AS cnt')
                ->groupBy('raw_plan')
                ->get();

            $resolved = 0;
            $ambiguous = 0;
            $unknown = 0;

            foreach ($distinct as $row) {
                $raw = (string) $row->raw_plan;
                $count = (int) $row->cnt;

                if ($raw === '') {
                    // Blank is not a spelling problem, it is a missing value, and
                    // counting it as "unknown" would bury the strings that need a
                    // human under rows that only need data entry.
                    continue;
                }

                $planId = $identity->resolve($raw);

                if ($planId !== null) {
                    $resolved += $count;

                    // A string that resolves but is not spelled canonically is
                    // still worth listing — it is what a future rename will
                    // break.
                    if ($raw !== $identity->label($planId)) {
                        $rows[] = [
                            'kind' => 'free_text_variant',
                            'table' => $table,
                            'column' => $column,
                            'account_no' => '',
                            'raw_value' => $raw,
                            'resolved_plan_id' => $planId,
                            'resolved_plan_name' => $identity->label($planId),
                            'affected_rows' => $count,
                            'action' => 'none — resolves, but is not the canonical spelling',
                        ];
                    }

                    continue;
                }

                $why = $identity->why($raw);
                $why === 'ambiguous' ? $ambiguous += $count : $unknown += $count;

                $rows[] = [
                    'kind' => 'free_text_' . $why,
                    'table' => $table,
                    'column' => $column,
                    'account_no' => '',
                    'raw_value' => $raw,
                    'resolved_plan_id' => '',
                    'resolved_plan_name' => '',
                    'affected_rows' => $count,
                    'action' => $why === 'ambiguous'
                        ? 'needs a decision — several plans share this signature'
                        : 'needs a person — no plan matches this string',
                ];
            }

            $summary[] = [
                $table . '.' . $column,
                number_format($resolved),
                number_format($ambiguous),
                number_format($unknown),
                $ambiguous + $unknown === 0 ? 'clean' : 'see CSV',
            ];
        }

        $this->info('Free-text plan columns');
        $this->table(['Column', 'Resolved', 'Ambiguous', 'Unknown', 'Status'], $summary);
    }

    /**
     * Accounts whose plan_id is missing or dangling, and what they could become.
     *
     * The LEFT JOIN is what finds a *dangling* id — a plan_id pointing at a row
     * that no longer exists reads as perfectly valid until it is joined and comes
     * back null. Those are the accounts that silently vanish from every
     * plan-grouped report, and a NULL check alone would miss all of them.
     *
     * @return array<int,array{id:int,account_no:string,plan_id:int}> resolvable rows
     */
    private function auditAccounts(PlanIdentity $identity, array &$rows): array
    {
        $broken = DB::table('billing_accounts as ba')
            ->leftJoin('plan_list as pl', 'pl.id', '=', 'ba.plan_id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->whereNull('pl.id')
            ->select(
                'ba.id',
                'ba.account_no',
                'ba.plan_id as current_plan_id',
                'c.desired_plan'
            )
            ->get();

        $fixable = [];
        $unresolved = 0;

        foreach ($broken as $row) {
            $planId = $identity->resolve($row->desired_plan);

            if ($planId !== null) {
                $fixable[] = [
                    'id' => (int) $row->id,
                    'account_no' => (string) $row->account_no,
                    'plan_id' => $planId,
                ];
            } else {
                $unresolved++;
            }

            $rows[] = [
                'kind' => $planId !== null ? 'account_backfillable' : 'account_unresolved',
                'table' => 'billing_accounts',
                'column' => 'plan_id',
                'account_no' => (string) $row->account_no,
                'raw_value' => (string) ($row->desired_plan ?? ''),
                'resolved_plan_id' => $planId ?? '',
                'resolved_plan_name' => $planId !== null ? $identity->label($planId) : '',
                'affected_rows' => 1,
                'action' => $planId !== null
                    ? sprintf(
                        'set plan_id = %d (was %s)',
                        $planId,
                        $row->current_plan_id === null ? 'NULL' : $row->current_plan_id
                    )
                    : 'needs a person — no plan can be inferred',
            ];
        }

        $this->info('billing_accounts.plan_id');
        $this->table(
            ['Check', 'Accounts'],
            [
                ['Missing or dangling plan_id', number_format(count($broken))],
                ['  → can be inferred from the customer record', number_format(count($fixable))],
                ['  → cannot be inferred, needs a person', number_format($unresolved)],
            ]
        );

        return $fixable;
    }

    /**
     * Writes the inferred ids.
     *
     * Batched by target plan so the whole backfill is a handful of `UPDATE ...
     * WHERE id IN (...)` statements rather than one per account — the difference
     * between a few round trips and several thousand.
     *
     * The transaction wraps the whole run, not each batch. A backfill that
     * committed half of itself and then failed would leave the database in a
     * state no report describes and no rerun can distinguish from the original,
     * which is worse than having changed nothing.
     */
    private function backfill(array $fixable, int $chunk): int
    {
        if ($fixable === []) {
            $this->info('Nothing to backfill — every account already resolves.');

            return self::SUCCESS;
        }

        $byPlan = [];

        foreach ($fixable as $row) {
            $byPlan[$row['plan_id']][] = $row['id'];
        }

        $updated = 0;

        DB::beginTransaction();

        try {
            foreach ($byPlan as $planId => $ids) {
                foreach (array_chunk($ids, $chunk) as $batch) {
                    $updated += DB::table('billing_accounts')
                        ->whereIn('id', $batch)
                        // Re-checked at write time, not only at read time. The
                        // audit ran over a snapshot and something may have set a
                        // real plan_id since; this clause means a concurrent
                        // correct answer is never overwritten by an inferred one.
                        ->where(function ($query) {
                            $query->whereNull('plan_id')
                                ->orWhereNotIn('plan_id', function ($sub) {
                                    $sub->from('plan_list')->select('id');
                                });
                        })
                        ->update([
                            'plan_id' => $planId,
                            'updated_at' => now(),
                            'updated_by' => 'plans:audit',
                        ]);
                }
            }

            DB::commit();
        } catch (Throwable $e) {
            DB::rollBack();

            $this->error('Backfill failed and was rolled back: ' . $e->getMessage());

            Log::error('plans:audit backfill failed', [
                'error' => $e->getMessage(),
                'exception' => get_class($e),
            ]);

            return self::FAILURE;
        }

        $this->info("Backfilled plan_id on {$updated} account(s).");

        Log::info('plans:audit backfill committed', [
            'accounts_updated' => $updated,
            'plans_touched' => count($byPlan),
        ]);

        return self::SUCCESS;
    }

    private function tableHasColumn(string $table, string $column): bool
    {
        try {
            return DB::getSchemaBuilder()->hasTable($table)
                && DB::getSchemaBuilder()->hasColumn($table, $column);
        } catch (Throwable $e) {
            return false;
        }
    }

    /** @param array<int,array<string,mixed>> $rows */
    private function writeCsv(array $rows): string
    {
        $path = (string) ($this->option('csv')
            ?: storage_path('app/plan-audit-' . now()->format('Ymd-His') . '.csv'));

        $directory = dirname($path);

        if (!is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $handle = fopen($path, 'w');

        fputcsv($handle, [
            'kind', 'table', 'column', 'account_no', 'raw_value',
            'resolved_plan_id', 'resolved_plan_name', 'affected_rows', 'action',
        ]);

        foreach ($rows as $row) {
            fputcsv($handle, array_values($row));
        }

        fclose($handle);

        return $path;
    }
}

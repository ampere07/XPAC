<?php

use App\Support\ExpenseClassifier;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Splits `expenses_logs.expense_type` into the two independent facts MONITOR
     * reports on, so the Expenses module and the executive dashboard describe the
     * same row the same way.
     *
     * The column previously held 'daily' / 'monthly' — a *frequency*, filed under
     * a name that everywhere else in the group means *nature* (OpEx against
     * CapEx). MONITOR's ExpenseClassifier documents the problem exactly: "Neither
     * source system records either fact", so it was inferring the OpEx/CapEx split
     * from category names. The two are orthogonal — a leased vehicle is monthly
     * OpEx, a fibre reel is one-off CapEx — and collapsing them into one column
     * forces a false choice.
     *
     * After this migration:
     *   expense_type  'OPEX' | 'CAPEX'   what kind of spending it is
     *   frequency     'Daily' | 'Monthly' how often it recurs
     *
     * The values are MOVED, not dropped. Every existing 'daily'/'monthly' lands in
     * `frequency` with its meaning intact, and `expense_type` is then re-derived.
     * Nothing a user recorded is lost or silently reinterpreted.
     *
     * Ordering matters and is the reason this runs in one transaction: frequency
     * has to be populated from expense_type BEFORE expense_type is overwritten. A
     * half-applied run that overwrote first would destroy the daily/monthly
     * distinction with no way to recover it.
     *
     * Every step is guarded so a re-run is a no-op rather than a second
     * translation — a migration that mangles data when run twice is a migration
     * nobody can safely re-run after a partial failure.
     */
    private const FREQUENCY_INDEX = 'expenses_logs_frequency_index';

    /**
     * The legacy vocabulary, lowercased, mapped to the new frequency values.
     *
     * Anything outside this map (a NULL, a blank, or a stray value from a hand
     * edit) becomes Daily, matching the default the previous migration gave the
     * column.
     */
    private const LEGACY_FREQUENCY = [
        'daily' => 'Daily',
        'monthly' => 'Monthly',
    ];

    /**
     * Schema::getIndexes() is Laravel 11+; this runs on 9.x without doctrine/dbal.
     * Same information_schema read the 2026_07_30 migration uses.
     */
    private function hasIndex(string $name): bool
    {
        return DB::selectOne(
            'SELECT 1 FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND INDEX_NAME = ?
              LIMIT 1',
            ['expenses_logs', $name]
        ) !== null;
    }

    /**
     * Whether expense_type still holds the legacy daily/monthly vocabulary.
     *
     * This is the re-run guard. Once the values have been translated the column
     * contains only OPEX/CAPEX, this returns false, and the backfill below is
     * skipped — so running the migration again cannot map already-translated
     * rows a second time.
     */
    private function holdsLegacyValues(): bool
    {
        return DB::table('expenses_logs')
            ->whereIn(DB::raw('LOWER(TRIM(COALESCE(expense_type, \'\')))'), array_keys(self::LEGACY_FREQUENCY))
            ->exists();
    }

    public function up(): void
    {
        // Guarded rather than assumed: this table is extended in place by an
        // earlier migration, and a fresh install may not have reached it yet.
        if (!Schema::hasTable('expenses_logs')) {
            return;
        }

        Schema::table('expenses_logs', function (Blueprint $table) {
            if (!Schema::hasColumn('expenses_logs', 'frequency')) {
                // varchar over enum, for the reason the previous migration gave:
                // widening an enum later needs a table rewrite.
                $table->string('frequency', 20)->default('Daily')->after('expense_type');
            }
        });

        // Both writes in one transaction. Losing power between them would leave
        // frequency populated but expense_type still legacy — recoverable — or,
        // in the other order, the daily/monthly distinction gone for good.
        DB::transaction(function () {
            if ($this->holdsLegacyValues()) {
                $this->moveFrequencyOut();
                $this->deriveExpenseType();
            }

            // Rows that arrived with neither a legacy value nor a valid new one:
            // NULLs from before the 2026_07_30 default, or a partially-applied
            // earlier run. Normalised so the column can be grouped on without a
            // UNION of near-identical strings.
            $this->normaliseStragglers();
        });

        Schema::table('expenses_logs', function (Blueprint $table) {
            if (!$this->hasIndex(self::FREQUENCY_INDEX)) {
                // The Expenses summary cards filter on frequency within an org and
                // date window, which the existing org/date index already serves;
                // this one carries the standalone frequency filter on the list.
                $table->index('frequency', self::FREQUENCY_INDEX);
            }
        });
    }

    /**
     * Step 1 — copy daily/monthly across to the column that now means it.
     *
     * A single UPDATE with a CASE rather than a row loop: this table is an
     * append-only expense ledger and can be large, and pulling it into PHP to
     * write one row at a time would be a round trip per expense ever recorded.
     */
    private function moveFrequencyOut(): void
    {
        DB::table('expenses_logs')->update([
            'frequency' => DB::raw(
                "CASE LOWER(TRIM(COALESCE(expense_type, '')))"
                . " WHEN 'monthly' THEN 'Monthly'"
                . " WHEN 'daily' THEN 'Daily'"
                // Not a legacy value: leave whatever frequency is already there
                // rather than forcing it, so a re-run cannot flatten a frequency
                // someone has since corrected by hand.
                . ' ELSE COALESCE(NULLIF(frequency, \'\'), \'Daily\') END'
            ),
        ]);
    }

    /**
     * Step 2 — re-derive expense_type as OpEx/CapEx from the category name.
     *
     * Uses the same patterns MONITOR matches on, read through the same config, so
     * a row lands in the same bucket on both systems. Built as one CASE
     * expression rather than a query per pattern: the pattern list is ~20 long
     * and twenty UPDATEs over the whole ledger is twenty table scans.
     *
     * Bindings, not interpolation, even though the patterns come from a config
     * file the operator controls — a value that reaches SQL through string
     * concatenation is one edit away from being a value that shouldn't have.
     */
    private function deriveExpenseType(): void
    {
        $patterns = ExpenseClassifier::capexPatterns();

        if ($patterns === []) {
            DB::table('expenses_logs')->update(['expense_type' => ExpenseClassifier::OPEX]);

            return;
        }

        $conditions = implode(' OR ', array_fill(
            0,
            count($patterns),
            "LOWER(COALESCE(category, '')) LIKE ?"
        ));

        $bindings = array_map(
            fn ($pattern) => '%' . strtolower(trim((string) $pattern)) . '%',
            $patterns
        );

        // Raw statement rather than the query builder: the CASE carries the LIKE
        // placeholders, and update() has nowhere to attach bindings that belong to
        // a raw expression. One statement, so the ledger is scanned once.
        DB::update(
            'UPDATE expenses_logs SET expense_type = CASE WHEN ' . $conditions
            . " THEN '" . ExpenseClassifier::CAPEX . "'"
            . " ELSE '" . ExpenseClassifier::OPEX . "' END",
            $bindings
        );
    }

    /**
     * Step 3 — anything still outside the two vocabularies gets a sane value.
     *
     * Touches only the rows that need it, so a re-run writes nothing.
     */
    private function normaliseStragglers(): void
    {
        DB::table('expenses_logs')
            ->whereNotIn('expense_type', ExpenseClassifier::TYPES)
            ->update(['expense_type' => ExpenseClassifier::OPEX]);

        DB::table('expenses_logs')
            ->whereNotIn('frequency', array_values(self::LEGACY_FREQUENCY))
            ->update(['frequency' => 'Daily']);
    }

    /**
     * Puts the legacy vocabulary back into expense_type and drops `frequency`.
     *
     * The daily/monthly distinction survives the round trip because it is read
     * back out of `frequency`, which still holds it. The OpEx/CapEx split does
     * not survive — there was nowhere to record it before this migration — but
     * it was derived rather than entered, so re-running up() reproduces it
     * exactly.
     */
    public function down(): void
    {
        if (!Schema::hasTable('expenses_logs') || !Schema::hasColumn('expenses_logs', 'frequency')) {
            return;
        }

        DB::transaction(function () {
            DB::table('expenses_logs')->update([
                'expense_type' => DB::raw(
                    "CASE LOWER(TRIM(COALESCE(frequency, '')))"
                    . " WHEN 'monthly' THEN 'monthly'"
                    . " ELSE 'daily' END"
                ),
            ]);
        });

        Schema::table('expenses_logs', function (Blueprint $table) {
            if ($this->hasIndex(self::FREQUENCY_INDEX)) {
                $table->dropIndex(self::FREQUENCY_INDEX);
            }
        });

        Schema::table('expenses_logs', function (Blueprint $table) {
            $table->dropColumn('frequency');
        });
    }
};

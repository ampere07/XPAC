<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Widen transactions.transaction_type for the prepaid / postpaid split.
     *
     * Two new members:
     *   - 'Top Up'         the PREPAID equivalent of a recurring payment. It buys service days
     *                      (and optionally a plan change) rather than settling an invoice, so it
     *                      has to be distinguishable from 'Recurring Fee' in reports and in the
     *                      revert path. See TransactionType::forGenerationType().
     *   - 'Service Charge' a payment against a Service Order charge, on EITHER account type.
     *
     * 'Recurring Fee' and 'Security Deposit' are deliberately left in place. The spec writes the
     * postpaid recurring type as 'Recurring', but that is the same concept under a shorter name —
     * renaming the member would rewrite every historical row and every report that groups on it,
     * for no behavioural gain.
     *
     * The new member list is built from whatever the column ALREADY declares rather than from a
     * hardcoded list. Production drifted from database/migrations/2024_01_01_000100 (which
     * created the enum lower-cased) to the title-cased spelling in db_schema.json, so a literal
     * MODIFY would silently re-case every stored value on whichever deployment did not drift.
     * Reading the live definition first means each environment keeps its own spelling.
     *
     * No-op when the column is not an enum: some deployments carry it as a plain varchar, where
     * there is nothing to widen and the new values already insert cleanly.
     */
    public function up(): void
    {
        $this->setEnumMembers(array_merge($this->currentMembers(), self::ADDED));
    }

    /**
     * Reverting is only safe once no row uses the added members — MySQL would coerce any
     * remaining 'Top Up' to '' and quietly destroy it. The backfill in the next migration is what
     * creates those rows, and its own down() puts them back to 'Recurring Fee' first.
     */
    public function down(): void
    {
        $inUse = DB::table('transactions')->whereIn('transaction_type', self::ADDED)->count();

        if ($inUse > 0) {
            throw new RuntimeException(
                "Cannot narrow transactions.transaction_type: {$inUse} row(s) still use "
                . implode(' / ', self::ADDED) . '. Roll back the backfill migration first.'
            );
        }

        $this->setEnumMembers(array_values(array_diff($this->currentMembers(), self::ADDED)));
    }

    /** Members this migration is responsible for. */
    private const ADDED = ['Top Up', 'Service Charge'];

    /**
     * The enum members currently declared on the column, or [] when it is not an enum.
     */
    private function currentMembers(): array
    {
        if (!Schema::hasTable('transactions') || !Schema::hasColumn('transactions', 'transaction_type')) {
            return [];
        }

        $type = (string) DB::selectOne(
            'SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [Schema::getConnection()->getDatabaseName(), 'transactions', 'transaction_type']
        )?->t;

        if (!preg_match('/^enum\((.*)\)$/i', $type, $matches)) {
            return [];
        }

        // Members come back as a quoted, comma-separated list. MySQL escapes an embedded quote by
        // doubling it, which is what the str_replace undoes.
        preg_match_all("/'((?:[^']|'')*)'/", $matches[1], $found);

        return array_map(fn($member) => str_replace("''", "'", $member), $found[1]);
    }

    /**
     * Rewrite the enum definition. Left nullable to match the existing column — the create
     * migration declared it ->nullable() and rows predating the transaction form still rely on it.
     */
    private function setEnumMembers(array $members): void
    {
        $members = array_values(array_unique($members));

        // Empty means the column is absent or not an enum; nothing to rewrite.
        if (empty($members)) {
            return;
        }

        $quoted = implode(',', array_map(
            fn($member) => "'" . str_replace("'", "''", $member) . "'",
            $members
        ));

        DB::statement("ALTER TABLE `transactions` MODIFY `transaction_type` ENUM({$quoted}) NULL");
    }
};

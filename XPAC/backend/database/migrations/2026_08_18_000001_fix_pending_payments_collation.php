<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Align `pending_payments` with the rest of the schema's collation.
 *
 * The reconciliation audit joins `pending_payments.account_no` against
 * `billing_accounts.account_no`. On this database the two columns ended up with
 * different collations — `utf8mb4_uca1400_ai_ci` on pending_payments (MariaDB
 * 11.4's new default) against `utf8mb4_unicode_ci` everywhere else — and MySQL
 * refuses to compare them:
 *
 *   SQLSTATE[HY000] 1267: Illegal mix of collations
 *   (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_uca1400_ai_ci,IMPLICIT) for operation '='
 *
 * The table was created by a migration that never named a collation, so it took
 * whatever the server default was at creation time. Any table created on a
 * MariaDB 11.4+ server has the same exposure; this one is fixed because it is the
 * one that actually joins across the boundary.
 *
 * Data safety: `CONVERT TO CHARACTER SET` rewrites the table in place. Both
 * collations are utf8mb4, so no byte in any stored value changes — only the
 * comparison rules attached to the columns. Account numbers, reference numbers
 * and statuses in this schema are ASCII, so even the sorting behaviour is
 * unchanged in practice.
 *
 * Guarded so it is safe to run twice: converting a table already in the target
 * collation is a no-op that still succeeds.
 *
 * `down()` is deliberately empty. Reverting would mean deliberately restoring the
 * mismatch that breaks the audit endpoint, and the original collation was a
 * server default rather than an intentional choice — there is nothing meaningful
 * to go back to.
 */
return new class extends Migration
{
    private const TABLE = 'pending_payments';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        // The connection has to be MySQL/MariaDB for any of this to mean anything.
        if (!in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        DB::statement('ALTER TABLE `pending_payments` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');

        // CONVERT TO CHARACTER SET already moved every column. The three that take
        // part in joins or filters are restated explicitly so their collation is
        // pinned rather than inherited, and cannot drift back if the table is ever
        // altered again on a server with a different default.
        //
        // Each keeps its CURRENT length rather than a hardcoded one. `reference_no`
        // is VARCHAR(255) here and carries a UNIQUE index: narrowing it would either
        // error on over-length data or silently truncate it into a duplicate-key
        // failure partway through the ALTER. Nothing about the collation fix needs a
        // length change, so none is made.
        foreach ([
            'account_no'   => "NOT NULL",
            'reference_no' => "NOT NULL",
            'status'       => "NOT NULL DEFAULT 'PENDING'",
        ] as $column => $constraints) {
            $length = $this->currentLength($column);

            if ($length === null) {
                // Column absent or not a VARCHAR — the table-wide CONVERT above
                // already handled it, so there is nothing further to pin.
                continue;
            }

            DB::statement(
                "ALTER TABLE `pending_payments` MODIFY `{$column}` VARCHAR({$length})"
                . " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci {$constraints}"
            );
        }
    }

    /**
     * The column's current VARCHAR length, or null if it is not a VARCHAR.
     *
     * Read from INFORMATION_SCHEMA rather than assumed, so this migration can never
     * be the thing that shrinks a column on production data.
     */
    private function currentLength(string $column): ?int
    {
        $row = DB::selectOne(
            'SELECT CHARACTER_MAXIMUM_LENGTH AS len, DATA_TYPE AS type
               FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = ?
                AND COLUMN_NAME = ?',
            [self::TABLE, $column]
        );

        if ($row === null || strtolower((string) $row->type) !== 'varchar' || $row->len === null) {
            return null;
        }

        return (int) $row->len;
    }

    public function down(): void
    {
        // Intentionally empty — see the class comment.
    }
};

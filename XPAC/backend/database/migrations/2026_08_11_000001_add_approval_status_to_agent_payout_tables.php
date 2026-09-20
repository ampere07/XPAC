<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bring agent payouts onto the same approval workflow as transactions.
 *
 * Transactions are created as 'Pending' and only affect the account balance once
 * approved, recording the approver's email in `approved_by`. Agent payouts had
 * no status at all — they applied immediately — so this adds the missing status
 * column to both payout ledgers. The approver column (`approve_by`) already
 * exists on both tables and is reused rather than duplicated.
 *
 * IMPORTANT — existing rows are backfilled as 'Approved'.
 *
 * Every payout recorded before this change already moved the agent's balance at
 * the time it was saved. Leaving them 'Pending' would invite someone to approve
 * them later and deduct the same money a second time. Marking them 'Approved'
 * records what actually happened and makes them ineligible for approval.
 *
 * Guarded throughout: safe on a deployment whose tables were created by hand,
 * and safe to run more than once.
 */
return new class extends Migration
{
    /** Ledger tables that gain the status column. */
    private const TABLES = ['agent_commission_history', 'agent_bonus_history'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            if (!Schema::hasTable($table)) {
                continue;
            }

            if (!Schema::hasColumn($table, 'status')) {
                Schema::table($table, function (Blueprint $t) {
                    // Matches transactions.status: a short free-text state rather
                    // than an enum, so a new state needs no schema change.
                    $t->string('status', 20)->nullable()->default('Pending');
                });
            }

            // The approver column is expected to already exist; add it only if a
            // hand-built table is missing it, so both ledgers end up consistent.
            if (!Schema::hasColumn($table, 'approve_by')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->string('approve_by', 255)->nullable();
                });
            }

            // A commission payout settles specific job orders. Now that the
            // effect is deferred to approval, the payout has to remember which
            // ones it covered so approval marks exactly those as paid.
            if ($table === 'agent_commission_history' && !Schema::hasColumn($table, 'job_order_ids')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->text('job_order_ids')->nullable();
                });
            }

            // Everything recorded before this migration has already been applied
            // to the agent's balance, so it is approved by definition.
            DB::table($table)->whereNull('status')->update(['status' => 'Approved']);
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'status')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->dropColumn('status');
                });
            }
        }
    }
};

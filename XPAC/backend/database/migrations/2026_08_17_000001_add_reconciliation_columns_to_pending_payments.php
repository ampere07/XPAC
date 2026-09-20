<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Webhook-independent reconciliation state for Xendit payments.
 *
 * Until now a payment only ever moved off PENDING because Xendit called our
 * webhook. A dropped callback — provider retry exhaustion, our host down, a
 * firewall rule, a deploy — left a customer who really paid sitting at PENDING
 * forever, still disconnected. These columns let a cron ask Xendit directly.
 *
 *   currency                 what the gateway was asked to charge. Verified
 *                            against the reconciliation response so a PHP
 *                            invoice can never be settled by a USD payment.
 *   xendit_payment_id        the *payment* that settled the request, as opposed
 *                            to `payment_id`, which holds the invoice/payment
 *                            request we created. Null until something pays.
 *   reconciliation_attempts  how many times we have asked. Drives the backoff
 *                            tier, so it must survive across runs.
 *   next_reconciliation_at   when this row becomes eligible again. Null means
 *                            "never swept" and is treated as immediately due.
 *   last_reconciled_at       when we last got an answer. Diagnostics only.
 *
 * `next_reconciliation_at` carries the index because the sweep's WHERE clause
 * is (status, next_reconciliation_at) on a table that grows one row per payment
 * attempt forever. Without it the every-two-minute cron degrades into a full
 * scan as the table fills.
 *
 * Deliberately NOT added: a second copy of the reference number, the request
 * amount, or the payment request id. `reference_no`, `amount` and `payment_id`
 * already hold exactly those values and are what the webhook, the payment
 * worker and the portal all read. A parallel column would be a second source of
 * truth for money, and the two would drift.
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const TABLE = 'pending_payments';

    public function up(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::table(self::TABLE, function (Blueprint $t) {
            if (!Schema::hasColumn(self::TABLE, 'currency')) {
                $t->string('currency', 10)->nullable()->default('PHP');
            }

            if (!Schema::hasColumn(self::TABLE, 'xendit_payment_id')) {
                $t->string('xendit_payment_id')->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'reconciliation_attempts')) {
                $t->integer('reconciliation_attempts')->default(0);
            }

            if (!Schema::hasColumn(self::TABLE, 'next_reconciliation_at')) {
                // Nullable on purpose: rows created before this migration have
                // never been swept, and null sorts as "due now" in the worker.
                $t->timestamp('next_reconciliation_at')->nullable();
            }

            if (!Schema::hasColumn(self::TABLE, 'last_reconciled_at')) {
                $t->timestamp('last_reconciled_at')->nullable();
            }
        });

        try {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->index(['status', 'next_reconciliation_at'], 'pending_payments_reconciliation_index');
            });
        } catch (\Throwable $e) {
            // The index is already there.
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable(self::TABLE)) {
            return;
        }

        try {
            Schema::table(self::TABLE, function (Blueprint $t) {
                $t->dropIndex('pending_payments_reconciliation_index');
            });
        } catch (\Throwable $e) {
            // Never existed.
        }

        foreach ([
            'currency',
            'xendit_payment_id',
            'reconciliation_attempts',
            'next_reconciliation_at',
            'last_reconciled_at',
        ] as $column) {
            if (Schema::hasColumn(self::TABLE, $column)) {
                Schema::table(self::TABLE, function (Blueprint $t) use ($column) {
                    $t->dropColumn($column);
                });
            }
        }
    }
};

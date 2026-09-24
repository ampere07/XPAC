<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Recurring and scheduled monthly obligations — rent, utilities, bandwidth,
     * subscriptions, vendor retainers, supplier dues.
     *
     * This is deliberately NOT the same thing as `expenses_logs.expense_type = 'monthly'`.
     * That flag is a bucket tag on an expense that already happened. A payable is money
     * *owed* for a billing period: it carries a due date, accrues payments, and moves
     * through a status lifecycle until it is settled.
     *
     *  - category_id     links to `expenses_category` — the app's existing category table.
     *                    Named `expenses_category` (singular), not `expense_categories`.
     *  - organization_id follows the org rule the rest of the app uses: an org-scoped user
     *                    sees that org's rows, an unscoped user sees the NULL ones.
     *  - billing_month   'YYYY-MM'. Stored as a string rather than derived from due_date
     *                    because a bill for June can legitimately fall due in July.
     *  - amount_paid     denormalised running total of `payable_payments.amount`. Kept on
     *                    the row so the list and the metric cards never need a per-row
     *                    subquery; the controller rewrites it from the ledger on every
     *                    payment change, so the ledger stays the source of truth.
     *  - is_recurring    marks a row as a template for generateMonthlyBatch, which copies
     *                    flagged rows forward into the next billing month.
     */
    public function up(): void
    {
        Schema::create('monthly_payables', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('organization_id')->nullable();
            $table->string('title', 200);
            $table->unsignedBigInteger('category_id');
            $table->string('vendor_name', 200)->nullable();
            $table->string('account_number', 100)->nullable();
            $table->decimal('amount_due', 12, 2);
            $table->decimal('amount_paid', 12, 2)->default(0.00);
            $table->date('due_date');
            $table->string('billing_month', 7);
            $table->enum('status', ['pending', 'partial', 'paid', 'overdue', 'cancelled'])
                ->default('pending');
            $table->boolean('is_recurring')->default(false);
            $table->text('notes')->nullable();
            $table->string('receipt_path', 500)->nullable();
            $table->string('created_by', 150)->nullable();
            $table->string('modified_by', 150)->nullable();
            $table->timestamps();
            $table->softDeletes();

            // The list is always filtered by org + billing month first.
            $table->index(['organization_id', 'billing_month'], 'monthly_payables_org_month_index');
            // Drives both the overdue sweep and the sidebar alert count.
            $table->index(['status', 'due_date'], 'monthly_payables_status_due_index');
            $table->index('category_id', 'monthly_payables_category_id_index');
            $table->index('is_recurring', 'monthly_payables_is_recurring_index');
            $table->index('deleted_at', 'monthly_payables_deleted_at_index');

            // restrictOnDelete: a category with payables against it must not vanish and
            // leave the rows pointing at nothing — amounts owed have to stay attributable.
            $table->foreign('category_id', 'monthly_payables_category_id_foreign')
                ->references('id')->on('expenses_category')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('monthly_payables');
    }
};

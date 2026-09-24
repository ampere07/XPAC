<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Approval queue for manual adjustments to a prepaid customer's service period.
 *
 * billing_accounts.prepaid_expires_at used to be directly editable on the Edit Billing Details
 * form, which meant a single mistyped date could hand out (or take away) months of service with no
 * record of who did it or why. That field is now read-only and every adjustment arrives here as a
 * request that someone else has to approve.
 *
 * The adjustment is stored as a SIGNED NUMBER OF DAYS rather than a target date: what the requester
 * is actually asking for is "give this customer 7 more days", and the answer must stay correct even
 * if the customer pays (moving prepaid_expires_at forward) between the request and the approval.
 * The absolute expiry is resolved at approval time and both sides of the move are recorded in
 * expiry_before / expiry_after.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('prepaid_override_requests')) {
            return;
        }

        Schema::create('prepaid_override_requests', function (Blueprint $table) {
            $table->id();

            // Nullable to match every other table in this schema: superadmin rows carry no
            // organization, and the list endpoints filter on that same convention.
            $table->bigInteger('organization_id')->nullable();

            // account_no is the join key the rest of the billing code uses; billing_account_id is
            // carried alongside it so activity logs and the RADIUS queue can reference the row by
            // id without a second lookup.
            $table->string('account_no', 100);
            $table->unsignedBigInteger('billing_account_id')->nullable();

            // Signed: positive extends the period, negative claws days back. Never zero — the
            // request would be a no-op and the validator rejects it.
            $table->integer('days_adjustment');

            $table->text('reason');
            $table->text('remarks')->nullable();

            // pending -> processed (approved and applied) | rejected. 'approved' is accepted from
            // clients and is the same decision as 'processed'; the stored terminal value is
            // 'processed' so the column never claims an adjustment landed when it did not.
            $table->string('status', 50)->default('pending');

            // Both sides of the actual move, filled in at approval. Kept even when the approval is
            // later superseded — this is the audit trail for "who gave this customer 30 days".
            $table->dateTime('expiry_before')->nullable();
            $table->dateTime('expiry_after')->nullable();
            $table->dateTime('processed_at')->nullable();

            $table->unsignedBigInteger('requested_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();

            $table->timestamps();

            // Serves the list view's default ordering and the org scope in one pass.
            $table->index(['organization_id', 'created_at'], 'idx_por_org_created');
            // Backs the duplicate-pending guard in PrepaidOverrideService::createRequest(), which
            // runs on every submission.
            $table->index(['account_no', 'status'], 'idx_por_account_status');
            $table->index('status', 'idx_por_status');
            // The store's incremental poll filters on updated_at > lastUpdated.
            $table->index('updated_at', 'idx_por_updated');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prepaid_override_requests');
    }
};

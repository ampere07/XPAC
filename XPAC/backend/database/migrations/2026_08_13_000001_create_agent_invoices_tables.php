<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Weekly referral invoices for agents and agent teams.
 *
 * One invoice covers one owner for one billing week, where an owner is either a
 * team or a solo agent. Every referred customer the invoice bills for is listed
 * on `agent_invoice_customers`, one row per customer, which is also what stops a
 * customer being billed twice.
 *
 * `owner_key` ("team:5" / "solo:201") carries the owner on both tables. It looks
 * redundant next to team_id and agent_id, but it is what makes the uniqueness
 * enforceable: MySQL treats NULLs as distinct in a unique index, so a key built
 * from the nullable columns would let a team invoice with a NULL agent_id repeat
 * without the database noticing. A single non-null string cannot.
 *
 * Guarded so it is safe to run twice.
 */
return new class extends Migration
{
    private const INVOICES  = 'agent_invoices';
    private const CUSTOMERS = 'agent_invoice_customers';

    public function up(): void
    {
        if (!Schema::hasTable(self::INVOICES)) {
            Schema::create(self::INVOICES, function (Blueprint $t) {
                $t->id();

                // Never reused, even if an invoice is deleted from the UI.
                $t->string('invoice_number', 40)->unique();

                // 'team' or 'solo'.
                $t->string('invoice_type', 10)->index();

                // "team:5" / "solo:201" — the owner this invoice belongs to.
                $t->string('owner_key', 40)->index();

                // The team, when this is a team invoice.
                $t->unsignedBigInteger('team_id')->nullable()->index();
                // The agent, when this is a solo invoice.
                $t->unsignedBigInteger('agent_id')->nullable()->index();

                // Names as they were when the invoice was raised, so a later
                // rename does not rewrite history on an already-issued document.
                $t->string('team_name')->nullable();
                $t->string('agent_name')->nullable();

                $t->date('period_start');
                $t->date('period_end');
                $t->date('invoice_date');

                $t->integer('total_customers')->default(0);
                $t->decimal('unit_price', 12, 2)->default(0);
                $t->decimal('installation_fee', 12, 2)->default(0);
                $t->decimal('total_amount', 12, 2)->default(0);
                $t->decimal('commission', 12, 2)->default(0);
                $t->decimal('subtotal', 12, 2)->default(0);

                $t->string('pdf_path')->nullable();

                // 'Generated' | 'Sent' | 'Paid' | 'Cancelled'
                $t->string('status', 20)->default('Generated')->index();

                $t->unsignedBigInteger('organization_id')->nullable()->index();
                $t->string('created_by')->nullable();
                $t->string('updated_by')->nullable();
                $t->timestamps();

                // One invoice per owner per billing week. This is what makes a
                // repeated run harmless: the second attempt is refused here
                // rather than relying on the schedule firing exactly once.
                $t->unique(['owner_key', 'period_start'], 'agent_invoice_owner_period_unique');

                // The listing sorts newest-first and filters by owner.
                $t->index(['owner_key', 'invoice_date'], 'agent_invoice_owner_date_index');
            });
        }

        if (!Schema::hasTable(self::CUSTOMERS)) {
            Schema::create(self::CUSTOMERS, function (Blueprint $t) {
                $t->id();

                $t->unsignedBigInteger('agent_invoice_id');
                // The referred customer, as their application record.
                $t->unsignedBigInteger('application_id');
                // The installed job order the referral was billed on, if known.
                $t->unsignedBigInteger('job_order_id')->nullable()->index();

                // Repeated from the invoice so the uniqueness below can be
                // enforced by the database rather than by a query.
                $t->string('owner_key', 40)->index();

                $t->string('customer_name');
                // Which agent in the team actually referred them.
                $t->unsignedBigInteger('referred_by_agent_id')->nullable()->index();
                $t->string('referred_by_name')->nullable();
                // The raw "Referred By" value, kept for tracing a mismatch.
                $t->string('referred_by_raw')->nullable();

                $t->date('installed_date')->nullable();
                $t->decimal('unit_price', 12, 2)->default(0);
                $t->integer('quantity')->default(1);
                $t->decimal('total', 12, 2)->default(0);

                $t->timestamps();

                $t->foreign('agent_invoice_id')
                  ->references('id')->on(self::INVOICES)
                  ->onDelete('cascade');

                // A customer appears once on an invoice...
                $t->unique(['agent_invoice_id', 'application_id'], 'agent_invoice_customer_unique');

                // ...and once for an owner, ever. This is the duplicate
                // prevention the requirement asks the database to enforce: a
                // customer already billed for this team or agent cannot be
                // written onto a later invoice for them, whatever the caller
                // believes.
                $t->unique(['owner_key', 'application_id'], 'agent_invoice_owner_customer_unique');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists(self::CUSTOMERS);
        Schema::dropIfExists(self::INVOICES);
    }
};

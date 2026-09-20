<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_accounts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('customer_id')->nullable();
            $table->string('account_no');
            $table->date('date_installed')->nullable();
            $table->unsignedBigInteger('plan_id')->nullable();
            $table->decimal('account_balance', 12, 2)->default(0.00);
            $table->dateTime('balance_update_date')->nullable();
            $table->integer('billing_day')->nullable();
            $table->unsignedBigInteger('billing_status_id')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->dateTime('vip_expiration')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->string('vip_remarks')->nullable();
            $table->timestamps();
            $table->unique('account_no', 'billing_accounts_account_no_unique');
            $table->index('customer_id', 'billing_accounts_customer_id_foreign');
            $table->index('plan_id', 'billing_accounts_plan_id_foreign');
            $table->index('billing_status_id', 'billing_accounts_billing_status_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_accounts');
    }
};

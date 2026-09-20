<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_change_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->unsignedBigInteger('old_plan_id')->nullable();
            $table->unsignedBigInteger('new_plan_id')->nullable();
            $table->string('status', 100)->nullable();
            $table->dateTime('date_changed')->nullable();
            $table->dateTime('date_used')->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->timestamps();
            $table->index('account_id', 'plan_change_logs_account_id_foreign');
            $table->index('old_plan_id', 'plan_change_logs_old_plan_id_foreign');
            $table->index('new_plan_id', 'plan_change_logs_new_plan_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_change_logs');
    }
};

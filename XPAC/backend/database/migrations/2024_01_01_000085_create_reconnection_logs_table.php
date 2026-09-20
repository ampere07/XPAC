<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reconnection_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('session_id')->nullable();
            $table->string('username')->nullable();
            $table->unsignedBigInteger('plan_id')->nullable();
            $table->decimal('reconnection_fee', 10, 2)->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->timestamps();
            $table->index('account_id', 'reconnection_logs_account_id_foreign');
            $table->index('plan_id', 'reconnection_logs_plan_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reconnection_logs');
    }
};

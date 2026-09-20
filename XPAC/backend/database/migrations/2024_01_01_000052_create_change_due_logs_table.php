<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('change_due_logs', function (Blueprint $table) {
            $table->id();
            $table->string('account_no');
            $table->string('previous_date')->nullable();
            $table->string('changed_date')->nullable();
            $table->decimal('added_balance', 10, 2)->nullable();
            $table->text('remarks')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('created_by_user_id', 'change_due_logs_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('change_due_logs');
    }
};

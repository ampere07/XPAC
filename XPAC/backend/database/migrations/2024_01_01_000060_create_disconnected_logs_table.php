<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('disconnected_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('session_id')->nullable();
            $table->string('username')->nullable();
            $table->text('remarks')->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->timestamps();
            $table->index('account_id', 'disconnected_logs_account_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('disconnected_logs');
    }
};

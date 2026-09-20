<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('details_update_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->longText('old_details')->nullable();
            $table->longText('new_details')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->index('account_id', 'details_update_logs_account_id_foreign');
            $table->index('created_by_user_id', 'details_update_logs_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('details_update_logs');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_status', function (Blueprint $table) {
            $table->id();
            $table->string('status_name');
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->unique('status_name', 'billing_status_status_name_unique');
            $table->index('created_by_user_id', 'billing_status_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_status');
    }
};

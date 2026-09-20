<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('usage_type', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('usage_name');
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique('usage_name', 'usage_type_usage_name_unique');
            $table->index('created_by_user_id', 'usage_type_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('usage_type');
    }
};

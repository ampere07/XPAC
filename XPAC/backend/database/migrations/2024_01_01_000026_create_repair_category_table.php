<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('repair_category', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('category_name');
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique('category_name', 'repair_category_category_name_unique');
            $table->index('created_by_user_id', 'repair_category_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('repair_category');
    }
};

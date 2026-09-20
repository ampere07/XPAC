<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('city', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('region_id')->nullable();
            $table->string('city');
            $table->string('modified_by')->nullable();
            $table->dateTime('modified_at')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->index('region_id', 'city_region_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('city');
    }
};

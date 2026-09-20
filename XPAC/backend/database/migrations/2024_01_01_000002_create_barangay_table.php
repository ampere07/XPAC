<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('barangay', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('city_id')->nullable();
            $table->string('barangay');
            $table->string('modified_by')->nullable();
            $table->dateTime('modified_at')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->index('city_id', 'barangay_city_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('barangay');
    }
};

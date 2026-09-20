<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('location', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('barangay_id')->nullable();
            $table->string('location_name')->nullable();
            $table->index('barangay_id', 'village_barangay_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('location');
    }
};

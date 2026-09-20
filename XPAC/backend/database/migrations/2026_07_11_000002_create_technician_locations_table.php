<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One continuously-updated live-location row per technician (keyed by user_id).
     */
    public function up(): void
    {
        if (Schema::hasTable('technician_locations')) {
            return;
        }

        Schema::create('technician_locations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->bigInteger('organization_id')->nullable();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);
            $table->decimal('accuracy', 8, 2)->nullable();
            $table->decimal('speed', 8, 2)->nullable();
            $table->decimal('heading', 6, 2)->nullable();
            $table->string('status', 30)->default('online');
            $table->dateTime('last_updated_at')->nullable();
            $table->timestamps();

            // Exactly one active location record per technician.
            $table->unique('user_id');
            $table->index('organization_id');
            $table->index('last_updated_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('technician_locations');
    }
};

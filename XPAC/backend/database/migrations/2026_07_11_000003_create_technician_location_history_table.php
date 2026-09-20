<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Breadcrumb trail: append-only movement points per technician (for drawing paths).
     * Kept separate from the single-row live-location table and pruned by cron.
     */
    public function up(): void
    {
        if (Schema::hasTable('technician_location_history')) {
            return;
        }

        Schema::create('technician_location_history', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->bigInteger('organization_id')->nullable();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);
            $table->decimal('accuracy', 8, 2)->nullable();
            $table->decimal('speed', 8, 2)->nullable();
            $table->decimal('heading', 6, 2)->nullable();
            $table->dateTime('recorded_at');
            $table->timestamp('created_at')->nullable();

            $table->index(['user_id', 'recorded_at']);
            $table->index('recorded_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('technician_location_history');
    }
};

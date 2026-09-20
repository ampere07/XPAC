<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Progress state for the stepwise operations run by the Tools suite.
 *
 * The SmartOLT tool sweeps thousands of ONUs across many HTTP round trips, far
 * more than one request can complete. Each step advances a row here and returns,
 * so progress survives a reload and two operators cannot start overlapping runs
 * (SmartOltReconciliationService::startJob claims with lockForUpdate over the
 * active rows).
 *
 * Additive: no existing table or column is touched.
 */
return new class extends Migration
{
    private const TABLE = 'tool_jobs';

    public function up(): void
    {
        if (Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->id();
            $table->string('tool', 50);
            $table->string('type', 50);
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('current')->default(0);
            $table->unsignedInteger('total')->default(0);
            $table->text('message')->nullable();
            $table->longText('context')->nullable();
            $table->longText('summary')->nullable();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();

            // The claim in startJob() filters on (tool, status); the UI polls by id.
            $table->index(['tool', 'status'], 'tool_jobs_tool_status_index');
            $table->index('created_at', 'tool_jobs_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
    }
};

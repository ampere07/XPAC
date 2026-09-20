<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rebates_usage', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->integer('rebates_id');
            $table->string('account_no')->nullable();
            $table->string('status', 50)->nullable();
            $table->string('month', 50)->nullable();
            $table->index('rebates_id', 'fk_rebates');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rebates_usage');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('concern', function (Blueprint $table) {
            $table->id();
            $table->string('concern_name');
            $table->string('modified_by')->nullable();
            $table->dateTime('modified_at')->nullable();
            $table->bigInteger('organization_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('concern');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_version_configs', function (Blueprint $table) {
            $table->id();
            $table->string('config_key');
            $table->text('config_value')->nullable();
            $table->string('updated_by');
            $table->timestamps();
            $table->unique('config_key', 'config_key');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_version_configs');
    }
};

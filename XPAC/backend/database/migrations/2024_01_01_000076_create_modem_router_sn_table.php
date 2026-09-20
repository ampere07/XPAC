<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('modem_router_sn', function (Blueprint $table) {
            $table->string('SN');
            $table->string('Model')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('modem_router_sn');
    }
};

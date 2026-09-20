<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('technical_details', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('account_no')->nullable();
            $table->string('username')->nullable();
            $table->string('username_status', 100)->nullable();
            $table->string('connection_type', 100)->nullable();
            $table->string('router_model')->nullable();
            $table->string('router_modem_sn')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('lcp')->nullable();
            $table->string('nap')->nullable();
            $table->string('port')->nullable();
            $table->string('vlan')->nullable();
            $table->string('lcpnap')->nullable();
            $table->string('usage_type')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->timestamps();
            $table->unique('username', 'technical_details_username_unique');
            $table->index('account_id', 'technical_details_account_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('technical_details');
    }
};

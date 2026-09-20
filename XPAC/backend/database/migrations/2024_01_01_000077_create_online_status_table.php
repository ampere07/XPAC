<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('online_status', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('account_no')->nullable();
            $table->string('username')->nullable();
            $table->string('session_status', 100)->nullable();
            $table->string('session_group', 100)->nullable();
            $table->string('session_id')->nullable();
            $table->integer('active_sessions')->nullable();
            $table->bigInteger('total_download')->nullable();
            $table->bigInteger('total_upload')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('city')->nullable();
            $table->string('session_mac_address', 17)->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->unique('account_id', 'online_status_account_id_unique');
            $table->unique('username', 'online_status_username_unique');
            $table->unique('session_mac_address', 'online_status_session_mac_address_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('online_status');
    }
};

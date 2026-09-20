<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sms_blast_logs', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->text('message')->nullable();
            $table->unsignedBigInteger('barangay_id')->nullable();
            $table->integer('billing_day')->nullable();
            $table->unsignedBigInteger('lcpnap_id')->nullable();
            $table->unsignedBigInteger('lcp_id')->nullable();
            $table->integer('message_count')->nullable();
            $table->dateTime('timestamp')->nullable();
            $table->decimal('credit_used', 10, 2)->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->index('lcpnap_id', 'sms_blast_logs_lcpnap_id_foreign');
            $table->index('lcp_id', 'sms_blast_logs_lcp_id_foreign');
            $table->index('created_by_user_id', 'sms_blast_logs_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sms_blast_logs');
    }
};

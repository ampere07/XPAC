<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('job_orders', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->dateTime('timestamp')->nullable();
            $table->date('date_installed')->nullable();
            $table->decimal('installation_fee', 10, 2)->nullable();
            $table->integer('billing_day')->nullable();
            $table->string('billing_status')->nullable();
            $table->string('status', 100)->nullable();
            $table->string('modem_router_sn')->nullable();
            $table->string('router_model')->nullable();
            $table->string('group_name')->nullable();
            $table->string('lcpnap')->nullable();
            $table->string('port')->nullable();
            $table->string('vlan')->nullable();
            $table->string('username')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('connection_type', 100)->nullable();
            $table->string('usage_type')->nullable();
            $table->string('username_status', 100)->nullable();
            $table->string('visit_by')->nullable();
            $table->string('visit_with')->nullable();
            $table->string('visit_with_other')->nullable();
            $table->string('onsite_status', 100)->nullable();
            $table->text('onsite_remarks')->nullable();
            $table->string('status_remarks')->nullable();
            $table->string('address_coordinates')->nullable();
            $table->string('contract_link')->nullable();
            $table->string('client_signature_url')->nullable();
            $table->string('setup_image_url')->nullable();
            $table->string('speedtest_image_url')->nullable();
            $table->string('signed_contract_image_url')->nullable();
            $table->string('box_reading_image_url')->nullable();
            $table->string('router_reading_image_url')->nullable();
            $table->string('port_label_image_url')->nullable();
            $table->string('house_front_picture_url')->nullable();
            $table->string('created_by_user_email')->nullable();
            $table->string('updated_by_user_email')->nullable();
            $table->string('assigned_email')->nullable();
            $table->string('pppoe_username')->nullable();
            $table->string('pppoe_password')->nullable();
            $table->string('installation_landmark')->nullable();
            $table->dateTime('start_time')->nullable();
            $table->dateTime('end_time')->nullable();
            $table->string('proof_image_url')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->text('technicians')->nullable();
            $table->string('client_tagging_url')->nullable();
            $table->timestamps();
            $table->index('account_id', 'job_orders_account_id_foreign');
            $table->index('application_id', 'job_orders_application_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_orders');
    }
};

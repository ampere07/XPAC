<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_orders', function (Blueprint $table) {
            $table->id();
            $table->string('account_no')->nullable();
            $table->string('invoice_id')->nullable();
            $table->string('status')->nullable();
            $table->string('ticket_id')->nullable();
            $table->dateTime('timestamp')->nullable();
            $table->string('support_status', 100)->nullable();
            $table->string('concern')->nullable();
            $table->text('concern_remarks')->nullable();
            $table->string('priority_level', 50)->nullable();
            $table->string('requested_by')->nullable();
            $table->string('assigned_email')->nullable();
            $table->string('visit_status', 100)->nullable();
            $table->string('visit_by_user')->nullable();
            $table->string('visit_with')->nullable();
            $table->string('visit_with_other')->nullable();
            $table->text('visit_remarks')->nullable();
            $table->string('repair_category')->nullable();
            $table->text('support_remarks')->nullable();
            $table->decimal('service_charge', 10, 2)->nullable();
            $table->string('client_signature_url')->nullable();
            $table->string('image1_url')->nullable();
            $table->string('image2_url')->nullable();
            $table->string('image3_url')->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->string('old_lcp')->nullable();
            $table->string('old_nap')->nullable();
            $table->string('old_port')->nullable();
            $table->string('old_router_modem_sn')->nullable();
            $table->string('old_vlan')->nullable();
            $table->string('new_router_modem_sn')->nullable();
            $table->string('new_lcp')->nullable();
            $table->string('new_nap')->nullable();
            $table->string('new_port')->nullable();
            $table->string('new_vlan')->nullable();
            $table->string('router_model')->nullable();
            $table->string('new_lcpnap')->nullable();
            $table->string('old_lcpnap')->nullable();
            $table->string('old_plan')->nullable();
            $table->string('new_plan')->nullable();
            $table->string('referred_by')->nullable();
            $table->dateTime('start_time')->nullable();
            $table->dateTime('end_time')->nullable();
            $table->string('proof_image_url')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->dateTime('date_installed')->nullable();
            $table->text('technicians')->nullable();
            $table->string('speedtest_image_url')->nullable();
            $table->string('setup_image_url')->nullable();
            $table->string('box_reading_image_url')->nullable();
            $table->string('router_reading_image_url')->nullable();
            $table->timestamps();
            $table->index('account_no', 'service_orders_account_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_orders');
    }
};

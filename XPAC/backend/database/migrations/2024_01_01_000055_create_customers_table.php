<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('first_name')->nullable();
            $table->char('middle_initial', 6)->nullable();
            $table->string('last_name')->nullable();
            $table->string('email_address')->nullable();
            $table->string('contact_number_primary', 50)->nullable();
            $table->string('contact_number_secondary', 50)->nullable();
            $table->text('address')->nullable();
            $table->string('location')->nullable();
            $table->string('barangay')->nullable();
            $table->string('city')->nullable();
            $table->string('region')->nullable();
            $table->string('address_coordinates')->nullable();
            $table->string('housing_status', 100)->nullable();
            $table->string('referred_by')->nullable();
            $table->string('group_name')->nullable();
            $table->string('created_by')->nullable();
            $table->string('updated_by')->nullable();
            $table->string('desired_plan')->nullable();
            $table->string('house_front_picture_url')->nullable();
            $table->string('account_no')->nullable();
            $table->string('proof_of_billing_url')->nullable();
            $table->string('government_valid_id_url')->nullable();
            $table->string('second_government_valid_id_url')->nullable();
            $table->string('document_attachment_url')->nullable();
            $table->string('other_isp_bill_url')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};

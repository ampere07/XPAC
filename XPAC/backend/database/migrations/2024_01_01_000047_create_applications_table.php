<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('applications', function (Blueprint $table) {
            $table->id();
            $table->dateTime('timestamp')->nullable();
            $table->string('email_address')->nullable();
            $table->string('first_name')->nullable();
            $table->char('middle_initial', 255)->nullable();
            $table->string('last_name')->nullable();
            $table->string('mobile_number', 50)->nullable();
            $table->string('secondary_mobile_number', 50)->nullable();
            $table->text('installation_address')->nullable();
            $table->text('landmark')->nullable();
            $table->string('region')->nullable();
            $table->string('city')->nullable();
            $table->string('barangay')->nullable();
            $table->string('location')->nullable();
            $table->string('desired_plan')->nullable();
            $table->string('promo')->nullable();
            $table->unsignedBigInteger('referrer_account_id')->nullable();
            $table->string('referred_by')->nullable();
            $table->string('proof_of_billing_url')->nullable();
            $table->string('government_valid_id_url')->nullable();
            $table->string('second_government_valid_id_url')->nullable();
            $table->string('house_front_picture_url')->nullable();
            $table->string('document_attachment_url')->nullable();
            $table->string('other_isp_bill_url')->nullable();
            $table->string('terms_agreed')->default(0);
            $table->string('status', 100)->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->string('updated_by')->nullable();
            $table->string('promo_url')->nullable();
            $table->string('nearest_landmark1_url')->nullable();
            $table->string('nearest_landmark2_url')->nullable();
            $table->string('long_lat')->nullable();
            $table->text('remarks')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('referrer_account_id', 'applications_referrer_account_id_foreign');
            $table->index('created_by_user_id', 'applications_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('applications');
    }
};

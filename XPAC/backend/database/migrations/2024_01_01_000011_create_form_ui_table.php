<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('form_ui', function (Blueprint $table) {
            $table->string('page_hex', 25)->nullable();
            $table->string('button_hex', 25)->nullable();
            $table->string('logo_url')->nullable();
            $table->string('multi_step', 50)->nullable()->default('inactive');
            $table->string('brand_name')->nullable();
            $table->string('transparency_rgba')->nullable();
            $table->string('form_hex')->nullable();
            $table->string('proof_of_billing', 100)->nullable();
            $table->string('id_primary', 100)->nullable();
            $table->string('id_secondary', 100)->nullable();
            $table->string('house_front_', 100)->nullable();
            $table->string('secondary_number', 100)->nullable();
            $table->string('captcha', 100)->nullable();
            $table->text('terms_and_condition')->nullable();
            $table->text('privacy_policy')->nullable();
            $table->text('contact_information')->nullable();
            $table->text('submit_modal')->nullable();
            $table->bigInteger('organization_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('form_ui');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('application_visits', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->dateTime('timestamp')->nullable();
            $table->string('assigned_email')->nullable();
            $table->string('visit_by')->nullable();
            $table->string('visit_with')->nullable();
            $table->string('visit_with_other')->nullable();
            $table->string('visit_status', 100)->nullable();
            $table->text('visit_remarks')->nullable();
            $table->string('application_status', 100)->nullable();
            $table->string('status_remarks')->nullable();
            $table->string('image1_url')->nullable();
            $table->string('image2_url')->nullable();
            $table->string('image3_url')->nullable();
            $table->string('house_front_picture_url')->nullable();
            $table->string('created_by_user_email')->nullable();
            $table->string('updated_by_user_email')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
            $table->index('application_id', 'application_visits_application_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('application_visits');
    }
};

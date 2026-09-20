<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lcpnap', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('lcpnap_name');
            $table->string('reading_image_url')->nullable();
            $table->string('street')->nullable();
            $table->string('region')->nullable();
            $table->string('city')->nullable();
            $table->string('barangay')->nullable();
            $table->string('location')->nullable();
            $table->string('lcp')->nullable();
            $table->string('nap')->nullable();
            $table->integer('port_total')->nullable();
            $table->string('image1_url')->nullable();
            $table->string('image2_url')->nullable();
            $table->string('modified_by')->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('coordinates')->nullable();
            $table->unique('lcpnap_name', 'lcpnap_lcpnap_name_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lcpnap');
    }
};

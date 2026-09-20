<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('barangay', function (Blueprint $table) {
            $table->unsignedBigInteger('radius_config_id')->nullable()->after('city_id');
            $table->index('radius_config_id', 'barangay_radius_config_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::table('barangay', function (Blueprint $table) {
            $table->dropIndex('barangay_radius_config_id_foreign');
            $table->dropColumn('radius_config_id');
        });
    }
};

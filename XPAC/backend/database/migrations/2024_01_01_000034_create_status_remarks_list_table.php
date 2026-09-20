<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('status_remarks_list', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('status_remarks');
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->timestamps();
            $table->unique('status_remarks', 'status_remarks_list_status_remarks_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('status_remarks_list');
    }
};

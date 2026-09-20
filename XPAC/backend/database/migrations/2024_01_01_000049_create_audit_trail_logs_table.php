<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_trail_logs', function (Blueprint $table) {
            $table->id();
            $table->longText('old_details')->nullable();
            $table->longText('new_details')->nullable();
            $table->string('created_by_user')->nullable();
            $table->string('updated_by_user')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_trail_logs');
    }
};

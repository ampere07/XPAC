<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organizations', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('organization_name');
            $table->text('address')->nullable();
            $table->string('contact_number', 50)->nullable();
            $table->string('email_address')->nullable();
            $table->string('created_by_user_id')->nullable();
            $table->string('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique('organization_name', 'organizations_organization_name_unique');
            $table->index('created_by_user_id', 'organizations_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organizations');
    }
};

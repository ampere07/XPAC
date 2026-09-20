<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('username');
            $table->string('password_hash');
            $table->string('email_address')->nullable();
            $table->string('first_name')->nullable();
            $table->char('middle_initial', 10)->nullable();
            $table->string('last_name')->nullable();
            $table->string('contact_number', 50)->nullable();
            $table->unsignedBigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('role_id')->nullable();
            $table->string('agent_id', 50)->nullable();
            $table->unsignedBigInteger('group_id')->nullable();
            $table->string('status', 100)->nullable();
            $table->dateTime('last_login')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->string('darkmode', 50)->nullable();
            $table->boolean('active')->nullable();
            $table->timestamps();
            $table->unique('username', 'users_username_unique');
            $table->index('organization_id', 'users_organization_id_foreign');
            $table->index('role_id', 'users_role_id_foreign');
            $table->index('group_id', 'users_group_id_foreign');
            $table->index('created_by_user_id', 'users_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};

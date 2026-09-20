<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('role_name');
            $table->text('description')->nullable();
            $table->longText('permissions')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique('role_name', 'roles_role_name_unique');
            $table->index('created_by_user_id', 'roles_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('roles');
    }
};

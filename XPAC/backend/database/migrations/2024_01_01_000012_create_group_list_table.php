<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('group_list', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('group_name');
            $table->string('fb_page_link')->nullable();
            $table->string('fb_messenger_link')->nullable();
            $table->string('template')->nullable();
            $table->string('company_name')->nullable();
            $table->string('portal_url')->nullable();
            $table->string('hotline', 50)->nullable();
            $table->string('email')->nullable();
            $table->unsignedBigInteger('modified_by_user_id')->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->unique('group_name', 'group_list_group_name_unique');
            $table->index('modified_by_user_id', 'group_list_modified_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_list');
    }
};

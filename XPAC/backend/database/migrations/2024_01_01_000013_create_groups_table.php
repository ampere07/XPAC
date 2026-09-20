<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('groups', function (Blueprint $table) {
            $table->integer('group_id');
            $table->string('group_name');
            $table->integer('org_id');
            $table->string('fb_page_link')->nullable();
            $table->string('fb_messenger_link')->nullable();
            $table->string('template')->nullable();
            $table->string('company_name')->nullable();
            $table->string('portal_url')->nullable();
            $table->string('hotline', 100)->nullable();
            $table->string('email')->nullable();
            $table->bigInteger('organization_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('groups');
    }
};

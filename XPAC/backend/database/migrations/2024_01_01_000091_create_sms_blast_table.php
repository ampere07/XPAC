<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sms_blast', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('contact_number', 50)->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->text('message')->nullable();
            $table->string('status', 100)->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->index('account_id', 'sms_blast_account_id_foreign');
            $table->index('created_by_user_id', 'sms_blast_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sms_blast');
    }
};

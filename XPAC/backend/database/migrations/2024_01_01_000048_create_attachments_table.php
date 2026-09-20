<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attachments', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('file_url')->nullable();
            $table->string('attachment_type', 100)->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->index('account_id', 'attachments_account_id_foreign');
            $table->index('created_by', 'attachments_created_by_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};

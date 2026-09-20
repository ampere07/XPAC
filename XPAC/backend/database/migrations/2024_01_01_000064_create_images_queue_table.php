<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('images_queue', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('application_id');
            $table->string('field_name');
            $table->string('local_path');
            $table->string('original_filename');
            $table->string('gdrive_url')->nullable();
            $table->enum('status', ['pending', 'processing', 'completed', 'failed'])->default('pending');
            $table->text('error_message')->nullable();
            $table->integer('retry_count')->default(0);
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'created_at'], 'idx_status_created_at');
            $table->index('application_id', 'idx_application_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('images_queue');
    }
};

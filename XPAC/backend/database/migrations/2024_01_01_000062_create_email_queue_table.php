<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_queue', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no', 50);
            $table->string('recipient_email', 150);
            $table->text('cc')->nullable();
            $table->text('bcc')->nullable();
            $table->string('subject', 200)->nullable();
            $table->longText('body_html')->nullable();
            $table->string('attachment_path')->nullable();
            $table->enum('status', ['pending', 'sent', 'failed'])->default('pending');
            $table->dateTime('sent_at')->nullable();
            $table->integer('attempts')->default(0);
            $table->text('error_message')->nullable();
            $table->string('email_sender', 150)->nullable();
            $table->string('reply_to', 150)->nullable();
            $table->string('sender_name', 150)->nullable();
            $table->dateTime('time_sent')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_queue');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_templates', function (Blueprint $table) {
            $table->string('Template_Code', 50);
            $table->string('Subject_Line', 150)->nullable();
            $table->longText('Body_HTML')->nullable();
            $table->string('Description')->nullable();
            $table->boolean('Is_Active')->nullable();
            $table->string('email_body')->nullable();
            $table->string('Page_Margin')->nullable()->default('1in');
            $table->string('Image_Margin')->nullable()->default('0px');
            $table->string('cc')->nullable();
            $table->string('bcc')->nullable();
            $table->string('email_sender')->nullable();
            $table->string('reply_to')->nullable();
            $table->string('sender_name')->nullable();
            $table->string('modified_by')->nullable();
            $table->dateTime('modifiet_at')->nullable();
            $table->bigInteger('organization_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_templates');
    }
};

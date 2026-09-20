<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('job_order_items', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('job_order_id')->nullable();
            $table->string('item_name')->nullable();
            $table->integer('quantity')->default(0);
            $table->timestamps();
            $table->index('job_order_id', 'job_order_items_job_order_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_order_items');
    }
};

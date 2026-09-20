<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_items', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('item_name');
            $table->text('item_description')->nullable();
            $table->unsignedBigInteger('category_id')->nullable();
            $table->unsignedBigInteger('supplier_id')->nullable();
            $table->integer('quantity_alert')->nullable();
            $table->integer('total_quantity')->nullable();
            $table->string('image_url')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->unique('item_name', 'inventory_items_item_name_unique');
            $table->index('category_id', 'inventory_items_category_id_foreign');
            $table->index('supplier_id', 'inventory_items_supplier_id_foreign');
            $table->index('created_by_user_id', 'inventory_items_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_items');
    }
};

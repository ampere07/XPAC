<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_supplier_list', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('supplier_name');
            $table->string('contact_number', 50)->nullable();
            $table->string('email')->nullable();
            $table->unsignedBigInteger('category_id')->nullable();
            $table->unique('supplier_name', 'item_supplier_list_supplier_name_unique');
            $table->index('category_id', 'item_supplier_list_category_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_supplier_list');
    }
};

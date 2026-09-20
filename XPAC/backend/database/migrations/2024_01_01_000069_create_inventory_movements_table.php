<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_movements', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->unsignedBigInteger('item_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->enum('movement_type', ['used', 'borrowed', 'returned', 'adjusted', 'defective'])->nullable();
            $table->integer('quantity')->nullable();
            $table->string('serial_number')->nullable();
            $table->unsignedBigInteger('requested_by_user_id')->nullable();
            $table->string('requested_with')->nullable();
            $table->string('status', 100)->nullable();
            $table->text('remarks')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->unsignedBigInteger('updated_by_user_id')->nullable();
            $table->timestamps();
            $table->index('item_id', 'inventory_movements_item_id_foreign');
            $table->index('account_id', 'inventory_movements_account_id_foreign');
            $table->index('requested_by_user_id', 'inventory_movements_requested_by_user_id_foreign');
            $table->index('created_by_user_id', 'inventory_movements_created_by_user_id_foreign');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_movements');
    }
};

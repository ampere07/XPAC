<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staggered_installation', function (Blueprint $table) {
            $table->id();
            $table->bigInteger('organization_id')->nullable();
            $table->string('account_no');
            $table->string('staggered_install_no', 50);
            $table->date('staggered_date')->nullable();
            $table->decimal('staggered_balance', 10, 2)->nullable()->default(0.00);
            $table->integer('months_to_pay')->nullable()->default(0);
            $table->decimal('monthly_payment', 10, 2)->nullable()->default(0.00);
            $table->string('modified_by')->nullable();
            $table->dateTime('modified_date')->nullable();
            $table->string('user_email')->nullable();
            $table->text('remarks')->nullable();
            $table->string('month1')->nullable();
            $table->string('month2')->nullable();
            $table->string('month3')->nullable();
            $table->string('month4')->nullable();
            $table->string('month5')->nullable();
            $table->string('month6')->nullable();
            $table->string('month7')->nullable();
            $table->string('month8')->nullable();
            $table->string('month9')->nullable();
            $table->string('month10')->nullable();
            $table->string('month11')->nullable();
            $table->string('month12')->nullable();
            $table->string('status')->nullable();
            $table->timestamps();
            $table->index('account_no', 'fk_account_no');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staggered_installation');
    }
};

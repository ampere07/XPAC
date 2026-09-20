<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        // Fix the Application_ID field to ensure it's auto-incrementing without redefining primary key
        DB::statement('ALTER TABLE application MODIFY Application_ID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        // Remove auto-increment if needed (though this should rarely be reversed)
        DB::statement('ALTER TABLE application MODIFY Application_ID BIGINT UNSIGNED NOT NULL');
    }
};

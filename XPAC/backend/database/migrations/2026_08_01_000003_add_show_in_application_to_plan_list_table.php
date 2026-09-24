<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Controls whether a plan is offered on the public application form.
     *
     * Some plans exist only for internal use — VIP and work-from-home packages are handed out by
     * staff, never self-selected by an applicant. Until now the application form excluded those by
     * matching on the plan NAME, which silently fails the moment someone names a plan differently.
     * This column makes the intent explicit and editable from the Plan form.
     *
     * Defaults to true, which also backfills every existing row as visible: the flag is new, so no
     * plan has yet been deliberately hidden, and defaulting to hidden would empty the application
     * form's plan list on deploy.
     *
     * plan_list is shared by the GOWISER admin app and the APPLY form, and the migration lives here
     * because this is where the table is created. The APPLY app reads the same column.
     */
    public function up(): void
    {
        Schema::table('plan_list', function (Blueprint $table) {
            if (!Schema::hasColumn('plan_list', 'show_in_application')) {
                $table->boolean('show_in_application')->default(true)->after('price');
            }
        });
    }

    public function down(): void
    {
        Schema::table('plan_list', function (Blueprint $table) {
            if (Schema::hasColumn('plan_list', 'show_in_application')) {
                $table->dropColumn('show_in_application');
            }
        });
    }
};

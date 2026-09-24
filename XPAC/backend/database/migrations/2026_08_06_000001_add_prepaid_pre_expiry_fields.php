<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Warn prepaid customers BEFORE their service period lapses, not only after.
     *
     * The existing prepaid notice (see 2026_08_01_000001) fires once the period has already
     * expired — by which point the customer is usually restricted and calling support. This adds
     * the heads-up that goes out a configurable number of days ahead of prepaid_expires_at so they
     * can renew before anything is cut.
     *
     *  - billing_config.prepaid_pre_expiry_days            how many days ahead to warn. 3 by
     *                                                      default, which is the window operations
     *                                                      already uses verbally.
     *  - billing_accounts.prepaid_pre_expiry_notified_for  the prepaid_expires_at the warning was
     *                                                      last sent for. Deliberately a SEPARATE
     *                                                      column from prepaid_expiry_notified_for:
     *                                                      both notices target the same expiry
     *                                                      timestamp, so sharing one marker would
     *                                                      make the pre-expiry warning suppress the
     *                                                      lapse notice three days later.
     *
     * Idempotency works the same way as the lapse notice and needs no cleanup: renewing moves
     * prepaid_expires_at forward, the stored value stops matching, and the next period warns again.
     *
     * No after() anchor on billing_accounts: prepaid_expires_at was added outside of migrations, so
     * it is not guaranteed to exist on a freshly migrated database and cannot be positioned against.
     */
    private const TEMPLATE_NAME = 'Prepaid Pre-Expiry Notice';

    private const TEMPLATE_TYPE = 'PrepaidPreExpiry';

    private const MESSAGE = 'Dear {{customer_name}}, your prepaid plan ({{plan_name}}) for account '
        . '{{account_no}} will expire on {{due_date}}. Amount to renew: P{{amount}}. Renew early at '
        . '{{payment_link}} to avoid service interruption.';

    public function up(): void
    {
        Schema::table('billing_config', function (Blueprint $table) {
            if (!Schema::hasColumn('billing_config', 'prepaid_pre_expiry_days')) {
                // Defaulted rather than nullable so an install that never opens the Billing
                // Configuration page still warns customers on the standard 3-day window.
                $table->integer('prepaid_pre_expiry_days')->default(3);
            }
        });

        Schema::table('billing_accounts', function (Blueprint $table) {
            if (!Schema::hasColumn('billing_accounts', 'prepaid_pre_expiry_notified_for')) {
                $table->dateTime('prepaid_pre_expiry_notified_for')->nullable();
            }
        });

        $this->seedTemplate();
    }

    /**
     * Registers the pre-expiry SMS template.
     *
     * A migration rather than a seeder: seeders here generate demo data and are not run on
     * production, and this is reference data that has to exist wherever the app does. Matched on
     * name so re-running never creates a second copy and never overwrites wording someone has since
     * edited in the SMS Templates page — the row existing at all is the point, not this exact text
     * surviving.
     */
    private function seedTemplate(): void
    {
        if (!Schema::hasTable('sms_templates')) {
            return;
        }

        $exists = DB::table('sms_templates')
            ->where('template_name', self::TEMPLATE_NAME)
            ->orWhere('template_type', self::TEMPLATE_TYPE)
            ->exists();

        if ($exists) {
            return;
        }

        DB::table('sms_templates')->insert([
            'template_name' => self::TEMPLATE_NAME,
            'template_type' => self::TEMPLATE_TYPE,
            'message_content' => self::MESSAGE,
            'variables' => json_encode([
                '{{customer_name}}',
                '{{account_no}}',
                '{{plan_name}}',
                '{{amount}}',
                '{{due_date}}',
                '{{payment_link}}',
            ]),
            'is_active' => 1,
            // Unscoped so every organisation inherits it, matching how the other system
            // templates are seeded.
            'organization_id' => null,
            'created_by' => 'System',
            'updated_by' => 'System',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::table('billing_config', function (Blueprint $table) {
            if (Schema::hasColumn('billing_config', 'prepaid_pre_expiry_days')) {
                $table->dropColumn('prepaid_pre_expiry_days');
            }
        });

        Schema::table('billing_accounts', function (Blueprint $table) {
            if (Schema::hasColumn('billing_accounts', 'prepaid_pre_expiry_notified_for')) {
                $table->dropColumn('prepaid_pre_expiry_notified_for');
            }
        });

        // Removed only if it is still the row this migration inserted. A template someone has
        // since rewritten is their content, and rolling back a code change must not delete it.
        if (Schema::hasTable('sms_templates')) {
            DB::table('sms_templates')
                ->where('template_name', self::TEMPLATE_NAME)
                ->where('message_content', self::MESSAGE)
                ->delete();
        }
    }
};

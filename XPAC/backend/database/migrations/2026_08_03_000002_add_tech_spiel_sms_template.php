<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Registers the "Tech Spiel SMS" template.
     *
     * This is the script a technician sends on arriving for an installation. The
     * mobile app's SMS quick action carries its own copy in
     * services/smsTemplateRegistry.ts so the button still works with no signal —
     * a technician standing at a gate cannot wait on a fetch. This row is what
     * makes the same wording visible and editable in the SMS Templates page,
     * rather than being a string only a developer can change.
     *
     * A migration rather than a seeder: seeders here generate demo data and are
     * not run on production, and this is reference data that has to exist
     * wherever the app does.
     */
    private const TEMPLATE_NAME = 'Tech Spiel SMS';

    private const TEMPLATE_TYPE = 'Technician';

    private const MESSAGE = 'Hi, This is from Go Wiser. I am your assigned technician for '
        . 'your installation today. May I Confirm if you are available right now for the '
        . 'installation? Thank you';

    public function up(): void
    {
        if (!Schema::hasTable('sms_templates')) {
            return;
        }

        // Matched on name, which is how the template is referred to everywhere
        // else. Re-running must not create a second copy, and must not overwrite
        // wording someone has since edited in the SMS Templates page — the row
        // existing at all is the whole point, not this exact text surviving.
        $exists = DB::table('sms_templates')
            ->where('template_name', self::TEMPLATE_NAME)
            ->exists();

        if ($exists) {
            return;
        }

        DB::table('sms_templates')->insert([
            'template_name' => self::TEMPLATE_NAME,
            'template_type' => self::TEMPLATE_TYPE,
            'message_content' => self::MESSAGE,
            // No placeholders: the spiel is deliberately generic. A technician
            // fires it before the app has resolved which subscriber is behind
            // the gate, so there is nothing to interpolate and an unresolved
            // {{customer_name}} would go out verbatim.
            'variables' => json_encode([]),
            'is_active' => 1,
            // Unscoped so every organisation inherits it, matching how the other
            // system templates are seeded.
            'organization_id' => null,
            'created_by' => 'System',
            'updated_by' => 'System',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Removes the row only if it is still the one this migration inserted.
     *
     * A template someone has since rewritten is their content, not ours, and a
     * rollback of a code change should not delete it.
     */
    public function down(): void
    {
        if (!Schema::hasTable('sms_templates')) {
            return;
        }

        DB::table('sms_templates')
            ->where('template_name', self::TEMPLATE_NAME)
            ->where('message_content', self::MESSAGE)
            ->delete();
    }
};

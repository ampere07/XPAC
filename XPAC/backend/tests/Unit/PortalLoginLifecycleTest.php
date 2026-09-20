<?php

namespace Tests\Unit;

use App\Support\PulloutCategory;
use PHPUnit\Framework\TestCase;

/**
 * When the customer's portal login opens and closes.
 *
 * `users.active` is the column the sign-in gates on — routes/api.php refuses a
 * row with `active = 0` and answers `status: 'suspended'`. Two acts move it, and
 * only two:
 *
 *   closed  a service order saved with a pullout repair category and the visit
 *           marked Done, which reaches attemptPullout();
 *   opened  a job order approved, which either creates the portal user with
 *           active = 1 or re-enables the one already there.
 *
 * The first rule is called here directly, because it lives in App\Support\
 * PulloutCategory rather than inline in a controller. The second is a branch of
 * a controller method too large to call without a database, so it is pinned by
 * reading the shipped source. Both controllers are also read to confirm they
 * still ask PulloutCategory rather than having grown their own copy of the rule
 * again — that is what stops this file passing while the real gate drifts.
 *
 * No database: nothing is written, read or migrated.
 */
class PortalLoginLifecycleTest extends TestCase
{
    private const API_CONTROLLER = __DIR__ . '/../../app/Http/Controllers/Api/ServiceOrderApiController.php';
    private const WEB_CONTROLLER = __DIR__ . '/../../app/Http/Controllers/ServiceOrderController.php';
    private const JOB_ORDER_CONTROLLER = __DIR__ . '/../../app/Http/Controllers/JobOrderController.php';

    // ── closing the login: the rule itself ───────────────────────────────

    /**
     * @dataProvider pulloutSpellings
     */
    public function test_any_spelling_of_pullout_closes_a_done_visit(string $category): void
    {
        $this->assertTrue(
            PulloutCategory::deactivatesPortalLogin($category, 'Done'),
            sprintf('"%s" is a pullout and did not close the login', $category)
        );
    }

    public static function pulloutSpellings(): array
    {
        return [
            'one word'            => ['Pullout'],
            'two words'          => ['Pull Out'],
            'lower case'          => ['pullout'],
            'lower, spaced'       => ['pull out'],
            'shouted'             => ['PULLOUT'],
            'shouted and spaced'  => ['PULL OUT'],
            'for, one word'       => ['For Pullout'],
            'for, two words'      => ['For Pull Out'],
            'for, lower'          => ['for pullout'],
            'for, lower spaced'   => ['for pull out'],
            'padded'              => ['   Pullout   '],
            'doubled spacing'     => ['for  pull  out'],
            'tabbed'              => ["for\tpull\tout"],
        ];
    }

    /**
     * @dataProvider unfinishedVisits
     */
    public function test_a_pullout_that_is_not_done_leaves_the_login_open(?string $visitStatus): void
    {
        $this->assertFalse(PulloutCategory::deactivatesPortalLogin('Pullout', $visitStatus));
    }

    public static function unfinishedVisits(): array
    {
        return [
            'in progress' => ['In Progress'],
            'reschedule'  => ['Reschedule'],
            'failed'      => ['Failed'],
            'nothing yet' => [''],
            'never set'   => [null],
            // "Done" inside another word must not satisfy it.
            'not done'    => ['Not Done'],
        ];
    }

    public function test_a_done_visit_is_recognised_however_it_is_spelled(): void
    {
        $this->assertTrue(PulloutCategory::deactivatesPortalLogin('Pullout', 'done'));
        $this->assertTrue(PulloutCategory::deactivatesPortalLogin('Pullout', 'DONE'));
        $this->assertTrue(PulloutCategory::deactivatesPortalLogin('Pullout', '  Done  '));
    }

    /**
     * @dataProvider otherCategories
     */
    public function test_no_other_repair_category_closes_the_login(?string $category): void
    {
        $this->assertFalse(
            PulloutCategory::deactivatesPortalLogin($category, 'Done'),
            sprintf('"%s" closed the portal login and only a pullout may', (string) $category)
        );
    }

    public static function otherCategories(): array
    {
        // Every option the two edit modals offer, plus the empty cases.
        return [
            ['None'], ['Fiber Relaying'], ['Migrate'], ['others'],
            ['Reactivate'], ['Reactivation'], ['Reboot/Reconfig Router'],
            ['Relocate Router'], ['Relocate'], ['Replace Patch Cord'],
            ['Replace Router'], ['Resplice'], ['Transfer LCP/NAP/PORT'],
            ['Update Vlan'], [''], [null],
            // Near misses that are not the instruction.
            ['Pulled Out'], ['Pullout Request'], ['No Pullout'],
        ];
    }

    public function test_the_concern_column_is_not_part_of_the_rule(): void
    {
        // A ticket raised by AutoDisconnectService carries concern 'for pullout'
        // and no category. Closing it as something else must leave the login
        // alone — the category is the only thing consulted.
        $this->assertFalse(PulloutCategory::deactivatesPortalLogin('Reboot/Reconfig Router', 'Done'));
        $this->assertFalse(PulloutCategory::deactivatesPortalLogin('', 'Done'));
    }

    // ── the shipped controllers still ask that rule ──────────────────────

    /**
     * @dataProvider serviceOrderControllers
     */
    public function test_the_trigger_asks_pullout_category(string $path): void
    {
        $src = file_get_contents($path);

        $this->assertStringContainsString(
            '$isPulloutVisitDone = \App\Support\PulloutCategory::deactivatesPortalLogin(',
            $src,
            'the trigger no longer asks PulloutCategory'
        );
        $this->assertStringNotContainsString(
            '$pulloutConcern',
            $src,
            'the concern column is being read into the pullout decision again'
        );
        $this->assertStringNotContainsString(
            '$pulloutCategories',
            $src,
            'a local copy of the category list has come back'
        );
    }

    /**
     * @dataProvider serviceOrderControllers
     */
    public function test_the_re_entry_guard_asks_the_same_rule(string $path): void
    {
        // The guard stops a re-save running the pullout twice. Asking a broader
        // question than the trigger would suppress pullouts that have not
        // happened yet; asking a narrower one would run them twice.
        $this->assertStringContainsString(
            '$isAlreadyPulloutDone = \App\Support\PulloutCategory::deactivatesPortalLogin(',
            file_get_contents($path),
            'the re-entry guard no longer asks PulloutCategory'
        );
    }

    /**
     * @dataProvider serviceOrderControllers
     */
    public function test_the_decision_is_read_back_off_the_saved_row(string $path): void
    {
        // Not from the request: a request that merely claims Done must not
        // disable a login the row never recorded as pulled out.
        $this->assertStringContainsString(
            "\$pulloutRow = DB::table('service_orders')->where('id', \$id)->first();",
            file_get_contents($path),
            'the pullout decision is no longer taken from the saved row'
        );
    }

    /**
     * @dataProvider serviceOrderControllers
     */
    public function test_deactivation_happens_behind_that_gate_and_nowhere_else(string $path): void
    {
        $src = file_get_contents($path);

        $this->assertSame(
            1,
            substr_count($src, "update(['active' => 0])"),
            'a second path in this controller disables the portal login'
        );
        $this->assertSame(
            1,
            substr_count($src, '$this->attemptPullout('),
            'attemptPullout is reached from more than one place'
        );
    }

    public static function serviceOrderControllers(): array
    {
        return [
            'mobile API' => [self::API_CONTROLLER],
            'web'        => [self::WEB_CONTROLLER],
        ];
    }

    // ── re-saving ────────────────────────────────────────────────────────

    public function test_re_saving_a_finished_pullout_does_not_run_it_again(): void
    {
        // Nothing about the category or the visit changed, so the row looked
        // pulled-out before the write and still does. Guard and trigger agree,
        // and agreeing is what makes it skip.
        $before = PulloutCategory::deactivatesPortalLogin('Pullout', 'Done');
        $after  = PulloutCategory::deactivatesPortalLogin('Pullout', 'Done');

        $this->assertTrue($before, 'the guard did not see the finished pullout');
        $this->assertTrue($after);
    }

    public function test_naming_a_finished_visit_a_pullout_still_fires(): void
    {
        // An auto-raised ticket: concern 'for pullout', no category, visit
        // already Done. The technician now names it a pullout.
        $before = PulloutCategory::deactivatesPortalLogin('', 'Done');
        $after  = PulloutCategory::deactivatesPortalLogin('Pull Out', 'Done');

        $this->assertFalse($before, 'the guard treated a non-pullout as already done');
        $this->assertTrue($after, 'naming it a pullout did not fire the pullout');
    }

    // ── opening the login ────────────────────────────────────────────────

    public function test_approving_a_job_order_creates_the_login_enabled(): void
    {
        $src = file_get_contents(self::JOB_ORDER_CONTROLLER);

        $this->assertStringContainsString("'status' => 'active',", $src);
        $this->assertStringContainsString("'active' => 1,", $src);
    }

    public function test_approving_re_enables_a_login_that_already_exists(): void
    {
        // The re-install case: the account was pulled out, so a users row is
        // already there with active = 0. Creating is skipped, so the existing
        // row has to be opened or the approval reports a portal account the
        // customer cannot sign in to.
        $src = file_get_contents(self::JOB_ORDER_CONTROLLER);

        $this->assertStringContainsString('$existingUser->active = 1;', $src);
        $this->assertStringContainsString("\$existingUser->status = 'active';", $src);
    }

    public function test_only_a_customer_row_is_re_enabled(): void
    {
        // A staff user whose username collides with an account number must not
        // be re-enabled by an installation.
        $src = file_get_contents(self::JOB_ORDER_CONTROLLER);

        $position = strpos($src, '$existingUser->active = 1;');
        $this->assertNotFalse($position, 'the re-enable was not found at all');

        $preceding = substr($src, max(0, $position - 600), 600);
        $this->assertStringContainsString(
            'PortalPassword::isCustomer($existingUser)',
            $preceding,
            'the re-enable is not guarded by the customer-role check'
        );
    }

    public function test_the_only_place_that_creates_a_portal_login_is_the_approval(): void
    {
        $src = file_get_contents(self::JOB_ORDER_CONTROLLER);

        $this->assertSame(
            1,
            substr_count($src, "\\DB::table('users')->insertGetId("),
            'a second path in this controller creates portal users'
        );
    }
}

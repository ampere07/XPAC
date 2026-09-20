<?php

namespace Tests\Unit;

use App\Services\SmartOltReconciliationService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * The pullout gate on Inactive ONU cleanup.
 *
 * An ONU is only ever unprovisioned once the subscriber's equipment has physically
 * been collected: a pullout Service Order (concern "pullout"/"for pullout", or repair
 * category "pullout") for its serial or its account, marked Done. No such order, or
 * one still pending, is a blocker - for the operator preview, for the operator's
 * delete job, and for the unattended nightly pass alike.
 *
 * These exercise the pure halves - how a service_orders row is indexed, and the
 * verdict drawn from that index - through reflection, with no database behind them.
 * buildSafetyMap() only feeds rows into the first; stepDelete(), revalidateCleanup()
 * and automateCleanup() only read the second.
 */
class SmartOltCleanupPulloutGuardTest extends TestCase
{
    private const SERIAL = 'HWTC1234ABCD';
    private const ACCOUNT = 'ACC-0001';

    private SmartOltReconciliationService $service;
    private ReflectionClass $reflection;

    protected function setUp(): void
    {
        $this->reflection = new ReflectionClass(SmartOltReconciliationService::class);
        // The constructor wants a RadiusReconciliationService; nothing tested here
        // touches it.
        $this->service = $this->reflection->newInstanceWithoutConstructor();
    }

    public function test_an_onu_with_no_pullout_service_order_is_blocked(): void
    {
        $safety = $this->safety([], []);

        $reasons = $this->blockers(self::SERIAL, $safety);

        $this->assertContains('No pullout service order found for this serial/account.', $reasons);
        $this->assertFalse($this->verdict(self::SERIAL, $safety)['cleared']);
    }

    public function test_a_pullout_that_is_not_done_blocks_and_names_its_status(): void
    {
        [$byAccount, $bySerial] = $this->index([
            $this->order(11, self::ACCOUNT, 'Pending', 'In Progress'),
        ]);

        $safety = $this->safety($byAccount, $bySerial);
        $reasons = $this->blockers(self::SERIAL, $safety);

        $this->assertContains(
            'Pullout service order exists but is not marked Done (status: Pending (visit: In Progress)).',
            $reasons
        );
        $this->assertFalse($this->verdict(self::SERIAL, $safety)['cleared']);
    }

    public function test_the_latest_open_pullout_is_the_one_reported(): void
    {
        [$byAccount, $bySerial] = $this->index([
            $this->order(30, self::ACCOUNT, 'Rescheduled', null),
            $this->order(12, self::ACCOUNT, 'Pending', null),
        ]);

        $reasons = $this->blockers(self::SERIAL, $this->safety($byAccount, $bySerial));

        $this->assertContains('Pullout service order exists but is not marked Done (status: Rescheduled).', $reasons);
    }

    public function test_a_pullout_with_a_blank_status_reads_as_pending(): void
    {
        [$byAccount, $bySerial] = $this->index([$this->order(5, self::ACCOUNT, null, null)]);

        $reasons = $this->blockers(self::SERIAL, $this->safety($byAccount, $bySerial));

        $this->assertContains('Pullout service order exists but is not marked Done (status: Pending).', $reasons);
    }

    public function test_a_done_pullout_on_the_account_clears_the_onu(): void
    {
        [$byAccount, $bySerial] = $this->index([
            $this->order(40, self::ACCOUNT, 'Pending', null),
            $this->order(41, '  ' . self::ACCOUNT . ' ', 'Done', null),
        ]);

        $safety = $this->safety($byAccount, $bySerial);

        $this->assertSame([], $this->blockers(self::SERIAL, $safety));
        $this->assertTrue($this->verdict(self::SERIAL, $safety)['cleared']);
    }

    public function test_done_is_read_from_the_visit_status_too_and_case_insensitively(): void
    {
        [$byAccount, $bySerial] = $this->index([$this->order(7, self::ACCOUNT, 'For Visit', ' COMPLETED ')]);

        $this->assertSame([], $this->blockers(self::SERIAL, $this->safety($byAccount, $bySerial)));
    }

    public function test_a_done_pullout_matched_by_serial_clears_the_onu(): void
    {
        // Written with separators and in lowercase on the ticket; the ONU reports the
        // bare uppercase form. Both must resolve to the same key.
        [$byAccount, $bySerial] = $this->index([
            $this->order(8, 'ACC-OTHER', 'Done', null, 'hwtc-1234-abcd', null),
        ]);

        $this->assertArrayHasKey(self::SERIAL, $bySerial);
        $this->assertSame([], $this->blockers(self::SERIAL, $this->safety($byAccount, $bySerial)));
    }

    public function test_a_done_pullout_for_a_different_account_and_serial_does_not_clear(): void
    {
        [$byAccount, $bySerial] = $this->index([
            $this->order(9, 'ACC-OTHER', 'Done', 'Done', 'ZTEG99990000', 'ZTEG99990001'),
        ]);

        $reasons = $this->blockers(self::SERIAL, $this->safety($byAccount, $bySerial));

        $this->assertContains('No pullout service order found for this serial/account.', $reasons);
    }

    public function test_a_ticket_whose_old_and_new_serials_match_is_indexed_once(): void
    {
        [, $bySerial] = $this->index([$this->order(3, '', 'Done', null, self::SERIAL, 'hwtc1234abcd')]);

        $this->assertCount(1, $bySerial[self::SERIAL]);
    }

    public function test_the_pullout_cannot_be_cleared_while_billing_validation_is_unavailable(): void
    {
        [$byAccount, $bySerial] = $this->index([$this->order(1, self::ACCOUNT, 'Done', 'Done')]);

        $safety = $this->safety($byAccount, $bySerial);
        $safety['available'] = false;

        $this->assertFalse($this->verdict(self::SERIAL, $safety)['cleared']);
        $this->assertContains('Billing safety validation is unavailable.', $this->blockers(self::SERIAL, $safety));
    }

    public function test_an_onu_without_a_serial_is_never_cleared(): void
    {
        [$byAccount, $bySerial] = $this->index([$this->order(1, self::ACCOUNT, 'Done', 'Done')]);

        $this->assertFalse($this->verdict('', $this->safety($byAccount, $bySerial))['cleared']);
    }

    public function test_the_existing_guards_still_apply_alongside_a_done_pullout(): void
    {
        [$byAccount, $bySerial] = $this->index([$this->order(1, self::ACCOUNT, 'Done', 'Done')]);

        $safety = $this->safety($byAccount, $bySerial);
        $safety['accounts'][self::SERIAL][0]['billing_status_id'] = 1;

        $reasons = $this->blockers(self::SERIAL, $safety);

        $this->assertCount(1, $reasons);
        $this->assertStringStartsWith('A billing account on this serial is not Terminated', $reasons[0]);
        // The pullout itself is satisfied - only the other guard objects.
        $this->assertTrue($this->verdict(self::SERIAL, $safety)['cleared']);
    }

    // ---- helpers -----------------------------------------------------------------

    /**
     * A safety map in which every existing guard passes, so the pullout gate is the
     * only thing under test.
     *
     * @param array<string, array<int, array<string, mixed>>> $byAccount
     * @param array<string, array<int, array<string, mixed>>> $bySerial
     * @return array<string, mixed>
     */
    private function safety(array $byAccount, array $bySerial): array
    {
        return [
            'available' => true,
            'accounts' => [
                self::SERIAL => [[
                    'billing_status_id' => $this->reflection->getConstant('BILLING_STATUS_TERMINATED'),
                    'account_no' => self::ACCOUNT,
                ]],
            ],
            'job_orders' => [],
            'usernames' => [],
            'sessions_available' => true,
            'online' => [],
            'session_errors' => [],
            'pullouts_by_account' => $byAccount,
            'pullouts_by_serial' => $bySerial,
        ];
    }

    private function order(
        int $id,
        ?string $accountNo,
        ?string $status,
        ?string $visitStatus,
        ?string $oldSn = null,
        ?string $newSn = null
    ): object {
        return (object) [
            'id' => $id,
            'account_no' => $accountNo,
            'status' => $status,
            'visit_status' => $visitStatus,
            'old_router_modem_sn' => $oldSn,
            'new_router_modem_sn' => $newSn,
        ];
    }

    /**
     * @param array<int, object> $rows
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private function index(array $rows): array
    {
        $byAccount = [];
        $bySerial = [];
        $method = $this->reflection->getMethod('indexPulloutOrder');
        $method->setAccessible(true);

        foreach ($rows as $row) {
            $method->invokeArgs($this->service, [$row, &$byAccount, &$bySerial]);
        }

        return [$byAccount, $bySerial];
    }

    /**
     * @param array<string, mixed> $safety
     * @return array<int, string>
     */
    private function blockers(string $serial, array $safety, ?string $onuName = null): array
    {
        $method = $this->reflection->getMethod('cleanupBlockers');
        $method->setAccessible(true);

        return $method->invoke($this->service, $serial, $safety, $onuName);
    }

    /**
     * @param array<string, mixed> $safety
     * @return array{cleared: bool, reason: string|null}
     */
    private function verdict(string $serial, array $safety, ?string $onuName = null): array
    {
        $method = $this->reflection->getMethod('pulloutVerdict');
        $method->setAccessible(true);

        return $method->invoke($this->service, $serial, $safety, $onuName);
    }

    public function test_automation_offline_days_is_fourteen_days(): void
    {
        $this->assertSame(14, SmartOltReconciliationService::AUTOMATION_OFFLINE_DAYS);
    }

    public function test_unassigned_not_set_onu_with_no_billing_accounts_is_cleared_without_pullout_order(): void
    {
        // No pullout service orders and no billing accounts on this serial
        $safety = $this->safety([], []);
        $safety['accounts'] = [];

        $verdict = $this->verdict(self::SERIAL, $safety, 'not set');
        $this->assertTrue($verdict['cleared']);
        $this->assertNull($verdict['reason']);

        $reasons = $this->blockers(self::SERIAL, $safety, 'not set');
        $this->assertSame([], $reasons);
    }

    public function test_named_subscriber_onu_without_pullout_order_remains_blocked(): void
    {
        $safety = $this->safety([], []);
        $safety['accounts'] = [];

        // Named subscriber ONU must not be deleted without a pullout order
        $verdict = $this->verdict(self::SERIAL, $safety, 'ACC-0001 - John Doe - Plan 1500');
        $this->assertFalse($verdict['cleared']);
        $this->assertSame('No pullout service order found for this serial/account.', $verdict['reason']);

        $reasons = $this->blockers(self::SERIAL, $safety, 'ACC-0001 - John Doe - Plan 1500');
        $this->assertContains('No pullout service order found for this serial/account.', $reasons);
    }

    public function test_not_set_onu_with_active_billing_account_remains_blocked(): void
    {
        // An ONU with 'not set' name but an active billing account linked to its serial
        $safety = $this->safety([], []);
        $safety['accounts'][self::SERIAL][0]['billing_status_id'] = 1; // Active

        $verdict = $this->verdict(self::SERIAL, $safety, 'not set');
        $this->assertFalse($verdict['cleared']);

        $reasons = $this->blockers(self::SERIAL, $safety, 'not set');
        $this->assertNotEmpty($reasons);
    }

    public function test_not_set_onu_with_open_job_order_remains_blocked(): void
    {
        $safety = $this->safety([], []);
        $safety['accounts'] = [];
        $safety['job_orders'][self::SERIAL] = ['In Progress'];

        $reasons = $this->blockers(self::SERIAL, $safety, 'not set');
        $this->assertContains('An open job order (in progress) exists for this serial.', $reasons);
    }
}

<?php

namespace App\Support;

use App\Services\SmartOltService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Moves an account onto the router a Service Order replaced it with.
 *
 * The serial a technician enters is a statement of intent, not of fact: until
 * the visit is finished the old router is still the one in the customer's house.
 * So `technical_details.router_modem_sn` is not written when the serial is
 * entered — it is written here, once the ticket says the visit is Done.
 *
 * Both ServiceOrderController and ServiceOrderApiController call this, so the
 * web and mobile paths cannot drift on when an account changes router.
 *
 * Deciding on the STORED Service Order rather than the request is what keeps
 * this from running early: a payload claiming visit_status=Done does not move
 * the account unless that value actually reached the row. Reading the serial
 * from the row also covers the ordinary case where it was entered on one save
 * and the visit completed by a later one carrying no serial at all.
 *
 * Safe to run repeatedly: a re-save finds the serial already stored and makes
 * no write.
 */
class ReplacementRouterSn
{
    /**
     * Apply the replacement serial if — and only if — the visit is Done.
     *
     * Never throws. Every refusal is logged to the smartoltrelated channel
     * alongside the ONU handover it accompanies, so one log tells the whole
     * story of a replacement.
     *
     * @param  object|null $order      service_orders row read back AFTER the write
     * @param  string|null $updatedBy  who to stamp on technical_details
     * @return array{status: string, reason: ?string, sn: ?string}
     */
    public static function applyIfVisitDone(
        ?object $order,
        ?string $updatedBy = null,
        string $tag = '[SERVICE ORDER REPLACE ROUTER]'
    ): array {
        $outcome = ['status' => 'skipped', 'reason' => null, 'sn' => null];

        if (!$order) {
            $outcome['reason'] = 'service order row unavailable';
            Log::channel('smartoltrelated')->error($tag . ' SN not applied — could not read the service order back after the write');
            return $outcome;
        }

        $visit = strtolower(trim((string) ($order->visit_status ?? '')));

        // The visit is not finished, so the old router is still the live one.
        if ($visit !== SmartOltService::VISIT_STATUS_DONE) {
            $outcome['status'] = 'not_applicable';
            $outcome['reason'] = "visit_status='{$visit}'";
            return $outcome;
        }

        $accountNo = trim((string) ($order->account_no ?? ''));
        $newSn     = trim((string) ($order->new_router_modem_sn ?? ''));

        // Nothing was replaced on this ticket — most visits are not swaps.
        if ($newSn === '') {
            $outcome['status'] = 'not_applicable';
            $outcome['reason'] = 'no replacement SN on this service order';
            return $outcome;
        }

        if ($accountNo === '') {
            $outcome['status'] = 'invalid';
            $outcome['reason'] = 'service order has no account_no';
            Log::channel('smartoltrelated')->error($tag . ' SN not applied — service order has no account_no', [
                'service_order_id'    => $order->id ?? null,
                'new_router_modem_sn' => $newSn,
            ]);
            return $outcome;
        }

        $current = DB::table('technical_details')
            ->where('account_no', $accountNo)
            ->value('router_modem_sn');

        // No technical row to move. Reported rather than passed over silently:
        // the ONU handover that follows would put this account's details onto a
        // router the system holds no technical record for.
        if ($current === null && !DB::table('technical_details')->where('account_no', $accountNo)->exists()) {
            $outcome['status'] = 'invalid';
            $outcome['reason'] = 'no technical_details row for this account';
            Log::channel('smartoltrelated')->error($tag . ' SN not applied — no technical_details row for the account', [
                'account_no'          => $accountNo,
                'service_order_id'    => $order->id ?? null,
                'new_router_modem_sn' => $newSn,
            ]);
            return $outcome;
        }

        // Already on this router — a re-save of a finished replacement.
        if (trim((string) $current) === $newSn) {
            $outcome['status'] = 'unchanged';
            $outcome['reason'] = 'account already on this router';
            $outcome['sn']     = $newSn;
            return $outcome;
        }

        $update = [
            'router_modem_sn' => $newSn,
            'updated_at'      => now(),
        ];

        if ($updatedBy !== null && trim($updatedBy) !== '') {
            $update['updated_by'] = $updatedBy;
        }

        DB::table('technical_details')
            ->where('account_no', $accountNo)
            ->update($update);

        Log::channel('smartoltrelated')->info($tag . ' Visit Done — account moved onto the replacement router', [
            'account_no'          => $accountNo,
            'service_order_id'    => $order->id ?? null,
            'old_router_modem_sn' => trim((string) $current) ?: null,
            'new_router_modem_sn' => $newSn,
        ]);

        $outcome['status'] = 'updated';
        $outcome['sn']     = $newSn;

        return $outcome;
    }
}

<?php

namespace App\Services;

use App\Models\JobOrder;
use App\Models\User;
use App\Support\AgentProgramme;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * JobOrderAgentPaymentService
 * ---------------------------------------------------------------------------
 * Settles a job order with the agent who referred it, at the moment it is
 * approved.
 *
 * Approving a job order does three things here:
 *
 *   1. marks it Paid on `job_orders.commission_status`
 *   2. credits the commission to `agent_balance.commission_value`, the running
 *      total of what the agent has earned in commission
 *   3. writes the rates it was settled at onto the job order itself
 *
 * The third is the reason this exists as more than an UPDATE. The commission
 * and incentive rates are administrator settings that change. A job order
 * approved today must keep the figures it was actually settled at, or raising
 * the rate next month would silently restate money already paid. So the rates
 * are copied onto the row, and every later calculation reads them from there.
 *
 * PAYING TWICE IS THE FAILURE THAT MATTERS, so it is guarded three ways:
 *
 *   • the row is locked FOR UPDATE before anything is read
 *   • a job order already carrying `agent_paid_at` is left alone
 *   • the credit and the stamp are written in one transaction, so a row that
 *     says it was paid definitely was
 *
 * The referring agent is resolved through the application's `referred_by`
 * field using the shared matcher, so this agrees with incentives, achievements
 * and invoices about whose referral a customer is.
 */
class JobOrderAgentPaymentService
{
    public const STATUS_PAID = 'Paid';

    /**
     * Settle one job order with its referring agent.
     *
     * Safe to call more than once: the second call reports `already_paid` and
     * changes nothing. Never throws — approving a job order must not fail
     * because the agent side of it could not be settled — but returns a reason
     * so the caller can log or surface it.
     *
     * MUST be called inside the caller's transaction, so that a failure after
     * this point rolls the credit back with everything else.
     *
     * @return array{paid: bool, reason: string, agent_id: ?int,
     *               commission: float, incentive_value: float}
     */
    public function settle(JobOrder $jobOrder, ?string $actionBy = null): array
    {
        $result = [
            'paid'            => false,
            'reason'          => '',
            'agent_id'        => null,
            'commission'      => 0.0,
            'incentive_value' => 0.0,
        ];

        try {
            // Re-read under a lock so two approvals racing cannot both see an
            // unpaid row and both credit it.
            $locked = JobOrder::whereKey($jobOrder->getKey())->lockForUpdate()->first();
            if (!$locked) {
                $result['reason'] = 'job order not found';
                return $result;
            }

            if ($locked->agent_paid_at !== null) {
                $result['reason']   = 'already_paid';
                $result['agent_id'] = $locked->agent_paid_to ? (int) $locked->agent_paid_to : null;
                return $result;
            }

            $agent = $this->referringAgent($locked);
            if (!$agent) {
                // Nothing to settle. The job order is still approved; it simply
                // was not referred by an agent we can identify.
                $result['reason'] = 'no matching agent';
                return $result;
            }

            $balance = DB::table('agent_balance')->where('agent_id', $agent->id)->lockForUpdate()->first();
            if (!$balance) {
                $result['reason']   = 'agent has no balance record';
                $result['agent_id'] = (int) $agent->id;
                return $result;
            }

            // The rates as they stand right now. Copied onto the job order
            // below so a later change to either setting cannot restate this.
            $commission     = $this->commissionRateFor($balance);
            $incentiveValue = $this->incentiveRateFor($balance);

            if ($commission > 0) {
                DB::table('agent_balance')
                    ->where('id', $balance->id)
                    ->update([
                        // Credited to commission_value, the running total of
                        // what the agent has earned. NOT to `commission`, which
                        // is the rate one referral pays — a setting, not a
                        // balance. COALESCE guards a NULL column and avoids a
                        // stale read.
                        'commission_value' => DB::raw('COALESCE(commission_value, 0) + ' . number_format($commission, 2, '.', '')),
                        'updated_at'       => Carbon::now(),
                    ]);
            }

            $locked->forceFill([
                'commission_status' => self::STATUS_PAID,
                'commission_value'  => $commission,
                'incentive_value'   => $incentiveValue,
                'agent_paid_at'     => Carbon::now(),
                'agent_paid_to'     => $agent->id,
            ])->save();

            $result = [
                'paid'            => true,
                'reason'          => 'settled',
                'agent_id'        => (int) $agent->id,
                'commission'      => $commission,
                'incentive_value' => $incentiveValue,
            ];

            Log::info('[JOB ORDER PAYMENT] Settled with agent', [
                'job_order_id'    => $locked->id,
                'agent_id'        => $agent->id,
                'commission'      => $commission,
                'incentive_value' => $incentiveValue,
                'by'              => $actionBy,
            ]);

            return $result;
        } catch (Throwable $e) {
            // Rethrow: this runs inside the approval's transaction, and a
            // half-applied settlement is worse than a failed approval.
            Log::error('[JOB ORDER PAYMENT] Could not settle job order '
                . $jobOrder->getKey() . ': ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * The agent whose referral this job order is, or null.
     *
     * Matched through the application's `referred_by` with the shared rule, so
     * this cannot disagree with the incentive cron, the achievements or the
     * weekly invoices about who referred a customer.
     *
     * A referral made through the "Referred By" picker holds the agent's user
     * id, so it matches exactly one candidate below and the ambiguity warning
     * further down cannot arise for it. Older free-text referrals still go
     * through the tolerant name match, and can still be ambiguous — writing the
     * referral through the picker is what resolves that for good.
     */
    public function referringAgent(JobOrder $jobOrder): ?User
    {
        $referredBy = optional($jobOrder->application)->referred_by;

        if (!$referredBy && $jobOrder->application_id) {
            $referredBy = DB::table('applications')->where('id', $jobOrder->application_id)->value('referred_by');
        }

        $referredBy = trim((string) $referredBy);
        if ($referredBy === '') {
            return null;
        }

        // Only users holding an agent balance are agents — the same definition
        // the incentive and invoice crons use.
        $candidates = DB::table('users as u')
            ->join('agent_balance as ab', 'ab.agent_id', '=', 'u.id')
            ->select('u.id', 'u.first_name', 'u.middle_initial', 'u.last_name', 'u.email_address')
            ->get();

        // Every agent the referral could belong to, not just the first.
        //
        // Returning the first match meant that where two agents shared a name,
        // the commission always went to whichever row came back first — in
        // practice the lowest user id — and the other could never be paid by
        // name, with nothing written down to say it had happened.
        $matches = [];
        $exactEmail = null;

        foreach ($candidates as $candidate) {
            $fullName = trim(preg_replace('/\s+/', ' ', trim(
                ($candidate->first_name ?? '') . ' ' . ($candidate->last_name ?? '')
            )));
            $email = trim((string) ($candidate->email_address ?? ''));

            if (!AgentProgramme::referralBelongsToAgent($referredBy, $fullName, $email, $candidate->id)) {
                continue;
            }

            $matches[] = ['id' => (int) $candidate->id, 'name' => $fullName, 'email' => $email];

            // An address identifies exactly one account, so a referral written
            // as an email is never ambiguous and always wins.
            if ($email !== '' && strcasecmp(trim($referredBy), $email) === 0) {
                $exactEmail = (int) $candidate->id;
            }
        }

        if ($matches === []) {
            return null;
        }

        if ($exactEmail !== null) {
            return User::find($exactEmail);
        }

        if (count($matches) > 1) {
            // Still settled with the first, because refusing to pay anybody is
            // worse than paying the wrong one and being able to see it. The
            // ambiguity is recorded so it can be corrected rather than sitting
            // silent in the ledger.
            Log::warning('[JOB ORDER PAYMENT] A referral matched more than one agent; '
                . 'settling with the first and leaving the rest unpaid. Use the agent\'s '
                . 'email address in "Referred By" to disambiguate.', [
                    'job_order_id' => $jobOrder->getKey(),
                    'referred_by'  => $referredBy,
                    'matched'      => array_map(
                        fn ($m) => "#{$m['id']} {$m['name']} <{$m['email']}>",
                        $matches
                    ),
                    'settled_with' => $matches[0]['id'],
                ]);
        }

        return User::find($matches[0]['id']);
    }

    /**
     * What one referral pays in commission.
     *
     * The agent's own rate where they have one, falling back to the global
     * billing configuration — matching how the payout screens resolve it.
     */
    private function commissionRateFor($balance): float
    {
        $own = (float) ($balance->commission ?? 0);
        if ($own > 0) {
            return $own;
        }

        $configured = DB::table('billing_config')->value('agent_commission');

        return (float) ($configured ?? 0);
    }

    /** What one referral is worth toward the quota incentive. */
    private function incentiveRateFor($balance): float
    {
        $own = (float) ($balance->incentives_value ?? 0);

        return $own > 0 ? $own : (float) config('agent_invoices.unit_price', 0);
    }
}

<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\BillingAccount;
use App\Models\PrepaidOverrideRequest;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Approval workflow for manual adjustments to a prepaid customer's service period.
 *
 * billing_accounts.prepaid_expires_at is no longer directly editable on the Edit Billing Details
 * form. Every adjustment outside of a payment now arrives as a PrepaidOverrideRequest that a second
 * person approves, and this class owns both halves of that: raising the request and applying it.
 *
 * Two invariants drive the design:
 *
 *   1. The adjustment is a SIGNED NUMBER OF DAYS resolved against the expiry as it stands AT
 *      APPROVAL TIME, not a target date captured when the request was raised. If the customer pays
 *      in between, PrepaidRenewalService moves the expiry forward and "+7 days" still means seven
 *      days on top of whatever they now have — which is what the requester asked for.
 *
 *   2. A request may only ever be applied ONCE. Every transition is gated on the row still being
 *      `pending`, read under `lockForUpdate`, so two approvers clicking at the same moment produce
 *      one adjustment and one no-op rather than fourteen days from a seven-day request.
 *
 * RADIUS side effects are deliberately kept OUT of the transaction — see
 * {@see enforceAfterCommit()}.
 */
class PrepaidOverrideService
{
    /** Remark stamped on RADIUS operations raised by an approved override. */
    private const RADIUS_REMARKS = 'Prepaid Expiration Override';

    /** billing_status.status_name => id fallbacks, used only when the lookup table has no match. */
    private const FALLBACK_ACTIVE_STATUS_ID = 1;
    private const FALLBACK_INACTIVE_STATUS_ID = 4;

    /**
     * Relations every list/detail response carries.
     *
     * Eager-loaded on ALL read paths. The list view renders the customer name and the requester's
     * email for each row, so lazy loading would fire two queries per request row — the N+1 this
     * constant exists to prevent.
     */
    public const EAGER_RELATIONS = [
        'billingAccount',
        'billingAccount.customer',
        'billingAccount.billingStatus',
        'requester',
        'updater',
    ];

    /**
     * Raise a pending override request.
     *
     * @param  array{account_no:string, days_adjustment:int, reason:string, remarks?:?string}  $data
     * @return array{success:bool, status:int, message:string, data?:PrepaidOverrideRequest}
     */
    public function createRequest(array $data, ?User $actor = null): array
    {
        $accountNo = trim((string) $data['account_no']);
        $days = (int) $data['days_adjustment'];

        try {
            $account = BillingAccount::where('account_no', $accountNo)->first();

            if (!$account) {
                return [
                    'success' => false,
                    'status' => 404,
                    'message' => "Billing account {$accountNo} was not found.",
                ];
            }

            // The whole feature only has meaning for accounts that HAVE a service period. A
            // postpaid account's access is governed by invoices, so adjusting prepaid_expires_at on
            // one would change nothing while looking like it had.
            if (!BillingAccount::isPrepaidType($account->generation_type)) {
                return [
                    'success' => false,
                    'status' => 422,
                    'message' => 'Prepaid expiration overrides apply to prepaid accounts only. This account is '
                        . ($account->generation_type ?: 'not set to a prepaid billing type') . '.',
                ];
            }

            // One open request per account. Without this, three "+30 days" requests could each be
            // approved by a different person and silently stack into ninety.
            $existing = PrepaidOverrideRequest::where('account_no', $accountNo)
                ->where('status', PrepaidOverrideRequest::STATUS_PENDING)
                ->first();

            if ($existing) {
                return [
                    'success' => false,
                    'status' => 409,
                    'message' => "There is already a pending prepaid override request (#{$existing->id}) for this account.",
                ];
            }

            $request = PrepaidOverrideRequest::create([
                'organization_id' => $actor->organization_id ?? $account->organization_id ?? null,
                'account_no' => $accountNo,
                'billing_account_id' => $account->id,
                'days_adjustment' => $days,
                'reason' => trim((string) $data['reason']),
                'remarks' => isset($data['remarks']) && trim((string) $data['remarks']) !== ''
                    ? trim((string) $data['remarks'])
                    : null,
                'status' => PrepaidOverrideRequest::STATUS_PENDING,
                'requested_by' => $actor->id ?? null,
            ]);

            Log::info('[PREPAID OVERRIDE] Request created', [
                'request_id' => $request->id,
                'account_no' => $accountNo,
                'days_adjustment' => $days,
                'current_expiry' => optional($account->prepaid_expires_at)->toDateTimeString(),
                'requested_by_user_id' => $actor->id ?? null,
                'requested_by' => $actor->email_address ?? 'unknown',
            ]);

            ActivityLog::log(
                'Prepaid Override Requested',
                sprintf(
                    'Requested %s day(s) on account %s',
                    $days > 0 ? "+{$days}" : (string) $days,
                    $accountNo
                ),
                'info',
                [
                    'resource_type' => 'PrepaidOverrideRequest',
                    'resource_id' => $request->id,
                    'additional_data' => [
                        'account_no' => $accountNo,
                        'days_adjustment' => $days,
                        'current_expiry' => optional($account->prepaid_expires_at)->toDateTimeString(),
                        'requested_by_user_id' => $actor->id ?? null,
                    ],
                ]
            );

            return [
                'success' => true,
                'status' => 201,
                'message' => 'Prepaid override request submitted successfully.',
                'data' => $request->load(self::EAGER_RELATIONS),
            ];
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to create request', [
                'account_no' => $accountNo,
                'days_adjustment' => $days,
                'requested_by_user_id' => $actor->id ?? null,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'status' => 500,
                'message' => 'Failed to submit prepaid override request.',
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Reject a pending request. Records the decision and touches nothing else.
     *
     * @return array{success:bool, status:int, message:string, data?:PrepaidOverrideRequest}
     */
    public function reject(int $id, ?User $actor = null, ?string $remarks = null): array
    {
        try {
            $result = DB::transaction(function () use ($id, $actor, $remarks) {
                $request = PrepaidOverrideRequest::lockForUpdate()->find($id);

                if (!$request) {
                    return ['success' => false, 'status' => 404, 'message' => 'Prepaid override request not found.'];
                }

                // Already rejected — report success without rewriting the decision, so a retried
                // click cannot overwrite who rejected it or when.
                if (strtolower((string) $request->status) === PrepaidOverrideRequest::STATUS_REJECTED) {
                    return [
                        'success' => true,
                        'status' => 200,
                        'message' => 'This request was already rejected.',
                        'data' => $request,
                    ];
                }

                if (!$request->isPending()) {
                    return [
                        'success' => false,
                        'status' => 409,
                        'message' => "This request is already {$request->status} and can no longer be rejected.",
                    ];
                }

                $request->status = PrepaidOverrideRequest::STATUS_REJECTED;
                $request->updated_by = $actor->id ?? null;
                $request->processed_at = Carbon::now();
                if ($remarks !== null && trim($remarks) !== '') {
                    $request->remarks = trim($remarks);
                }
                $request->save();

                return ['success' => true, 'status' => 200, 'message' => 'Prepaid override request rejected.', 'data' => $request];
            });

            if ($result['success'] && isset($result['data'])) {
                Log::info('[PREPAID OVERRIDE] Request rejected', [
                    'request_id' => $id,
                    'account_no' => $result['data']->account_no,
                    'days_adjustment' => $result['data']->days_adjustment,
                    'rejected_by_user_id' => $actor->id ?? null,
                ]);

                ActivityLog::log(
                    'Prepaid Override Rejected',
                    "Prepaid override request #{$id} for account {$result['data']->account_no} was rejected",
                    'warning',
                    [
                        'resource_type' => 'PrepaidOverrideRequest',
                        'resource_id' => $id,
                        'additional_data' => [
                            'account_no' => $result['data']->account_no,
                            'days_adjustment' => $result['data']->days_adjustment,
                            'rejected_by_user_id' => $actor->id ?? null,
                        ],
                    ]
                );

                $result['data'] = $result['data']->load(self::EAGER_RELATIONS);
            }

            return $result;
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to reject request', [
                'request_id' => $id,
                'rejected_by_user_id' => $actor->id ?? null,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'status' => 500,
                'message' => 'Failed to reject prepaid override request.',
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Approve a pending request and move the customer's expiry by the requested number of days.
     *
     * The request row and the billing account are both taken under `lockForUpdate` inside one
     * transaction, so a concurrent approval of the same request — or a payment renewing the same
     * account — serialises behind this one instead of interleaving with it.
     *
     * IDEMPOTENT: only a `pending` row is ever applied. Re-approving an already-processed request
     * returns the stored result untouched, which is what makes a retried click, a double-submit or
     * a queue redelivery safe.
     *
     * The returned `enforcement` payload is the caller's cue to run {@see enforceAfterCommit()};
     * it is null whenever nothing was applied.
     *
     * @return array{success:bool, status:int, message:string, data?:PrepaidOverrideRequest, enforcement?:?array}
     */
    public function approve(int $id, ?User $actor = null): array
    {
        try {
            $outcome = DB::transaction(function () use ($id, $actor) {
                $request = PrepaidOverrideRequest::lockForUpdate()->find($id);

                if (!$request) {
                    return ['success' => false, 'status' => 404, 'message' => 'Prepaid override request not found.'];
                }

                // Already applied. Returning the stored row (rather than re-applying, or erroring)
                // is what makes this safe to retry: the days were granted exactly once and the
                // caller still sees the outcome it asked for.
                if (strtolower((string) $request->status) === PrepaidOverrideRequest::STATUS_PROCESSED) {
                    return [
                        'success' => true,
                        'status' => 200,
                        'message' => 'This request has already been approved and applied.',
                        'data' => $request,
                        'enforcement' => null,
                        'applied' => false,
                    ];
                }

                if (!$request->isPending()) {
                    return [
                        'success' => false,
                        'status' => 409,
                        'message' => "This request is already {$request->status} and can no longer be approved.",
                    ];
                }

                // Locked for the same reason the request row is: a payment settling on this account
                // mid-approval would otherwise read the pre-adjustment expiry and overwrite ours.
                $account = BillingAccount::where('account_no', $request->account_no)->lockForUpdate()->first();

                if (!$account) {
                    return [
                        'success' => false,
                        'status' => 404,
                        'message' => "Billing account {$request->account_no} no longer exists.",
                    ];
                }

                // Re-checked at approval, not just at submission: the account may have been switched
                // to postpaid in between, and writing prepaid_expires_at on it would be meaningless.
                if (!BillingAccount::isPrepaidType($account->generation_type)) {
                    return [
                        'success' => false,
                        'status' => 422,
                        'message' => 'This account is no longer a prepaid account, so its expiration cannot be overridden.',
                    ];
                }

                $days = (int) $request->days_adjustment;
                $currentExpiry = $account->prepaid_expires_at ? Carbon::parse($account->prepaid_expires_at) : null;

                // No expiry means the prepaid clock has never started (it begins on the first
                // payment). Granting days from now is a coherent way to start it; DEDUCTING from
                // nothing is not — there is no period to shorten, and silently anchoring to `now`
                // would back-date the customer into an immediate cut-off.
                if ($currentExpiry === null && $days < 0) {
                    return [
                        'success' => false,
                        'status' => 422,
                        'message' => 'This account has no prepaid period yet, so days cannot be deducted from it.',
                    ];
                }

                $base = $currentExpiry ?? Carbon::now();
                $newExpiry = $base->copy()->addDays($days);

                $account->prepaid_expires_at = $newExpiry;
                $account->updated_by = $actor->id ?? $account->updated_by;
                $account->save();

                $request->status = PrepaidOverrideRequest::STATUS_PROCESSED;
                $request->updated_by = $actor->id ?? null;
                $request->expiry_before = $currentExpiry;
                $request->expiry_after = $newExpiry;
                $request->processed_at = Carbon::now();
                $request->billing_account_id = $request->billing_account_id ?: $account->id;
                $request->save();

                return [
                    'success' => true,
                    'status' => 200,
                    'message' => 'Prepaid override approved and applied.',
                    'data' => $request,
                    'applied' => true,
                    'enforcement' => [
                        'account_no' => $account->account_no,
                        'billing_account_id' => $account->id,
                        'new_expiry' => $newExpiry->toDateTimeString(),
                        'previous_expiry' => $currentExpiry?->toDateTimeString(),
                        'days_adjustment' => $days,
                        'request_id' => $request->id,
                    ],
                ];
            });

            if (!empty($outcome['applied'])) {
                Log::info('[PREPAID OVERRIDE] Request approved and expiry adjusted', [
                    'request_id' => $id,
                    'account_no' => $outcome['data']->account_no,
                    'days_adjustment' => $outcome['data']->days_adjustment,
                    'expiry_before' => optional($outcome['data']->expiry_before)->toDateTimeString(),
                    'expiry_after' => optional($outcome['data']->expiry_after)->toDateTimeString(),
                    'approved_by_user_id' => $actor->id ?? null,
                ]);

                ActivityLog::log(
                    'Prepaid Override Approved',
                    sprintf(
                        'Account %s prepaid expiry moved %s day(s): %s -> %s',
                        $outcome['data']->account_no,
                        $outcome['data']->days_adjustment > 0 ? "+{$outcome['data']->days_adjustment}" : (string) $outcome['data']->days_adjustment,
                        optional($outcome['data']->expiry_before)->toDateTimeString() ?? 'not set',
                        optional($outcome['data']->expiry_after)->toDateTimeString() ?? 'not set'
                    ),
                    'warning',
                    [
                        'resource_type' => 'PrepaidOverrideRequest',
                        'resource_id' => $id,
                        'additional_data' => [
                            'account_no' => $outcome['data']->account_no,
                            'days_adjustment' => $outcome['data']->days_adjustment,
                            'expiry_before' => optional($outcome['data']->expiry_before)->toDateTimeString(),
                            'expiry_after' => optional($outcome['data']->expiry_after)->toDateTimeString(),
                            'approved_by_user_id' => $actor->id ?? null,
                        ],
                    ]
                );
            }

            if (isset($outcome['data'])) {
                $outcome['data'] = $outcome['data']->load(self::EAGER_RELATIONS);
            }

            return $outcome;
        } catch (\Throwable $e) {
            Log::error('[PREPAID OVERRIDE] Failed to approve request', [
                'request_id' => $id,
                'approved_by_user_id' => $actor->id ?? null,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'status' => 500,
                'message' => 'Failed to approve prepaid override request.',
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Bring RADIUS in line with an expiry that has just moved.
     *
     * Without this the module does nothing useful in its main case: granting days to a customer who
     * has ALREADY been cut off leaves them cut off, because nothing re-checks a prepaid expiry
     * outside of a payment. Conversely, clawing days back from a live customer would leave them
     * online until the 02:00 `cron:auto-disconnect-pullout` run reached them.
     *
     * Applies exactly the cutoff {@see AutoDisconnectService::processPrepaidRestrictions()} applies
     * — same grace day, same restrictedUser() workflow, same flip to Inactive — so a customer ends
     * up in the same state whichever path reaches them first.
     *
     * MUST be called AFTER the approving transaction has committed: a RADIUS group change cannot be
     * rolled back, so issuing one inside the transaction risks cutting off (or reconnecting) a
     * customer whose approval then fails to commit.
     *
     * NEVER THROWS. The adjustment is already durable and the approval must still be reported as
     * successful; a RADIUS failure is queued for `cron:process-radius-queue` and returned, not
     * raised.
     *
     * @param  array{account_no:string, billing_account_id:int, new_expiry:string, request_id:int}  $plan
     * @return array{action:string, reason?:string, expires_at?:string, username?:string}
     */
    public function enforceAfterCommit(array $plan, ?User $actor = null): array
    {
        $accountNo = $plan['account_no'];
        $updatedBy = $actor->email_address ?? 'System';

        try {
            $account = BillingAccount::with('technicalDetails', 'customer')
                ->where('account_no', $accountNo)
                ->first();

            if (!$account) {
                return ['action' => 'skipped', 'reason' => 'billing account not found'];
            }

            if (!BillingAccount::isPrepaidType($account->generation_type)) {
                return ['action' => 'skipped', 'reason' => 'not a prepaid account'];
            }

            if (empty($account->prepaid_expires_at)) {
                return ['action' => 'skipped', 'reason' => 'no prepaid_expires_at to judge'];
            }

            /*
             * Identical cutoff to processPrepaidRestrictions(): the expiry DATE is served in full
             * and restriction falls due at the start of the following day, so an account expiring
             * 07/30 is restricted on 07/31. Normalising to the calendar date is what stops the
             * expiry's inherited time-of-day from cutting customers off mid-afternoon.
             */
            $restrictFrom = Carbon::now()->startOfDay()->subDays(AutoDisconnectService::PREPAID_GRACE_DAYS - 1);
            $expiry = Carbon::parse($account->prepaid_expires_at);
            $hasLapsed = $expiry->lessThan($restrictFrom);

            $currentStatusId = (int) $account->billing_status_id;
            $activeStatusId = $this->statusId('Active', self::FALLBACK_ACTIVE_STATUS_ID);
            $inactiveStatusId = $this->statusId('Inactive', self::FALLBACK_INACTIVE_STATUS_ID);

            /*
             * Both directions are gated on the EXACT status the prepaid restriction flow uses, not
             * on "active vs anything else".
             *
             * The reconnect side is the reason why: Inactive is where
             * processPrepaidRestrictions() parks a customer whose period lapsed, so reconnecting
             * one is simply undoing that. Terminated, Suspended and Pending are deliberate business
             * decisions made elsewhere — granting somebody a few days must never be the thing that
             * quietly puts a terminated account back on the network.
             */
            if ($hasLapsed) {
                if ($currentStatusId !== $activeStatusId) {
                    return [
                        'action' => 'skipped',
                        'reason' => 'period has lapsed but the account is not active, so there is nothing to restrict',
                        'expires_at' => $expiry->toDateTimeString(),
                    ];
                }
            } else {
                if ($currentStatusId === $activeStatusId) {
                    return [
                        'action' => 'skipped',
                        'reason' => 'period is still running and the account is already active',
                        'expires_at' => $expiry->toDateTimeString(),
                    ];
                }

                if ($currentStatusId !== $inactiveStatusId) {
                    return [
                        'action' => 'skipped',
                        'reason' => 'account is not in the Inactive state the prepaid flow sets, so its status was decided elsewhere',
                        'expires_at' => $expiry->toDateTimeString(),
                    ];
                }
            }

            $username = optional($account->technicalDetails->first())->username;

            if (empty($username)) {
                Log::warning('[PREPAID OVERRIDE] No PPPoE username to act on after expiry change', [
                    'account_no' => $accountNo,
                    'expires_at' => $expiry->toDateTimeString(),
                ]);

                return ['action' => 'skipped', 'reason' => 'no PPPoE username in technical_details'];
            }

            return $hasLapsed
                ? $this->restrict($account, $username, $expiry, $updatedBy, $actor)
                : $this->reconnect($account, $username, $expiry, $updatedBy, $actor);
        } catch (\Throwable $e) {
            // The adjustment is committed and correct; only the enforcement failed. Report it and
            // let the nightly AutoDisconnectService run pick this customer up instead.
            Log::error('[PREPAID OVERRIDE] Enforcement failed after approval', [
                'account_no' => $accountNo,
                'request_id' => $plan['request_id'] ?? null,
                'approved_by_user_id' => $actor->id ?? null,
                'error' => $e->getMessage(),
            ]);

            return ['action' => 'error', 'reason' => $e->getMessage()];
        }
    }

    /**
     * Restrict a customer whose adjusted period is already past its grace day.
     *
     * @return array{action:string, reason?:string, expires_at:string, username:string}
     */
    private function restrict(BillingAccount $account, string $username, Carbon $expiry, string $updatedBy, ?User $actor): array
    {
        $accountNo = $account->account_no;

        // Mirror the cron's dedupe: never issue a direct restrict while an earlier one is still
        // queued for retry, or the customer is restricted twice over.
        if ($this->hasQueuedOperation($accountNo, 'restricted_user')) {
            return [
                'action' => 'skipped',
                'reason' => 'a restrict operation is already queued for retry',
                'expires_at' => $expiry->toDateTimeString(),
                'username' => $username,
            ];
        }

        $params = [
            'accountNumber' => $accountNo,
            'username' => $username,
            'remarks' => self::RADIUS_REMARKS . ' — period shortened past expiry',
            'updatedBy' => $updatedBy,
        ];

        $result = app(ManualRadiusOperationsService::class)->restrictedUser($params);

        if (($result['status'] ?? '') !== 'success') {
            $reason = $result['message'] ?? 'Unknown RADIUS error';

            RadiusQueueService::queue([
                'organization_id' => $account->organization_id ?? null,
                'source_type' => 'prepaid_override',
                'source_id' => $account->id,
                'account_no' => $accountNo,
                'operation' => 'restricted_user',
                'params' => $params,
                'last_error' => 'RADIUS restrict failed during prepaid override: ' . $reason,
                'created_by' => $updatedBy,
            ]);

            Log::warning('[PREPAID OVERRIDE] Restrict failed, queued for retry', [
                'account_no' => $accountNo,
                'username' => $username,
                'expires_at' => $expiry->toDateTimeString(),
                'reason' => $reason,
            ]);

            return [
                'action' => 'queued',
                'reason' => $reason,
                'expires_at' => $expiry->toDateTimeString(),
                'username' => $username,
            ];
        }

        // Billing status flips only once RADIUS has accepted the change — same ordering as the
        // cron, so an Inactive row always means a restriction that really landed.
        $account->billing_status_id = $this->statusId('Inactive', self::FALLBACK_INACTIVE_STATUS_ID);
        $account->updated_by = $actor->id ?? $account->updated_by;
        $account->save();

        Log::info('[PREPAID OVERRIDE] Customer restricted — adjusted period already expired', [
            'account_no' => $accountNo,
            'username' => $username,
            'expires_at' => $expiry->toDateTimeString(),
        ]);

        ActivityLog::log(
            'Prepaid Restricted After Override',
            "Account {$accountNo} restricted — the approved override left the prepaid period expired on {$expiry->toDateString()}",
            'warning',
            [
                'resource_type' => 'BillingAccount',
                'resource_id' => $account->id,
                'additional_data' => [
                    'account_no' => $accountNo,
                    'username' => $username,
                    'expires_at' => $expiry->toDateTimeString(),
                ],
            ]
        );

        return ['action' => 'restricted', 'expires_at' => $expiry->toDateTimeString(), 'username' => $username];
    }

    /**
     * Put a restricted customer back online after their period was extended past today.
     *
     * @return array{action:string, reason?:string, expires_at:string, username:string}
     */
    private function reconnect(BillingAccount $account, string $username, Carbon $expiry, string $updatedBy, ?User $actor): array
    {
        $accountNo = $account->account_no;

        if ($this->hasQueuedOperation($accountNo, 'reconnect_user')) {
            return [
                'action' => 'skipped',
                'reason' => 'a reconnect operation is already queued for retry',
                'expires_at' => $expiry->toDateTimeString(),
                'username' => $username,
            ];
        }

        // reconnectUser() puts the customer on the RADIUS group named after their plan, so the plan
        // name has to come along. desired_plan is the same source TransactionController's
        // post-approval reconnect reads.
        $plan = optional($account->customer)->desired_plan;

        if (empty($plan)) {
            Log::warning('[PREPAID OVERRIDE] No plan on customer record, cannot reconnect', [
                'account_no' => $accountNo,
                'username' => $username,
            ]);

            return [
                'action' => 'skipped',
                'reason' => 'no plan on the customer record to reconnect onto',
                'expires_at' => $expiry->toDateTimeString(),
                'username' => $username,
            ];
        }

        $params = [
            'accountNumber' => $accountNo,
            'username' => $username,
            'plan' => $plan,
            'remarks' => self::RADIUS_REMARKS . ' — period extended',
            'updatedBy' => $updatedBy,
        ];

        $result = app(ManualRadiusOperationsService::class)->reconnectUser($params);

        if (($result['status'] ?? '') !== 'success') {
            $reason = $result['message'] ?? 'Unknown RADIUS error';

            RadiusQueueService::queue([
                'organization_id' => $account->organization_id ?? null,
                'source_type' => 'prepaid_override',
                'source_id' => $account->id,
                'account_no' => $accountNo,
                'operation' => 'reconnect_user',
                'params' => $params,
                'last_error' => 'RADIUS reconnect failed during prepaid override: ' . $reason,
                'created_by' => $updatedBy,
            ]);

            Log::warning('[PREPAID OVERRIDE] Reconnect failed, queued for retry', [
                'account_no' => $accountNo,
                'username' => $username,
                'expires_at' => $expiry->toDateTimeString(),
                'reason' => $reason,
            ]);

            return [
                'action' => 'queued',
                'reason' => $reason,
                'expires_at' => $expiry->toDateTimeString(),
                'username' => $username,
            ];
        }

        $account->billing_status_id = $this->statusId('Active', self::FALLBACK_ACTIVE_STATUS_ID);
        $account->updated_by = $actor->id ?? $account->updated_by;
        $account->save();

        // When an override extends the period of an expired account past today and reconnects it,
        // any pending pullout service order for equipment retrieval is now void.
        app(PulloutServiceOrderCloser::class)
            ->closeIfSettled($accountNo, 0.0, 'prepaid override');

        Log::info('[PREPAID OVERRIDE] Customer reconnected — period extended past today', [
            'account_no' => $accountNo,
            'username' => $username,
            'expires_at' => $expiry->toDateTimeString(),
        ]);

        ActivityLog::log(
            'Prepaid Reconnected After Override',
            "Account {$accountNo} reconnected — the approved override extended the prepaid period to {$expiry->toDateString()}",
            'info',
            [
                'resource_type' => 'BillingAccount',
                'resource_id' => $account->id,
                'additional_data' => [
                    'account_no' => $accountNo,
                    'username' => $username,
                    'expires_at' => $expiry->toDateTimeString(),
                ],
            ]
        );

        return ['action' => 'reconnected', 'expires_at' => $expiry->toDateTimeString(), 'username' => $username];
    }

    /** Is a RADIUS operation of this kind already waiting in the retry queue for this account? */
    private function hasQueuedOperation(string $accountNo, string $operation): bool
    {
        return DB::table('radius_operation_queue')
            ->where('account_no', $accountNo)
            ->where('operation', $operation)
            ->whereIn('status', ['pending', 'processing'])
            ->exists();
    }

    /** billing_status id by name, falling back to the historical hardcoded id. */
    private function statusId(string $statusName, int $fallback): int
    {
        return (int) (DB::table('billing_status')->where('status_name', $statusName)->value('id') ?? $fallback);
    }
}

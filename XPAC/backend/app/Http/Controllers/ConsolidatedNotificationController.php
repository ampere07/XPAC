<?php

namespace App\Http\Controllers;

use App\Services\JobOrderNotificationGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class ConsolidatedNotificationController extends Controller
{
    /** roles.id for SuperAdmin. Matches the $roleId == 7 checks elsewhere in the app. */
    private const SUPERADMIN_ROLE_ID = 7;

    /**
     * How much wider than $limit the job-order query reads before suppression.
     *
     * The guard removes rows after the query, so reading exactly $limit would
     * hand back a short page whenever anything was withheld. The cap stops an
     * installation whose job orders are overwhelmingly pending from turning a
     * notification poll into a large scan.
     */
    private const SUPPRESSION_OVERFETCH = 3;
    private const SUPPRESSION_OVERFETCH_CAP = 150;

    public function index(Request $request)
    {
        try {
            // Cast and clamped: the value reaches a LIMIT and an arithmetic
            // over-fetch below, and a caller passing "abc" or 100000 should not
            // decide either.
            $limit = max(1, min(100, (int) $request->get('limit', 15)));

            // 1. Fetch Applications (Pending)
            $applications = DB::table('applications')
                ->where('status', 'Pending')
                ->orderBy('created_at', 'desc')
                ->limit($limit)
                ->get()
                ->map(function ($app) {
                    $createdAt = Carbon::parse($app->created_at);
                    return [
                        'id' => $app->id,
                        'type' => 'application',
                        'customer_name' => trim(($app->first_name ?? '') . ' ' . ($app->last_name ?? '')),
                        'plan_name' => $app->desired_plan ?? 'Unknown Plan',
                        'title' => 'New Application',
                        'message' => 'New application received',
                        'timestamp' => $createdAt->timestamp,
                        'formatted_date' => $createdAt->format('Y-m-d h:i:s A'), // e.g. 2026-02-11 05:53:42 PM
                        'raw_date' => $createdAt->toIso8601String()
                    ];
                });

            // 2. Fetch Job Orders (Done)
            //
            // A JO notification names the job order by number and says the work is
            // finished, so it is withheld until both halves of the job order have
            // actually landed — see JobOrderNotificationGuard. The visit row and
            // billing_status are selected here rather than re-read by the guard so
            // the check costs no extra query.
            //
            // Over-fetched before filtering: the guard drops rows, and taking
            // exactly $limit first would leave the feed short by however many were
            // suppressed. Capped at a small multiple so a database full of pending
            // job orders cannot turn this into an unbounded read.
            $jobCandidates = DB::table('job_orders')
                ->join('applications', 'job_orders.application_id', '=', 'applications.id')
                ->where('job_orders.onsite_status', 'Done')
                ->orderBy('job_orders.updated_at', 'desc')
                ->limit(min($limit * self::SUPPRESSION_OVERFETCH, self::SUPPRESSION_OVERFETCH_CAP))
                ->select(
                    'job_orders.id',
                    'job_orders.updated_at',
                    'job_orders.billing_status',
                    'job_orders.onsite_status',
                    'applications.first_name',
                    'applications.last_name',
                    'applications.desired_plan'
                )
                ->get();

            $guard = app(JobOrderNotificationGuard::class);

            $jobCompeltions = $jobCandidates
                ->filter(function ($job) use ($guard) {
                    $reason = $guard->reasonFor($job->billing_status, $job->onsite_status);

                    if ($reason === null) {
                        return true;
                    }

                    $guard->logSuppressed($job->id, $reason, [
                        'feed' => 'consolidated',
                        'billing_status' => $job->billing_status,
                        'onsite_status' => $job->onsite_status,
                    ]);

                    return false;
                })
                ->take($limit)
                ->map(function ($job) {
                    $updatedAt = Carbon::parse($job->updated_at);
                    return [
                        'id' => $job->id,
                        'type' => 'job_order_done',
                        'customer_name' => trim(($job->first_name ?? '') . ' ' . ($job->last_name ?? '')),
                        'plan_name' => $job->desired_plan ?? 'Unknown Plan',
                        'title' => 'Job Order Completed',
                        'message' => 'Onsite status marked as Done',
                        'timestamp' => $updatedAt->timestamp,
                        'formatted_date' => $updatedAt->format('Y-m-d h:i:s A'), // e.g. 2026-02-11 05:53:42 PM
                        'raw_date' => $updatedAt->toIso8601String()
                    ];
                })
                ->values();

            // 3. Fetch Service Orders (Visit Done)
            //
            // visit_status is the service order's equivalent of a job order's
            // onsite_status: it records what happened on the visit. support_status is a
            // separate axis (For Visit / Resolved / Cancelled) and is deliberately not
            // used here — "the technician finished the visit" is the event being reported.
            //
            // Joined through the billing account because a service order stores only an
            // account_no, unlike a job order which carries the application.
            $serviceCompletions = DB::table('service_orders')
                ->leftJoin('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('service_orders.visit_status', 'Done')
                ->orderBy('service_orders.updated_at', 'desc')
                ->limit($limit)
                ->select(
                    'service_orders.id',
                    'service_orders.updated_at',
                    'service_orders.account_no',
                    'service_orders.concern',
                    'customers.first_name',
                    'customers.last_name'
                )
                ->get()
                ->map(function ($order) {
                    $updatedAt = Carbon::parse($order->updated_at);
                    $name = trim(($order->first_name ?? '') . ' ' . ($order->last_name ?? ''));

                    return [
                        'id' => $order->id,
                        'type' => 'service_order_done',
                        // Falls back to the account number so a service order whose
                        // customer record is missing is still identifiable.
                        'customer_name' => $name !== '' ? $name : ($order->account_no ?? 'Unknown account'),
                        // The concern rather than a plan: it is what the visit was about.
                        'plan_name' => $order->concern ?? 'Service visit',
                        'title' => 'Service Order Completed',
                        'message' => 'Visit status marked as Done',
                        'timestamp' => $updatedAt->timestamp,
                        'formatted_date' => $updatedAt->format('Y-m-d h:i:s A'),
                        'raw_date' => $updatedAt->toIso8601String(),
                    ];
                });

            // 4. Service charges claimed on a completed visit.
            //
            // Deliberately its own kind rather than folded into service_order_done
            // above: that entry reports the visit finished, this one reports money a
            // technician added to the customer's balance. A charge is reviewable in a
            // way a completed visit is not, so it is named as a charge instead of
            // being something you only discover by opening every finished order.
            // A charged order therefore produces both entries, on purpose.
            //
            // '> 0' rather than a null check: the mobile edit modal posts
            // parseFloat('0.00') for a field the technician never touched, so
            // whereNotNull would announce practically every completed visit.
            $serviceChargeClaims = DB::table('service_orders')
                ->leftJoin('billing_accounts', 'service_orders.account_no', '=', 'billing_accounts.account_no')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('service_orders.visit_status', 'Done')
                ->where('service_orders.service_charge', '>', 0)
                ->orderBy('service_orders.updated_at', 'desc')
                ->limit($limit)
                ->select(
                    'service_orders.id',
                    'service_orders.updated_at',
                    'service_orders.account_no',
                    'service_orders.service_charge',
                    'service_orders.visit_by_user',
                    'customers.first_name',
                    'customers.last_name'
                )
                ->get()
                ->map(function ($order) {
                    $updatedAt = Carbon::parse($order->updated_at);
                    $name = trim(($order->first_name ?? '') . ' ' . ($order->last_name ?? ''));
                    // visit_by_user is the technician who attended, not whoever last
                    // saved the row — the claim belongs to the person on site.
                    $technician = trim((string) ($order->visit_by_user ?? ''));
                    $amount = '₱ ' . number_format((float) $order->service_charge, 2);

                    return [
                        'id' => $order->id,
                        'type' => 'service_order_charge_claimed',
                        'customer_name' => $name !== '' ? $name : ($order->account_no ?? 'Unknown account'),
                        // The amount, so the size of the claim is visible without opening it.
                        'plan_name' => $amount,
                        'technician' => $technician !== '' ? $technician : null,
                        'title' => 'Service Charge Claimed',
                        'message' => ($technician !== '' ? $technician : 'A technician')
                            . " claimed a {$amount} service charge on service order #{$order->id}",
                        'timestamp' => $updatedAt->timestamp,
                        'formatted_date' => $updatedAt->format('Y-m-d h:i:s A'),
                        'raw_date' => $updatedAt->toIso8601String(),
                    ];
                });

            // 5. Pending transaction reverts — SUPERADMIN ONLY.
            //
            // A revert undoes money that was already posted, so only the role that can
            // action one is told about it. Gated on role_id 7 explicitly and failing
            // closed when there is no authenticated user: this route is not behind
            // auth:sanctum, so an unauthenticated caller reaches it, and treating
            // "no user" as unrestricted (as some older controllers here do) would
            // publish reverts to anyone who asked.
            $authUser = auth()->user();
            $isSuperadmin = $authUser && (int) $authUser->role_id === self::SUPERADMIN_ROLE_ID;

            $reverts = $isSuperadmin
                ? DB::table('transaction_revert')
                    ->join('transactions', 'transaction_revert.transaction_id', '=', 'transactions.id')
                    ->leftJoin('billing_accounts', 'transactions.account_no', '=', 'billing_accounts.account_no')
                    ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                    // Only what still needs a decision. A revert already actioned is
                    // history, not a prompt.
                    ->where('transaction_revert.status', 'pending')
                    ->orderBy('transaction_revert.created_at', 'desc')
                    ->limit($limit)
                    ->select(
                        'transaction_revert.id',
                        'transaction_revert.created_at',
                        'transaction_revert.reason',
                        'transactions.received_payment',
                        'transactions.account_no',
                        'customers.first_name',
                        'customers.last_name'
                    )
                    ->get()
                    ->map(function ($revert) {
                        $createdAt = Carbon::parse($revert->created_at);
                        $name = trim(($revert->first_name ?? '') . ' ' . ($revert->last_name ?? ''));

                        return [
                            'id' => $revert->id,
                            'type' => 'transaction_revert',
                            // Falls back to the account number: a revert must still be
                            // identifiable when the customer record is missing.
                            'customer_name' => $name !== '' ? $name : ($revert->account_no ?? 'Unknown account'),
                            'plan_name' => '₱ ' . number_format((float) ($revert->received_payment ?? 0), 2),
                            'title' => 'Revert Requested',
                            'message' => $revert->reason ?? 'Transaction revert requested',
                            'timestamp' => $createdAt->timestamp,
                            'formatted_date' => $createdAt->format('Y-m-d h:i:s A'),
                            'raw_date' => $createdAt->toIso8601String(),
                        ];
                    })
                : collect();

            // Merge and Sort
            $all = $applications->concat($jobCompeltions)->concat($serviceCompletions)->concat($serviceChargeClaims)->concat($reverts)
                ->sortByDesc('timestamp')
                ->take($limit)
                ->values();

            return response()->json([
                'success' => true,
                'data' => $all
            ]);

        } catch (\Exception $e) {
            Log::error('Failed to fetch consolidated notifications', [
                'error' => $e->getMessage()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch notifications',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}



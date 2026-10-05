<?php

namespace App\Services;

use App\Models\JobOrder;
use App\Models\Role;
use App\Models\Transaction;
use Illuminate\Database\Eloquent\Builder;

/**
 * The For Approval queue: every record still waiting on an approver, in one place.
 *
 * Nothing here approves anything. Approving goes through each record's own endpoint
 * (TransactionController::approve, JobOrderController::approve), so this class only has to
 * decide what is listed — and it lists exactly what those endpoints would accept, so the queue
 * never offers a record whose Approve is then refused:
 *
 *   transactions  status Pending. approve() refuses any other status.
 *   job orders    onsite_status Done and billing_status not Done — the rule the Approve button
 *                 in JobOrderDetails is drawn by — with no billing account yet and an
 *                 application behind it, both of which approve() refuses without.
 *
 * Each list is scoped to the organisation the way its approve endpoint scopes the lookup, and the
 * two do not use the same rule: a transaction is visible across every organisation to SuperAdmin
 * or to a user with none, while a job order is only ever visible within the caller's own
 * organisation (for a user with none, among the job orders that carry none). Mirroring each one
 * is what keeps Approve from answering "not found" for a row the queue itself listed.
 *
 * Statuses are compared with plain equality. These columns use a case-insensitive collation, so
 * 'pending' and 'PENDING' still match — as the clients' toLowerCase() checks do — while the
 * comparison stays one an index on the column can serve.
 */
class ForApprovalQueueService
{
    /** What the Transaction List loads with each row, so the details pane renders the same. */
    public const TRANSACTION_RELATIONS = [
        'account.customer', 'account.technicalDetails', 'processor', 'paymentMethodInfo', 'revert_request',
    ];

    /** What the Job Order list loads with each row; JobOrderListFormatter reads all three. */
    public const JOB_ORDER_RELATIONS = ['application', 'items', 'billingAccount.customer'];

    /**
     * Pending transactions the user may approve, optionally narrowed by a search term.
     *
     * @param  \App\Models\User|object  $user
     */
    public function transactions($user, string $search = ''): Builder
    {
        $query = Transaction::query()->where('status', 'Pending');

        // TransactionController::approve(): SuperAdmin, or a user with no organisation, may
        // approve any transaction; everyone else only their organisation's.
        $organizationId = $user->organization_id ?? null;
        $isSuperAdmin = (int) ($user->role_id ?? 0) === Role::SUPER_ADMIN || !$organizationId;

        if (!$isSuperAdmin) {
            $query->where('organization_id', $organizationId);
        }

        if ($search !== '') {
            $like = "%{$search}%";

            $query->where(function (Builder $q) use ($search, $like) {
                $q->where('account_no', 'LIKE', $like)
                    ->orWhere('reference_no', 'LIKE', $like)
                    ->orWhere('or_no', 'LIKE', $like)
                    ->orWhere('transaction_type', 'LIKE', $like)
                    ->orWhere('payment_method', 'LIKE', $like)
                    ->orWhere('processed_by_user', 'LIKE', $like)
                    ->orWhereHas('account.customer', fn (Builder $c) => $this->whereNameMatches($c, $like));

                if (ctype_digit($search)) {
                    $q->orWhere('id', (int) $search);
                }
            });
        }

        return $query;
    }

    /**
     * Done job orders the user may approve, optionally narrowed by a search term.
     *
     * @param  \App\Models\User|object  $user
     */
    public function jobOrders($user, string $search = ''): Builder
    {
        $query = JobOrder::query()
            ->where('onsite_status', 'Done')
            ->where(function (Builder $q) {
                // A billing status that was never set is the most common "not approved yet".
                $q->whereNull('billing_status')->orWhere('billing_status', '!=', 'Done');
            })
            // approve() refuses a job order that already has an account, or has no application.
            ->whereNull('account_id')
            ->whereHas('application');

        // JobOrderController::approve(): the caller's own organisation, or — with none — the job
        // orders that carry none.
        if (!empty($user->organization_id)) {
            $query->where('organization_id', $user->organization_id);
        } else {
            $query->whereNull('organization_id');
        }

        if ($search !== '') {
            $like = "%{$search}%";

            $query->where(function (Builder $q) use ($search, $like) {
                $q->where('assigned_email', 'LIKE', $like)
                    ->orWhere('username', 'LIKE', $like)
                    ->orWhere('modem_router_sn', 'LIKE', $like)
                    ->orWhereHas('application', function (Builder $app) use ($like) {
                        $app->where(function (Builder $a) use ($like) {
                            $this->whereNameMatches($a, $like);
                            $a->orWhere('mobile_number', 'LIKE', $like)
                                ->orWhere('city', 'LIKE', $like)
                                ->orWhere('barangay', 'LIKE', $like)
                                ->orWhere('desired_plan', 'LIKE', $like);
                        });
                    });

                if (ctype_digit($search)) {
                    $q->orWhere('id', (int) $search);
                }
            });
        }

        return $query;
    }

    /**
     * How many of each are waiting.
     *
     * @param  \App\Models\User|object  $user
     * @return array{transactions: int, job_orders: int, total: int}
     */
    public function counts($user): array
    {
        $transactions = $this->transactions($user)->count();
        $jobOrders = $this->jobOrders($user)->count();

        return [
            'transactions' => $transactions,
            'job_orders' => $jobOrders,
            'total' => $transactions + $jobOrders,
        ];
    }

    /**
     * First name, last name, or the two together — with or without the middle initial, the way
     * Customer::full_name writes it — so "Juan Dela Cruz" finds Juan Dela Cruz.
     */
    private function whereNameMatches(Builder $query, string $like): void
    {
        $query->where(function (Builder $q) use ($like) {
            $q->where('first_name', 'LIKE', $like)
                ->orWhere('last_name', 'LIKE', $like)
                ->orWhereRaw("CONCAT_WS(' ', first_name, last_name) LIKE ?", [$like])
                ->orWhereRaw("CONCAT_WS(' ', first_name, middle_initial, last_name) LIKE ?", [$like]);
        });
    }
}

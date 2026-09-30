<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Permanently deletes a customer and every record tied to them.
 *
 * Triggered when a pullout service order (concern "Pullout" / "For Pullout") is
 * saved with support status Resolved OR visit status Done — see
 * ServiceOrderApiController::update().
 *
 * The customer's PPPoE username is deleted from every RADIUS server FIRST. If any
 * server cannot be reached or refuses the delete, nothing in the database is
 * touched: the records are the only way to find that username again, so they are
 * kept until RADIUS is clean. The next save of the service order retries.
 *
 * This is a HARD delete: rows are removed, not flagged. It covers the customer,
 * billing account, technical details, application, job orders, service orders,
 * invoices, transactions, payment portal logs, notices, SMS/email logs and the
 * portal login — every table that carries the account's number, billing account
 * id, job order id or application id.
 *
 * All deletes run in one transaction: either the whole customer goes or nothing
 * does, so a failure part-way can never leave half a customer behind.
 *
 * Only disconnected_logs is kept. Its account_id is nulled by the foreign key when
 * the billing account goes, but each row keeps its username, and one final row is
 * added recording the purge (account no, name, service order).
 *
 * The *_backup_* snapshot tables are purged too: they hold older copies of this
 * customer's rows, and keeping them would keep the data.
 *
 * RADIUS queue rows are all deleted: once the username is gone from RADIUS there
 * is nothing left for a queued disconnect or restrict to act on.
 *
 * No copy of the deleted rows is kept anywhere — no backup file, no snapshot in
 * activity_logs. Once a pullout is finished the customer's data is gone for good;
 * only disconnected_logs remains.
 */
final class CustomerPurgeService
{

    /** Concern values that mark a service order as a pullout. */
    public const PULLOUT_CONCERNS = ['pullout', 'forpullout'];

    /** Does this concern mean pullout? Case and spacing ("For Pull Out") do not matter. */
    public static function isPulloutConcern(?string $concern): bool
    {
        $folded = preg_replace('/\s+/u', '', strtolower(trim((string) $concern)));

        return in_array($folded, self::PULLOUT_CONCERNS, true);
    }

    /** The whole trigger: a pullout concern whose support status is Resolved or visit status is Done. */
    public static function shouldPurge(?string $concern, ?string $supportStatus, ?string $visitStatus = null): bool
    {
        return self::isPulloutConcern($concern)
            && (strtolower(trim((string) $supportStatus)) === 'resolved'
                || strtolower(trim((string) $visitStatus)) === 'done');
    }

    /**
     * Delete the customer behind this account number, and everything linked to it.
     *
     * @return array{status:string, account_no:string, deleted:array<string,int>, total:int, radius_usernames:string[], error:?string}
     */
    public function purge(string $accountNo, string $triggeredBy = 'System', ?int $serviceOrderId = null): array
    {
        $result = [
            'status' => 'skipped',
            'account_no' => $accountNo,
            'deleted' => [],
            'total' => 0,
            'radius_usernames' => [],
            'error' => null,
        ];

        $this->log("[START] Purge requested for account {$accountNo} by {$triggeredBy}" . ($serviceOrderId ? " (service order #{$serviceOrderId})" : ''));

        try {
            $account = DB::table('billing_accounts')->where('account_no', $accountNo)->first();
            if (!$account) {
                $result['error'] = 'Billing account not found';
                $this->log("[SKIP] No billing account for {$accountNo}");
                return $result;
            }

            $billingId = (int) $account->id;
            $customerId = $account->customer_id !== null ? (int) $account->customer_id : null;

            $jobOrderIds = $this->ids('job_orders', 'id', 'account_id', [$billingId]);
            $applicationIds = DB::table('job_orders')
                ->whereIn('id', $jobOrderIds ?: [0])
                ->whereNotNull('application_id')
                ->pluck('application_id')->map(fn ($v) => (int) $v)->unique()->values()->all();
            $serviceOrderIds = $this->ids('service_orders', 'id', 'account_no', [$accountNo]);
            $invoiceIds = $this->ids('invoices', 'id', 'account_no', [$accountNo]);
            $transactionIds = $this->ids('transactions', 'id', 'account_no', [$accountNo]);

            // ── RADIUS first ─────────────────────────────────────────────────────
            // Every username this customer has gone by: the live one on technical
            // details, the session record, and what the job order provisioned.
            $usernames = collect()
                ->merge($this->column('technical_details', 'username', 'account_id', [$billingId]))
                ->merge($this->column('online_status', 'username', 'account_id', [$billingId]))
                ->merge($this->column('job_orders', 'pppoe_username', 'id', $jobOrderIds))
                ->merge($this->column('job_orders', 'username', 'id', $jobOrderIds))
                ->map(fn ($u) => trim((string) $u))
                ->filter()
                ->unique(fn ($u) => strtolower($u))
                ->values()
                ->all();

            $result['radius_usernames'] = $usernames;
            $organizationId = isset($account->organization_id) ? (int) $account->organization_id ?: null : null;
            $radius = app(RadiusReconciliationService::class);

            foreach ($usernames as $username) {
                $outcome = $radius->deleteUserFromAllServers($username, $organizationId);
                $this->log("[RADIUS] '{$username}': deleted on [" . implode(', ', $outcome['deleted']) . '], absent on [' . implode(', ', $outcome['absent']) . ']'
                    . ($outcome['errors'] ? ', errors: ' . implode(' | ', $outcome['errors']) : ''));

                if (!$outcome['success']) {
                    // Keep every record: they are the only trace of a username still on RADIUS.
                    $result['status'] = 'failed';
                    $result['error'] = "RADIUS delete failed for '{$username}', so no customer data was deleted: " . implode(' | ', $outcome['errors']);
                    $this->log('[ABORT] ' . $result['error']);
                    return $result;
                }
            }

            $plan = $this->plan($accountNo, $billingId, $customerId, $jobOrderIds, $applicationIds, $serviceOrderIds, $invoiceIds, $transactionIds);

            $customer = $customerId !== null ? DB::table('customers')->where('id', $customerId)->first() : null;
            $fullName = $customer ? trim(($customer->first_name ?? '') . ' ' . ($customer->last_name ?? '')) : '';

            DB::transaction(function () use ($plan, &$result, $accountNo, $fullName, $usernames, $serviceOrderId, $triggeredBy, $organizationId) {
                foreach ($plan as $step) {
                    $query = $this->query($step);
                    if ($query === null) {
                        continue;
                    }
                    $count = $query->delete();
                    if ($count > 0) {
                        $result['deleted'][$step['table']] = ($result['deleted'][$step['table']] ?? 0) + $count;
                        $result['total'] += $count;
                    }
                }

                // The one record kept on purpose says what happened to the customer.
                if (Schema::hasTable('disconnected_logs')) {
                    DB::table('disconnected_logs')->insert([
                        'organization_id' => $organizationId,
                        'account_id' => null,
                        'username' => $usernames[0] ?? null,
                        'remarks' => "Customer purged after pullout: account {$accountNo}"
                            . ($fullName !== '' ? " ({$fullName})" : '')
                            . ($serviceOrderId ? ", service order #{$serviceOrderId}" : '')
                            . ($usernames ? '. RADIUS username(s) deleted: ' . implode(', ', $usernames) : '. No RADIUS username on record')
                            . '.',
                        'created_by_user' => $triggeredBy,
                        'updated_by_user' => $triggeredBy,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            });

            $result['status'] = 'success';
            $this->log("[SUCCESS] Purged account {$accountNo}: {$result['total']} row(s) across " . count($result['deleted']) . ' table(s) ' . json_encode($result['deleted']));
        } catch (Throwable $e) {
            $result['status'] = 'failed';
            $result['error'] = $e->getMessage();
            $result['deleted'] = [];
            $result['total'] = 0;
            $this->log("[FAILED] Purge of {$accountNo} rolled back: " . $e->getMessage());
            Log::error('[CUSTOMER PURGE] Failed for ' . $accountNo . ': ' . $e->getMessage());
        }

        return $result;
    }

    /**
     * Every delete, children before parents. Each step is a table, a key column and
     * the values to match; optional `extra` narrows it further.
     */
    private function plan(
        string $accountNo,
        int $billingId,
        ?int $customerId,
        array $jobOrderIds,
        array $applicationIds,
        array $serviceOrderIds,
        array $invoiceIds,
        array $transactionIds
    ): array {
        $byNo = fn (string $table, string $column = 'account_no') => ['table' => $table, 'column' => $column, 'values' => [$accountNo]];
        $byBilling = fn (string $table) => ['table' => $table, 'column' => 'account_id', 'values' => [$billingId]];

        return [
            // Rows hanging off other rows of this customer.
            ['table' => 'service_order_items', 'column' => 'service_order_id', 'values' => $serviceOrderIds],
            ['table' => 'installment_schedules', 'column' => 'invoice_id', 'values' => $invoiceIds],
            ['table' => 'transaction_revert', 'column' => 'transaction_id', 'values' => $transactionIds],
            ['table' => 'job_order_items', 'column' => 'job_order_id', 'values' => $jobOrderIds],
            ['table' => 'job_order_images_queue', 'column' => 'job_order_id', 'values' => $jobOrderIds],
            ['table' => 'agent_incentive_history', 'column' => 'job_order_id', 'values' => $jobOrderIds],
            ['table' => 'agent_invoice_customers', 'column' => 'job_order_id', 'values' => $jobOrderIds],
            ['table' => 'agent_invoice_customers', 'column' => 'application_id', 'values' => $applicationIds],
            ['table' => 'application_visits', 'column' => 'application_id', 'values' => $applicationIds],
            ['table' => 'images_queue', 'column' => 'application_id', 'values' => $applicationIds],

            // Keyed by account number.
            $byNo('service_charge_logs'),
            $byNo('service_orders'),
            $byNo('overdue'),
            $byNo('disconnection_notice'),
            $byNo('discounts'),
            $byNo('rebates_usage'),
            $byNo('staggered_installation'),
            $byNo('statement_of_accounts'),
            $byNo('pending_payments'),
            $byNo('transactions'),
            $byNo('invoices'),
            $byNo('borrowed_logs'),
            $byNo('change_due_logs'),
            $byNo('email_queue'),
            $byNo('sms_logs'),
            $byNo('sms_queue'),
            $byNo('inventory_logs'),
            $byNo('prepaid_override_requests'),
            $byNo('billing_reconciliation_dismissals'),
            // The username is already off RADIUS (purge() stops before this otherwise), so
            // any queued disconnect/restrict has nothing left to act on.
            $byNo('radius_operation_queue'),

            // Keyed by billing account id.
            $byBilling('advanced_payments'),
            $byBilling('attachments'),
            $byBilling('dc_notice'),
            $byBilling('details_update_logs'),
            // disconnected_logs is kept on purpose — see the class comment.
            $byBilling('installments'),
            $byBilling('inventory_movements'),
            $byBilling('payment_portal_logs'),
            $byBilling('plan_change_logs'),
            $byBilling('reconnection_logs'),
            $byBilling('security_deposits'),
            $byBilling('sms_blast'),
            $byBilling('online_status'),
            $byNo('online_status'),
            $byNo('technical_details'),
            $byBilling('technical_details'),

            // The customer's own records, last.
            ['table' => 'job_orders', 'column' => 'id', 'values' => $jobOrderIds],
            ['table' => 'applications', 'column' => 'id', 'values' => $applicationIds],
            // The portal login: username is the account number. Customer role only, so a
            // staff user whose username happens to match is never touched.
            $byNo('users', 'username') + ['extra' => fn ($q) => $q->whereIn('role_id', DB::table('roles')->where('role_name', 'Customer')->pluck('id'))],
            ['table' => 'billing_accounts', 'column' => 'id', 'values' => [$billingId]],
            ['table' => 'customers', 'column' => 'id', 'values' => $customerId !== null ? [$customerId] : []],

            // Snapshot tables holding older copies of the same rows.
            ...$this->backupTableSteps($accountNo, $billingId, $customerId),
        ];
    }

    /**
     * Delete steps for every *backup* table that holds this customer: matched by
     * account number, or by billing account / customer id when the snapshot is of
     * billing_accounts or customers. disconnected_logs backups are left alone, like
     * the table itself.
     */
    private function backupTableSteps(string $accountNo, int $billingId, ?int $customerId): array
    {
        $tables = collect(DB::select(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '%backup%'"
        ))->pluck('name')->reject(fn ($t) => str_starts_with(strtolower($t), 'disconnected_logs'));

        $steps = [];
        foreach ($tables as $table) {
            if (Schema::hasColumn($table, 'account_no')) {
                $steps[] = ['table' => $table, 'column' => 'account_no', 'values' => [$accountNo]];
            } elseif (Schema::hasColumn($table, 'account_id')) {
                $steps[] = ['table' => $table, 'column' => 'account_id', 'values' => [$billingId]];
            } elseif (str_starts_with(strtolower($table), 'billing_accounts') && Schema::hasColumn($table, 'id')) {
                $steps[] = ['table' => $table, 'column' => 'id', 'values' => [$billingId]];
            } elseif (str_starts_with(strtolower($table), 'customers') && Schema::hasColumn($table, 'id') && $customerId !== null) {
                $steps[] = ['table' => $table, 'column' => 'id', 'values' => [$customerId]];
            }
        }

        return $steps;
    }

    /** The query for one step, or null when the table/column does not exist or nothing matches. */
    private function query(array $step)
    {
        if ($step['values'] === [] || !Schema::hasTable($step['table']) || !Schema::hasColumn($step['table'], $step['column'])) {
            return null;
        }

        $query = DB::table($step['table'])->whereIn($step['column'], $step['values']);
        if (isset($step['extra'])) {
            ($step['extra'])($query);
        }

        return $query;
    }

    /** The `$select` values of `$table` rows whose `$column` is one of `$values`. */
    private function column(string $table, string $select, string $column, array $values): array
    {
        if ($values === [] || !Schema::hasTable($table) || !Schema::hasColumn($table, $column) || !Schema::hasColumn($table, $select)) {
            return [];
        }

        return DB::table($table)->whereIn($column, $values)->pluck($select)->all();
    }

    /** The ids of `$table` rows whose `$column` is one of `$values`. */
    private function ids(string $table, string $idColumn, string $column, array $values): array
    {
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, $column)) {
            return [];
        }

        return DB::table($table)->whereIn($column, $values)->pluck($idColumn)->map(fn ($v) => (int) $v)->all();
    }

    private function log(string $message): void
    {
        $line = '[' . now()->format('Y-m-d H:i:s') . "] [Customer Purge] {$message}";
        try {
            file_put_contents(storage_path('logs/customerpurge.log'), $line . PHP_EOL, FILE_APPEND);
        } catch (Throwable $e) {
            // Never fatal.
        }
        Log::info('[Customer Purge] ' . $message);
    }
}

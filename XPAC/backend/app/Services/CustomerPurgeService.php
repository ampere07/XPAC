<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Permanently deletes a pulled-out customer.
 *
 * Triggered when a pullout service order (concern "Pullout" / "For Pullout") is
 * saved with support status Resolved OR visit status Done — see
 * ServiceOrderApiController::update().
 *
 * 1. The customer's PPPoE username is deleted from RADIUS. The configured servers
 *    back each other up, so one server answering is enough; an unreachable one is
 *    skipped and named in the log. A username already gone from RADIUS is fine. If
 *    RADIUS cannot confirm the delete (no server answers, or one refuses), the purge
 *    still goes ahead and the RADIUS delete is queued (operation delete_user) for
 *    cron:process-radius-queue to finish.
 * 2. Rows are then HARD deleted from exactly these tables: customers,
 *    billing_accounts, technical_details, service_orders and the customer's
 *    portal login in users (see plan()).
 *    Everything else about the customer is left in place.
 * 3. One row is added to disconnected_logs recording the purge.
 *
 * The deletes run in one transaction: either all of them go or none do. No copy of
 * the deleted rows is kept anywhere.
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
     * Delete the customer behind this account number from RADIUS and the purge tables.
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

            // Read only, to collect every username the customer went by for the RADIUS step.
            $jobOrderIds = $this->ids('job_orders', 'id', 'account_id', [$billingId]);

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

            // What happened to each username, for the disconnected_logs entry.
            $radiusSummary = [];
            // Usernames RADIUS could not confirm as deleted => their error, queued below.
            $unconfirmed = [];
            foreach ($usernames as $username) {
                $outcome = $radius->deleteUserFromAllServers($username, $organizationId);
                // A server that could not be reached is named, so staff can remove the
                // username there by hand once it is back.
                $unreachableNames = array_map(fn ($u) => explode(':', $u, 2)[0], $outcome['unreachable'] ?? []);
                $radiusSummary[] = ($outcome['deleted'] !== []
                        ? "{$username} (deleted from RADIUS)"
                        : "{$username} (not found on RADIUS, skipped)")
                    . ($unreachableNames ? ' — not checked on unreachable ' . implode(', ', $unreachableNames) : '');
                $this->log("[RADIUS] '{$username}': deleted on [" . implode(', ', $outcome['deleted']) . '], absent on [' . implode(', ', $outcome['absent']) . ']'
                    . (!empty($outcome['unreachable']) ? ', unreachable (skipped): ' . implode(' | ', $outcome['unreachable']) : '')
                    . ($outcome['errors'] ? ', errors: ' . implode(' | ', $outcome['errors']) : ''));

                if (!$outcome['success']) {
                    // The purge goes ahead regardless: a username that is already gone from
                    // RADIUS (or a device that answers in a way we cannot read) must not keep a
                    // pulled-out customer's records alive. In case it IS still there, the delete
                    // is handed to the RADIUS retry queue, which finishes it once a server answers.
                    $unconfirmed[$username] = implode(' | ', $outcome['errors']);
                    $radiusSummary[count($radiusSummary) - 1] = "{$username} (RADIUS not confirmed — queued for retry)";
                    $this->log("[RADIUS] '{$username}' not confirmed ({$unconfirmed[$username]}) — continuing purge");
                }
            }

            // One queue entry for the account (the queue keeps one pending entry per account and
            // operation), carrying every username that still needs removing.
            if ($unconfirmed !== []) {
                $queueId = RadiusQueueService::queue([
                    'organization_id' => $organizationId,
                    'source_type' => 'customer_purge',
                    'source_id' => $serviceOrderId ?? 0,
                    'account_no' => $accountNo,
                    'operation' => 'delete_user',
                    'params' => ['usernames' => array_keys($unconfirmed), 'organization_id' => $organizationId],
                    'last_error' => 'RADIUS delete not confirmed during pullout purge: ' . implode(' | ', $unconfirmed),
                    'created_by' => $triggeredBy,
                ]);
                $this->log($queueId
                    ? "[RADIUS] Queued delete_user #{$queueId} for: " . implode(', ', array_keys($unconfirmed))
                    : '[RADIUS] Queue insert FAILED — remove by hand: ' . implode(', ', array_keys($unconfirmed)));
                if (!$queueId) {
                    $radiusSummary[] = 'RADIUS retry could not be queued — remove ' . implode(', ', array_keys($unconfirmed)) . ' by hand';
                }
            }

            $plan = $this->plan($accountNo, $billingId, $customerId);

            $customer = $customerId !== null ? DB::table('customers')->where('id', $customerId)->first() : null;
            $fullName = $customer ? trim(($customer->first_name ?? '') . ' ' . ($customer->last_name ?? '')) : '';

            DB::transaction(function () use ($plan, &$result, $accountNo, $fullName, $usernames, $radiusSummary, $serviceOrderId, $triggeredBy, $organizationId) {
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
                            . ($radiusSummary ? '. RADIUS: ' . implode(', ', $radiusSummary) : '. No RADIUS username on record')
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
     * The only tables a pullout deletes from: the customer, their billing account,
     * their technical details, their service orders and their portal login. Everything else about the
     * customer (invoices, transactions, job orders, logs...) is left as it is; rows that
     * pointed at the deleted billing account or customer have that link set to NULL by
     * their foreign keys. Children before parents.
     */
    private function plan(string $accountNo, int $billingId, ?int $customerId): array
    {
        return [
            ['table' => 'service_orders', 'column' => 'account_no', 'values' => [$accountNo]],
            ['table' => 'technical_details', 'column' => 'account_id', 'values' => [$billingId]],
            ['table' => 'technical_details', 'column' => 'account_no', 'values' => [$accountNo]],
            ['table' => 'billing_accounts', 'column' => 'id', 'values' => [$billingId]],
            ['table' => 'customers', 'column' => 'id', 'values' => $customerId !== null ? [$customerId] : []],
            // The customer's portal login: its username is the account number. Customer role
            // only, so a staff account whose username happens to match is never touched.
            ['table' => 'users', 'column' => 'username', 'values' => [$accountNo],
                'extra' => fn ($q) => $q->whereIn('role_id', DB::table('roles')->where('role_name', 'Customer')->pluck('id')->push(3))],
        ];
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

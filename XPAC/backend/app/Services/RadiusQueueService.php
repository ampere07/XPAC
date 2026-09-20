<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Support\CronLog;
use Illuminate\Support\Facades\Log;
use App\Services\ManualRadiusOperationsService;
use App\Services\RouterosApiService;
use App\Models\RadiusConfig;
use App\Support\RadiusRetryPolicy;
use Carbon\Carbon;

/**
 * Retry queue for RADIUS operations that could not be applied immediately.
 *
 * Each queued operation is attempted up to the configured maximum, waiting a
 * progressively longer time after each failure (see config/radius.php). The
 * schedule and the attempt counter live in the database row, not in memory, so
 * the retry sequence survives an application or worker restart. A retry updates
 * the existing row rather than inserting a new one, so retrying never duplicates
 * a job.
 */
class RadiusQueueService
{
    private $logName = 'Radius_Queue';

    /**
     * Queue items handled by the current run, bucketed by outcome and keyed on the
     * account the operation belongs to. Emitted once at the end of processQueue() as a
     * quoted list per outcome, since the per-item narration is filtered out now.
     */
    private CronLog $runLog;

    /** Statuses that mean a queued operation is still on its way through. */
    private const ACTIVE_STATUSES = ['pending', 'processing'];

    /**
     * Queue a failed RADIUS operation for retry
     */
    public static function queue(array $data): ?int
    {
        try {
            $attempt = $data['attempts'] ?? 0;
            $maxAttempts = $data['max_attempts'] ?? RadiusRetryPolicy::maxAttempts();

            // An identical operation already waiting means this one would be a
            // duplicate: two rows for the same job would both retry, and the
            // operation would be applied twice.
            if (RadiusRetryPolicy::preventsDuplicates()) {
                $existingId = self::findActiveDuplicate($data);

                if ($existingId !== null) {
                    self::writeStaticLog(sprintf(
                        '[SKIPPED] Duplicate suppressed | Existing Job #%s still active | Operation: %s | Source: %s#%s | Account: %s',
                        $existingId,
                        $data['operation'],
                        $data['source_type'],
                        $data['source_id'],
                        $data['account_no'] ?? 'N/A'
                    ));

                    return (int) $existingId;
                }
            }

            $insertData = [
                'source_type'     => $data['source_type'],
                'source_id'       => $data['source_id'],
                'account_no'      => $data['account_no'] ?? null,
                'operation'       => $data['operation'],
                'params'          => json_encode($data['params']),
                'status'          => 'pending',
                'attempts'        => $attempt,
                'max_attempts'    => $maxAttempts,
                'last_error'      => $data['last_error'] ?? null,
                'next_retry_at'   => Carbon::now(),
                'created_by'      => $data['created_by'] ?? 'System',
                'created_at'      => now(),
                'updated_at'      => now(),
            ];

            if (\Illuminate\Support\Facades\Schema::hasColumn('radius_operation_queue', 'organization_id')) {
                $insertData['organization_id'] = $data['organization_id'] ?? null;
            }

            // Use insert() instead of insertGetId() to avoid exceptions on tables without auto-increment IDs
            $success = DB::table('radius_operation_queue')->insert($insertData);

            if ($success) {
                self::writeStaticLog(sprintf(
                    '[QUEUED] Operation: %s | Source: %s#%s | Account: %s | Attempt 1 of %d will run now, then retry after %s',
                    $data['operation'],
                    $data['source_type'],
                    $data['source_id'],
                    $data['account_no'] ?? 'N/A',
                    RadiusRetryPolicy::resolveMaxAttempts($maxAttempts),
                    RadiusRetryPolicy::describeSchedule()
                ));

                return 1; // Return a truthy integer to satisfy callers expecting an ID
            }

            return null;
        } catch (\Exception $e) {
            Log::channel('radiusrelated')->error('[RADIUS QUEUE] Failed to queue operation: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * The id of an operation that is already queued for the same target, or null.
     *
     * Matched on the job's identity — the source that raised it, the operation
     * and the account — rather than the full parameter set, because a second
     * request to disconnect the same account is the same job however its
     * parameters were spelled.
     */
    private static function findActiveDuplicate(array $data): ?int
    {
        $query = DB::table('radius_operation_queue')
            ->where('source_type', $data['source_type'])
            ->where('source_id', $data['source_id'])
            ->where('operation', $data['operation'])
            ->whereIn('status', self::ACTIVE_STATUSES);

        if (!empty($data['account_no'])) {
            $query->where('account_no', $data['account_no']);
        }

        $existing = $query->orderBy('id')->first();

        if (!$existing) {
            return null;
        }

        // Tables created without an auto-increment id report no usable id; the
        // duplicate is still real, so report it as suppressed rather than
        // inserting a second copy.
        return isset($existing->id) ? (int) $existing->id : 0;
    }

    /**
     * Append a line to the queue log from a static context.
     */
    private static function writeStaticLog(string $message): void
    {
        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        $logDir    = storage_path('logs/radiusqueue');
        $logFile   = $logDir . '/radius_queue.log';

        if (!file_exists($logDir)) {
            mkdir($logDir, 0755, true);
        }

        file_put_contents($logFile, "[{$timestamp}] [Radius_Queue] {$message}" . PHP_EOL, FILE_APPEND);
    }

    /**
     * Process all pending items in the queue
     * Called by the cron command
     */
    public function processQueue(?int $batchSize = null): array
    {
        $this->runLog = new CronLog();

        $batchSize = $batchSize ?? RadiusRetryPolicy::batchSize();

        $results = [
            'processed' => 0,
            'succeeded' => 0,
            'failed'    => 0,
            'skipped'   => 0,
            'reclaimed' => 0,
        ];

        $maxAttempts = RadiusRetryPolicy::maxAttempts();

        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         RADIUS QUEUE PROCESSING START                          ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("Retry Policy: up to {$maxAttempts} attempts | delays: " . RadiusRetryPolicy::describeSchedule());
        $this->writeLog("");

        // Recover anything a previous worker was holding when it stopped, before
        // deciding what is due — otherwise those jobs would never be seen again.
        $results['reclaimed'] = $this->reclaimStaleProcessing();

        // Fetch pending items that are due for retry.
        //
        // A row's own max_attempts wins when it holds a usable value, so a job
        // deliberately queued with a different allowance keeps it. The configured
        // maximum fills in only where the row has none — rows written by a caller
        // that set no limit, or by a table built without that default. Rows still
        // carrying the older, lower allowance are raised to the current one by
        // the migration that accompanies this policy.
        $effectiveMax = 'COALESCE(NULLIF(max_attempts, 0), ' . (int) $maxAttempts . ')';

        $pendingItems = DB::table('radius_operation_queue')
            ->where('status', 'pending')
            ->where(function ($q) {
                // A row that has never been scheduled is due immediately.
                $q->whereNull('next_retry_at')
                  ->orWhere('next_retry_at', '<=', Carbon::now());
            })
            ->whereRaw("attempts < {$effectiveMax}")
            ->orderBy('next_retry_at', 'asc')
            ->limit($batchSize)
            ->get();

        if ($pendingItems->isEmpty()) {
            $this->writeLog("[INFO] No pending items in queue. Nothing to process.");
            $this->writeLog("");
            return $results;
        }

        $totalCount = $pendingItems->count();
        $this->writeLog("[QUERY] Found {$totalCount} pending item(s) to process");
        $this->writeLog("─────────────────────────────────────────────────────────────────");
        $this->writeLog("");

        $counter = 0;
        foreach ($pendingItems as $item) {
            $counter++;
            $results['processed']++;

            $itemMax     = RadiusRetryPolicy::resolveMaxAttempts(isset($item->max_attempts) ? (int) $item->max_attempts : null);
            $thisAttempt = (int) $item->attempts + 1;

            $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");
            $this->writeLog("  [ITEM] Job #{$item->id} | Operation: {$item->operation} | Account: " . ($item->account_no ?? 'N/A'));
            $this->writeLog("  [ITEM] Source: {$item->source_type}#{$item->source_id} | Attempt: {$thisAttempt}/{$itemMax}");

            // Mark as processing
            DB::table('radius_operation_queue')
                ->where('id', $item->id)
                ->update([
                    'status'     => 'processing',
                    'updated_at' => now(),
                ]);

            try {
                $params = json_decode($item->params, true);
                $this->writeLog("  [EXEC] Executing {$item->operation}...");

                $errorMessage = null;
                $success = $this->executeOperation($item->operation, $params, $errorMessage);

                if ($success) {
                    // Success is terminal: the row leaves 'pending', so the queue
                    // query can never pick it up again and no further retry is
                    // scheduled. The attempt counter records what it took.
                    DB::table('radius_operation_queue')
                        ->where('id', $item->id)
                        ->update([
                            'status'       => 'success',
                            'attempts'     => $thisAttempt,
                            'completed_at' => now(),
                            'updated_at'   => now(),
                        ]);

                    // Only once the operation has actually landed on the device.
                    // A queued job that is still retrying has changed nothing a
                    // subscriber's history should show.
                    $this->logDetailsUpdate($item, $params, $thisAttempt);

                    $results['succeeded']++;
                    $this->runLog->processed($item->account_no ?? ('job#' . $item->id));
                    $this->writeLog("  [RESULT] ✓ SUCCESS on attempt {$thisAttempt}/{$itemMax} — no further retries");
                } else {
                    $errorMsg = $errorMessage ?? 'Operation returned failure status';
                    $this->markRetryOrFailed($item, $errorMsg);
                    $results['failed']++;
                    $this->runLog->failed($item->account_no ?? ('job#' . $item->id));
                    $this->writeLog("  [RESULT] ✗ FAILED - " . $errorMsg);
                }
            } catch (\Exception $e) {
                $this->markRetryOrFailed($item, $e->getMessage());
                $results['failed']++;
                $this->runLog->failed($item->account_no ?? ('job#' . $item->id));
                $this->writeLog("  [RESULT] ✗ EXCEPTION - " . $e->getMessage());
            }

            $this->writeLog("");
        }

        $endTime = Carbon::now();
        $duration = $endTime->diffInSeconds($startTime);

        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         RADIUS QUEUE PROCESSING COMPLETE                       ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $this->writeLog("Summary:");
        $this->writeLog("  • Total Processed: {$results['processed']}");
        $this->writeLog("  • Succeeded: {$results['succeeded']}");
        $this->writeLog("  • Failed (retry scheduled or exhausted): {$results['failed']}");
        $this->writeLog("  • Reclaimed from stopped worker: {$results['reclaimed']}");
        $this->writeLog("  • Duration: {$duration} second(s)");
        $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
        $this->writeLog("");
        $this->writeLog("");

        foreach ($this->runLog->summaryLines() as $line) {
            $this->writeLog($line);
        }
        $this->runLog->reset();

        return $results;
    }

    /**
     * Record a completed queue operation in details_update_logs.
     *
     * The same table the Customer Details and Service Order screens write to, in
     * the same `{type, data}` shape, so a RADIUS change made by the queue appears
     * in an account's history beside the changes made by hand. `technical_details`
     * is used as the type because that is the table a RADIUS credential change
     * moves, and the Data Logs viewer already renders it as "Technical Details".
     *
     * Written only on success, and never allowed to break the queue: a logging
     * failure must not turn a completed RADIUS operation into a retry, which
     * would re-apply work already done on the device.
     *
     * @param object $item   The radius_operation_queue row.
     * @param array<string, mixed>|null $params Its decoded params.
     */
    private function logDetailsUpdate(object $item, ?array $params, int $attempt): void
    {
        try {
            $params = $params ?? [];
            $change = $this->describeChange((string) $item->operation, $params);

            if ($change === null) {
                return;
            }

            [$old, $new] = $change;

            $accountNo = $item->account_no ?? ($params['accountNumber'] ?? null);
            $accountId = null;

            if (!empty($accountNo)) {
                $accountId = DB::table('billing_accounts')->where('account_no', $accountNo)->value('id');
            }

            $context = [
                'type'       => 'technical_details',
                'source'     => 'radius_queue',
                'operation'  => $item->operation,
                'account_no' => $accountNo,
                'queue_id'   => $item->id,
                'attempt'    => $attempt,
            ];

            $userId = $this->logUserId($params, $item);

            DB::table('details_update_logs')->insert([
                'organization_id'    => $item->organization_id ?? null,
                'account_id'         => $accountId,
                'old_details'        => json_encode($context + ['data' => $old]),
                'new_details'        => json_encode($context + ['data' => $new]),
                'created_by_user_id' => $userId,
                'updated_by_user_id' => $userId,
                'created_at'         => now(),
                'updated_at'         => now(),
            ]);

            $this->writeLog("  [LOGGED] details_update_logs entry written for " . ($accountNo ?? 'job#' . $item->id));
        } catch (\Throwable $e) {
            // Deliberately swallowed. The device work is already done and the row
            // is already marked success; losing the audit line is the smaller harm.
            $this->writeLog("  [WARNING] Could not write details_update_logs entry: " . $e->getMessage());
            Log::warning('RADIUS queue: details_update_logs insert failed', [
                'queue_id' => $item->id ?? null,
                'error'    => $e->getMessage(),
            ]);
        }
    }

    /**
     * What an operation changed, as an old/new pair — or null when the operation
     * changes nothing worth an account-history entry.
     *
     * A password is never written to the log, only the fact that one was set.
     *
     * @param array<string, mixed> $params
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}|null
     */
    private function describeChange(string $operation, array $params): ?array
    {
        switch ($operation) {
            case 'update_credentials':
                $oldUsername = (string) ($params['username'] ?? '');
                $newUsername = (string) ($params['newUsername'] ?? '');

                if ($oldUsername === '' && $newUsername === '') {
                    return null;
                }

                $old = ['username' => $oldUsername];
                $new = ['username' => $newUsername];

                if (!empty($params['newPassword'])) {
                    $old['pppoe_password'] = '(unchanged)';
                    $new['pppoe_password'] = '(updated)';
                }

                return [$old, $new];

            case 'create_user':
                return [
                    ['username' => null, 'group' => null],
                    [
                        'username' => (string) ($params['username'] ?? ''),
                        'group'    => (string) ($params['group'] ?? ''),
                    ],
                ];

            case 'reconnect_user':
            case 'disconnect_user':
            case 'restricted_user':
                // These move the account between RADIUS groups rather than
                // renaming it, so the group is the field that changed.
                return [
                    ['radius_group' => (string) ($params['oldGroup'] ?? $params['currentGroup'] ?? '(previous)')],
                    ['radius_group' => (string) ($params['group'] ?? $params['plan'] ?? $operation)],
                ];

            default:
                return null;
        }
    }

    /**
     * The user to credit the log line to.
     *
     * The queued params carry whoever pressed the button; the queue row's
     * created_by is the fallback, and is only usable when it is an id rather than
     * an email address.
     *
     * @param array<string, mixed> $params
     */
    private function logUserId(array $params, object $item): ?int
    {
        foreach ([$params['updatedBy'] ?? null, $params['updated_by'] ?? null, $item->created_by ?? null] as $candidate) {
            if (is_numeric($candidate)) {
                return (int) $candidate;
            }
        }

        return null;
    }

    private function executeOperation(string $operation, array $params, &$errorMessage = null): bool
    {
        switch ($operation) {
            case 'create_user':
                $success = $this->retryCreateUser($params);
                if (!$success) {
                    $errorMessage = 'create_user failed on all endpoints.';
                }
                return $success;

            case 'reconnect_user':
                $service = app(ManualRadiusOperationsService::class);
                $result = $service->reconnectUser($params);
                if (($result['status'] ?? '') !== 'success') {
                    $errorMessage = $result['message'] ?? 'Operation returned failure status';
                    return false;
                }
                return true;

            case 'restricted_user':
                $service = app(ManualRadiusOperationsService::class);
                $result = $service->restrictedUser($params);
                if (($result['status'] ?? '') !== 'success') {
                    $errorMessage = $result['message'] ?? 'Operation returned failure status';
                    return false;
                }
                return true;

            case 'disconnect_user':
                $service = app(ManualRadiusOperationsService::class);
                $result = $service->disconnectUser($params);
                if (($result['status'] ?? '') !== 'success') {
                    $errorMessage = $result['message'] ?? 'Operation returned failure status';
                    return false;
                }
                return true;

            case 'update_credentials':
                $service = app(ManualRadiusOperationsService::class);
                $result = $service->updateCredentials($params);
                if (($result['status'] ?? '') !== 'success') {
                    $errorMessage = $result['message'] ?? 'Operation returned failure status';
                    return false;
                }
                return true;

            default:
                $errorMessage = "Unknown operation: {$operation}";
                $this->writeLog("  [ERROR] " . $errorMessage);
                return false;
        }
    }

    /**
     * Retry create_user (the direct HTTP PUT used by JobOrderController)
     */
    private function retryCreateUser(array $params): bool
    {
        $username = $params['username'] ?? '';
        $password = $params['password'] ?? '';
        $group = $params['group'] ?? '';
        $organizationId = $params['organization_id'] ?? null;
        $city = $params['city'] ?? null;

        if (empty($username) || empty($password)) {
            $this->writeLog("  [ERROR] create_user: Missing username or password");
            return false;
        }

        $resolver = app(RadiusServerResolver::class);

        // A create places a NEW account, so pick the target server the same way
        // JobOrderController does — by the customer's city — when we know it. This keeps
        // the account on exactly one server rather than creating it on all of them.
        if (!empty($city)) {
            $config = $resolver->resolveForCity($city, $organizationId);
            if (!$config) {
                $this->writeLog("  [ERROR] create_user: No RADIUS config found for city '{$city}'");
                return false;
            }
            $this->writeLog("  [RADIUS] create_user targeting city-mapped server (Config #{$config->id} | {$config->ip}) for '{$username}'");
            return $this->putCreateUser($config, $username, $password, $group);
        }

        // No city recorded on the queued item: fall back to the ordered configs and stop
        // on the first server that accepts the create (never creating on more than one).
        $radiusConfigs = $resolver->orderedConfigs($organizationId);

        if ($radiusConfigs->isEmpty()) {
            $this->writeLog("  [ERROR] create_user: No RADIUS config found");
            return false;
        }

        foreach ($radiusConfigs as $config) {
            if ($this->putCreateUser($config, $username, $password, $group)) {
                return true;
            }
        }

        $this->writeLog("  [ERROR] create_user failed on all endpoints.");
        return false;
    }

    /**
     * Create the account on a single RADIUS config over the native RouterOS API.
     *
     * RouterosApiService::addUser() is read-then-write: an account that is already on the
     * device is reported as success and left untouched, so replaying a queued create after
     * a partial outage cannot produce a second copy of the subscriber.
     */
    private function putCreateUser(RadiusConfig $config, string $username, string $password, string $group): bool
    {
        $target = $config->ip . ' (Config #' . $config->id . ')';
        $this->writeLog("  [RADIUS] API create_user at {$target} | User: {$username} | Group: {$group}");

        try {
            $api = app(RouterosApiService::class);

            if ($api->addUser($config, $username, $password, $group)) {
                $this->writeLog("  [RADIUS] ✓ create_user SUCCESS at {$target}");

                // A brand new user is absent from any cached user list, and
                // would read "Not Found" until that list expired.
                RadiusStatusSyncService::invalidateUserCache();

                return true;
            }

            $this->writeLog("  [RADIUS] ✗ create_user FAILED at {$target} - " . $api->getLastError());
        } catch (\Throwable $e) {
            $this->writeLog("  [RADIUS] ✗ create_user EXCEPTION at {$target}: " . $e->getMessage());
        }

        return false;
    }

    /**
     * Record the outcome of a failed attempt: schedule the next one, or give up.
     *
     * The attempt counter and the scheduled time are both written to the row, so
     * the retry sequence is held in the database rather than in the worker. A
     * restart therefore resumes exactly where it left off, and because this
     * UPDATEs the existing row it can never duplicate the job.
     */
    private function markRetryOrFailed(object $item, string $error): void
    {
        $newAttempts  = (int) $item->attempts + 1;
        $maxAttempts  = RadiusRetryPolicy::resolveMaxAttempts(isset($item->max_attempts) ? (int) $item->max_attempts : null);
        $remaining    = RadiusRetryPolicy::attemptsRemaining($newAttempts, $maxAttempts);

        if (RadiusRetryPolicy::isExhausted($newAttempts, $maxAttempts)) {
            // Every allowed attempt has now failed. The job stays 'failed' and is
            // never picked up again by the queue query.
            DB::table('radius_operation_queue')
                ->where('id', $item->id)
                ->update([
                    'status'     => 'failed',
                    'attempts'   => $newAttempts,
                    'last_error' => $error,
                    'updated_at' => now(),
                ]);

            $this->writeLog("  [RETRY] ✗ Job #{$item->id} permanently FAILED");
            $this->writeLog("  [RETRY] Attempt: {$newAttempts}/{$maxAttempts} | Attempts Remaining: 0");
            $this->writeLog("  [RETRY] Failure Reason: {$error}");
            $this->writeLog("  [RETRY] No further retries will be scheduled.");

            Log::channel('radiusrelated')->error('[RADIUS QUEUE] Job permanently failed', [
                'job_id'             => $item->id,
                'operation'          => $item->operation,
                'account_no'         => $item->account_no ?? null,
                'attempt'            => $newAttempts,
                'max_attempts'       => $maxAttempts,
                'attempts_remaining' => 0,
                'failure_reason'     => $error,
            ]);

            return;
        }

        // Wait progressively longer after each failure, so a server that is down
        // is not hammered every minute.
        $delayMinutes = RadiusRetryPolicy::delayMinutesAfter($newAttempts);
        $nextRetryAt  = RadiusRetryPolicy::nextRetryAt($newAttempts);

        DB::table('radius_operation_queue')
            ->where('id', $item->id)
            ->update([
                'status'        => 'pending',
                'attempts'      => $newAttempts,
                'last_error'    => $error,
                'next_retry_at' => $nextRetryAt,
                'updated_at'    => now(),
            ]);

        $this->writeLog("  [RETRY] Job #{$item->id} scheduled for retry");
        $this->writeLog("  [RETRY] Attempt: {$newAttempts}/{$maxAttempts} | Attempts Remaining: {$remaining}");
        $this->writeLog("  [RETRY] Failure Reason: {$error}");
        $this->writeLog("  [RETRY] Next Attempt: " . $nextRetryAt->format('Y-m-d H:i:s') . " (in {$delayMinutes} minute(s))");

        Log::channel('radiusrelated')->warning('[RADIUS QUEUE] Attempt failed, retry scheduled', [
            'job_id'             => $item->id,
            'operation'          => $item->operation,
            'account_no'         => $item->account_no ?? null,
            'attempt'            => $newAttempts,
            'max_attempts'       => $maxAttempts,
            'attempts_remaining' => $remaining,
            'failure_reason'     => $error,
            'retry_delay_minutes' => $delayMinutes,
            'next_retry_at'      => $nextRetryAt->format('Y-m-d H:i:s'),
        ]);
    }

    /**
     * Return jobs abandoned by a worker that stopped mid-item.
     *
     * A row is set to 'processing' before the operation runs. If the worker is
     * killed at that moment nothing ever clears it, and without this the job
     * would sit in 'processing' for ever. The attempt counter is deliberately
     * left alone: the attempt never produced a result, so it does not consume
     * one of the job's allowed tries.
     */
    private function reclaimStaleProcessing(): int
    {
        $cutoff = Carbon::now()->subMinutes(RadiusRetryPolicy::staleProcessingMinutes());

        $stale = DB::table('radius_operation_queue')
            ->where('status', 'processing')
            ->where('updated_at', '<=', $cutoff)
            ->get(['id', 'operation', 'account_no', 'attempts']);

        if ($stale->isEmpty()) {
            return 0;
        }

        foreach ($stale as $row) {
            DB::table('radius_operation_queue')
                ->where('id', $row->id)
                ->update([
                    'status'        => 'pending',
                    'next_retry_at' => Carbon::now(),
                    'updated_at'    => now(),
                ]);

            $this->writeLog("  [RECOVER] Job #{$row->id} was left processing by a stopped worker — returned to the queue (attempts still {$row->attempts})");

            Log::channel('radiusrelated')->warning('[RADIUS QUEUE] Reclaimed stalled job', [
                'job_id'     => $row->id,
                'operation'  => $row->operation,
                'account_no' => $row->account_no ?? null,
                'attempt'    => $row->attempts,
            ]);
        }

        return $stale->count();
    }

    /**
     * Get summary statistics for the queue
     */
    public static function getStats(): array
    {
        return [
            'pending'    => DB::table('radius_operation_queue')->where('status', 'pending')->count(),
            'processing' => DB::table('radius_operation_queue')->where('status', 'processing')->count(),
            'success'    => DB::table('radius_operation_queue')->where('status', 'success')->count(),
            'failed'     => DB::table('radius_operation_queue')->where('status', 'failed')->count(),
            'total'      => DB::table('radius_operation_queue')->count(),
        ];
    }

    /**
     * Write to log file
     */
    private function writeLog(string $message): void
    {
        // Errors and run summaries only - see App\Support\CronLog. This is a raw
        // file write, so LOG_LEVEL never reached it and the narration accumulated
        // no matter how the channels were configured.
        if (!CronLog::shouldWrite($message)) {
            return;
        }

        $timestamp = Carbon::now()->format('Y-m-d H:i:s');
        $logMessage = "[{$timestamp}] [{$this->logName}] {$message}";

        // Define directory and file path
        $logDir = storage_path('logs/radiusqueue');
        $logFile = $logDir . '/radius_queue.log';

        // Check/Create Directory
        if (!file_exists($logDir)) {
            mkdir($logDir, 0755, true);
        }

        // Write to custom log file
        file_put_contents($logFile, $logMessage . PHP_EOL, FILE_APPEND);

        // Also log to Laravel default log
        // Only faults are mirrored, and as ->error(). Every line used to be
        // duplicated into laravel.log at info level, which doubled the volume
        // and misreported the severity of all of it.
        if (CronLog::isError($message)) {
            Log::channel('single')->error("[{$this->logName}] {$message}");
        }
    }
}

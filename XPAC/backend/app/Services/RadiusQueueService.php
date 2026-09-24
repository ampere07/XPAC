<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use App\Services\ManualRadiusOperationsService;
use App\Models\RadiusConfig;
use Carbon\Carbon;

class RadiusQueueService
{
    private $logName = 'Radius_Queue';

    /**
     * Retry backoff schedule: wait time BEFORE attempt N, keyed 1-10.
     *
     * Attempt 1 is the first attempt made from inside the queue (after the initial direct
     * execution already failed and the item was queued), so backoff[1] is also the delay
     * applied at queue-time. backoff[N] for N=2..10 is applied in markRetryOrFailed() once
     * attempt N-1 has failed. With max_attempts = 10 every entry in this table is used exactly
     * once per item's lifecycle.
     */
    private const RETRY_BACKOFF_MINUTES = [
        1 => 5,
        2 => 30,
        3 => 60,
        4 => 120,
        5 => 180,
        6 => 240,
        7 => 360,
        8 => 480,
        9 => 720,
        10 => 1440,
    ];

    /**
     * Queue a failed RADIUS operation for retry
     */
    public static function queue(array $data): ?int
    {
        try {
            $attempt = $data['attempts'] ?? 0;
            $maxAttempts = $data['max_attempts'] ?? 10;

            // Dedupe: a pending/processing entry for the same account + operation already
            // covers this failure. Without this guard, every caller that queues on failure
            // without its own pre-check (most of them) could pile up duplicate rows for the
            // same underlying RADIUS action.
            if (!empty($data['account_no'])) {
                $existing = DB::table('radius_operation_queue')
                    ->where('account_no', $data['account_no'])
                    ->where('operation', $data['operation'])
                    ->whereIn('status', ['pending', 'processing'])
                    ->orderByDesc('id')
                    ->value('id');

                if ($existing) {
                    return (int) $existing;
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
                // Wait before attempt 1 — see RETRY_BACKOFF_MINUTES.
                'next_retry_at'   => Carbon::now()->addMinutes(self::RETRY_BACKOFF_MINUTES[1]),
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
                // Static method can't use $this->writeLog, so write directly
                $timestamp = Carbon::now()->format('Y-m-d H:i:s');
                $logDir = storage_path('logs/radiusqueue');
                $logFile = $logDir . '/radius_queue.log';
                if (!file_exists($logDir)) {
                    mkdir($logDir, 0755, true);
                }
                $msg = "[{$timestamp}] [Radius_Queue] [QUEUED] Operation: {$data['operation']} | Source: {$data['source_type']}#{$data['source_id']} | Account: " . ($data['account_no'] ?? 'N/A');
                file_put_contents($logFile, $msg . PHP_EOL, FILE_APPEND);

                return 1; // Return a truthy integer to satisfy callers expecting an ID
            }
            
            return null;
        } catch (\Exception $e) {
            Log::channel('radiusrelated')->error('[RADIUS QUEUE] Failed to queue operation: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Process all pending items in the queue
     * Called by the cron command
     */
    public function processQueue(int $batchSize = 20): array
    {
        $results = [
            'processed' => 0,
            'succeeded' => 0,
            'failed'    => 0,
            'skipped'   => 0,
        ];

        $this->writeLog("╔════════════════════════════════════════════════════════════════╗");
        $this->writeLog("║         RADIUS QUEUE PROCESSING START                          ║");
        $this->writeLog("╚════════════════════════════════════════════════════════════════╝");
        $startTime = Carbon::now();
        $this->writeLog("Start Time: " . $startTime->format('Y-m-d H:i:s'));
        $this->writeLog("");

        // Fetch pending items that are due for retry
        $pendingItems = DB::table('radius_operation_queue')
            ->where('status', 'pending')
            ->where('next_retry_at', '<=', Carbon::now())
            ->where('attempts', '<', DB::raw('max_attempts'))
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

            $this->writeLog("[{$counter}/{$totalCount}] ══════════════════════════════════════════════");
            $this->writeLog("  [ITEM] ID: {$item->id} | Operation: {$item->operation} | Account: " . ($item->account_no ?? 'N/A'));
            $this->writeLog("  [ITEM] Source: {$item->source_type}#{$item->source_id} | Attempt: " . ($item->attempts + 1) . "/{$item->max_attempts}");

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
                    // Mark as success
                    DB::table('radius_operation_queue')
                        ->where('id', $item->id)
                        ->update([
                            'status'       => 'success',
                            'completed_at' => now(),
                            'updated_at'   => now(),
                        ]);

                    $results['succeeded']++;
                    $this->writeLog("  [RESULT] ✓ SUCCESS");
                } else {
                    $errorMsg = $errorMessage ?? 'Operation returned failure status';
                    $this->markRetryOrFailed($item, $errorMsg);
                    $results['failed']++;
                    $this->writeLog("  [RESULT] ✗ FAILED - " . $errorMsg);
                }
            } catch (\Exception $e) {
                $this->markRetryOrFailed($item, $e->getMessage());
                $results['failed']++;
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
        $this->writeLog("  • Failed: {$results['failed']}");
        $this->writeLog("  • Duration: {$duration} second(s)");
        $this->writeLog("End Time: " . $endTime->format('Y-m-d H:i:s'));
        $this->writeLog("");
        $this->writeLog("");

        return $results;
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

            // Plan/group change. Queued by PrepaidPlanChangeService when the direct push fails,
            // so a RADIUS outage at the moment a prepaid plan switch lands cannot leave the
            // database on the new plan while RADIUS keeps serving the old one.
            case 'update_group':
                $service = app(ManualRadiusOperationsService::class);
                $result = $service->updateGroup($params);
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
            return $this->putCreateUser($config, $resolver, $username, $password, $group);
        }

        // No city recorded on the queued item: fall back to the ordered configs and stop
        // on the first server that accepts the create (never creating on more than one).
        $radiusConfigs = $resolver->orderedConfigs($organizationId);

        if ($radiusConfigs->isEmpty()) {
            $this->writeLog("  [ERROR] create_user: No RADIUS config found");
            return false;
        }

        foreach ($radiusConfigs as $config) {
            if ($this->putCreateUser($config, $resolver, $username, $password, $group)) {
                return true;
            }
        }

        $this->writeLog("  [ERROR] create_user failed on all endpoints.");
        return false;
    }

    /**
     * PUT a create_user request to a single RADIUS config, trying the configured protocol
     * first then the alternate. Returns true on the first successful server.
     */
    private function putCreateUser(RadiusConfig $config, RadiusServerResolver $resolver, string $username, string $password, string $group): bool
    {
        foreach ($resolver->baseUrlsFor($config) as $baseUrl) {
            $radiusUrl = $baseUrl . '/rest/user-manage/user';
            $this->writeLog("  [RADIUS] PUT {$radiusUrl} | User: {$username} | Group: {$group}");

            try {
                $response = Http::withOptions(['verify' => false, 'timeout' => 5])
                    ->withBasicAuth($config->username, $config->password)
                    ->put($radiusUrl, [
                        'name'     => $username,
                        'group'    => $group,
                        'password' => $password,
                    ]);

                $statusCode = $response->status();

                if ($statusCode === 204 || $response->successful()) {
                    $this->writeLog("  [RADIUS] ✓ create_user SUCCESS (HTTP {$statusCode}) at {$baseUrl}");
                    return true;
                }

                $this->writeLog("  [RADIUS] ✗ create_user FAILED (HTTP {$statusCode}) at {$baseUrl} - " . $response->body());
            } catch (\Exception $e) {
                $this->writeLog("  [RADIUS] ✗ create_user EXCEPTION at {$baseUrl}: " . $e->getMessage());
            }
        }

        return false;
    }

    /**
     * Mark item for retry or as permanently failed
     */
    private function markRetryOrFailed(object $item, string $error): void
    {
        $newAttempts = $item->attempts + 1;

        if ($newAttempts >= $item->max_attempts) {
            // Max attempts reached — mark as failed
            DB::table('radius_operation_queue')
                ->where('id', $item->id)
                ->update([
                    'status'     => 'failed',
                    'attempts'   => $newAttempts,
                    'last_error' => $error,
                    'updated_at' => now(),
                ]);

            $this->writeLog("  [RETRY] ✗ Item #{$item->id} permanently FAILED after {$newAttempts}/{$item->max_attempts} attempts");
            $this->writeLog("  [RETRY] Last Error: {$error}");
        } else {
            // Schedule for next retry using the fixed backoff schedule — the wait BEFORE the
            // attempt about to be made (attempt number newAttempts + 1). Falls back to the
            // longest defined step for any attempt number beyond the table (e.g. a caller with
            // a custom max_attempts > 10).
            $nextAttemptNumber = $newAttempts + 1;
            $backoffMinutes = self::RETRY_BACKOFF_MINUTES[$nextAttemptNumber]
                ?? max(self::RETRY_BACKOFF_MINUTES);

            DB::table('radius_operation_queue')
                ->where('id', $item->id)
                ->update([
                    'status'        => 'pending',
                    'attempts'      => $newAttempts,
                    'last_error'    => $error,
                    'next_retry_at' => Carbon::now()->addMinutes($backoffMinutes),
                    'updated_at'    => now(),
                ]);

            $this->writeLog("  [RETRY] Item #{$item->id} scheduled for retry (attempt {$newAttempts}/{$item->max_attempts}) in {$backoffMinutes} minute(s)");
        }
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
        Log::channel('single')->info("[{$this->logName}] {$message}");
    }
}

<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\ManualRadiusOperationsService;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class CheckVipExpiration extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'vip:check-expiration';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Check VIP accounts for expiration and disconnect them if expired';

    /**
     * ManualRadiusOperationsService instance
     *
     * @var ManualRadiusOperationsService
     */
    protected $radiusService;

    /**
     * Create a new command instance.
     *
     * @param ManualRadiusOperationsService $radiusService
     */
    public function __construct(ManualRadiusOperationsService $radiusService)
    {
        parent::__construct();
        $this->radiusService = $radiusService;
    }

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $logPath = storage_path('logs/vipChecker.log');
        $startTime = now();
        $this->logToFile("--- VIP CHECK START (" . $startTime->toDateTimeString() . ") ---", $logPath);

        // Fetch VIP accounts (status_id 7) with their usernames
        $vipAccounts = DB::table('billing_accounts')
            ->join('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
            ->where('billing_accounts.billing_status_id', 7)
            ->select(
                'billing_accounts.id',
                'billing_accounts.account_no',
                'billing_accounts.vip_expiration',
                'technical_details.username'
            )
            ->get();

        $todayString = Carbon::today()->toDateString();
        $this->logToFile("Total VIP accounts found: " . $vipAccounts->count(), $logPath);

        $processedCount = 0;
        $disconnectedCount = 0;

        foreach ($vipAccounts as $account) {
            $processedCount++;
            
            if (empty($account->vip_expiration)) {
                $this->logToFile("Skipping {$account->account_no}: No expiration date set", $logPath);
                continue;
            }

            try {
                $expirationDate = Carbon::parse($account->vip_expiration)->toDateString();

                if ($expirationDate === $todayString) {
                    $this->logToFile("VIP EXPIRED: Account {$account->account_no} (User: {$account->username}) expires today ($expirationDate)", $logPath);

                    // Call restrict service
                    $result = $this->radiusService->restrictedUser([
                        'accountNumber' => $account->account_no,
                        'username' => $account->username,
                        'remarks' => 'VIP Expiration - Auto Restrict',
                        'updatedBy' => 'System'
                    ]);

                    if ($result['status'] === 'success') {
                        // Calculate duration the user has been a VIP
                        $vipStartDate = null;
                        
                        // Look up details update logs for when status changed to 7 (VIP)
                        $firstVipLog = DB::table('details_update_logs')
                            ->where('account_id', $account->id)
                            ->where(function($query) {
                                $query->where('new_details', 'like', '%"billing_status_id":7%')
                                      ->orWhere('new_details', 'like', '%"billing_status_id":"7"%')
                                      ->orWhere('new_details', 'like', '%"billing_status_id": 7%');
                            })
                            ->orderBy('created_at', 'asc')
                            ->first();

                        if ($firstVipLog) {
                            $vipStartDate = Carbon::parse($firstVipLog->created_at);
                        } else {
                            // Fallback to billing account's created_at
                            $billingAcc = DB::table('billing_accounts')->where('id', $account->id)->first();
                            if ($billingAcc && !empty($billingAcc->created_at)) {
                                $vipStartDate = Carbon::parse($billingAcc->created_at);
                            }
                        }

                        $durationString = 'unknown duration';
                        if ($vipStartDate) {
                            $diff = $vipStartDate->diff(now());
                            $durationParts = [];
                            if ($diff->y > 0) {
                                $durationParts[] = $diff->y . ' ' . ($diff->y === 1 ? 'year' : 'years');
                            }
                            if ($diff->m > 0) {
                                $durationParts[] = $diff->m . ' ' . ($diff->m === 1 ? 'month' : 'months');
                            }
                            if ($diff->d > 0 || empty($durationParts)) {
                                $durationParts[] = $diff->d . ' ' . ($diff->d === 1 ? 'day' : 'days');
                            }
                            $durationString = implode(', ', $durationParts);
                        }

                        $currentDate = now()->format('Y-m-d');
                        $remarks = "This VIP account has been restricted on {$currentDate} via system automation because the VIP subscription expired on {$expirationDate}. Total duration as VIP: {$durationString}.";

                        DB::table('billing_accounts')
                            ->where('id', $account->id)
                            ->update([
                                'billing_status_id' => 4,
                                'vip_remarks' => $remarks,
                                'updated_at' => now(),
                                'updated_by' => 'System'
                            ]);

                        $disconnectedCount++;
                        $this->logToFile("[SUCCESS] Restricted user session, updated status to 4, and updated vip_remarks for {$account->account_no}. Duration: {$durationString}", $logPath);
                    } else {
                        $this->logToFile("[ERROR] Failed to restrict {$account->account_no}: " . ($result['message'] ?? 'Unknown error'), $logPath);
                    }
                }
            } catch (\Exception $e) {
                $this->logToFile("[EXCEPTION] Error processing {$account->account_no}: " . $e->getMessage(), $logPath);
            }
        }

        $endTime = now();
        $duration = $endTime->diffInSeconds($startTime);
        $this->logToFile("--- VIP CHECK END (" . $endTime->toDateTimeString() . ") | Processed: $processedCount | Disconnected: $disconnectedCount | Duration: {$duration}s ---", $logPath);
        $this->logToFile("", $logPath); // Blank line for readability

        $this->info("VIP Expiration check completed. See storage/logs/vipChecker.log for details.");
        return 0;
    }

    /**
     * Log a message to a custom file and console output
     *
     * @param string $message
     * @param string $path
     * @return void
     */
    private function logToFile($message, $path)
    {
        if (empty($message)) {
            file_put_contents($path, PHP_EOL, FILE_APPEND);
            return;
        }

        $timestamp = now()->toDateTimeString();
        $formattedMessage = "[$timestamp] $message";
        
        file_put_contents($path, $formattedMessage . PHP_EOL, FILE_APPEND);
        
        if (strpos($message, '[ERROR]') !== false || strpos($message, '[EXCEPTION]') !== false) {
            $this->error($message);
        } elseif (strpos($message, '[SUCCESS]') !== false) {
            $this->info($message);
        } else {
            $this->line($message);
        }
    }
}

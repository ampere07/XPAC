<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\EnhancedBillingGenerationServiceWithNotifications;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class GenerateDailyBillingsCron extends Command
{
    protected $signature = 'cron:generate-daily-billings';
    protected $description = 'Cron job to generate daily billings with PDF and notifications at 1:00 AM';

    protected EnhancedBillingGenerationServiceWithNotifications $billingService;

    public function __construct(EnhancedBillingGenerationServiceWithNotifications $billingService)
    {
        parent::__construct();
        $this->billingService = $billingService;
    }

    public function handle(): int
    {
        $logPath = storage_path('logs/billing');
        if (!file_exists($logPath)) {
            mkdir($logPath, 0755, true);
        }

        $logger = Log::build([
            'driver' => 'single',
            'path' => $logPath . '/billinggeneration.log',
        ]);

        $startTime = microtime(true);
        $today = Carbon::now();
        
        $logger->info('=================================================================');
        $logger->info('Daily Billing Generation Cron Job Started', [
            'timestamp' => $today->format('Y-m-d H:i:s'),
            'day_of_month' => $today->day,
            'command' => 'cron:generate-daily-billings'
        ]);
        $logger->info('=================================================================');

        try {
            // Fetch advance generation days from billing_config
            $config = \App\Models\BillingConfig::first();
            $advanceDays = $config ? ($config->advance_generation_day ?? 0) : 0;
            
            // Calculate target date by adding advance days to today
            $targetDate = $today->copy()->addDays($advanceDays);
            $targetBillingDay = $targetDate->day;

            $logger->info('Configuration loaded', [
                'mode' => 'advance_generation',
                'description' => "Generating bills {$advanceDays} days in advance",
                'advance_days' => $advanceDays,
                'today' => $today->format('Y-m-d'),
                'target_date' => $targetDate->format('Y-m-d'),
                'target_billing_day' => $targetBillingDay
            ]);

            $logger->info('Checking billing_accounts table for eligible accounts...', [
                'criteria' => [
                    'billing_status_id' => 1,
                    'date_installed' => 'NOT NULL',
                    'account_no' => 'NOT NULL',
                    'billing_day' => $targetBillingDay
                ]
            ]);

            $matchingAccounts = \App\Models\BillingAccount::where('billing_status_id', 1)
                ->whereNotNull('date_installed')
                ->whereNotNull('account_no')
                ->where('billing_day', $targetBillingDay)
                ->select('account_no')
                ->get();

            $accountsCount = $matchingAccounts->count();

            if ($accountsCount > 0) {
                $logger->info('Found matching accounts. Will generate billings for:', [
                    'count' => $accountsCount,
                    'account_numbers' => $matchingAccounts->pluck('account_no')->toArray()
                ]);
            }

            $logger->info('Accounts found for processing', [
                'billing_day' => $targetBillingDay,
                'accounts_count' => $accountsCount,
                'status' => $accountsCount > 0 ? 'READY_TO_PROCESS' : 'NO_ACCOUNTS_FOUND'
            ]);

            if ($accountsCount === 0) {
                $logger->info('No accounts scheduled for billing today', [
                    'billing_day' => $targetBillingDay,
                    'message' => 'Cron executed successfully but no billing generated - no accounts due today'
                ]);
                
                $endTime = microtime(true);
                $duration = round($endTime - $startTime, 2);
                
                $logger->info('=================================================================');
                $logger->info('Daily Billing Generation Cron Job Completed (No Generation Needed)', [
                    'timestamp' => Carbon::now()->format('Y-m-d H:i:s'),
                    'duration_seconds' => $duration,
                    'status' => 'SUCCESS',
                    'accounts_processed' => 0
                ]);
                $logger->info('=================================================================');
                
                return Command::SUCCESS;
            }

            $logger->info('Starting Unified Billing generation (SOA + Invoice + Notification)', [
                'billing_day' => $targetBillingDay,
                'accounts_to_process' => $accountsCount
            ]);

            $unifiedResults = $this->billingService->generateUnifiedBilling(
                $targetBillingDay,
                $today,
                1
            );

            $logger->info('SOA generation completed', [
                'success' => $unifiedResults['statements']['success'],
                'failed' => $unifiedResults['statements']['failed'],
                'total_accounts' => $accountsCount
            ]);

            $logger->info('Invoice generation completed', [
                'success' => $unifiedResults['invoices']['success'],
                'failed' => $unifiedResults['invoices']['failed'],
                'total_accounts' => $accountsCount
            ]);

            $logger->info('Notifications completed', [
                'count' => count($unifiedResults['notifications'] ?? [])
            ]);

            // [NEW] Generate Overdue Notices
            $logger->info('Starting Overdue Notice generation');
            $overdueResults = $this->billingService->generateOverdueNotices(false, 1);
            $logger->info('Overdue Notice generation completed', [
                'success' => $overdueResults['success'],
                'failed' => $overdueResults['failed']
            ]);

            // [NEW] Generate DC Notices
            $logger->info('Starting DC Notice generation');
            $dcResults = $this->billingService->generateDCNotices(false, 1);
            $logger->info('DC Notice generation completed', [
                'success' => $dcResults['success'],
                'failed' => $dcResults['failed']
            ]);

            $soaResults = $unifiedResults['statements'];
            $invoiceResults = $unifiedResults['invoices'];

            $totalSuccess = $soaResults['success'] + $invoiceResults['success'] + $overdueResults['success'] + $dcResults['success'];
            $totalFailed = $soaResults['failed'] + $invoiceResults['failed'] + $overdueResults['failed'] + $dcResults['failed'];

            $endTime = microtime(true);
            $duration = round($endTime - $startTime, 2);

            $logger->info('=================================================================');
            $logger->info('Daily Billing Generation Cron Job Completed', [
                'timestamp' => Carbon::now()->format('Y-m-d H:i:s'),
                'duration_seconds' => $duration,
                'status' => 'SUCCESS',
                'summary' => [
                    'accounts_found' => $accountsCount,
                    'soa_success' => $soaResults['success'],
                    'soa_failed' => $soaResults['failed'],
                    'invoice_success' => $invoiceResults['success'],
                    'invoice_failed' => $invoiceResults['failed'],
                    'overdue_success' => $overdueResults['success'],
                    'overdue_failed' => $overdueResults['failed'],
                    'dc_notice_success' => $dcResults['success'],
                    'dc_notice_failed' => $dcResults['failed'],
                    'total_success' => $totalSuccess,
                    'total_failed' => $totalFailed
                ]
            ]);
            $logger->info('=================================================================');

            return Command::SUCCESS;

        } catch (\Exception $e) {
            $endTime = microtime(true);
            $duration = round($endTime - $startTime, 2);

            $logger->error('=================================================================');
            $logger->error('Daily Billing Generation Cron Job Failed', [
                'timestamp' => Carbon::now()->format('Y-m-d H:i:s'),
                'duration_seconds' => $duration,
                'status' => 'FAILED',
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            $logger->error('=================================================================');

            return Command::FAILURE;
        }
    }
}



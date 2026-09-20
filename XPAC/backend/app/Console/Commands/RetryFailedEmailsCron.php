<?php

namespace App\Console\Commands;

use App\Services\EmailQueueService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class RetryFailedEmailsCron extends Command
{
    protected $signature = 'cron:retry-failed-emails';

    protected $description = 'Cron job to retry failed emails from the email queue';

    protected EmailQueueService $emailQueueService;

    public function __construct(EmailQueueService $emailQueueService)
    {
        parent::__construct();
        $this->emailQueueService = $emailQueueService;
    }

    public function handle(): int
    {
        $logPath = storage_path('logs/emailqueue');
        if (!file_exists($logPath)) {
            mkdir($logPath, 0755, true);
        }

        Log::build([
            'driver' => 'single',
            'path' => $logPath . '/emailqueue.log',
        ])->info('Failed emails retry cron job started', ['timestamp' => now()->toDateTimeString()]);

        try {
            $stats = $this->emailQueueService->retryFailedEmails(3, 20);

            Log::build([
                'driver' => 'single',
                'path' => $logPath . '/emailqueue.log',
            ])->info('Failed emails retry cron job completed', [
                'timestamp' => now()->toDateTimeString(),
                'processed' => $stats['processed'],
                'sent' => $stats['sent'],
                'failed' => $stats['failed']
            ]);

            if ($stats['failed'] > 0) {
                Log::build([
                    'driver' => 'single',
                    'path' => $logPath . '/emailqueue.log',
                ])->warning('Email retry had failures', [
                    'timestamp' => now()->toDateTimeString(),
                    'failed_count' => $stats['failed']
                ]);
            }

            return Command::SUCCESS;

        } catch (\Exception $e) {
            Log::build([
                'driver' => 'single',
                'path' => $logPath . '/emailqueue.log',
            ])->error('Failed emails retry cron job failed', [
                'timestamp' => now()->toDateTimeString(),
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return Command::FAILURE;
        }
    }
}

<?php

namespace App\Console\Commands;

use App\Services\EmailQueueService;
use App\Services\SmsQueueService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ProcessEmailQueueCron extends Command
{
    protected $signature = 'cron:process-email-queue';

    protected $description = 'Cron job to process pending emails from the email queue';

    protected EmailQueueService $emailQueueService;
    protected SmsQueueService $smsQueueService;

    public function __construct(EmailQueueService $emailQueueService, SmsQueueService $smsQueueService)
    {
        parent::__construct();
        $this->emailQueueService = $emailQueueService;
        $this->smsQueueService = $smsQueueService;
    }

    public function handle(): int
    {
        $logPath = storage_path('logs/emailqueue');
        if (!file_exists($logPath)) {
            mkdir($logPath, 0755, true);
        }

        $logger = Log::build([
            'driver' => 'single',
            'path' => $logPath . '/emailqueue.log',
        ]);

        $logger->info('Queue processing cron job started', ['timestamp' => now()->toDateTimeString()]);

        try {
            // Process Emails
            $emailStats = $this->emailQueueService->processPendingEmails(50);
            
            // Process SMS
            $smsStats = $this->smsQueueService->processPendingSms(50);

            $logger->info('Queue processing cron job completed', [
                'timestamp' => now()->toDateTimeString(),
                'emails' => $emailStats,
                'sms' => $smsStats
            ]);

            return Command::SUCCESS;

        } catch (\Exception $e) {
            $logger->error('Queue processing cron job failed', [
                'timestamp' => now()->toDateTimeString(),
                'error' => $e->getMessage()
            ]);

            return Command::FAILURE;
        }
    }
}

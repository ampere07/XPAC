<?php

namespace App\Console\Commands;

use App\Services\EmailQueueService;
use Illuminate\Console\Command;

class ProcessEmailQueue extends Command
{
    protected $signature = 'email:process-queue 
                            {--batch=50 : Number of emails to process per batch}
                            {--retry : Also retry failed emails}
                            {--max-attempts=3 : Maximum retry attempts for failed emails}';

    protected $description = 'Process pending emails in the queue and send them via Resend API';

    protected EmailQueueService $emailQueueService;

    public function __construct(EmailQueueService $emailQueueService)
    {
        parent::__construct();
        $this->emailQueueService = $emailQueueService;
    }

    public function handle(): int
    {
        $this->info('Starting email queue processing...');

        $batchSize = (int) $this->option('batch');
        $stats = $this->emailQueueService->processPendingEmails($batchSize);

        $this->info("Processed: {$stats['processed']} emails");
        $this->info("Sent: {$stats['sent']} emails");
        
        if ($stats['failed'] > 0) {
            $this->warn("Failed: {$stats['failed']} emails");
        }

        if ($this->option('retry')) {
            $this->info('Processing retry queue...');
            
            $maxAttempts = (int) $this->option('max-attempts');
            $retryStats = $this->emailQueueService->retryFailedEmails($maxAttempts, 20);

            $this->info("Retry - Processed: {$retryStats['processed']} emails");
            $this->info("Retry - Sent: {$retryStats['sent']} emails");
            
            if ($retryStats['failed'] > 0) {
                $this->warn("Retry - Failed: {$retryStats['failed']} emails");
            }
        }

        $this->info('Email queue processing completed.');

        return Command::SUCCESS;
    }
}

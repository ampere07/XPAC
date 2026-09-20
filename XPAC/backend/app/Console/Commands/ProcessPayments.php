<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\PaymentWorkerService;

class ProcessPayments extends Command
{
    protected $signature = 'payments:process';
    protected $description = 'Process queued payments, update billing, and log transactions (runs every 2 minutes)';

    private $paymentWorker;

    public function __construct(PaymentWorkerService $paymentWorker)
    {
        parent::__construct();
        $this->paymentWorker = $paymentWorker;
    }

    public function handle()
    {
        $this->info('===========================================');
        $this->info('Payment Worker Started: ' . now()->format('Y-m-d H:i:s'));
        $this->info('===========================================');

        // Get statistics before processing
        $statsBefore = $this->paymentWorker->getStatistics();
        
        $this->info("Status before processing:");
        $this->line("  PENDING:    {$statsBefore['pending']}");
        $this->line("  QUEUED:     {$statsBefore['queued']}");
        $this->line("  PROCESSING: {$statsBefore['processing']}");
        $this->line("  API_RETRY:  {$statsBefore['api_retry']}");
        $this->newLine();

        // Process payments
        $success = $this->paymentWorker->processPayments();

        if (!$success) {
            $this->error('Worker failed or another instance is running');
            return 1;
        }

        // Get statistics after processing
        $statsAfter = $this->paymentWorker->getStatistics();
        
        $this->newLine();
        $this->info("Status after processing:");
        $this->line("  PAID (today):    {$statsAfter['paid']}");
        $this->line("  FAILED (today):  {$statsAfter['failed']}");
        $this->line("  PENDING:         {$statsAfter['pending']}");
        $this->line("  QUEUED:          {$statsAfter['queued']}");
        $this->line("  API_RETRY:       {$statsAfter['api_retry']}");
        
        $this->newLine();
        $this->info('===========================================');
        $this->info('Payment Worker Completed: ' . now()->format('Y-m-d H:i:s'));
        $this->info('===========================================');

        return 0;
    }
}

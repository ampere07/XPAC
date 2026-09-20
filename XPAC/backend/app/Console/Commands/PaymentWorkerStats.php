<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\PaymentWorkerService;

class PaymentWorkerStats extends Command
{
    protected $signature = 'payments:stats';
    protected $description = 'Show payment worker statistics';

    private $paymentWorker;

    public function __construct(PaymentWorkerService $paymentWorker)
    {
        parent::__construct();
        $this->paymentWorker = $paymentWorker;
    }

    public function handle()
    {
        $stats = $this->paymentWorker->getStatistics();

        $this->info('===========================================');
        $this->info('Payment Worker Statistics');
        $this->info('===========================================');
        $this->newLine();

        $headers = ['Status', 'Count'];
        $rows = [
            ['PENDING', $stats['pending']],
            ['QUEUED', $stats['queued']],
            ['PROCESSING', $stats['processing']],
            ['PAID (Today)', $stats['paid']],
            ['FAILED (Today)', $stats['failed']],
            ['API_RETRY', $stats['api_retry']],
        ];

        $this->table($headers, $rows);

        $this->newLine();
        
        if ($stats['queued'] > 0) {
            $this->warn("⚠ {$stats['queued']} payment(s) waiting to be processed");
        }
        
        if ($stats['api_retry'] > 0) {
            $this->error("✗ {$stats['api_retry']} payment(s) need retry");
            $this->line('Run: php artisan payments:retry-failed');
        }

        if ($stats['paid'] > 0) {
            $this->info("✓ {$stats['paid']} payment(s) processed successfully today");
        }

        return 0;
    }
}

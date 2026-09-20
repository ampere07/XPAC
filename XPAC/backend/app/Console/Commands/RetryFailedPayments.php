<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\PaymentWorkerService;

class RetryFailedPayments extends Command
{
    protected $signature = 'payments:retry-failed';
    protected $description = 'Retry payments marked as API_RETRY';

    private $paymentWorker;

    public function __construct(PaymentWorkerService $paymentWorker)
    {
        parent::__construct();
        $this->paymentWorker = $paymentWorker;
    }

    public function handle()
    {
        $this->info('Retrying failed payments...');

        $count = $this->paymentWorker->retryFailedPayments();

        if ($count > 0) {
            $this->info("Marked {$count} payment(s) for retry (moved to QUEUED status)");
            $this->info('Run "php artisan payments:process" to process them');
        } else {
            $this->info('No failed payments to retry');
        }

        return 0;
    }
}

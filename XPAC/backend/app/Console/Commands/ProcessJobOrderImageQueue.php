<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\ImageProcessingService;
use Illuminate\Support\Facades\Log;

class ProcessJobOrderImageQueue extends Command
{
    protected $signature = 'joborderimages:process {--limit=10 : Maximum number of job order images to process}';
    
    protected $description = 'Process pending job order images in the queue - resize and upload to Google Drive';

    private $imageProcessingService;

    public function __construct(ImageProcessingService $imageProcessingService)
    {
        parent::__construct();
        $this->imageProcessingService = $imageProcessingService;
    }

    public function handle(): int
    {
        $startTime = now();
        $this->logToFile("\n" . str_repeat('=', 80));
        $this->logToFile("[" . $startTime->format('Y-m-d H:i:s') . "] Job Order Image Queue Processing Started");
        $this->logToFile(str_repeat('=', 80));
        
        $this->info('Starting job order image queue processing...');
        Log::info('Job Order Image Queue Processing: Started');

        $limit = (int) $this->option('limit');
        $this->logToFile("Processing limit: {$limit} images");

        try {
            $stats = $this->imageProcessingService->getJobOrderQueueStats();
            
            $statsMessage = sprintf(
                "Job Order Queue Stats - Pending: %d, Processing: %d, Completed: %d, Failed: %d, Total: %d",
                $stats['pending'],
                $stats['processing'],
                $stats['completed'],
                $stats['failed'],
                $stats['total']
            );
            
            $this->info($statsMessage);
            $this->logToFile($statsMessage);
            Log::info('Job Order Queue Stats', $stats);

            if ($stats['pending'] === 0) {
                $this->info('No pending job order images to process.');
                $this->logToFile('No pending job order images to process.');
                Log::info('Job Order Image Queue Processing: No pending images');
                
                $endTime = now();
                $duration = $endTime->diffInSeconds($startTime);
                $this->logToFile("Execution completed in {$duration} seconds");
                $this->logToFile(str_repeat('=', 80) . "\n");
                
                return Command::SUCCESS;
            }

            $this->logToFile("Starting to process {$stats['pending']} pending job order image(s)...");
            $result = $this->imageProcessingService->processPendingJobOrderImages($limit);

            $resultMessage = sprintf(
                "Processing complete - Successfully processed: %d, Failed: %d, Skipped: %d",
                $result['processed'],
                $result['failed'],
                $result['skipped']
            );
            
            $this->info("Processing complete:");
            $this->info("  - Successfully processed: {$result['processed']}");
            $this->info("  - Failed: {$result['failed']}");
            $this->info("  - Skipped: {$result['skipped']}");
            $this->logToFile($resultMessage);

            Log::info('Job Order Image Queue Processing: Completed', $result);

            if ($result['failed'] > 0) {
                $retryResult = $this->imageProcessingService->retryFailedJobOrderImages();
                $retryMessage = "Marked {$retryResult['retried']} failed job order image(s) for retry";
                $this->info($retryMessage);
                $this->logToFile($retryMessage);
            }

            $endTime = now();
            $duration = $endTime->diffInSeconds($startTime);
            $this->logToFile("Execution completed successfully in {$duration} seconds");
            $this->logToFile(str_repeat('=', 80) . "\n");

            return Command::SUCCESS;

        } catch (\Exception $e) {
            $errorMessage = "Error processing job order image queue: " . $e->getMessage();
            $this->error($errorMessage);
            $this->logToFile("ERROR: {$errorMessage}");
            $this->logToFile("Stack trace: " . $e->getTraceAsString());
            
            Log::error('Job Order Image Queue Processing Error: ' . $e->getMessage(), [
                'exception' => $e,
            ]);
            
            $endTime = now();
            $duration = $endTime->diffInSeconds($startTime);
            $this->logToFile("Execution failed after {$duration} seconds");
            $this->logToFile(str_repeat('=', 80) . "\n");
            
            return Command::FAILURE;
        }
    }

    private function logToFile(string $message): void
    {
        $logPath = storage_path('logs/joborderimagequeue.log');
        $timestamp = now()->format('Y-m-d H:i:s');
        
        if (!str_starts_with($message, '===') && !str_starts_with($message, "\n===")) {
            $message = "[{$timestamp}] {$message}";
        }
        
        try {
            if (file_exists($logPath)) {
                if (is_writable($logPath)) {
                    @file_put_contents($logPath, $message . "\n", FILE_APPEND);
                }
            } elseif (is_writable(dirname($logPath))) {
                @file_put_contents($logPath, $message . "\n", FILE_APPEND);
            }
        } catch (\Throwable $e) {
            // Silently ignore log write errors to prevent command failure
        }
    }
}


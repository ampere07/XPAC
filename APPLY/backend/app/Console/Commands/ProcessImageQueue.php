<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\ImageProcessingService;
use Illuminate\Support\Facades\Log;

class ProcessImageQueue extends Command
{
    protected $signature = 'images:process {--limit=10 : Maximum number of images to process}';
    
    protected $description = 'Process pending images in the queue - resize and upload to Google Drive';

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
        $this->logToFile("[" . $startTime->format('Y-m-d H:i:s') . "] Image Queue Processing Started");
        $this->logToFile(str_repeat('=', 80));
        
        $this->info('Starting image queue processing...');
        Log::info('Image Queue Processing: Started');

        $limit = (int) $this->option('limit');
        $this->logToFile("Processing limit: {$limit} images");

        try {
            $stats = $this->imageProcessingService->getQueueStats();
            
            $statsMessage = sprintf(
                "Queue Stats - Pending: %d, Processing: %d, Completed: %d, Failed: %d, Total: %d",
                $stats['pending'],
                $stats['processing'],
                $stats['completed'],
                $stats['failed'],
                $stats['total']
            );
            
            $this->info($statsMessage);
            $this->logToFile($statsMessage);
            Log::info('Queue Stats', $stats);

            if ($stats['pending'] === 0) {
                $this->info('No pending images to process.');
                $this->logToFile('No pending images to process.');
                Log::info('Image Queue Processing: No pending images');
                
                $endTime = now();
                $duration = $endTime->diffInSeconds($startTime);
                $this->logToFile("Execution completed in {$duration} seconds");
                $this->logToFile(str_repeat('=', 80) . "\n");
                
                return Command::SUCCESS;
            }

            $this->logToFile("Starting to process {$stats['pending']} pending image(s)...");
            $result = $this->imageProcessingService->processPendingImages($limit);

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

            Log::info('Image Queue Processing: Completed', $result);

            if ($result['failed'] > 0) {
                $retryResult = $this->imageProcessingService->retryFailedImages();
                $retryMessage = "Marked {$retryResult['retried']} failed image(s) for retry";
                $this->info($retryMessage);
                $this->logToFile($retryMessage);
            }

            $endTime = now();
            $duration = $endTime->diffInSeconds($startTime);
            $this->logToFile("Execution completed successfully in {$duration} seconds");
            $this->logToFile(str_repeat('=', 80) . "\n");

            return Command::SUCCESS;

        } catch (\Exception $e) {
            $errorMessage = "Error processing image queue: " . $e->getMessage();
            $this->error($errorMessage);
            $this->logToFile("ERROR: {$errorMessage}");
            $this->logToFile("Stack trace: " . $e->getTraceAsString());
            
            Log::error('Image Queue Processing Error: ' . $e->getMessage(), [
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
        $logPath = storage_path('logs/imagequeue.log');
        $timestamp = now()->format('Y-m-d H:i:s');
        
        if (!str_starts_with($message, '===') && !str_starts_with($message, "\n===")) {
            $message = "[{$timestamp}] {$message}";
        }
        
        file_put_contents($logPath, $message . "\n", FILE_APPEND);
    }
}

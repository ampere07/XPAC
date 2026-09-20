<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class ServeWithSocket extends Command
{
    protected $signature = 'serve:all {--host=127.0.0.1} {--port=8000}';
    protected $description = 'Start Laravel and Socket.IO servers together';

    private $socketProcess;

    public function handle()
    {
        $host = $this->option('host');
        $port = $this->option('port');

        $this->info('Starting CBMS servers...');
        $this->newLine();

        // Start Socket.IO server
        $this->info('Starting Socket.IO server on port 3001...');
        $this->socketProcess = new Process(['node', 'socket-server.js']);
        $this->socketProcess->setTimeout(null);
        $this->socketProcess->start();

        sleep(2);

        if ($this->socketProcess->isRunning()) {
            $this->info('✓ Socket.IO server started successfully');
        } else {
            $this->error('✗ Failed to start Socket.IO server');
            $this->error($this->socketProcess->getErrorOutput());
            return 1;
        }

        $this->newLine();
        $this->info("Starting Laravel server on http://{$host}:{$port}...");
        $this->newLine();

        // Start Laravel server
        $laravelProcess = new Process(['php', 'artisan', 'serve', "--host={$host}", "--port={$port}"]);
        $laravelProcess->setTimeout(null);
        $laravelProcess->start();

        // Handle signals gracefully if supported (not on Windows)
        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGINT, function () {
                $this->cleanup();
                exit(0);
            });

            pcntl_signal(SIGTERM, function () {
                $this->cleanup();
                exit(0);
            });
        }

        // Monitor both processes
        while ($laravelProcess->isRunning() || $this->socketProcess->isRunning()) {
            echo $laravelProcess->getIncrementalOutput();
            echo $laravelProcess->getIncrementalErrorOutput();
            
            if (!$this->socketProcess->isRunning()) {
                $this->error('Socket.IO server stopped unexpectedly');
                $laravelProcess->stop();
                break;
            }
            
            usleep(100000);
        }

        $this->cleanup();
        return 0;
    }

    private function cleanup()
    {
        $this->newLine();
        $this->info('Shutting down servers...');
        
        if ($this->socketProcess && $this->socketProcess->isRunning()) {
            $this->socketProcess->stop();
            $this->info('✓ Socket.IO server stopped');
        }
    }
}


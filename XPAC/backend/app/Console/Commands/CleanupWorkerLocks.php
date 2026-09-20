<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CleanupWorkerLocks extends Command
{
    protected $signature = 'worker:cleanup-locks';
    protected $description = 'Clean up expired worker locks';

    public function handle()
    {
        $this->info('Cleaning up expired worker locks...');

        $deleted = DB::table('worker_locks')
            ->where('locked_at', '<', now()->subMinutes(10))
            ->delete();

        if ($deleted > 0) {
            $this->info("Cleaned up {$deleted} expired lock(s)");
        } else {
            $this->info('No expired locks found');
        }

        return 0;
    }
}

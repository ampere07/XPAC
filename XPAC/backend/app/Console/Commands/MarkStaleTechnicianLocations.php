<?php

namespace App\Console\Commands;

use App\Models\TechnicianLocation;
use App\Http\Controllers\Api\TechnicianLocationController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Carbon\Carbon;

class MarkStaleTechnicianLocations extends Command
{
    protected $signature = 'cron:mark-stale-locations';

    protected $description = 'Flag technician live-location records as stale when no GPS update has arrived within the stale window';

    public function handle(): int
    {
        try {
            $threshold = Carbon::now()->subSeconds(TechnicianLocationController::STALE_SECONDS);

            // Rows that were "online" but have gone quiet past the stale window.
            $affected = TechnicianLocation::where('status', 'online')
                ->where(function ($q) use ($threshold) {
                    $q->whereNull('last_updated_at')
                      ->orWhere('last_updated_at', '<', $threshold);
                })
                ->update(['status' => 'stale']);

            if ($affected > 0) {
                Log::info("MarkStaleTechnicianLocations: marked {$affected} technician(s) stale.");
            }

            // Prune old breadcrumb-trail points to keep the history table bounded.
            $pruned = 0;
            if (Schema::hasTable('technician_location_history')) {
                $cutoff = Carbon::now()->subHours(TechnicianLocationController::HISTORY_RETENTION_HOURS);
                $pruned = DB::table('technician_location_history')
                    ->where('recorded_at', '<', $cutoff)
                    ->limit(5000) // bound work per run
                    ->delete();
            }

            $this->info("Marked {$affected} technician location(s) as stale; pruned {$pruned} old trail point(s).");
            return self::SUCCESS;
        } catch (\Throwable $e) {
            Log::error('MarkStaleTechnicianLocations failed: ' . $e->getMessage());
            $this->error('Failed: ' . $e->getMessage());
            return self::FAILURE;
        }
    }
}

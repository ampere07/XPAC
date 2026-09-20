<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use App\Services\EnhancedBillingGenerationServiceWithNotifications;
use Illuminate\Support\Facades\Log;

class CronTestController extends Controller
{
    public function processOverdueNotifications()
    {
        try {
            $service = app(EnhancedBillingGenerationServiceWithNotifications::class);
            $results = $service->generateOverdueNotices(false, 1);
            
            return response()->json([
                'success' => true,
                'message' => 'Overdue notifications processed successfully',
                'output' => json_encode($results)
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error processing overdue notifications',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function processDisconnectionNotices()
    {
        try {
            $service = app(EnhancedBillingGenerationServiceWithNotifications::class);
            $results = $service->generateDCNotices(false, 1, true);
            
            return response()->json([
                'success' => true,
                'message' => 'Disconnection notices processed successfully',
                'output' => json_encode($results)
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error processing disconnection notices',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function testLogging()
    {
        try {
            Artisan::call('test:logging');
            
            $output = Artisan::output();
            
            return response()->json([
                'success' => true,
                'message' => 'Test logging completed',
                'output' => $output
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error testing logging',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


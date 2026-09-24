<?php

use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\GeographicController;
use App\Http\Controllers\PlanController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\FormUIController;
use App\Http\Controllers\PromoController;
use App\Services\ImageProcessingService;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Authentication Routes
Route::post('/login', [AuthController::class, 'login']);
Route::post('/logout', [AuthController::class, 'logout']);
Route::get('/user', [AuthController::class, 'user']);

// Dashboard Routes (Protected)
Route::get('/dashboard/stats', [DashboardController::class, 'stats']);
Route::get('/dashboard/recent-applications', [DashboardController::class, 'recentApplications']);

// Form UI Settings Routes
Route::get('/form-ui/settings', [FormUIController::class, 'getSettings']);
Route::post('/form-ui/settings', [FormUIController::class, 'updateSettings']);

Route::post('/application/store', [ApplicationController::class, 'store']);

Route::get('/applications', [ApplicationController::class, 'index']);
Route::get('/applications/{id}', [ApplicationController::class, 'show']);
Route::patch('/applications/{id}/status', [ApplicationController::class, 'updateStatus']);

Route::get('/regions', [GeographicController::class, 'getRegions']);
Route::get('/cities', [GeographicController::class, 'getCities']);
Route::get('/barangays', [GeographicController::class, 'getBarangays']);
Route::get('/villages', [GeographicController::class, 'getVillages']);
Route::get('/referrers', [GeographicController::class, 'getReferrers']);

// Also keep singular versions for backward compatibility
Route::get('/region', [GeographicController::class, 'getRegions']);
Route::get('/city', [GeographicController::class, 'getCities']);
Route::get('/barangay', [GeographicController::class, 'getBarangays']);
Route::get('/village', [GeographicController::class, 'getVillages']);

// Plan Management Routes - Using plan_list table
Route::get('/plans', [PlanController::class, 'index']);
Route::get('/plans/{id}', [PlanController::class, 'show']);
Route::post('/plans', [PlanController::class, 'store']);
Route::put('/plans/{id}', [PlanController::class, 'update']);
Route::delete('/plans/{id}', [PlanController::class, 'destroy']);

Route::get('/promo_list', [PromoController::class, 'index']);

// Image Queue Monitoring Routes
Route::get('/image-queue/stats', function () {
    try {
        $service = app(ImageProcessingService::class);
        return response()->json([
            'success' => true,
            'stats' => $service->getQueueStats()
        ]);
    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'error' => $e->getMessage()
        ], 500);
    }
});

// Temporary cache clear route - DELETE AFTER USE
Route::get('/clear-cache', function () {
    \Illuminate\Support\Facades\Artisan::call('config:clear');
    \Illuminate\Support\Facades\Artisan::call('cache:clear');
    return response()->json([
        'success' => true,
        'message' => 'Cache cleared successfully'
    ]);
});

Route::get('/debug/tables', function () {
    try {
        $result = [];
        
        $result['tables_exist'] = [
            'region' => Schema::hasTable('region'),
            'city' => Schema::hasTable('city'),
            'barangay' => Schema::hasTable('barangay'),
            'location' => Schema::hasTable('location'),
        ];
        
        if (Schema::hasTable('region')) {
            $result['region_columns'] = Schema::getColumnListing('region');
            $result['region_count'] = DB::table('region')->count();
            $result['region_sample'] = DB::table('region')->limit(3)->get();
        }
        
        if (Schema::hasTable('city')) {
            $result['city_columns'] = Schema::getColumnListing('city');
            $result['city_count'] = DB::table('city')->count();
            $result['city_sample'] = DB::table('city')->limit(3)->get();
        }
        
        if (Schema::hasTable('barangay')) {
            $result['barangay_columns'] = Schema::getColumnListing('barangay');
            $result['barangay_count'] = DB::table('barangay')->count();
            $result['barangay_sample'] = DB::table('barangay')->limit(3)->get();
        }
        
        if (Schema::hasTable('location')) {
            $result['location_columns'] = Schema::getColumnListing('location');
            $result['location_count'] = DB::table('location')->count();
            $result['location_sample'] = DB::table('location')->limit(3)->get();
        }
        
        return response()->json(['success' => true, 'data' => $result]);
    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'message' => 'Error checking tables: ' . $e->getMessage()
        ], 500);
    }
});

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'timestamp' => now(),
        'message' => 'AmpereCBMS API is running'
    ]);
});

Route::get('/debug/form-ui-structure', function () {
    try {
        return response()->json([
            'table_exists' => Schema::hasTable('form_ui'),
            'columns' => Schema::getColumnListing('form_ui'),
            'current_data' => DB::table('form_ui')->first(),
            'row_count' => DB::table('form_ui')->count()
        ]);
    } catch (\Exception $e) {
        return response()->json([
            'error' => $e->getMessage()
        ], 500);
    }
});

Route::get('/debug/gdrive-status', function () {
    try {
        $diagnostics = [
            'google_client_exists' => class_exists('Google\Client'),
            'service_file_exists' => file_exists(app_path('Services/GoogleDriveService.php')),
            'config_exists' => !empty(config('services.google')),
            'folder_id' => config('services.google.folder_id') ?? 'NOT SET',
            'client_email' => config('services.google.client_email') ?? 'NOT SET',
            'has_private_key' => !empty(config('services.google.private_key')),
            'private_key_length' => strlen(config('services.google.private_key') ?? ''),
        ];
        
        return response()->json($diagnostics);
    } catch (\Exception $e) {
        return response()->json([
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString()
        ], 500);
    }
});

Route::get('/debug/latest-logs', function () {
    try {
        $logFile = storage_path('logs/laravel.log');
        
        if (!file_exists($logFile)) {
            return response()->json([
                'error' => 'Log file does not exist',
                'path' => $logFile
            ]);
        }
        
        $lines = file($logFile);
        $lastLines = array_slice($lines, -100);
        
        return response()->json([
            'log_file_exists' => true,
            'total_lines' => count($lines),
            'last_100_lines' => implode('', $lastLines)
        ]);
    } catch (\Exception $e) {
        return response()->json([
            'error' => $e->getMessage()
        ], 500);
    }
});


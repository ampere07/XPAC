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

/*
|--------------------------------------------------------------------------
| PUBLIC
|--------------------------------------------------------------------------
|
| Everything an applicant needs, and nothing else. A member of the public
| filling in the form has no account, so these must stay open: the form
| itself, the reference data it is built from, and the submission.
|
| Read-only throughout, apart from the submission. Nothing here returns an
| existing applicant's details or changes any setting.
|
*/

Route::post('/login', [AuthController::class, 'login'])
    // Ten attempts a minute per IP. Password guessing against this endpoint
    // was otherwise limited only by how fast an attacker could send requests.
    ->middleware('throttle:10,1');

// The application form's own submission.
Route::post('/application/store', [ApplicationController::class, 'store'])
    ->middleware('throttle:20,1');

// How the form is laid out. Read-only — updating it is an administrator's job
// and now lives in the protected group below.
Route::get('/form-ui/settings', [FormUIController::class, 'getSettings']);

// Address pickers.
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

// What the applicant is choosing between. Reading the catalogue is public;
// changing it is not.
Route::get('/plans', [PlanController::class, 'index']);
Route::get('/plans/{id}', [PlanController::class, 'show']);
Route::get('/promo_list', [PromoController::class, 'index']);

/*
|--------------------------------------------------------------------------
| PROTECTED — requires a valid bearer token
|--------------------------------------------------------------------------
|
| Everything below was previously callable by anybody who knew the URL. That
| included the full applicant list and every individual application, both of
| which carry names, addresses and contact numbers; the endpoint that changes
| an application's status; and the plan and form-settings writes.
|
| See EnsureApiTokenIsValid for why the token travels in a header rather than
| a cookie — the same reason the SPA works inside an in-app browser.
|
*/

Route::middleware('auth.token')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'user']);

    // Dashboard
    Route::get('/dashboard/stats', [DashboardController::class, 'stats']);
    Route::get('/dashboard/recent-applications', [DashboardController::class, 'recentApplications']);

    // Applicant records. These are the personal details of real people.
    Route::get('/applications', [ApplicationController::class, 'index']);
    Route::get('/applications/{id}', [ApplicationController::class, 'show']);
    Route::patch('/applications/{id}/status', [ApplicationController::class, 'updateStatus']);

    // Changing what the form asks for.
    Route::post('/form-ui/settings', [FormUIController::class, 'updateSettings']);

    // Changing the catalogue an applicant is quoted from.
    Route::post('/plans', [PlanController::class, 'store']);
    Route::put('/plans/{id}', [PlanController::class, 'update']);
    Route::delete('/plans/{id}', [PlanController::class, 'destroy']);
});

/*
|--------------------------------------------------------------------------
| OPERATIONS & DIAGNOSTICS — requires a valid bearer token
|--------------------------------------------------------------------------
|
| These were all public. Between them they disclosed the last hundred lines of
| the application log, the Google service-account address, the database schema
| with sample rows, and offered anyone who found the URL a way to clear the
| cache — which, since sessions for this API live in the cache, signed every
| administrator out.
|
| None of it is applicant-facing, so all of it is now behind the same token as
| the rest of the administrative API.
|
*/

Route::middleware('auth.token')->group(function () {

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

}); // end of the token-protected operations group

// Deliberately public: an uptime monitor has no credentials, and this returns
// nothing but a fixed string and the clock.
Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'timestamp' => now(),
        'message' => 'AmpereCBMS API is running'
    ]);
});

Route::middleware('auth.token')->group(function () {

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


}); // end of the token-protected diagnostics group

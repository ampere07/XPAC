<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Hash;
use App\Http\Controllers\UserController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\SetupController;
use App\Http\Controllers\LogsController;
use App\Http\Controllers\ApplicationController;
use App\Http\Controllers\JobOrderController;
use App\Http\Controllers\ApplicationVisitController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\CityController;
use App\Http\Controllers\RegionController;
use App\Http\Controllers\DebugController;
use App\Http\Controllers\EmergencyLocationController;
use App\Http\Controllers\RadiusController;
use App\Http\Controllers\RadiusConfigController;
use App\Http\Controllers\SmsConfigController;
use App\Http\Controllers\EmailTemplateController;
use App\Http\Controllers\EmailQueueController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\BillingGenerationController;
use App\Models\User;
use App\Models\MassRebate;

// Handle all OPTIONS requests
Route::options('{any}', function() {
    return response('', 200)
        ->header('Access-Control-Allow-Origin', '*')
        ->header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        ->header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With, X-XSRF-TOKEN')
        ->header('Access-Control-Allow-Credentials', 'true')
        ->header('Access-Control-Max-Age', '86400');
})->where('any', '.*');

// =======================================================================
// BILLING GENERATION ROUTES - ADDED FOR SAMPLE DATA FUNCTIONALITY
// =======================================================================
Route::prefix('billing-generation')->group(function () {
    // Generate sample data with notifications for single account
    Route::post('/generate-sample', [BillingGenerationController::class, 'generateSampleData']);
    
    // Force generate all accounts (with optional notifications)
    Route::post('/force-generate-all', [BillingGenerationController::class, 'forceGenerateAll']);
    
    // Generate for specific billing day
    Route::post('/generate-for-day', [BillingGenerationController::class, 'generateBillingsForDay']);
    
    // Generate today's billings
    Route::post('/generate-today', [BillingGenerationController::class, 'generateTodaysBillings']);
    
    // Generate enhanced statements
    Route::post('/generate-statements', [BillingGenerationController::class, 'generateEnhancedStatements']);
    
    // Generate enhanced invoices
    Route::post('/generate-invoices', [BillingGenerationController::class, 'generateEnhancedInvoices']);
    
    // Get invoices
    Route::get('/invoices', [BillingGenerationController::class, 'getInvoices']);
    
    // Get statements
    Route::get('/statements', [BillingGenerationController::class, 'getStatements']);

    // Generate custom billing for a single account with optional service charge
    Route::post('/generate-custom', [BillingGenerationController::class, 'generateCustomBilling']);
});

// Test route to verify routes are working
Route::get('/billing-generation/test', function() {
    \Illuminate\Support\Facades\Log::info('Billing generation test route accessed', [
        'timestamp' => now()->toISOString(),
        'server_time' => now()->format('Y-m-d H:i:s')
    ]);
    
    return response()->json([
        'success' => true,
        'message' => 'Billing generation routes are working!',
        'timestamp' => now()->toISOString(),
        'routes' => [
            'POST /api/billing-generation/generate-sample',
            'POST /api/billing-generation/force-generate-all',
            'POST /api/billing-generation/generate-for-day',
            'POST /api/billing-generation/generate-today',
            'POST /api/billing-generation/generate-statements',
            'POST /api/billing-generation/generate-invoices',
            'GET /api/billing-generation/invoices',
            'GET /api/billing-generation/statements'
        ]
    ]);
});
// =======================================================================

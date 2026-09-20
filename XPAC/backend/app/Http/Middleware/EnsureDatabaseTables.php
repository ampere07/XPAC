<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use App\Services\DatabaseService;
use Illuminate\Support\Facades\Log;

class EnsureDatabaseTables
{
    public function handle(Request $request, Closure $next)
    {
        try {
            // Check if the main tables exist
            $requiredTables = [
                'organizations', 'roles', 'users', 'groups', 'activity_logs',
                'app_applications', 'job_orders', 'modem_router_sn', 'contract_templates',
                'lcp', 'nap', 'ports', 'vlans', 'lcpnap'
            ];
            $missingTables = [];
            
            foreach ($requiredTables as $table) {
                if (!Schema::hasTable($table)) {
                    $missingTables[] = $table;
                }
            }
            
            // If any tables are missing, create all tables
            if (!empty($missingTables)) {
                Log::info('Missing database tables detected: ' . implode(', ', $missingTables) . '. Creating tables...');
                
                try {
                    $result = DatabaseService::ensureTablesExist();
                    
                    if ($result['success']) {
                        Log::info('Database tables created successfully');
                        
                        // Also seed default data
                        try {
                            $seedResult = DatabaseService::seedDefaultData();
                            if ($seedResult['success']) {
                                Log::info('Default data seeded successfully');
                            } else {
                                Log::warning('Failed to seed default data: ' . $seedResult['message']);
                            }
                        } catch (\Exception $seedError) {
                            Log::warning('Error during seeding: ' . $seedError->getMessage());
                            // Continue even if seeding fails
                        }
                    } else {
                        Log::error('Failed to create database tables: ' . $result['message']);
                        return response()->json([
                            'success' => false,
                            'message' => 'Database initialization failed',
                            'error' => $result['message']
                        ], 500);
                    }
                } catch (\Exception $tableError) {
                    Log::error('Exception during table creation: ' . $tableError->getMessage());
                    return response()->json([
                        'success' => false,
                        'message' => 'Database initialization failed',
                        'error' => $tableError->getMessage()
                    ], 500);
                }
            }
            
        } catch (\Exception $e) {
            Log::error('Database middleware error: ' . $e->getMessage());
            
            // For critical errors, return error response
            if (str_contains($e->getMessage(), 'SQLSTATE') || str_contains($e->getMessage(), 'database')) {
                return response()->json([
                    'success' => false,
                    'message' => 'Database error',
                    'error' => 'Unable to initialize database tables'
                ], 500);
            }
            
            // For other errors, continue with request to avoid breaking the entire application
        }

        return $next($request);
    }
}

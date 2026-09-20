<?php

namespace App\Http\Controllers;

use App\Services\DatabaseService;
use Illuminate\Http\Request;

class SetupController extends Controller
{
    public function initializeDatabase()
    {
        try {
            $tablesResult = DatabaseService::ensureTablesExist();
            
            if (!$tablesResult['success']) {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to create tables',
                    'error' => $tablesResult['message']
                ], 500);
            }

            $seedResult = DatabaseService::seedDefaultData();
            
            if (!$seedResult['success']) {
                return response()->json([
                    'success' => false,
                    'message' => 'Tables created but failed to seed data',
                    'error' => $seedResult['message']
                ], 500);
            }

            return response()->json([
                'success' => true,
                'message' => 'Database initialized successfully',
                'data' => [
                    'tables_created' => true,
                    'default_data_seeded' => true,
                    'timestamp' => now()->toISOString()
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to initialize database',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function checkDatabaseStatus()
    {
        try {
            $tableStatus = DatabaseService::checkTableStatus();
            $allTablesExist = !in_array(false, array_values($tableStatus));

            return response()->json([
                'success' => true,
                'message' => 'Database status checked',
                'data' => [
                    'tables' => $tableStatus,
                    'all_tables_exist' => $allTablesExist,
                    'timestamp' => now()->toISOString()
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to check database status',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

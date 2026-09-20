<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Region;
use App\Models\City;
use App\Models\Barangay;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class DirectInsertController extends Controller
{
    /**
     * Create a region directly - bypassing most middleware and validation
     */
    public function insertRegion(Request $request)
    {
        try {
            // Log the request
            Log::info('[DirectInsert] Inserting region', [
                'request' => $request->all(),
                'headers' => $request->headers->all(),
                'method' => $request->method(),
                'url' => $request->fullUrl()
            ]);
            
            // Direct DB insert to bypass any model validation
            $id = DB::table('region_list')->insertGetId([
                'name' => $request->input('name', 'Test Region ' . rand(100, 999)),
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now()
            ]);
            
            // Get the inserted record
            $region = DB::table('region_list')->where('id', $id)->first();
            
            Log::info('[DirectInsert] Region inserted successfully', [
                'id' => $id,
                'name' => $region->name
            ]);
            
            return response()->json([
                'success' => true,
                'message' => 'Region inserted successfully using direct DB',
                'data' => $region
            ]);
        } catch (\Exception $e) {
            Log::error('[DirectInsert] Error inserting region', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Error inserting region: ' . $e->getMessage(),
                'error' => $e->getTraceAsString()
            ], 500);
        }
    }
}

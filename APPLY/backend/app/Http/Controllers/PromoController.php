<?php

namespace App\Http\Controllers;

use App\Models\PromoList;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class PromoController extends Controller
{
    public function index()
    {
        try {
            Log::info('=== PromoController index START ===');
            
            Log::info('Querying promo_list table for active promos');
            $promos = PromoList::where('status', 'active')->get(['id', 'name', 'status']);
            Log::info('Promos fetched', ['count' => $promos->count()]);

            Log::info('=== PromoController index SUCCESS ===');
            return response()->json([
                'data' => $promos
            ]);
        } catch (\Exception $e) {
            Log::error('=== PromoController index ERROR ===');
            Log::error('Error message: ' . $e->getMessage());
            Log::error('Error file: ' . $e->getFile() . ':' . $e->getLine());
            Log::error('Stack trace: ' . $e->getTraceAsString());

            return response()->json([
                'success' => false,
                'message' => 'Failed to retrieve promos',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

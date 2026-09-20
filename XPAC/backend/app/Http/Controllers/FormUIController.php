<?php

namespace App\Http\Controllers;

use App\Models\FormUI;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class FormUIController extends Controller
{
    public function getConfig()
    {
        try {
            $config = FormUI::first();
            
            return response()->json([
                'success' => true,
                'data' => $config
            ]);
        } catch (\Exception $e) {
            Log::error('Error fetching form UI config: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch form UI configuration'
            ], 500);
        }
    }
}

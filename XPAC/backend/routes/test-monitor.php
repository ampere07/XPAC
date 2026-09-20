<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Http\Request;

// Simple test endpoints to verify routing works
Route::get('/test/monitor/simple', function() {
    return response()->json([
        'status' => 'success',
        'message' => 'Simple monitor test working',
        'timestamp' => now()
    ]);
});

Route::get('/test/monitor/with-params', function(Request $request) {
    return response()->json([
        'status' => 'success',
        'message' => 'Monitor test with params working',
        'params' => $request->all(),
        'timestamp' => now()
    ]);
});

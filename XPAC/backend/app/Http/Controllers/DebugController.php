<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class DebugController extends Controller
{
    public function listRoutes()
    {
        $routes = \Route::getRoutes();
        $routeList = [];
        
        foreach ($routes as $route) {
            $methods = implode(', ', $route->methods());
            $uri = $route->uri();
            $name = $route->getName() ?? 'unnamed';
            $action = $route->getActionName();
            
            $routeList[] = [
                'method' => $methods,
                'uri' => $uri,
                'name' => $name,
                'action' => $action
            ];
        }
        
        return response()->json([
            'status' => 'success',
            'count' => count($routeList),
            'routes' => $routeList
        ]);
    }
    
    public function locationTest()
    {
        return response()->json([
            'success' => true,
            'message' => 'Location debug endpoint is working',
            'tables' => [
                'region_list_exists' => \Schema::hasTable('region_list'),
                'city_list_exists' => \Schema::hasTable('city_list'),
                'barangay_list_exists' => \Schema::hasTable('barangay_list')
            ],
            'region_count' => \App\Models\Region::count(),
            'city_count' => \App\Models\City::count(),
            'barangay_count' => \App\Models\Barangay::count(),
            'columns' => [
                'region_is_active_exists' => \Schema::hasColumn('region_list', 'is_active'),
                'city_is_active_exists' => \Schema::hasColumn('city_list', 'is_active'),
                'barangay_is_active_exists' => \Schema::hasColumn('barangay_list', 'is_active')
            ]
        ]);
    }
}

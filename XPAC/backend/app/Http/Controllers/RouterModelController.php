<?php

namespace App\Http\Controllers;

use App\Models\RouterModel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class RouterModelController extends Controller
{
    public function index()
    {
        try {
            $routerModels = RouterModel::orderBy('model', 'asc')->get();
            return response()->json([
                'success' => true,
                'data' => $routerModels
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch router models',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'model' => 'required|string|max:255|unique:router_models,model',
            'brand' => 'nullable|string|max:255',
            'description' => 'nullable|string'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $routerModel = RouterModel::create([
                'model' => $request->model,
                'brand' => $request->brand,
                'description' => $request->description
            ]);

            // Create Activity Log
            ActivityLog::log(
                'Router Model Created',
                "New Router Model created: {$routerModel->brand} {$routerModel->model}",
                'info',
                [
                    'resource_type' => 'RouterModel',
                    'resource_id' => $routerModel->id,
                    'additional_data' => $routerModel->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Router model created successfully',
                'data' => $routerModel
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to create router model',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($model)
    {
        try {
            $routerModel = RouterModel::where('model', $model)->firstOrFail();
            return response()->json([
                'success' => true,
                'data' => $routerModel
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Router model not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), [
            'model' => 'sometimes|string|max:255|unique:router_models,model,' . $id,
            'brand' => 'sometimes|nullable|string|max:255',
            'description' => 'sometimes|nullable|string'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $routerModel = RouterModel::findOrFail($id);
            $routerModel->update($request->only(['model', 'brand', 'description']));

            // Create Activity Log
            ActivityLog::log(
                'Router Model Updated',
                "Router Model updated: {$routerModel->brand} {$routerModel->model} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'RouterModel',
                    'resource_id' => $id,
                    'additional_data' => $routerModel->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Router model updated successfully',
                'data' => $routerModel
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to update router model',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $routerModel = RouterModel::findOrFail($id);
            $routerModelData = $routerModel->toArray();
            $routerModel->delete();

            // Create Activity Log
            ActivityLog::log(
                'Router Model Deleted',
                "Router Model deleted: {$routerModelData['brand']} {$routerModelData['model']} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'RouterModel',
                    'resource_id' => $id,
                    'additional_data' => $routerModelData
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Router model deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete router model',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\InventoryCategory;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;
use App\Events\InventoryCategoryUpdated;
use Illuminate\Support\Facades\Auth;

class InventoryCategoryApiController extends Controller
{
    private function getCurrentUser(Request $request, $required = true)
    {
        if (auth()->check()) {
            return auth()->user()->email_address;
        }
        if ($request->has('user_email')) {
            return $request->user_email;
        }
        if ($request->has('modified_by')) {
            return $request->modified_by;
        }
        if ($request->has('modifiedBy')) {
            return $request->modifiedBy;
        }
        
        if ($required) {
            throw new \Exception('Unauthenticated: User email is required for this operation.');
        }
        
        return 'System';
    }

    private function resolveUserId(Request $request)
    {
        if (auth()->check()) return auth()->id();
        
        $email = $request->modified_by ?? $request->modifiedBy ?? $request->user_email;
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) return $user->id;
            throw new \Exception("User not found with email: {$email}");
        }
        
        throw new \Exception('Unauthenticated: User identification is required for this operation.');
    }

    public function index(Request $request)
    {
        try {
            $currentUser = Auth::user();
            $query = InventoryCategory::query();
            
            if ($currentUser && $currentUser->organization_id) {
                $query->where(function($q) use ($currentUser) {
                    $q->where('organization_id', $currentUser->organization_id)
                      ->orWhereNull('organization_id');
                });
            }
            
            $categories = $query->with(['updater'])->orderBy('id', 'desc')->get();
            $formattedCategories = $categories->map(function ($category) {
                return [
                    'id' => $category->id,
                    'name' => $category->category_name,
                    'created_at' => $category->created_at,
                    'updated_at' => $category->updated_at,
                    'modified_date' => $category->updated_at,
                    'modified_by' => $category->updater->email_address ?? 'System',
                    'organization_id' => $category->organization_id
                ];
            });
            return response()->json([
                'success' => true,
                'data' => $formattedCategories
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching inventory categories: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $currentUser = Auth::user();
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255'
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        // Check for duplicate within organization
        $duplicateQuery = InventoryCategory::where('category_name', $request->name);
        if ($currentUser && $currentUser->organization_id) {
            $duplicateQuery->where('organization_id', $currentUser->organization_id);
        }
        if ($duplicateQuery->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Category name already exists'
            ], 422);
        }
        
        try {
            $category = new InventoryCategory();
            $category->category_name = $request->name;
            $userId = $this->resolveUserId($request);
            $category->created_by_user_id = $userId;
            $category->updated_by_user_id = $userId;
            $category->organization_id = $currentUser->organization_id ?? null;
            $category->save();
            
            // Log Activity
            ActivityLog::log(
                'Inventory Category Created',
                "New inventory category created: {$category->category_name}",
                'info',
                [
                    'resource_type' => 'InventoryCategory',
                    'resource_id' => $category->id,
                    'additional_data' => $category->toArray(),
                    'organization_id' => $category->organization_id
                ]
            );
            
            event(new InventoryCategoryUpdated(['action' => 'created', 'category_id' => $category->id, 'name' => $category->category_name]));

            return response()->json([
                'success' => true,
                'message' => 'Inventory category added successfully',
                'data' => [
                    'id' => $category->id,
                    'name' => $category->category_name,
                    'created_at' => $category->created_at,
                    'updated_at' => $category->updated_at,
                    'modified_by' => $this->getCurrentUser($request),
                    'modified_date' => $category->updated_at,
                    'organization_id' => $category->organization_id
                ]
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding inventory category: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show(Request $request, $id)
    {
        try {
            $currentUser = Auth::user();
            $category = InventoryCategory::findOrFail($id);
            
            if ($currentUser && $currentUser->organization_id && $category->organization_id && $category->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'id' => $category->id,
                    'name' => $category->category_name,
                    'created_at' => $category->created_at,
                    'updated_at' => $category->updated_at,
                    'modified_date' => $category->updated_at,
                    'modified_by' => $this->getCurrentUser($request),
                    'organization_id' => $category->organization_id
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Inventory category not found'
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $currentUser = Auth::user();
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255'
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }
        
        try {
            $category = InventoryCategory::findOrFail($id);
            
            if ($currentUser && $currentUser->organization_id && $category->organization_id && $category->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
            }

            // Check duplicate name within organization excluding self
            $duplicateQuery = InventoryCategory::where('category_name', $request->name)->where('id', '!=', $id);
            if ($currentUser && $currentUser->organization_id) {
                $duplicateQuery->where('organization_id', $currentUser->organization_id);
            }
            if ($duplicateQuery->exists()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Category name already exists'
                ], 422);
            }

            $category->category_name = $request->name;
            $category->updated_by_user_id = $this->resolveUserId($request);
            $category->save();
            
            // Log Activity
            ActivityLog::log(
                'Inventory Category Updated',
                "Inventory category updated: {$category->category_name} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'InventoryCategory',
                    'resource_id' => $category->id,
                    'additional_data' => $category->toArray(),
                    'organization_id' => $category->organization_id
                ]
            );
            
            event(new InventoryCategoryUpdated(['action' => 'updated', 'category_id' => $category->id, 'name' => $category->category_name]));

            return response()->json([
                'success' => true,
                'message' => 'Inventory category updated successfully',
                'data' => [
                    'id' => $category->id,
                    'name' => $category->category_name,
                    'created_at' => $category->created_at,
                    'updated_at' => $category->updated_at,
                    'modified_date' => $category->updated_at,
                    'modified_by' => $this->getCurrentUser($request),
                    'organization_id' => $category->organization_id
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating inventory category: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $currentUser = Auth::user();
            $category = InventoryCategory::findOrFail($id);

            if ($currentUser && $currentUser->organization_id && $category->organization_id && $category->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
            }

            $categoryData = $category->toArray();
            $categoryName = $category->category_name;
            $category->delete();
            
            // Log Activity
            ActivityLog::log(
                'Inventory Category Deleted',
                "Inventory category deleted: {$categoryName} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'InventoryCategory',
                    'resource_id' => $id,
                    'additional_data' => $categoryData,
                    'organization_id' => $category->organization_id
                ]
            );
            
            event(new InventoryCategoryUpdated(['action' => 'deleted', 'category_id' => $id, 'name' => $categoryName]));

            return response()->json([
                'success' => true,
                'message' => 'Inventory category deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting inventory category: ' . $e->getMessage()
            ], 500);
        }
    }
}


<?php

namespace App\Http\Controllers\Api;

use App\Events\ExpensesCategoryUpdated;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\ExpensesCategory;
use App\Models\ExpensesLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;

class ExpensesCategoryApiController extends Controller
{
    private function resolveUserId(Request $request)
    {
        if (auth()->check()) {
            return auth()->id();
        }

        $email = $request->modified_by ?? $request->modifiedBy ?? $request->user_email;
        if ($email) {
            $user = \App\Models\User::where('email_address', $email)->first();
            if ($user) {
                return $user->id;
            }
            throw new \Exception("User not found with email: {$email}");
        }

        throw new \Exception('Unauthenticated: User identification is required for this operation.');
    }

    /**
     * Dispatches the realtime notification without letting it fail the request.
     *
     * The category row is already committed by the time this runs, so anything thrown here
     * turns a save that succeeded into a 500 that says it did not. That is exactly what
     * happened when App\Events\ExpensesCategoryUpdated was missing from a deployment: the
     * category was written, the dispatch raised "Class not found", and the caller saw a
     * bare "Server Error" for an operation that had in fact worked.
     *
     * Throwable, not Exception: a missing class raises Error, which sails straight past
     * catch(\Exception) — which is why the surrounding handler never saw it.
     */
    private function broadcast(array $payload): void
    {
        try {
            event(new ExpensesCategoryUpdated($payload));
        } catch (\Throwable $e) {
            // Realtime is a nicety; the write already landed. Other clients pick the change
            // up on their next fetch.
            \Log::warning('ExpensesCategory broadcast failed (write was committed)', [
                'action' => $payload['action'] ?? 'unknown',
                'error'  => $e->getMessage(),
            ]);
        }
    }

    private function format(ExpensesCategory $category, $expenseCount = null)
    {
        return [
            'id' => $category->id,
            'name' => $category->category_name,
            'created_at' => $category->created_at,
            'updated_at' => $category->updated_at,
            'modified_date' => $category->updated_at,
            'modified_by' => $category->updater->email_address ?? 'System',
            'expense_count' => $expenseCount,
            'organization_id' => $category->organization_id,
        ];
    }

    public function index(Request $request)
    {
        try {
            $currentUser = Auth::user();
            $query = ExpensesCategory::query();

            // Same rule the rest of the app uses: org users also see the unscoped
            // (organization_id NULL) rows, which act as global defaults.
            if ($currentUser && $currentUser->organization_id) {
                $query->where(function ($q) use ($currentUser) {
                    $q->where('organization_id', $currentUser->organization_id)
                        ->orWhereNull('organization_id');
                });
            }

            if ($request->filled('search')) {
                $query->where('category_name', 'like', '%' . $request->search . '%');
            }

            $categories = $query->with(['updater'])->orderBy('category_name', 'asc')->get();

            // One grouped count instead of a query per category.
            $counts = ExpensesLog::query()
                ->whereIn('category_id', $categories->pluck('id'))
                ->selectRaw('category_id, COUNT(*) as total')
                ->groupBy('category_id')
                ->pluck('total', 'category_id');

            $data = $categories->map(function ($category) use ($counts) {
                return $this->format($category, (int) ($counts[$category->id] ?? 0));
            });

            return response()->json(['success' => true, 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching expenses categories: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function store(Request $request)
    {
        $currentUser = Auth::user();

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        $duplicate = ExpensesCategory::where('category_name', $request->name);
        if ($currentUser && $currentUser->organization_id) {
            $duplicate->where('organization_id', $currentUser->organization_id);
        } else {
            $duplicate->whereNull('organization_id');
        }
        if ($duplicate->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Category name already exists',
            ], 422);
        }

        try {
            $userId = $this->resolveUserId($request);

            $category = new ExpensesCategory();
            $category->category_name = $request->name;
            $category->created_by_user_id = $userId;
            $category->updated_by_user_id = $userId;
            $category->organization_id = $currentUser->organization_id ?? null;
            $category->save();

            ActivityLog::log(
                'Expenses Category Created',
                "New expenses category created: {$category->category_name}",
                'info',
                [
                    'resource_type' => 'ExpensesCategory',
                    'resource_id' => $category->id,
                    'additional_data' => $category->toArray(),
                    'organization_id' => $category->organization_id,
                ]
            );

            $this->broadcast([
                'action' => 'created',
                'category_id' => $category->id,
                'name' => $category->category_name,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Expenses category added successfully',
                'data' => $this->format($category->fresh(['updater']), 0),
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error adding expenses category: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function show(Request $request, $id)
    {
        try {
            $currentUser = Auth::user();
            $category = ExpensesCategory::with(['updater'])->findOrFail($id);

            if ($currentUser && $currentUser->organization_id
                && $category->organization_id
                && $category->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
            }

            $count = ExpensesLog::where('category_id', $category->id)->count();

            return response()->json(['success' => true, 'data' => $this->format($category, $count)]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => 'Expenses category not found'], 404);
        }
    }

    public function update(Request $request, $id)
    {
        $currentUser = Auth::user();

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        try {
            $category = ExpensesCategory::findOrFail($id);

            if ($currentUser && $currentUser->organization_id
                && $category->organization_id
                && $category->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
            }

            $duplicate = ExpensesCategory::where('category_name', $request->name)->where('id', '!=', $id);
            if ($currentUser && $currentUser->organization_id) {
                $duplicate->where('organization_id', $currentUser->organization_id);
            } else {
                $duplicate->whereNull('organization_id');
            }
            if ($duplicate->exists()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Category name already exists',
                ], 422);
            }

            $previousName = $category->category_name;
            $category->category_name = $request->name;
            $category->updated_by_user_id = $this->resolveUserId($request);
            $category->save();

            // expenses_logs keeps a denormalised `category` string so the legacy
            // ExpensesLog page keeps rendering a name. Renaming here has to carry
            // across or that page would show the stale label forever.
            if ($previousName !== $category->category_name) {
                ExpensesLog::where('category_id', $category->id)
                    ->update(['category' => $category->category_name]);
            }

            ActivityLog::log(
                'Expenses Category Updated',
                "Expenses category updated: {$category->category_name} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'ExpensesCategory',
                    'resource_id' => $category->id,
                    'additional_data' => $category->toArray(),
                    'organization_id' => $category->organization_id,
                ]
            );

            $this->broadcast([
                'action' => 'updated',
                'category_id' => $category->id,
                'name' => $category->category_name,
            ]);

            $count = ExpensesLog::where('category_id', $category->id)->count();

            return response()->json([
                'success' => true,
                'message' => 'Expenses category updated successfully',
                'data' => $this->format($category->fresh(['updater']), $count),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating expenses category: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $currentUser = Auth::user();
            $category = ExpensesCategory::findOrFail($id);

            if ($currentUser && $currentUser->organization_id
                && $category->organization_id
                && $category->organization_id !== $currentUser->organization_id) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
            }

            // Refuse rather than orphan: expenses_logs.category_id has no FK, so a
            // delete here would silently leave expenses pointing at a missing row.
            $inUse = ExpensesLog::where('category_id', $category->id)->count();
            if ($inUse > 0) {
                return response()->json([
                    'success' => false,
                    'message' => "Cannot delete: {$inUse} expense(s) still use this category. Reassign them first.",
                ], 422);
            }

            $categoryData = $category->toArray();
            $categoryName = $category->category_name;
            $organizationId = $category->organization_id;
            $category->delete();

            ActivityLog::log(
                'Expenses Category Deleted',
                "Expenses category deleted: {$categoryName} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'ExpensesCategory',
                    'resource_id' => $id,
                    'additional_data' => $categoryData,
                    'organization_id' => $organizationId,
                ]
            );

            $this->broadcast([
                'action' => 'deleted',
                'category_id' => $id,
                'name' => $categoryName,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Expenses category deleted successfully',
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting expenses category: ' . $e->getMessage(),
            ], 500);
        }
    }
}

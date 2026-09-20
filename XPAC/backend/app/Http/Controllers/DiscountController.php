<?php

namespace App\Http\Controllers;

use App\Models\Discount;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use App\Models\ActivityLog;
use App\Events\DiscountUpdated;

class DiscountController extends Controller
{
    public function index(): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $query = Discount::with([
                'billingAccount.customer',
                'billingAccount.plan',
                'processedByUser',
                'approvedByUser',
                'createdByUser',
                'updatedByUser'
            ]);

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }

            $discounts = $query->orderBy('created_at', 'desc')
                ->get();

            return response()->json([
                'success' => true,
                'data' => $discounts,
                'count' => $discounts->count()
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching discounts: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch discounts',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|exists:billing_accounts,account_no',
                'discount_amount' => 'required|numeric|min:0',
                'remaining' => 'required|integer|min:0',
                'status' => 'required|in:Pending,Unused,Used,Permanent,Monthly',
                'processed_date' => 'required|date',
                'processed_by_user_id' => 'required|exists:users,id',
                'approved_by_user_id' => 'required|exists:users,id',
                'remarks' => 'nullable|string',
                'invoice_used_id' => 'nullable|exists:invoices,id',
                'used_date' => 'nullable|date',
            ]);

            if ($validated['status'] === 'Monthly' && $validated['remaining'] <= 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Remaining cycles must be greater than 0 for Monthly discounts',
                    'errors' => ['remaining' => ['Remaining cycles must be greater than 0 for Monthly discounts']]
                ], 422);
            }

            DB::beginTransaction();

            $validated['created_by_user_id'] = Auth::id();
            $validated['updated_by_user_id'] = Auth::id();
            
            if (Auth::user() && Auth::user()->organization_id) {
                $validated['organization_id'] = Auth::user()->organization_id;
            }

            $discount = Discount::create($validated);

            // Log Activity
            ActivityLog::log(
                'Discount Created',
                "New discount created for Account: {$validated['account_no']} (Amount: {$validated['discount_amount']})",
                'info',
                [
                    'resource_type' => 'Discount',
                    'resource_id' => $discount->id,
                    'additional_data' => $discount->toArray()
                ]
            );

            DB::commit();

            event(new DiscountUpdated(['action' => 'created', 'discount_id' => $discount->id, 'account_no' => $validated['account_no']]));

            return response()->json([
                'success' => true,
                'message' => 'Discount created successfully',
                'data' => $discount->load([
                    'billingAccount.customer',
                    'billingAccount.plan',
                    'processedByUser',
                    'approvedByUser',
                    'createdByUser',
                    'updatedByUser'
                ])
            ], 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error creating discount: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to create discount',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show(string $id): JsonResponse
    {
        try {
            $discount = Discount::with([
                'billingAccount.customer',
                'billingAccount.plan',
                'processedByUser',
                'approvedByUser',
                'createdByUser',
                'updatedByUser'
            ])
            ->findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $discount->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to this discount record'
                ], 403);
            }

            return response()->json([
                'success' => true,
                'data' => $discount
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching discount: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Discount not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, string $id): JsonResponse
    {
        try {
            $discount = Discount::findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $discount->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to update this discount record'
                ], 403);
            }

            $validated = $request->validate([
                'account_no' => 'sometimes|exists:billing_accounts,account_no',
                'discount_amount' => 'sometimes|numeric|min:0',
                'remaining' => 'sometimes|integer|min:0',
                'status' => 'sometimes|in:Pending,Unused,Used,Permanent,Monthly',
                'processed_date' => 'sometimes|date',
                'processed_by_user_id' => 'sometimes|exists:users,id',
                'approved_by_user_id' => 'sometimes|exists:users,id',
                'remarks' => 'nullable|string',
                'invoice_used_id' => 'nullable|exists:invoices,id',
                'used_date' => 'nullable|date',
            ]);

            if (isset($validated['status']) && $validated['status'] === 'Monthly' && isset($validated['remaining']) && $validated['remaining'] <= 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Remaining cycles must be greater than 0 for Monthly discounts',
                    'errors' => ['remaining' => ['Remaining cycles must be greater than 0 for Monthly discounts']]
                ], 422);
            }

            DB::beginTransaction();

            $validated['updated_by_user_id'] = Auth::id();

            $discount->update($validated);

            // Log Activity
            ActivityLog::log(
                'Discount Updated',
                "Discount updated for Account: {$discount->account_no} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'Discount',
                    'resource_id' => $id,
                    'additional_data' => $discount->toArray()
                ]
            );

            DB::commit();

            event(new DiscountUpdated(['action' => 'updated', 'discount_id' => $id, 'account_no' => $discount->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Discount updated successfully',
                'data' => $discount->load([
                    'billingAccount.customer',
                    'billingAccount.plan',
                    'processedByUser',
                    'approvedByUser',
                    'createdByUser',
                    'updatedByUser'
                ])
            ]);
        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error updating discount: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update discount',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy(string $id): JsonResponse
    {
        try {
            $discount = Discount::findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $discount->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to delete this discount record'
                ], 403);
            }

            DB::beginTransaction();

            $discount->delete();

            // Log Activity
            ActivityLog::log(
                'Discount Deleted',
                "Discount deleted for Account: {$discount->account_no} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'Discount',
                    'resource_id' => $id,
                    'additional_data' => $discount->toArray()
                ]
            );

            DB::commit();

            event(new DiscountUpdated(['action' => 'deleted', 'discount_id' => $id, 'account_no' => $discount->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Discount deleted successfully'
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error deleting discount: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete discount',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

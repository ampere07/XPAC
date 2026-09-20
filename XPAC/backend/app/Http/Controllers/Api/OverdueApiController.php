<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Overdue;
use App\Models\BillingAccount;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Exception;
use App\Events\OverdueUpdated;

class OverdueApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $search = $request->get('search');
            $date = $request->get('date');
            $page = $request->get('page', 1);
            $limit = $request->get('limit', 25);

            $query = Overdue::orderBy('overdue_date', 'desc');

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }

            if ($search) {
                $query->where(function ($q) use ($search) {
                    $q->where('account_no', 'LIKE', "%{$search}%");
                });
            }

            if ($date) {
                $query->whereDate('overdue_date', $date);
            }

            // Fetch with eager loading
            $overdues = $query->with(['account.customer'])
                ->skip(($page - 1) * $limit)
                ->take($limit + 1)
                ->get();

            // Check if there are more pages
            $hasMore = $overdues->count() > $limit;

            // Remove the extra record if it exists
            if ($hasMore) {
                $overdues = $overdues->slice(0, $limit);
            }

            // Map data
            $enrichedData = $overdues->map(function ($overdue) {
                $customer = $overdue->account?->customer;
                
                // Safe date formatting
                $overdue_date = null;
                if ($overdue->overdue_date instanceof \DateTimeInterface) {
                    $overdue_date = $overdue->overdue_date->format('Y-m-d H:i:s');
                } elseif (is_string($overdue->overdue_date)) {
                    $overdue_date = $overdue->overdue_date;
                }

                $created_at = null;
                if ($overdue->created_at instanceof \DateTimeInterface) {
                    $created_at = $overdue->created_at->format('Y-m-d H:i:s');
                }

                $updated_at = null;
                if ($overdue->updated_at instanceof \DateTimeInterface) {
                    $updated_at = $overdue->updated_at->format('Y-m-d H:i:s');
                }

                return [
                    'id' => $overdue->id,
                    'account_no' => $overdue->account_no,
                    'invoice_id' => $overdue->invoice_id,
                    'overdue_date' => $overdue_date,
                    'print_link' => $overdue->print_link,
                    'created_at' => $created_at,
                    'created_by_user_id' => $overdue->created_by_user_id,
                    'updated_at' => $updated_at,
                    'updated_by_user_id' => $overdue->updated_by_user_id,
                    'full_name' => $customer?->full_name ?? null,
                    'contact_number' => $customer?->contact_number_primary ?? null,
                    'email_address' => $customer?->email_address ?? null,
                    'address' => $customer?->address ?? null,
                    'plan' => $customer?->desired_plan ?? null,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $enrichedData->values(),
                'pagination' => [
                    'current_page' => (int) $page,
                    'per_page' => (int) $limit,
                    'has_more' => $hasMore,
                    'total' => (!$isSuperAdmin && $organizationId) ? Overdue::where('organization_id', $organizationId)->count() : Overdue::count()
                ]
            ]);

        } catch (\Throwable $e) {
            Log::error('Overdue API error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch Overdue records',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $overdue = Overdue::with(['account.customer'])->findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $overdue->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to this overdue record'
                ], 403);
            }

            $customer = $overdue->account?->customer;
            
            // Safe date formatting
            $overdue_date = null;
            if ($overdue->overdue_date instanceof \DateTimeInterface) {
                $overdue_date = $overdue->overdue_date->format('Y-m-d H:i:s');
            } elseif (is_string($overdue->overdue_date)) {
                $overdue_date = $overdue->overdue_date;
            }

            $created_at = null;
            if ($overdue->created_at instanceof \DateTimeInterface) {
                $created_at = $overdue->created_at->format('Y-m-d H:i:s');
            }

            $updated_at = null;
            if ($overdue->updated_at instanceof \DateTimeInterface) {
                $updated_at = $overdue->updated_at->format('Y-m-d H:i:s');
            }

            $data = [
                'id' => $overdue->id,
                'account_no' => $overdue->account_no,
                'invoice_id' => $overdue->invoice_id,
                'overdue_date' => $overdue_date,
                'print_link' => $overdue->print_link,
                'created_at' => $created_at,
                'created_by_user_id' => $overdue->created_by_user_id,
                'updated_at' => $updated_at,
                'updated_by_user_id' => $overdue->updated_by_user_id,
                'full_name' => $customer?->full_name ?? null,
                'contact_number' => $customer?->contact_number_primary ?? null,
                'email_address' => $customer?->email_address ?? null,
                'address' => $customer?->address ?? null,
                'plan' => $customer?->desired_plan ?? null,
            ];

            return response()->json([
                'success' => true,
                'data' => $data
            ]);

        } catch (\Throwable $e) {
            Log::error('Overdue show error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Overdue record not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'account_no' => 'required|string',
                'invoice_id' => 'nullable|integer',
                'overdue_date' => 'required|date',
                'print_link' => 'nullable|string|max:255',
            ]);

            $authData = $request->user();
            $validated['created_by_user_id'] = $authData?->id;
            
            if ($authData && $authData->organization_id) {
                $validated['organization_id'] = $authData->organization_id;
            }

            $overdue = Overdue::create($validated);

            event(new OverdueUpdated(['action' => 'created', 'overdue_id' => $overdue->id, 'account_no' => $overdue->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Overdue record created successfully',
                'data' => $overdue
            ], 201);

        } catch (\Throwable $e) {
            Log::error('Overdue create error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create Overdue record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $overdue = Overdue::findOrFail($id);

            $validated = $request->validate([
                'account_no' => 'sometimes|required|string',
                'invoice_id' => 'nullable|integer',
                'overdue_date' => 'sometimes|required|date',
                'print_link' => 'nullable|string|max:255',
            ]);

            $authData = $request->user();
            $validated['updated_by_user_id'] = $authData?->id;

            $organizationId = $authData ? $authData->organization_id : null;
            $roleId = $authData ? $authData->role_id : null;
            $isSuperAdmin = !$authData || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $overdue->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to update this overdue record'
                ], 403);
            }

            $overdue->update($validated);

            event(new OverdueUpdated(['action' => 'updated', 'overdue_id' => $overdue->id, 'account_no' => $overdue->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Overdue record updated successfully',
                'data' => $overdue
            ]);

        } catch (\Throwable $e) {
            Log::error('Overdue update error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update Overdue record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $overdue = Overdue::findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $overdue->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to delete this overdue record'
                ], 403);
            }

            $overdue->delete();

            event(new OverdueUpdated(['action' => 'deleted', 'overdue_id' => $id]));

            return response()->json([
                'success' => true,
                'message' => 'Overdue record deleted successfully'
            ]);

        } catch (\Throwable $e) {
            Log::error('Overdue delete error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete Overdue record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics()
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $totalQuery = Overdue::query();
            $thisMonthQuery = Overdue::whereMonth('overdue_date', now()->month)
                ->whereYear('overdue_date', now()->year);

            if (!$isSuperAdmin && $organizationId) {
                $totalQuery->where('organization_id', $organizationId);
                $thisMonthQuery->where('organization_id', $organizationId);
            }

            $total = $totalQuery->count();
            $thisMonth = $thisMonthQuery->count();

            return response()->json([
                'success' => true,
                'data' => [
                    'total_overdue' => $total,
                    'this_month' => $thisMonth,
                ]
            ]);

        } catch (\Throwable $e) {
            Log::error('Overdue statistics error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch statistics',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


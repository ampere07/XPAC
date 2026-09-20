<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DCNotice;
use App\Models\BillingAccount;
use App\Models\Invoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Exception;
use App\Events\DCNoticeUpdated;

class DCNoticeApiController extends Controller
{
    public function index(Request $request)
    {
        try {
            $limitInput = $request->input('limit', 50);
            $limit = (is_numeric($limitInput) && $limitInput > 0) ? (int)$limitInput : null;
            $page = $request->input('page', 1);
            $search = $request->input('search', '');
            $date = $request->input('date', '');
            $fastMode = $request->input('fast', false); // Fast mode: skip customer data loading

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Build query based on fast mode
            if ($fastMode) {
                // Fast mode: No eager loading
                $query = DCNotice::orderBy('dc_notice_date', 'desc');
            } else {
                // Normal mode: Include relationships
                $query = DCNotice::with(['account.customer', 'invoice'])
                    ->orderBy('dc_notice_date', 'desc');
            }

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }

            if ($search) {
                if ($fastMode) {
                    // Simple search in fast mode
                    $query->where('account_id', 'LIKE', "%{$search}%");
                } else {
                    // Complex search with relationships in normal mode
                    $query->where(function ($q) use ($search) {
                        $q->whereHas('account', function ($accountQuery) use ($search) {
                            $accountQuery->where('account_no', 'LIKE', "%{$search}%");
                        })->orWhereHas('account.customer', function ($customerQuery) use ($search) {
                            $customerQuery->where('first_name', 'LIKE', "%{$search}%")
                                          ->orWhere('last_name', 'LIKE', "%{$search}%");
                        });
                    });
                }
            }

            if ($date) {
                $query->whereDate('dc_notice_date', $date);
            }

            // If limit is provided and > 0, do pagination. Otherwise, return ALL records.
            if ($limit !== null) {
                // Fetch one extra record to check if there are more pages (more efficient than COUNT)
                $dcNotices = $query->skip(($page - 1) * $limit)
                    ->take($limit + 1) // Fetch one extra
                    ->get();
                $hasMore = $dcNotices->count() > $limit;
                if ($hasMore) {
                    $dcNotices = $dcNotices->slice(0, $limit);
                }
            } else {
                // NO LIMIT - Return everything
                $dcNotices = $query->get();
                $hasMore = false;
            }

            // Fast mode: Return data immediately without customer details
            if ($fastMode) {
                $enrichedData = $dcNotices->map(function ($notice) {
                    return [
                        'id' => $notice->id,
                        'account_id' => $notice->account_id,
                        'invoice_id' => $notice->invoice_id,
                        'dc_notice_date' => $notice->dc_notice_date?->format('Y-m-d H:i:s'),
                        'print_link' => $notice->print_link,
                        'created_at' => $notice->created_at?->format('Y-m-d H:i:s'),
                        'created_by_user_id' => $notice->created_by_user_id,
                        'updated_at' => $notice->updated_at?->format('Y-m-d H:i:s'),
                        'updated_by_user_id' => $notice->updated_by_user_id,
                        'organization_id' => $notice->organization_id,
                    ];
                });

                return response()->json([
                    'success' => true,
                    'data' => $enrichedData->values(),
                    'pagination' => [
                        'current_page' => (int) $page,
                        'per_page' => (int) $limit,
                        'has_more' => $hasMore
                    ]
                ]);
            }

            // Normal mode: Include customer data
            $enrichedData = $dcNotices->map(function ($notice) {
                $account = $notice->account;
                $customer = $account?->customer;
                
                return [
                    'id' => $notice->id,
                    'account_id' => $notice->account_id,
                    'invoice_id' => $notice->invoice_id,
                    'dc_notice_date' => $notice->dc_notice_date?->format('Y-m-d H:i:s'),
                    'print_link' => $notice->print_link,
                    'created_at' => $notice->created_at?->format('Y-m-d H:i:s'),
                    'created_by_user_id' => $notice->created_by_user_id,
                    'updated_at' => $notice->updated_at?->format('Y-m-d H:i:s'),
                    'updated_by_user_id' => $notice->updated_by_user_id,
                    'organization_id' => $notice->organization_id,
                    'account_no' => $account?->account_no ?? null,
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
                    'has_more' => $hasMore
                ]
            ]);

        } catch (Exception $e) {
            Log::error('DC Notice API error', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch DC Notice records',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $dcNotice = DCNotice::with(['account.customer', 'invoice'])->findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $dcNotice->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to this DC Notice record'
                ], 403);
            }

            $account = $dcNotice->account;
            $customer = $account?->customer;
            
            $data = [
                'id' => $dcNotice->id,
                'account_id' => $dcNotice->account_id,
                'invoice_id' => $dcNotice->invoice_id,
                'dc_notice_date' => $dcNotice->dc_notice_date?->format('Y-m-d H:i:s'),
                'print_link' => $dcNotice->print_link,
                'created_at' => $dcNotice->created_at?->format('Y-m-d H:i:s'),
                'created_by_user_id' => $dcNotice->created_by_user_id,
                'updated_at' => $dcNotice->updated_at?->format('Y-m-d H:i:s'),
                'updated_by_user_id' => $dcNotice->updated_by_user_id,
                'account_no' => $account?->account_no ?? null,
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

        } catch (Exception $e) {
            Log::error('DC Notice show error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'DC Notice record not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function store(Request $request)
    {
        try {
            $validated = $request->validate([
                'account_id' => 'required|integer',
                'invoice_id' => 'nullable|integer',
                'dc_notice_date' => 'required|date',
                'print_link' => 'nullable|string|max:255',
            ]);

            $authData = $request->user();
            $validated['created_by_user_id'] = $authData?->id;
            
            if ($authData && $authData->organization_id) {
                $validated['organization_id'] = $authData->organization_id;
            }

            $dcNotice = DCNotice::create($validated);

            event(new DCNoticeUpdated(['action' => 'created', 'dc_notice_id' => $dcNotice->id]));

            return response()->json([
                'success' => true,
                'message' => 'DC Notice record created successfully',
                'data' => $dcNotice
            ], 201);

        } catch (Exception $e) {
            Log::error('DC Notice create error', [
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create DC Notice record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $dcNotice = DCNotice::findOrFail($id);

            $validated = $request->validate([
                'account_id' => 'sometimes|required|integer',
                'invoice_id' => 'nullable|integer',
                'dc_notice_date' => 'sometimes|required|date',
                'print_link' => 'nullable|string|max:255',
            ]);

            $authData = $request->user();
            $validated['updated_by_user_id'] = $authData?->id;

            $organizationId = $authData ? $authData->organization_id : null;
            $roleId = $authData ? $authData->role_id : null;
            $isSuperAdmin = !$authData || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $dcNotice->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to update this DC Notice record'
                ], 403);
            }

            $dcNotice->update($validated);

            event(new DCNoticeUpdated(['action' => 'updated', 'dc_notice_id' => $dcNotice->id]));

            return response()->json([
                'success' => true,
                'message' => 'DC Notice record updated successfully',
                'data' => $dcNotice
            ]);

        } catch (Exception $e) {
            Log::error('DC Notice update error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update DC Notice record',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $dcNotice = DCNotice::findOrFail($id);

            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            if (!$isSuperAdmin && $organizationId && $dcNotice->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized to delete this DC Notice record'
                ], 403);
            }

            $dcNotice->delete();

            event(new DCNoticeUpdated(['action' => 'deleted', 'dc_notice_id' => $id]));

            return response()->json([
                'success' => true,
                'message' => 'DC Notice record deleted successfully'
            ]);

        } catch (Exception $e) {
            Log::error('DC Notice delete error', [
                'id' => $id,
                'message' => $e->getMessage()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete DC Notice record',
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

            $totalQuery = DCNotice::query();
            $thisMonthQuery = DCNotice::whereMonth('dc_notice_date', now()->month)
                ->whereYear('dc_notice_date', now()->year);

            if (!$isSuperAdmin && $organizationId) {
                $totalQuery->where('organization_id', $organizationId);
                $thisMonthQuery->where('organization_id', $organizationId);
            }

            $total = $totalQuery->count();
            $thisMonth = $thisMonthQuery->count();

            return response()->json([
                'success' => true,
                'data' => [
                    'total_notices' => $total,
                    'this_month' => $thisMonth,
                ]
            ]);

        } catch (Exception $e) {
            Log::error('DC Notice statistics error', [
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



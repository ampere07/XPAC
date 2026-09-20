<?php

namespace App\Http\Controllers;

use App\Models\StatementOfAccount;
use App\Models\Invoice;
use App\Models\BillingAccount;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * Billing Records Controller
 * 
 * Handles direct fetching of SOA and Invoice records from database tables
 * Separate from BillingGenerationController to avoid conflicts
 */
class BillingRecordsController extends Controller
{
    /**
     * Get all Statement of Account records
     * Fetches directly from statement_of_accounts table
     */
    public function getSOARecords(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Pagination parameters - smaller default for faster loading
            $perPage = $request->get('per_page', 50); // Reduced to 50 for faster response
            $page = $request->get('page', 1);
            $fastMode = $request->get('fast', false); // Fast mode: skip customer data loading
            
            // Build base query - use simple query for fast mode, joins for normal mode
            if ($fastMode) {
                // Fast mode: Direct query without joins
                $query = StatementOfAccount::query();
            } else {
                // Normal mode: Include joins for customer data
                $query = StatementOfAccount::query()
                    ->select('statement_of_accounts.*')
                    ->leftJoin('billing_accounts', 'statement_of_accounts.account_no', '=', 'billing_accounts.account_no')
                    ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id');
            }

            if (!$isSuperAdmin && $organizationId) {
                $query->where($fastMode ? 'organization_id' : 'statement_of_accounts.organization_id', $organizationId);
            }
            
            // Filter by account number
            if ($request->has('account_no')) {
                $query->where($fastMode ? 'account_no' : 'statement_of_accounts.account_no', $request->account_no);
            }
            
            if ($request->has('account_id')) {
                $query->where($fastMode ? 'account_no' : 'statement_of_accounts.account_no', $request->account_id);
            }
            
            // Filter by date range
            if ($request->has('date_from') && $request->has('date_to')) {
                $query->whereBetween($fastMode ? 'statement_date' : 'statement_of_accounts.statement_date', [
                    $request->date_from,
                    $request->date_to
                ]);
            }
            
            // Filter by recently updated
            if ($request->has('updated_since')) {
                $query->where($fastMode ? 'updated_at' : 'statement_of_accounts.updated_at', '>=', date('Y-m-d H:i:s', strtotime($request->updated_since)));
            }

            
            // Calculate total count based on filtered query
            $totalCount = (clone $query)->count();

            // Fetch one extra record to check if there are more pages (more efficient than COUNT)
            $statements = $query
                ->orderBy('statement_of_accounts.statement_date', 'desc')
                ->skip(($page - 1) * $perPage)
                ->take($perPage + 1) // Fetch one extra
                ->get();
            
            // Check if there are more pages
            $hasMore = $statements->count() > $perPage;
            
            // Remove the extra record if it exists
            if ($hasMore) {
                $statements = $statements->slice(0, $perPage);
            }
            
            // Fast mode: Return data immediately without customer details
            if ($fastMode) {
                $statementsData = $statements->map(function($statement) {
                    return $statement->toArray();
                });
                
                Log::info('Fetched SOA records (fast mode)', [
                    'count' => $statementsData->count(),
                    'page' => $page,
                    'has_more' => $hasMore
                ]);
                
                return response()->json([
                    'success' => true,
                    'data' => $statementsData->values(),
                    'count' => $statementsData->count(),
                    'total' => $totalCount, // Use filtered count
                    'pagination' => [
                        'current_page' => (int)$page,
                        'per_page' => (int)$perPage,
                        'has_more' => $hasMore
                    ],
                    'fast_mode' => true
                ]);
            }
            
            // Normal mode: Fetch all related data in bulk to avoid N+1 queries
            $accountNos = $statements->pluck('account_no')->unique()->toArray();
            
            // Bulk fetch accounts with customers
            $accounts = BillingAccount::whereIn('account_no', $accountNos)
                ->with('customer')
                ->get()
                ->keyBy('account_no');
            
            // Convert to array and attach account and customer data
            $statementsData = $statements->map(function($statement) use ($accounts) {
                $data = $statement->toArray();
                $account = $accounts->get($statement->account_no);
                
                if ($account) {
                    $data['account'] = [
                        'account_no' => $account->account_no,
                        'date_installed' => $account->date_installed,
                        'billing_day' => $account->billing_day,
                    ];
                    
                    if ($account->customer) {
                        $data['account']['customer'] = [
                            'full_name' => $account->customer->full_name ?? '',
                            'contact_number_primary' => $account->customer->contact_number_primary ?? '',
                            'email_address' => $account->customer->email_address ?? '',
                            'address' => $account->customer->address ?? '',
                            'desired_plan' => $account->customer->desired_plan ?? '',
                            'barangay' => $account->customer->barangay ?? '',
                            'city' => $account->customer->city ?? '',
                            'region' => $account->customer->region ?? '',
                        ];
                    }
                }
                
                return $data;
            });
            
            Log::info('Fetched SOA records successfully', [
                'count' => $statementsData->count(),
                'page' => $page,
                'has_more' => $hasMore
            ]);
            
            return response()->json([
                'success' => true,
                'data' => $statementsData->values(), // Reset array keys
                'count' => $statementsData->count(),
                'total' => $totalCount, // Use filtered count
                'pagination' => [
                    'current_page' => (int)$page,
                    'per_page' => (int)$perPage,
                    'has_more' => $hasMore
                ],
                'fast_mode' => false
            ]);
            
        } catch (\Exception $e) {
            Log::error('Error fetching SOA records: ' . $e->getMessage());
            Log::error('Stack trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch SOA records',
                'error' => $e->getMessage()
            ], 500);
        }
    }
    
    /**
     * Get all Invoice records
     * Fetches directly from invoices table
     */
    public function getInvoiceRecords(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Pagination parameters - smaller default for faster loading
            $perPage = $request->get('per_page', 50); // Reduced to 50 for faster response
            $page = $request->get('page', 1);
            $fastMode = $request->get('fast', false); // Fast mode: skip customer data loading
            
            // Base query - direct fetch for both modes since we load relations manually
            $query = Invoice::query()
                ->select('invoices.*')
                ->leftJoin('billing_accounts', 'invoices.account_no', '=', 'billing_accounts.account_no')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id');

            if (!$isSuperAdmin && $organizationId) {
                $query->where('invoices.organization_id', $organizationId);
            }
            
            // Filter by account number
            if ($request->has('account_no')) {
                $query->where('account_no', $request->account_no);
            }
            
            if ($request->has('account_id')) {
                $query->where('account_no', $request->account_id);
            }
            
            // Filter by status
            if ($request->has('status')) {
                $query->where('status', $request->status);
            }
            
            // Filter by date range
            if ($request->has('date_from') && $request->has('date_to')) {
                $query->whereBetween('invoice_date', [
                    $request->date_from,
                    $request->date_to
                ]);
            }
            
            // Calculate total count based on filtered query
            $totalCount = (clone $query)->count();

            // Fetch one extra record to check if there are more pages (more efficient than COUNT)
            $invoices = $query
                ->orderBy('invoice_date', 'desc')
                ->skip(($page - 1) * $perPage)
                ->take($perPage + 1) // Fetch one extra
                ->get();
            
            // Check if there are more pages
            $hasMore = $invoices->count() > $perPage;
            
            // Remove the extra record if it exists
            if ($hasMore) {
                $invoices = $invoices->slice(0, $perPage);
            }
            
            // Fast mode: Return data immediately without customer details
            if ($fastMode) {
                $invoicesData = $invoices->map(function($invoice) {
                    return $invoice->toArray();
                });
                
                Log::info('Fetched invoice records (fast mode)', [
                    'count' => $invoicesData->count(),
                    'page' => $page,
                    'has_more' => $hasMore
                ]);
                
                return response()->json([
                    'success' => true,
                    'data' => $invoicesData->values(),
                    'count' => $invoicesData->count(),
                    'total' => $totalCount, // Use filtered count
                    'pagination' => [
                        'current_page' => (int)$page,
                        'per_page' => (int)$perPage,
                        'has_more' => $hasMore
                    ],
                    'fast_mode' => true
                ]);
            }
            
            // Normal mode: Fetch all related data in bulk to avoid N+1 queries
            $accountNos = $invoices->pluck('account_no')->unique()->toArray();
            
            // Bulk fetch accounts with customers
            $accounts = BillingAccount::whereIn('account_no', $accountNos)
                ->with('customer')
                ->get()
                ->keyBy('account_no');
            
            // Convert to array and attach account and customer data
            $invoicesData = $invoices->map(function($invoice) use ($accounts) {
                $data = $invoice->toArray();
                $account = $accounts->get($invoice->account_no);
                
                if ($account) {
                    $data['account'] = [
                        'account_no' => $account->account_no,
                        'date_installed' => $account->date_installed,
                        'billing_day' => $account->billing_day,
                    ];
                    
                    if ($account->customer) {
                        $data['account']['customer'] = [
                            'full_name' => $account->customer->full_name ?? '',
                            'contact_number_primary' => $account->customer->contact_number_primary ?? '',
                            'email_address' => $account->customer->email_address ?? '',
                            'address' => $account->customer->address ?? '',
                            'desired_plan' => $account->customer->desired_plan ?? '',
                            'barangay' => $account->customer->barangay ?? '',
                            'city' => $account->customer->city ?? '',
                            'region' => $account->customer->region ?? '',
                        ];
                    }
                }
                
                return $data;
            });
            
            Log::info('Fetched invoice records successfully', [
                'count' => $invoicesData->count(),
                'page' => $page,
                'has_more' => $hasMore
            ]);
            
            return response()->json([
                'success' => true,
                'data' => $invoicesData->values(), // Reset array keys
                'count' => $invoicesData->count(),
                'total' => $totalCount, // Use filtered count
                'pagination' => [
                    'current_page' => (int)$page,
                    'per_page' => (int)$perPage,
                    'has_more' => $hasMore
                ],
                'fast_mode' => false
            ]);
            
        } catch (\Exception $e) {
            Log::error('Error fetching invoice records: ' . $e->getMessage());
            Log::error('Stack trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch invoice records',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}



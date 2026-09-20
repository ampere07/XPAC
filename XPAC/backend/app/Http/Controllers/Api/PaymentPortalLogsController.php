<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Exception;

class PaymentPortalLogsController extends Controller
{
    /**
     * Get all payment portal logs with account details
     */
    public function index(Request $request)
    {
        try {
            $currentUser = auth()->user();
            $query = DB::table('payment_portal_logs')
                ->leftJoin('billing_accounts', 'payment_portal_logs.account_id', '=', 'billing_accounts.id')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->select(
                    'payment_portal_logs.*',
                    'billing_accounts.account_no as accountNo',
                    'billing_accounts.account_balance as accountBalance',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as fullName"),
                    'customers.contact_number_primary as contactNo',
                    'customers.email_address as emailAddress',
                    'customers.address',
                    'customers.city',
                    'customers.barangay',
                    'customers.desired_plan as plan',
                    'payment_portal_logs.organization_id'
                )
                ->orderBy('payment_portal_logs.date_time', 'desc');

            // Apply organization filter
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('payment_portal_logs.organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('payment_portal_logs.organization_id');
                }
            }
            
            if ($request->has('updated_since')) {
                $query->where('payment_portal_logs.updated_at', '>', $request->input('updated_since'));
            }

            // Optional filters
            if ($request->has('status')) {
                $query->where('payment_portal_logs.status', $request->input('status'));
            }

            if ($request->has('account_no')) {
                $query->where('billing_accounts.account_no', $request->input('account_no'));
            }

            if ($request->has('city')) {
                $query->where('customers.city', $request->input('city'));
            }

            if ($request->has('search')) {
                $searchTerm = $request->input('search');
                $query->where(function($q) use ($searchTerm) {
                    $q->where('payment_portal_logs.reference_no', 'LIKE', "%{$searchTerm}%")
                      ->orWhere('billing_accounts.account_no', 'LIKE', "%{$searchTerm}%")
                      ->orWhere(DB::raw("CONCAT(customers.first_name, ' ', customers.last_name)"), 'LIKE', "%{$searchTerm}%");
                });
            }

            // Get total count before pagination
            $total = $query->count();

            // Apply pagination
            $limit = $request->input('limit', 100);
            $offset = $request->input('offset', 0);
            
            $records = $query->limit($limit)->offset($offset)->get();

            // Transform the data to match frontend expectations
            $transformedRecords = $records->map(function($record) {
                return [
                    'id' => $record->id,
                    'reference_no' => $record->reference_no,
                    'account_id' => $record->account_id,
                    'total_amount' => floatval($record->total_amount),
                    'date_time' => $record->date_time,
                    'checkout_id' => $record->checkout_id,
                    'status' => $record->status,
                    'transaction_status' => $record->transaction_status,
                    'ewallet_type' => $record->ewallet_type,
                    'payment_channel' => $record->payment_channel,
                    'type' => $record->type,
                    'payment_url' => $record->payment_url,
                    'json_payload' => $record->json_payload,
                    'callback_payload' => $record->callback_payload,
                    'account_balance_before' => floatval($record->account_balance_before ?? 0),
                    'updated_at' => $record->updated_at,
                    // Account details
                    'accountNo' => $record->accountNo,
                    'fullName' => $record->fullName,
                    'contactNo' => $record->contactNo,
                    'emailAddress' => $record->emailAddress,
                    'accountBalance' => floatval($record->accountBalance ?? 0),
                    'address' => $record->address,
                    'city' => $record->city,
                    'barangay' => $record->barangay,
                    'plan' => $record->plan,
                    'provider' => $record->payment_channel ?? 'Xendit',
                ];
            });

            return response()->json([
                'status' => 'success',
                'data' => $transformedRecords,
                'total' => $total,
                'count' => count($transformedRecords)
            ]);

        } catch (Exception $e) {
            Log::error('Failed to fetch payment portal logs', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to fetch payment portal logs'
            ], 500);
        }
    }

    /**
     * Get a single payment portal log by ID
     */
    public function show($id)
    {
        try {
            $currentUser = auth()->user();
            $record = DB::table('payment_portal_logs')
                ->leftJoin('billing_accounts', 'payment_portal_logs.account_id', '=', 'billing_accounts.id')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('payment_portal_logs.id', $id)
                ->select(
                    'payment_portal_logs.*',
                    'billing_accounts.account_no as accountNo',
                    'billing_accounts.account_balance as accountBalance',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as fullName"),
                    'customers.contact_number_primary as contactNo',
                    'customers.email_address as emailAddress',
                    'customers.address',
                    'customers.city',
                    'customers.barangay',
                    'customers.desired_plan as plan',
                    'payment_portal_logs.organization_id'
                );

            // Apply organization filter
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $record->where('payment_portal_logs.organization_id', $currentUser->organization_id);
                } else {
                    $record->whereNull('payment_portal_logs.organization_id');
                }
            }

            $record = $record->first();

            if (!$record) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Payment portal log not found'
                ], 404);
            }

            $transformedRecord = [
                'id' => $record->id,
                'reference_no' => $record->reference_no,
                'account_id' => $record->account_id,
                'total_amount' => floatval($record->total_amount),
                'date_time' => $record->date_time,
                'checkout_id' => $record->checkout_id,
                'status' => $record->status,
                'transaction_status' => $record->transaction_status,
                'ewallet_type' => $record->ewallet_type,
                'payment_channel' => $record->payment_channel,
                'type' => $record->type,
                'payment_url' => $record->payment_url,
                'json_payload' => $record->json_payload,
                'callback_payload' => $record->callback_payload,
                'account_balance_before' => floatval($record->account_balance_before ?? 0),
                'updated_at' => $record->updated_at,
                // Account details
                'accountNo' => $record->accountNo,
                'fullName' => $record->fullName,
                'contactNo' => $record->contactNo,
                'emailAddress' => $record->emailAddress,
                'accountBalance' => floatval($record->accountBalance ?? 0),
                'address' => $record->address,
                'city' => $record->city,
                'barangay' => $record->barangay,
                'plan' => $record->plan,
                'provider' => $record->payment_channel ?? 'Xendit',
            ];

            return response()->json([
                'status' => 'success',
                'data' => $transformedRecord
            ]);

        } catch (Exception $e) {
            Log::error('Failed to fetch payment portal log', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to fetch payment portal log'
            ], 500);
        }
    }

    /**
     * Get payment portal logs by account number
     */
    public function getByAccountNo($accountNo)
    {
        try {
            $records = DB::table('payment_portal_logs')
                ->leftJoin('billing_accounts', 'payment_portal_logs.account_id', '=', 'billing_accounts.id')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->where('billing_accounts.account_no', $accountNo)
                ->select(
                    'payment_portal_logs.*',
                    'billing_accounts.account_no as accountNo',
                    'billing_accounts.account_balance as accountBalance',
                    DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as fullName"),
                    'customers.contact_number_primary as contactNo'
                )
                ->orderBy('payment_portal_logs.date_time', 'desc')
                ->get();

            return response()->json([
                'status' => 'success',
                'data' => $records
            ]);

        } catch (Exception $e) {
            Log::error('Failed to fetch payment portal logs by account', [
                'account_no' => $accountNo,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Failed to fetch payment portal logs'
            ], 500);
        }
    }
}


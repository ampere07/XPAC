<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class DataLogsController extends Controller
{
    public function index(Request $request)
    {
        try {
            // Base query for Details Update Logs
            $detailsQuery = DB::table('details_update_logs')
                ->leftJoin('users as cu', 'details_update_logs.created_by_user_id', '=', 'cu.id')
                ->leftJoin('users as uu', 'details_update_logs.updated_by_user_id', '=', 'uu.id')
                ->select([
                    DB::raw("'Details Update Log' as log_type"),
                    'details_update_logs.id',
                    'details_update_logs.old_details',
                    'details_update_logs.new_details',
                    'details_update_logs.created_at',
                    'details_update_logs.updated_at',
                    'cu.email_address as created_by',
                    'uu.email_address as updated_by',
                ]);

            // Base query for Audit Trail Logs
            $auditQuery = DB::table('audit_trail_logs')
                ->select([
                    DB::raw("'Audit Trail Log' as log_type"),
                    'audit_trail_logs.id',
                    'audit_trail_logs.old_details',
                    'audit_trail_logs.new_details',
                    'audit_trail_logs.created_at',
                    'audit_trail_logs.updated_at',
                    'audit_trail_logs.created_by_user as created_by',
                    'audit_trail_logs.updated_by_user as updated_by',
                ]);

            // Combine based on log_type filter
            $unionQuery = null;
            if ($request->has('log_type') && !empty($request->log_type)) {
                if ($request->log_type === 'details_update') {
                    $unionQuery = $detailsQuery;
                } else if ($request->log_type === 'audit_trail') {
                    $unionQuery = $auditQuery;
                } else {
                    $unionQuery = $detailsQuery->unionAll($auditQuery);
                }
            } else {
                $unionQuery = $detailsQuery->unionAll($auditQuery);
            }

            // Wrap query in a subquery to support combined sorting, searching, and filtering
            $query = DB::table(DB::raw("({$unionQuery->toSql()}) as combined"))
                ->mergeBindings($unionQuery);

            if ($request->has('search') && !empty($request->search)) {
                $search = $request->search;
                $query->where(function($q) use ($search) {
                    $q->where('combined.old_details', 'like', "%{$search}%")
                      ->orWhere('combined.new_details', 'like', "%{$search}%")
                      ->orWhere('combined.created_by', 'like', "%{$search}%")
                      ->orWhere('combined.updated_by', 'like', "%{$search}%")
                      ->orWhere('combined.id', '=', $search);
                });
            }

            // Sort by updated_at descending, fallback to created_at
            $query->orderBy('combined.updated_at', 'desc')
                  ->orderBy('combined.created_at', 'desc');

            // Limit to avoid high latency or out-of-memory errors
            $limit = $request->has('limit') ? intval($request->limit) : 250;
            $records = $query->limit($limit)->get();

            $data = $records->map(function ($record) {
                // Ensure proper fallbacks for user emails
                $createdBy = trim($record->created_by ?? '');
                if (empty($createdBy)) {
                    $createdBy = 'System/N/A';
                }

                $updatedBy = trim($record->updated_by ?? '');
                if (empty($updatedBy)) {
                    $updatedBy = 'System/N/A';
                }

                // Format dates to Manila timezone matching frontend expectation
                $createdAtFormatted = $record->created_at 
                    ? Carbon::parse($record->created_at)->setTimezone('Asia/Manila')->format('m/d/Y h:i A') 
                    : '';

                $updatedAtFormatted = $record->updated_at 
                    ? Carbon::parse($record->updated_at)->setTimezone('Asia/Manila')->format('m/d/Y h:i A') 
                    : '';

                // Try to find the type from JSON old_details / new_details
                $oldData = json_decode($record->old_details, true) ?? [];
                $newData = json_decode($record->new_details, true) ?? [];

                $rawType = $oldData['type'] ?? $newData['type'] ?? null;
                if (empty($rawType)) {
                    $rawType = $oldData['data']['type'] ?? $newData['data']['type'] ?? null;
                }

                 // Map of raw types to clean human-readable log types
                $typeMap = [
                    'applications' => 'Application',
                    'application' => 'Application',
                    'service_orders' => 'Service Order',
                    'service_order' => 'Service Order',
                    'serviceorders' => 'Service Order',
                    'serviceorder' => 'Service Order',
                    'job_orders' => 'Job Order',
                    'job_order' => 'Job Order',
                    'joborders' => 'Job Order',
                    'joborder' => 'Job Order',
                    'customer_details' => 'Customer Details',
                    'billing_details' => 'Billing Details',
                    'technical_details' => 'Technical Details',
                    'billing_accounts' => 'Billing Account',
                    'billing_account' => 'Billing Account',
                    'customers' => 'Customer',
                    'customer' => 'Customer',
                    'users' => 'User',
                    'user' => 'User',
                    'transactions' => 'Transaction',
                    'transaction' => 'Transaction',
                    'invoices' => 'Invoice',
                    'invoice' => 'Invoice',
                    'statement_of_accounts' => 'Statement of Account',
                    'statement_of_account' => 'Statement of Account',
                ];

                $cleanType = null;
                if (!empty($rawType)) {
                    $cleanType = $typeMap[strtolower($rawType)] ?? null;
                    if (!$cleanType) {
                        $cleanType = ucwords(str_replace('_', ' ', $rawType));
                    }
                }

                if (empty($cleanType)) {
                    $cleanType = ($record->log_type === 'Details Update Log') ? 'Account Details' : 'System Activity';
                }

                return [
                    'id' => (string)$record->id,
                    'log_type' => $cleanType,
                    'old_details' => $record->old_details,
                    'new_details' => $record->new_details,
                    'created_at' => $createdAtFormatted,
                    'created_by' => $createdBy,
                    'updated_at' => $updatedAtFormatted,
                    'updated_by' => $updatedBy,
                ];
            });

            return response()->json(['status' => 'success', 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }
}

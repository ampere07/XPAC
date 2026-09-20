<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class ReconnectionLogsController extends Controller
{
    public function index(Request $request)
    {
        try {
            $currentUser = auth()->user();
            $query = DB::table('reconnection_logs')
                ->leftJoin('billing_accounts', 'reconnection_logs.account_id', '=', 'billing_accounts.id')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('plan_list', 'reconnection_logs.plan_id', '=', 'plan_list.id')
                ->select(
                    'reconnection_logs.id',
                    'reconnection_logs.session_id',
                    'reconnection_logs.created_at as reconnection_date',
                    'reconnection_logs.remarks',
                    'reconnection_logs.username',
                    'reconnection_logs.reconnection_fee',
                    'reconnection_logs.created_by_user',
                    'billing_accounts.account_no',
                    'plan_list.plan_name',
                    'customers.first_name',
                    'customers.last_name',
                    'customers.address',
                    'customers.barangay',
                    'customers.city',
                    'customers.contact_number_primary',
                    'customers.email_address',
                    'reconnection_logs.organization_id'
                );

            // Apply organization filter
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('reconnection_logs.organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('reconnection_logs.organization_id');
                }
            }

            if ($request->has('search') && !empty($request->search)) {
                $search = $request->search;
                $query->where(function($q) use ($search) {
                    $q->where('billing_accounts.account_no', 'like', "%{$search}%")
                      ->orWhere('customers.first_name', 'like', "%{$search}%")
                      ->orWhere('customers.last_name', 'like', "%{$search}%")
                      ->orWhere('reconnection_logs.username', 'like', "%{$search}%");
                });
            }

            $query->orderBy('reconnection_logs.created_at', 'desc');

            $records = $query->get();

            $data = $records->map(function ($record) {
                $reconnectedBy = trim($record->created_by_user ?? '');
                if (empty($reconnectedBy)) {
                    $reconnectedBy = 'System/N/A';
                }

                return [
                    'id' => (string)$record->id,
                    'accountNo' => $record->account_no ?? 'N/A',
                    'customerName' => trim(($record->first_name ?? '') . ' ' . ($record->last_name ?? '')),
                    'address' => $record->address ?? '',
                    'contactNumber' => $record->contact_number_primary ?? '',
                    'emailAddress' => $record->email_address ?? '',
                    'plan' => $record->plan_name ?? '',
                    'status' => 'Reconnected',
                    'reconnectionDate' => $record->reconnection_date ? Carbon::parse($record->reconnection_date)->format('n/j/Y g:i:s A') : '',
                    'reconnectionFee' => (float)$record->reconnection_fee,
                    'remarks' => $record->remarks ?? '',
                    'username' => $record->username ?? '',
                    'sessionId' => $record->session_id ?? '',
                    'reconnectedBy' => $reconnectedBy,
                    'provider' => 'SWITCH',
                    'date' => $record->reconnection_date ? Carbon::parse($record->reconnection_date)->format('n/j/Y g:i:s A') : '',
                    'barangay' => $record->barangay ?? '',
                    'city' => $record->city ?? '',
                    'dateFormat' => $record->reconnection_date ? Carbon::parse($record->reconnection_date)->format('n/j/Y') : '',
                ];
            });

            return response()->json(['status' => 'success', 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }
}


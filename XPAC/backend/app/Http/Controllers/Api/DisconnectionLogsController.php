<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class DisconnectionLogsController extends Controller
{
    public function index(Request $request)
    {
        try {
            $currentUser = auth()->user();
            $query = DB::table('disconnected_logs')
                ->leftJoin('billing_accounts', 'disconnected_logs.account_id', '=', 'billing_accounts.id')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('plan_list', 'billing_accounts.plan_id', '=', 'plan_list.id')
                ->select(
                    'disconnected_logs.id',
                    'disconnected_logs.session_id',
                    'disconnected_logs.created_at as disconnection_date',
                    'disconnected_logs.remarks',
                    'disconnected_logs.username',
                    'disconnected_logs.created_by_user',
                    'billing_accounts.account_no',
                    'customers.first_name',
                    'customers.last_name',
                    'customers.address',
                    'customers.barangay',
                    'customers.city',
                    'customers.contact_number_primary',
                    'customers.email_address',
                    'plan_list.plan_name',
                    'disconnected_logs.organization_id'
                );

            // Apply organization filter
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('disconnected_logs.organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('disconnected_logs.organization_id');
                }
            }

            if ($request->has('search') && !empty($request->search)) {
                $search = $request->search;
                $query->where(function($q) use ($search) {
                    $q->where('billing_accounts.account_no', 'like', "%{$search}%")
                      ->orWhere('customers.first_name', 'like', "%{$search}%")
                      ->orWhere('customers.last_name', 'like', "%{$search}%")
                      ->orWhere('disconnected_logs.username', 'like', "%{$search}%");
                });
            }
            
            if ($request->has('city') && $request->city !== 'all') {
                // Future city implementation
            }

            $query->orderBy('disconnected_logs.created_at', 'desc');

            $records = $query->get();

            $data = $records->map(function ($record) {
                $disconnectedBy = trim($record->created_by_user ?? '');
                if (empty($disconnectedBy)) {
                    $disconnectedBy = 'System/N/A';
                }

                return [
                    'id' => (string)$record->id,
                    'accountNo' => $record->account_no ?? 'N/A',
                    'customerName' => trim(($record->first_name ?? '') . ' ' . ($record->last_name ?? '')),
                    'address' => $record->address ?? '',
                    'contactNumber' => $record->contact_number_primary ?? '',
                    'emailAddress' => $record->email_address ?? '',
                    'plan' => $record->plan_name ?? '', 
                    'status' => 'Disconnected',
                    'disconnectionDate' => $record->disconnection_date ? Carbon::parse($record->disconnection_date)->format('n/j/Y g:i:s A') : '',
                    'remarks' => $record->remarks ?? '',
                    'username' => $record->username ?? '',
                    'sessionId' => $record->session_id ?? '',
                    'disconnectedBy' => $disconnectedBy,
                    'provider' => 'SWITCH', 
                    'date' => $record->disconnection_date ? Carbon::parse($record->disconnection_date)->format('n/j/Y g:i:s A') : '',
                    'barangay' => $record->barangay ?? '',
                    'city' => $record->city ?? '',
                    'dateFormat' => $record->disconnection_date ? Carbon::parse($record->disconnection_date)->format('n/j/Y') : '',
                ];
            });

            return response()->json(['status' => 'success', 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }
}


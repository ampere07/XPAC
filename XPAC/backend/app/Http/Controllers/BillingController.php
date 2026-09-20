<?php

namespace App\Http\Controllers;

use App\Models\BillingAccount;
use App\Models\Customer;
use App\Models\TechnicalDetail;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class BillingController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Pagination parameters
            $perPage = $request->get('per_page', 50);
            $page = $request->get('page', 1);

            // Pre-calculate transactions total for 'done' status
            $transactions = \DB::table('transactions')
                ->where('status', 'done')
                ->select('account_no', \DB::raw('SUM(received_payment) as total'))
                ->groupBy('account_no')
                ->get()
                ->pluck('total', 'account_no');

            // Pre-calculate payment portal logs total for 'success' status
            $portalLogs = \DB::table('payment_portal_logs')
                ->where('status', 'success')
                ->select('account_id', \DB::raw('SUM(total_amount) as total'))
                ->groupBy('account_id')
                ->get()
                ->pluck('total', 'account_id');

            $query = BillingAccount::with(['customer.group', 'technicalDetails', 'onlineStatus', 'billingStatus'])
                ->orderBy('created_at', 'desc')
                ->orderBy('id', 'desc');

            if (!$isSuperAdmin && $organizationId) {
                $query->whereHas('customer', function($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId);
                });
            }

            // Support incremental refresh: only return records updated since a given timestamp
            $updatedSince = $request->get('updated_since');
            if ($updatedSince) {
                $query->where(function ($q) use ($updatedSince) {
                    $q->where('billing_accounts.updated_at', '>', $updatedSince)
                      ->orWhereHas('customer', function ($cq) use ($updatedSince) {
                          $cq->where('updated_at', '>', $updatedSince);
                      })
                      ->orWhereHas('technicalDetails', function ($tq) use ($updatedSince) {
                          $tq->where('updated_at', '>', $updatedSince);
                      });
                });

                // No pagination for incremental refresh - return all changed records
                $billingAccounts = $query->get();
                $hasMore = false;
            } else {
                // Fetch one extra record to check if there are more pages
                $billingAccounts = $query
                    ->skip(($page - 1) * $perPage)
                    ->take($perPage + 1)
                    ->get();

                $hasMore = $billingAccounts->count() > $perPage;

                if ($hasMore) {
                    $billingAccounts = $billingAccounts->slice(0, $perPage);
                }
            }

            $billingData = $billingAccounts->map(function ($billingAccount) use ($transactions, $portalLogs) {
                $customer = $billingAccount->customer;
                $technicalDetail = $billingAccount->technicalDetails->first();
                $accNo = $billingAccount->account_no;
                
                // Fix: Use ID for portal logs lookup as it is grouped by account_id
                $totalPaid = ($transactions[$accNo] ?? 0) + ($portalLogs[$billingAccount->id] ?? 0);
                
                return [
                    'id' => $billingAccount->id,
                    'Account_No' => $billingAccount->account_no,
                    'Date_Installed' => $billingAccount->date_installed ? $billingAccount->date_installed->format('Y-m-d') : null,
                    'Billing_Day' => $billingAccount->billing_day == 0 ? 'Every end of month' : $billingAccount->billing_day,
                    'Billing_Status_ID' => $billingAccount->billing_status_id,
                    'Billing_Status_Name' => $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : null,
                    'Account_Balance' => $billingAccount->account_balance,
                    'account_balance' => $billingAccount->account_balance,
                    'Balance_Update_Date' => $billingAccount->balance_update_date ? $billingAccount->balance_update_date->format('Y-m-d H:i:s') : null,
                    
                    'First_Name' => $customer ? $customer->first_name : null,
                    'Middle_Initial' => $customer ? $customer->middle_initial : null,
                    'Last_Name' => $customer ? $customer->last_name : null,
                    'Full_Name' => $customer ? trim(($customer->first_name ?? '') . ' ' . ($customer->middle_initial ?? '') . ' ' . ($customer->last_name ?? '')) : null,
                    'Email_Address' => $customer ? $customer->email_address : null,
                    'Contact_Number' => $customer ? $customer->contact_number_primary : null,
                    'Second_Contact_Number' => $customer ? $customer->contact_number_secondary : null,
                    'Address' => $customer ? $customer->address : null,
                    'Location' => $customer ? $customer->location : null,
                    'Barangay' => $customer ? $customer->barangay : null,
                    'City' => $customer ? $customer->city : null,
                    'Region' => $customer ? $customer->region : null,
                    'Address_Coordinates' => $customer ? $customer->address_coordinates : null,
                    'Housing_Status' => $customer ? $customer->housing_status : null,
                    'Referred_By' => \App\Support\AgentReferral::displayName($customer ? $customer->referred_by : null),
                    'Referred_By_Agent_ID' => \App\Support\AgentReferral::agentIdIfAgent($customer ? $customer->referred_by : null),
                    'Desired_Plan' => $customer ? $customer->desired_plan : null,
                    'house_front_picture_url' => $customer ? $customer->house_front_picture_url : null,
                    'proof_of_billing_url' => $customer ? $customer->proof_of_billing_url : null,
                    'government_valid_id_url' => $customer ? $customer->government_valid_id_url : null,
                    'second_government_valid_id_url' => $customer ? $customer->second_government_valid_id_url : null,
                    'document_attachment_url' => $customer ? $customer->document_attachment_url : null,
                    'other_isp_bill_url' => $customer ? $customer->other_isp_bill_url : null,
                    'Account_No_Customer' => $customer ? $customer->account_no : null,
                    'Group_ID' => $customer ? $customer->group_id : null,
                    
                    'Username' => $technicalDetail ? $technicalDetail->username : null,
                    'Username_Status' => $technicalDetail ? $technicalDetail->username_status : null,
                    'Connection_Type' => $technicalDetail ? $technicalDetail->connection_type : null,
                    'Router_Model' => $technicalDetail ? $technicalDetail->router_model : null,
                    'Router_Modem_SN' => $technicalDetail ? $technicalDetail->router_modem_sn : null,
                    'IP_Address' => $technicalDetail ? $technicalDetail->ip_address : null,
                    'LCP' => $technicalDetail ? $technicalDetail->lcp : null,
                    'NAP' => $technicalDetail ? $technicalDetail->nap : null,
                    'PORT' => $technicalDetail ? $technicalDetail->port : null,
                    'VLAN' => $technicalDetail ? $technicalDetail->vlan : null,
                    'LCPNAP' => $technicalDetail ? $technicalDetail->lcpnap : null,
                    'Usage_Type' => $technicalDetail ? $technicalDetail->usage_type : null,
                    'Referred_By' => \App\Support\AgentReferral::displayName($customer ? $customer->referred_by : null),
                    'Referred_By_Agent_ID' => \App\Support\AgentReferral::agentIdIfAgent($customer ? $customer->referred_by : null),
                    'Second_Contact_Number' => $customer ? $customer->contact_number_secondary : null,
                    'Status' => $billingAccount->billing_status_id == 1 ? 'Active' : ($billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : 'Inactive'),
                    'Modified_By' => $customer ? $customer->updated_by : null,
                    'Modified_Date' => $billingAccount->updated_at ? $billingAccount->updated_at->format('Y-m-d H:i:s') : null,
                    
                    'Plan' => $customer ? $customer->desired_plan : null,
                    'Provider' => $customer ? $customer->group_name : null,
                    'Total_Paid' => $totalPaid,
                    'LCPNAPPORT' => $technicalDetail ? (trim(($technicalDetail->lcpnap ?? '') . ' ' . ($technicalDetail->port ?? ''))) : null,
                    'Online_Session_Status' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_status : null,
                    'session_group' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_group : null,
                    'session_ip' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->ip_address : null,
                    'active_sessions' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->active_sessions : 0,
                ];
            });

            return response()->json([
                'success' => true,
                'data' => $billingData->values(),
                'count' => $billingData->count(),
                'total' => $isSuperAdmin ? BillingAccount::count() : BillingAccount::whereHas('customer', function($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId);
                })->count(),
                'server_time' => now()->toISOString(),
                'pagination' => [
                    'current_page' => (int)$page,
                    'per_page' => (int)$perPage,
                    'has_more' => $hasMore
                ]
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching billing data: ' . $e->getMessage());
            \Log::error('Stack trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch billing data',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $billingAccount = BillingAccount::with(['customer.group', 'technicalDetails', 'onlineStatus', 'billingStatus'])
                ->where(function($q) use ($id) {
                    $q->where('id', $id)
                      ->orWhere('account_no', $id);
                })
                ->firstOrFail();

            if (!$isSuperAdmin && $organizationId && $billingAccount->customer && $billingAccount->customer->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to billing record'
                ], 403);
            }
            $customer = $billingAccount->customer;
            $technicalDetail = $billingAccount->technicalDetails->first();
            
            \Log::info('BillingController - Customer data:', [
                'customer_id' => $customer ? $customer->id : 'null',
                'house_front_picture_url' => $customer ? $customer->house_front_picture_url : 'null',
                'raw_customer' => $customer ? $customer->toArray() : 'null'
            ]);
            
            $accNo = $billingAccount->account_no;
            
            // Calculate total paid from transactions table (status = 'done')
            $transactionsPaid = \DB::table('transactions')
                ->where('account_no', $accNo)
                ->where('status', 'done')
                ->sum('received_payment');
            
            // Calculate total paid from payment_portal_logs table (status = 'success')
            $portalPaid = \DB::table('payment_portal_logs')
                ->where('account_id', $accNo)
                ->where('status', 'success')
                ->sum('total_amount');
            
            $totalPaid = ($transactionsPaid ?? 0) + ($portalPaid ?? 0);
            
            $data = [
                'id' => $billingAccount->id,
                'Account_No' => $billingAccount->account_no,
                'Date_Installed' => $billingAccount->date_installed ? $billingAccount->date_installed->format('Y-m-d') : null,
                'Billing_Day' => $billingAccount->billing_day == 0 ? 'Every end of month' : $billingAccount->billing_day,
                'Billing_Status_ID' => $billingAccount->billing_status_id,
                'Billing_Status_Name' => $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : null,
                'Account_Balance' => $billingAccount->account_balance,
                'account_balance' => $billingAccount->account_balance,
                'Balance_Update_Date' => $billingAccount->balance_update_date ? $billingAccount->balance_update_date->format('Y-m-d H:i:s') : null,
                
                'First_Name' => $customer ? $customer->first_name : null,
                'Middle_Initial' => $customer ? $customer->middle_initial : null,
                'Last_Name' => $customer ? $customer->last_name : null,
                'Full_Name' => $customer ? trim(($customer->first_name ?? '') . ' ' . ($customer->middle_initial ?? '') . ' ' . ($customer->last_name ?? '')) : null,
                'Email_Address' => $customer ? $customer->email_address : null,
                'Contact_Number' => $customer ? $customer->contact_number_primary : null,
                'Second_Contact_Number' => $customer ? $customer->contact_number_secondary : null,
                'Address' => $customer ? $customer->address : null,
                'Location' => $customer ? $customer->location : null,
                'Barangay' => $customer ? $customer->barangay : null,
                'City' => $customer ? $customer->city : null,
                'Region' => $customer ? $customer->region : null,
                'Address_Coordinates' => $customer ? $customer->address_coordinates : null,
                'Housing_Status' => $customer ? $customer->housing_status : null,
                'Referred_By' => \App\Support\AgentReferral::displayName($customer ? $customer->referred_by : null),
                'Referred_By_Agent_ID' => \App\Support\AgentReferral::agentIdIfAgent($customer ? $customer->referred_by : null),
                'Desired_Plan' => $customer ? $customer->desired_plan : null,
                'house_front_picture_url' => $customer ? $customer->house_front_picture_url : null,
                'proof_of_billing_url' => $customer ? $customer->proof_of_billing_url : null,
                'government_valid_id_url' => $customer ? $customer->government_valid_id_url : null,
                'second_government_valid_id_url' => $customer ? $customer->second_government_valid_id_url : null,
                'document_attachment_url' => $customer ? $customer->document_attachment_url : null,
                'other_isp_bill_url' => $customer ? $customer->other_isp_bill_url : null,
                'Account_No_Customer' => $customer ? $customer->account_no : null,
                'Group_ID' => $customer ? $customer->group_id : null,
                
                'Username' => $technicalDetail ? $technicalDetail->username : null,
                'Username_Status' => $technicalDetail ? $technicalDetail->username_status : null,
                'Connection_Type' => $technicalDetail ? $technicalDetail->connection_type : null,
                'Router_Model' => $technicalDetail ? $technicalDetail->router_model : null,
                'Router_Modem_SN' => $technicalDetail ? $technicalDetail->router_modem_sn : null,
                'IP_Address' => $technicalDetail ? $technicalDetail->ip_address : null,
                'LCP' => $technicalDetail ? $technicalDetail->lcp : null,
                'NAP' => $technicalDetail ? $technicalDetail->nap : null,
                'PORT' => $technicalDetail ? $technicalDetail->port : null,
                'VLAN' => $technicalDetail ? $technicalDetail->vlan : null,
                'LCPNAP' => $technicalDetail ? $technicalDetail->lcpnap : null,
                'Usage_Type' => $technicalDetail ? $technicalDetail->usage_type : null,
                'Referred_By' => \App\Support\AgentReferral::displayName($customer ? $customer->referred_by : null),
                'Referred_By_Agent_ID' => \App\Support\AgentReferral::agentIdIfAgent($customer ? $customer->referred_by : null),
                'Second_Contact_Number' => $customer ? $customer->contact_number_secondary : null,
                'Status' => $billingAccount->billing_status_id == 1 ? 'Active' : ($billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : 'Inactive'),
                'Modified_By' => $customer ? $customer->updated_by : null,
                'Modified_Date' => $billingAccount->updated_at ? $billingAccount->updated_at->format('Y-m-d H:i:s') : null,
                
                'Plan' => $customer ? $customer->desired_plan : null,
                'Provider' => $customer ? $customer->group_name : null,
                'Total_Paid' => $totalPaid,
                'LCPNAPPORT' => $technicalDetail ? (trim(($technicalDetail->lcpnap ?? '') . ' ' . ($technicalDetail->port ?? ''))) : null,
                'Online_Session_Status' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_status : null,
                'session_group' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_group : null,
                'session_ip' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->ip_address : null,
                'active_sessions' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->active_sessions : 0,
            ];

            return response()->json([
                'success' => true,
                'data' => $data
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching billing record: ' . $e->getMessage());
            
            return response()->json([
                'success' => false,
                'message' => 'Billing record not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    /**
     * Lightweight endpoint to check if any records have changed since a given timestamp.
     * Used for polling to detect changes from any source (web, mobile app, etc.)
     */
    public function checkUpdates(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $since = $request->get('since');

            if (!$since) {
                return response()->json(['has_updates' => false, 'count' => 0]);
            }

            $query = BillingAccount::where(function($q) use ($since) {
                $q->where('updated_at', '>=', $since)
                  ->orWhereHas('customer', function ($cq) use ($since) {
                      $cq->where('updated_at', '>=', $since);
                  });
            });

            if (!$isSuperAdmin && $organizationId) {
                $query->whereHas('customer', function($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId);
                });
            }

            $count = $query->count();

            return response()->json([
                'has_updates' => $count > 0,
                'count' => $count,
                'server_time' => now()->toISOString()
            ]);
        } catch (\Exception $e) {
            return response()->json(['has_updates' => false, 'count' => 0]);
        }
    }
}




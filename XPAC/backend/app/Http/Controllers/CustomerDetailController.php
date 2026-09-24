<?php

namespace App\Http\Controllers;

use App\Models\BillingAccount;
use App\Models\Customer;
use App\Models\TechnicalDetail;
use App\Models\LCPNAPLocation;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class CustomerDetailController extends Controller
{
    public function show($accountNo): JsonResponse
    {
        try {
            \Log::info('CustomerDetailController - Fetching details for account:', ['account_no' => $accountNo]);
            
            $billingAccount = BillingAccount::where('account_no', $accountNo)
                ->with(['customer', 'technicalDetails', 'onlineStatus', 'billingStatus'])
                ->first();
            
            if (!$billingAccount) {
                \Log::warning('CustomerDetailController - Billing account not found:', ['account_no' => $accountNo]);
                return response()->json([
                    'success' => false,
                    'message' => 'Billing account not found'
                ], 404);
            }
            
            $customer = $billingAccount->customer;
            $technicalDetail = $billingAccount->technicalDetails->first();

            // Fetch LCP and NAP from LCPNAPLocation table based on lcpnap name
            $lcpNapLocation = null;
            if ($technicalDetail && $technicalDetail->lcpnap) {
                $lcpNapLocation = LCPNAPLocation::where('lcpnap_name', $technicalDetail->lcpnap)->first();
            }

            // PPPoE credentials come from technical_details, the account's current-state record.
            // Accounts installed before pppoe_password was added there were not backfilled, so fall
            // back to the job order the technician set at install — matched on account_id (the
            // structural link) rather than on the username string, and newest-first so a
            // re-install wins.
            $pppoeCredentials = ['username' => null, 'password' => null];
            if ($technicalDetail) {
                $pppoeCredentials = [
                    'username' => $technicalDetail->username,
                    'password' => $technicalDetail->pppoe_password,
                ];

                if ($pppoeCredentials['password'] === null || $pppoeCredentials['password'] === '') {
                    $jobOrderCredentials = \App\Models\JobOrder::where('account_id', $billingAccount->id)
                        ->whereNotNull('pppoe_password')
                        ->where('pppoe_password', '!=', '')
                        ->orderByDesc('id')
                        ->first(['pppoe_username', 'pppoe_password']);

                    if ($jobOrderCredentials) {
                        $pppoeCredentials = [
                            'username' => $pppoeCredentials['username'] ?: $jobOrderCredentials->pppoe_username,
                            'password' => $jobOrderCredentials->pppoe_password,
                        ];
                    }
                }
            }
            
            \Log::info('CustomerDetailController - Customer found:', [
                'customer_id' => $customer ? $customer->id : null,
                'house_front_picture_url' => $customer ? $customer->house_front_picture_url : null,
                'all_customer_fields' => $customer ? $customer->toArray() : null
            ]);
            
            if (!$customer) {
                return response()->json([
                    'success' => false,
                    'message' => 'Customer not found for billing account'
                ], 404);
            }
            
            // Calculate total paid from transactions table (status = 'done')
            $transactionsPaid = \DB::table('transactions')
                ->where('account_no', $accountNo)
                ->where('status', 'done')
                ->sum('received_payment');
            
            // Calculate total paid from payment_portal_logs table (status = 'success')
            $portalPaid = \DB::table('payment_portal_logs')
                ->where('account_id', $billingAccount->id)
                ->where('status', 'success')
                ->sum('total_amount');
            
            // Total paid is the sum of both
            $totalPaid = ($transactionsPaid ?? 0) + ($portalPaid ?? 0);
            
            \Log::info('CustomerDetailController - Payment calculation:', [
                'account_no' => $accountNo,
                'billing_account_id' => $billingAccount->id,
                'transactions_paid' => $transactionsPaid,
                'portal_paid' => $portalPaid,
                'total_paid' => $totalPaid
            ]);
            
            $data = [
                'id' => $customer->id,
                'firstName' => $customer->first_name,
                'middleInitial' => $customer->middle_initial,
                'lastName' => $customer->last_name,
                'fullName' => trim(($customer->first_name ?? '') . ' ' . ($customer->middle_initial ?? '') . ' ' . ($customer->last_name ?? '')),
                'emailAddress' => $customer->email_address,
                'contactNumberPrimary' => $customer->contact_number_primary,
                'contactNumberSecondary' => $customer->contact_number_secondary,
                'address' => $customer->address,
                'location' => $customer->location,
                'barangay' => $customer->barangay,
                'city' => $customer->city,
                'region' => $customer->region,
                'addressCoordinates' => $customer->address_coordinates,
                'housingStatus' => $customer->housing_status,
                // Shown as a name; the id travels beside it so an edit form can
                // write the same referral back instead of turning it into a name.
                'referredBy' => \App\Support\AgentReferral::displayName($customer->referred_by),
                'referredByAgentId' => \App\Support\AgentReferral::agentIdIfAgent($customer->referred_by),
                'desiredPlan' => $customer->desired_plan,
                'houseFrontPictureUrl' => $customer->house_front_picture_url,
                'proofOfBillingUrl' => $customer->proof_of_billing_url,
                'governmentValidIdUrl' => $customer->government_valid_id_url,
                'secondGovernmentValidIdUrl' => $customer->second_government_valid_id_url,
                'documentAttachmentUrl' => $customer->document_attachment_url,
                'otherIspBillUrl' => $customer->other_isp_bill_url,
                'groupName' => $customer->group_name,
                'createdBy' => $customer->created_by,
                'updatedBy' => $customer->updated_by,
                'totalPaid' => $totalPaid,
                
                'billingAccount' => [
                    'id' => $billingAccount->id,
                    'customerId' => $billingAccount->customer_id,
                    'accountNo' => $billingAccount->account_no,
                    'dateInstalled' => $billingAccount->date_installed ? $billingAccount->date_installed->format('Y-m-d') : null,
                    'planId' => $billingAccount->plan_id,
                    'billingDay' => $billingAccount->billing_day,
                    'billingStatusId' => $billingAccount->billing_status_id,
                    'billingStatusName' => $billingAccount->billingStatus ? $billingAccount->billingStatus->status_name : null,
                    'accountBalance' => $billingAccount->account_balance,
                    'balanceUpdateDate' => $billingAccount->balance_update_date ? $billingAccount->balance_update_date->format('Y-m-d H:i:s') : null,
                    'createdBy' => $billingAccount->created_by,
                    'createdAt' => $billingAccount->created_at ? $billingAccount->created_at->format('Y-m-d H:i:s') : null,
                    'updatedBy' => $billingAccount->updated_by,
                    'updatedAt' => $billingAccount->updated_at ? $billingAccount->updated_at->format('Y-m-d H:i:s') : null,
                    'vip_expiration' => $billingAccount->vip_expiration,
                    'vip_remarks' => $billingAccount->vip_remarks,
                    'generation_type' => $billingAccount->generation_type,
                    'vat_type' => $billingAccount->vat_type,
                    // Boolean VAT plus withholding, carried over from the job order at approval.
                    // vat_type above is the legacy text kept in sync for older readers.
                    'vat_enabled' => $billingAccount->vat_enabled,
                    'withholding_enabled' => $billingAccount->withholding_enabled,
                    'withholding_percentage' => $billingAccount->withholding_percentage,
                    'prepaid_expires_at' => $billingAccount->prepaid_expires_at ? $billingAccount->prepaid_expires_at->format('Y-m-d H:i:s') : null,
                    // Prepaid plan change bought but not yet in effect — the customer app shows
                    // this so they can see the switch they already paid for and when it lands.
                    'pending_plan_id' => $billingAccount->pending_plan_id,
                    'pending_plan_name' => $billingAccount->pending_plan_id
                        ? \App\Models\AppPlan::where('id', $billingAccount->pending_plan_id)->value('plan_name')
                        : null,
                    'pending_plan_effective_at' => $billingAccount->pending_plan_effective_at
                        ? $billingAccount->pending_plan_effective_at->format('Y-m-d H:i:s')
                        : null,
                ],
                
                'technicalDetails' => $technicalDetail ? [
                    'id' => $technicalDetail->id,
                    'accountId' => $technicalDetail->account_id,
                    'username' => $technicalDetail->username,
                    'usernameStatus' => $technicalDetail->username_status,
                    'connectionType' => $technicalDetail->connection_type,
                    'routerModel' => $technicalDetail->router_model,
                    'routerModemSn' => $technicalDetail->router_modem_sn,
                    'ipAddress' => $technicalDetail->ip_address,
                    'lcp' => $lcpNapLocation ? $lcpNapLocation->lcp : $technicalDetail->lcp,
                    'nap' => $lcpNapLocation ? $lcpNapLocation->nap : $technicalDetail->nap,
                    'port' => $technicalDetail->port,
                    'vlan' => $technicalDetail->vlan,
                    'lcpnap' => $technicalDetail->lcpnap,
                    'usageTypeId' => $technicalDetail->usage_type_id,
                    'usageType' => $technicalDetail->usage_type,
                    // Resolved above: technical_details.pppoe_password, falling back to the install
                    // job order for accounts predating that column.
                    'pppoePassword' => $pppoeCredentials['password'],
                    'pppoeUsername' => $pppoeCredentials['username'],
                    'createdBy' => $technicalDetail->created_by,
                    'updatedBy' => $technicalDetail->updated_by,
                ] : null,
                
                'createdAt' => $customer->created_at?->format('Y-m-d H:i:s'),
                'updatedAt' => $customer->updated_at?->format('Y-m-d H:i:s'),
                
                // Connectivity. Every key below is additive to what callers already read, so the
                // response contract is unchanged.
                //
                // session_status alone was not enough to tell the truth. The Customer list gets
                // active_sessions from BillingController and treats a live RADIUS session as
                // connectivity; this endpoint did not return it, so the Customer Details panel had
                // only the 2-minute-old session_status to go on and rendered OFFLINE for a customer
                // the list beside it showed as online. active_sessions is returned here so the two
                // resolve identically.
                'onlineSessionStatus' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_status : null,
                'session_group' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_group : null,
                'session_ip' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->ip_address : null,
                'active_sessions' => $billingAccount->onlineStatus ? (int) $billingAccount->onlineStatus->active_sessions : 0,
                // When RADIUS last wrote this row. Lets the panel tell "offline" apart from
                // "nobody has synced this account in hours".
                'session_updated_at' => $billingAccount->onlineStatus && $billingAccount->onlineStatus->updated_at
                    ? $billingAccount->onlineStatus->updated_at->format('Y-m-d H:i:s')
                    : null,
                'onlineStatusData' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->toArray() : null,
            ];
            
            \Log::info('CustomerDetailController - Response data:', [
                'houseFrontPictureUrl' => $data['houseFrontPictureUrl']
            ]);

            return response()->json([
                'success' => true,
                'data' => $data
            ]);
        } catch (\Exception $e) {
            \Log::error('CustomerDetailController - Unexpected Error:', [
                'account_no' => $accountNo,
                'message' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'An error occurred while fetching customer details',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}




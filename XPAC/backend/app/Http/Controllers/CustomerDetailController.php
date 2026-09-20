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
                'referredByAgentId' => \App\Support\AgentReferral::agentId($customer->referred_by),
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
                    // Cast, like every other emitter of this figure — the
                    // pay-summary endpoint and both payment-portal-log
                    // responses all send a number. Passed through raw, a NULL
                    // column arrives as null, and the customer dashboard reads
                    // that as "no figure" rather than "nothing owed": it draws
                    // "Balance unavailable" off a request that succeeded. That
                    // distinction is deliberate on the client — a settled
                    // account must not render a confident zero it never got —
                    // so the zero has to come from here.
                    'accountBalance' => (float) $billingAccount->account_balance,
                    'balanceUpdateDate' => $billingAccount->balance_update_date ? $billingAccount->balance_update_date->format('Y-m-d H:i:s') : null,
                    'createdBy' => $billingAccount->created_by,
                    'createdAt' => $billingAccount->created_at ? $billingAccount->created_at->format('Y-m-d H:i:s') : null,
                    'updatedBy' => $billingAccount->updated_by,
                    'updatedAt' => $billingAccount->updated_at ? $billingAccount->updated_at->format('Y-m-d H:i:s') : null,
                    'vip_expiration' => $billingAccount->vip_expiration,
                    'vip_remarks' => $billingAccount->vip_remarks,
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
                    'createdBy' => $technicalDetail->created_by,
                    'updatedBy' => $technicalDetail->updated_by,
                ] : null,
                
                'createdAt' => $customer->created_at?->format('Y-m-d H:i:s'),
                'updatedAt' => $customer->updated_at?->format('Y-m-d H:i:s'),
                
                'onlineSessionStatus' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_status : null,
                'session_group' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->session_group : null,
                'session_ip' => $billingAccount->onlineStatus ? $billingAccount->onlineStatus->ip_address : null,
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




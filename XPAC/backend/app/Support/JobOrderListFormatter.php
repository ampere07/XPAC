<?php

namespace App\Support;

use App\Models\JobOrder;
use Illuminate\Support\Collection;

/**
 * One job order exactly as the Job Order list sends it (GET job-orders, normal mode).
 *
 * The response is a hand-built whitelist rather than the model, and more than one screen reads
 * it: the Job Order page and its details pane, and the For Approval queue. The Approve flow
 * behind both reads the modem SN, PPPoE username, address and contact off this shape to rename
 * the ONU in SmartOLT, so the queue must send the same fields or approving from it would quietly
 * skip that step. Kept in one place for that reason.
 */
final class JobOrderListFormatter
{
    /**
     * Format a page of job orders.
     *
     * Resolves every referral on the page in one query rather than one per row: a referral made
     * through the agent picker holds the agent's user id, and the list shows their name.
     *
     * @param  Collection<int, JobOrder>  $jobOrders  loaded with application, items and
     *                                               billingAccount.customer
     */
    public static function formatMany(Collection $jobOrders): Collection
    {
        AgentReferral::prime(
            $jobOrders->flatMap(fn ($jo) => [
                optional($jo->application)->referred_by,
                optional(optional($jo->billingAccount)->customer)->referred_by,
            ])
        );

        return $jobOrders->map(fn (JobOrder $jobOrder) => self::format($jobOrder))->values();
    }

    /**
     * One row. Call through formatMany() for a page, so referrals are resolved in one query.
     */
    public static function format(JobOrder $jobOrder): array
    {
        $application = $jobOrder->application;
        $customer = $jobOrder->billingAccount ? $jobOrder->billingAccount->customer : null;

        return [
            'id' => $jobOrder->id,
            'JobOrder_ID' => $jobOrder->id,
            'application_id' => $jobOrder->application_id,
            'Timestamp' => $jobOrder->timestamp ? $jobOrder->timestamp->format('Y-m-d H:i:s') : null,
            'Installation_Fee' => $jobOrder->installation_fee,
            'Billing_Day' => $jobOrder->billing_day,
            // This response is a hand-built whitelist, not the model, so every billing
            // field the Job Order details panel renders has to be listed here explicitly
            // — anything omitted silently renders as blank.
            'generation_type' => $jobOrder->generation_type,
            'vat_type' => $jobOrder->vat_type,
            'vat_enabled' => $jobOrder->vat_enabled,
            'withholding_enabled' => $jobOrder->withholding_enabled,
            'withholding_percentage' => $jobOrder->withholding_percentage,
            'vip_enabled' => $jobOrder->vip_enabled,
            'vip_expiration' => $jobOrder->vip_expiration,
            // job_orders has no prepaid column of its own — the expiry lives on the
            // linked billing account, which is already eager-loaded, so no extra query.
            // Needed by the Prepaid Expiration funnel filter on the Job Order list.
            'prepaid_expires_at' => $jobOrder->billingAccount && $jobOrder->billingAccount->prepaid_expires_at
                ? $jobOrder->billingAccount->prepaid_expires_at->format('Y-m-d H:i:s')
                : null,
            'Onsite_Status' => $jobOrder->onsite_status,
            'Status' => $jobOrder->status,
            'status' => $jobOrder->status,
            'billing_status' => $jobOrder->billing_status,
            'Status_Remarks' => $jobOrder->status_remarks,
            'Assigned_Email' => $jobOrder->assigned_email,
            'Contract_Template' => $jobOrder->contract_link,
            'contract_link' => $jobOrder->contract_link,
            'Created_By' => $jobOrder->created_by_user_email,
            'Created_At' => $jobOrder->created_at ? $jobOrder->created_at->format('Y-m-d H:i:s') : null,
            'Updated_By' => $jobOrder->updated_by_user_email,
            'Updated_At' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null,
            'Modified_By' => $jobOrder->created_by_user_email, // Keep for compatibility
            'Modified_Date' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null, // Keep for compatibility
            'Username' => $jobOrder->username,
            'group_name' => $jobOrder->group_name,
            'pppoe_username' => $jobOrder->pppoe_username,
            'pppoe_password' => $jobOrder->pppoe_password,

            'date_installed' => $jobOrder->date_installed,
            'start_time' => $jobOrder->start_time,
            'end_time' => $jobOrder->end_time,
            'technicians' => $jobOrder->technicians,
            'usage_type' => $jobOrder->usage_type,
            'connection_type' => $jobOrder->connection_type,
            'router_model' => $jobOrder->router_model,
            'modem_router_sn' => $jobOrder->modem_router_sn,
            'Modem_SN' => $jobOrder->modem_router_sn,
            'modem_sn' => $jobOrder->modem_router_sn,
            'lcpnap' => $jobOrder->lcpnap,
            'port' => $jobOrder->port,
            'vlan' => $jobOrder->vlan,
            'visit_by' => $jobOrder->visit_by,
            'visit_with' => $jobOrder->visit_with,
            'visit_with_other' => $jobOrder->visit_with_other,
            'ip_address' => $jobOrder->ip_address,
            'address_coordinates' => $jobOrder->address_coordinates,
            'onsite_remarks' => $jobOrder->onsite_remarks,
            'username_status' => $jobOrder->username_status,

            'client_signature_url' => $jobOrder->client_signature_url,
            'setup_image_url' => $jobOrder->setup_image_url,
            'speedtest_image_url' => $jobOrder->speedtest_image_url,
            'signed_contract_image_url' => $jobOrder->signed_contract_image_url,
            'box_reading_image_url' => $jobOrder->box_reading_image_url,
            'router_reading_image_url' => $jobOrder->router_reading_image_url,
            'port_label_image_url' => $jobOrder->port_label_image_url,
            'house_front_picture_url' => $jobOrder->house_front_picture_url,
            'client_tagging_url' => $jobOrder->client_tagging_url,
            'proof_image_url' => $jobOrder->proof_image_url,
            'other_photos_url' => $jobOrder->other_photos_url,
            'installation_landmark' => $jobOrder->installation_landmark,

            'created_at' => $jobOrder->created_at ? $jobOrder->created_at->format('Y-m-d H:i:s') : null,
            'updated_at' => $jobOrder->updated_at ? $jobOrder->updated_at->format('Y-m-d H:i:s') : null,
            'created_by_user_email' => $jobOrder->created_by_user_email,
            'updated_by_user_email' => $jobOrder->updated_by_user_email,

            'First_Name' => $application ? $application->first_name : ($customer ? $customer->first_name : null),
            'Middle_Initial' => $application ? $application->middle_initial : ($customer ? $customer->middle_initial : null),
            'Last_Name' => $application ? $application->last_name : ($customer ? $customer->last_name : null),
            'Address' => ($application && !empty(trim($application->installation_address ?? '')))
                ? $application->installation_address
                : ($customer ? $customer->address : null),
            'Installation_Address' => ($application && !empty(trim($application->installation_address ?? '')))
                ? $application->installation_address
                : ($customer ? $customer->address : null),
            'Location' => ($application && !empty(trim($application->location ?? '')))
                ? $application->location
                : ($customer ? $customer->location : null),
            'City' => ($application && !empty(trim($application->city ?? '')))
                ? $application->city
                : ($customer ? $customer->city : null),
            'Region' => ($application && !empty(trim($application->region ?? '')))
                ? $application->region
                : ($customer ? $customer->region : null),
            'Barangay' => ($application && !empty(trim($application->barangay ?? '')))
                ? $application->barangay
                : ($customer ? $customer->barangay : null),
            'Email_Address' => $application ? $application->email_address : ($customer ? $customer->email_address : null),
            'Mobile_Number' => $application ? $application->mobile_number : ($customer ? $customer->contact_number_primary : null),
            'Secondary_Mobile_Number' => $application ? $application->secondary_mobile_number : ($customer ? $customer->contact_number_secondary : null),
            'Desired_Plan' => $application ? $application->desired_plan : ($customer ? $customer->desired_plan : null),
            // The stored value and how to show it, side by side. Every
            // list, export and detail pane reads Referred_By and keeps
            // showing a name; the edit forms read the id so that saving
            // an untouched record writes the same referral back rather
            // than turning it into a name again.
            'Referred_By' => AgentReferral::displayName(
                $application ? $application->referred_by : ($customer ? $customer->referred_by : null)
            ),
            'Referred_By_Raw' => $application ? $application->referred_by : ($customer ? $customer->referred_by : null),
            'Referred_By_Agent_ID' => AgentReferral::agentIdIfAgent(
                $application ? $application->referred_by : ($customer ? $customer->referred_by : null)
            ),
            'Billing_Status' => $jobOrder->billing_status,
            'commission_status' => $jobOrder->commission_status,
            'job_order_items' => $jobOrder->items,
        ];
    }
}

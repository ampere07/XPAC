<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class ServiceOrderSeeder extends Seeder
{
    public function run(): void
    {
        $billingAccounts = DB::table('billing_accounts')->get();
        if ($billingAccounts->isEmpty()) {
            $this->command->info('No billing accounts found. Please seed customers first.');
            return;
        }

        $records = [];
        $concerns = ['no connection', 'slow connection', 'pullout', 'router configuration', 'relocation'];
        $repairCategories = ['repair', 'repair', 'pullout', 'configuration', 'relocate'];
        $visitStatuses = ['Done', 'In Progress', 'Failed'];
        $supportStatuses = ['Resolved', 'In Progress', 'Pending'];

        foreach ($billingAccounts as $i => $account) {
            $createdDaysAgo = 30 - $i;
            $timestamp = Carbon::now()->subDays($createdDaysAgo);
            
            $concern = $concerns[$i % count($concerns)];
            $repairCategory = $repairCategories[$i % count($repairCategories)];
            $visitStatus = $visitStatuses[$i % count($visitStatuses)];
            $supportStatus = $supportStatuses[$i % count($supportStatuses)];

            // Override values if it's a pullout to ensure consistency
            if ($repairCategory === 'pullout') {
                $concern = 'pullout';
            }

            $records[] = [
                'organization_id' => null,
                'account_no' => $account->account_no,
                'invoice_id' => null,
                'status' => 'active',
                'ticket_id' => 'TCK-SO-' . str_pad($account->id * 29, 8, '0', STR_PAD_LEFT),
                'timestamp' => $timestamp->copy()->addDays(5),
                'support_status' => $supportStatus,
                'concern' => $concern,
                'concern_remarks' => 'Reported issue: ' . $concern . '. Needs checkup.',
                'priority_level' => $i % 2 === 0 ? 'High' : 'Medium',
                'requested_by' => 'customer' . $account->id . '@example.com',
                'assigned_email' => 'tech1@localhost.com',
                'visit_status' => $visitStatus,
                'visit_by_user' => 'tech1@localhost.com',
                'visit_with' => 'tech2@localhost.com',
                'visit_with_other' => null,
                'visit_remarks' => strtolower($visitStatus) === 'done' ? 'Onsite check done. Resolved.' : 'Ongoing diagnostics.',
                'repair_category' => $repairCategory,
                'support_remarks' => 'Assigned dispatch team.',
                'service_charge' => $i % 4 === 0 ? 500.00 : 0.00,
                'client_signature_url' => 'https://example.com/signature.png',
                'image1_url' => 'https://example.com/setup.jpg',
                'image2_url' => null,
                'image3_url' => null,
                'created_by_user' => 'superadmin@localhost.com',
                'updated_by_user' => 'superadmin@localhost.com',
                'old_lcp' => 'LCP-1',
                'old_nap' => 'NAP-1',
                'old_port' => 'Port 1',
                'old_router_modem_sn' => 'SN-OLD-12345',
                'old_vlan' => '100',
                'new_router_modem_sn' => null,
                'new_lcp' => null,
                'new_nap' => null,
                'new_port' => null,
                'new_vlan' => null,
                'router_model' => 'Huawei HG8145V5',
                'new_lcpnap' => null,
                'old_lcpnap' => 'LCP-NAP-1',
                'old_plan' => 'Plan 1599 - 50 Mbps',
                'new_plan' => null,
                'referred_by' => null,
                'start_time' => $timestamp->copy()->addDays(5)->addHours(1),
                'end_time' => $timestamp->copy()->addDays(5)->addHours(3),
                'proof_image_url' => 'https://example.com/proof.jpg',
                'date_installed' => null,
                'technicians' => json_encode(['tech1@localhost.com', 'tech2@localhost.com']),
                'speedtest_image_url' => null,
                'setup_image_url' => null,
                'box_reading_image_url' => null,
                'router_reading_image_url' => null,
                'created_at' => $timestamp->copy()->addDays(5),
                'updated_at' => $timestamp->copy()->addDays(5),
            ];
        }

        DB::table('service_orders')->insert($records);
    }
}

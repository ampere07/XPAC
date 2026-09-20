<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class JobOrderSeeder extends Seeder
{
    public function run(): void
    {
        $applications = DB::table('applications')->get();
        if ($applications->isEmpty()) {
            $this->command->info('No applications found. Please seed applications first.');
            return;
        }

        $onsiteStatuses = ['Done', 'In Progress', 'Failed'];
        $records = [];

        foreach ($applications as $i => $app) {
            $onsiteStatus = $onsiteStatuses[$i % count($onsiteStatuses)];
            $createdDaysAgo = 20 - $i;
            $timestamp = Carbon::parse($app->timestamp);

            $records[] = [
                'application_id' => $app->id,
                'account_id' => null,
                'status' => strtolower($onsiteStatus) === 'done' ? 'active' : 'pending',
                'timestamp' => $timestamp,
                'date_installed' => strtolower($onsiteStatus) === 'done' ? Carbon::now()->subDays($createdDaysAgo - 1)->format('Y-m-d') : null,
                'installation_fee' => 1500.00,
                'billing_day' => 15,
                'billing_status' => strtolower($onsiteStatus) === 'done' ? 'active' : 'pending',
                'modem_router_sn' => 'SN-' . str_pad($app->id * 97, 8, '0', STR_PAD_LEFT),
                'router_model' => 'Huawei HG8145V5',
                'group_name' => 'Calamba Group',
                'lcpnap' => 'LCP-NAP-' . (($app->id % 5) + 1),
                'port' => 'Port ' . (($app->id % 8) + 1),
                'vlan' => '100' . ($app->id % 5),
                'username' => 'user_' . $app->id,
                'ip_address' => '192.168.1.' . ($app->id + 10),
                'connection_type' => 'FTTH',
                'usage_type' => 'Residential',
                'username_status' => strtolower($onsiteStatus) === 'done' ? 'active' : 'pending',
                'visit_by' => 'tech1@localhost.com',
                'visit_with' => 'tech2@localhost.com',
                'visit_with_other' => null,
                'onsite_status' => $onsiteStatus,
                'assigned_email' => 'tech1@localhost.com',
                'status_remarks' => 'Seeded onsite remark',
                'onsite_remarks' => 'Everything set up successfully.',
                'status_remarks' => null,
                'address_coordinates' => $app->long_lat,
                'contract_link' => 'https://example.com/contract.pdf',
                'client_signature_url' => 'https://example.com/signature.png',
                'setup_image_url' => 'https://example.com/setup.jpg',
                'speedtest_image_url' => 'https://example.com/speedtest.png',
                'signed_contract_image_url' => 'https://example.com/signed.jpg',
                'box_reading_image_url' => 'https://example.com/box.jpg',
                'router_reading_image_url' => 'https://example.com/router.jpg',
                'port_label_image_url' => 'https://example.com/port.jpg',
                'house_front_picture_url' => $app->house_front_picture_url,
                'created_at' => $app->created_at,
                'created_by_user_email' => 'superadmin@localhost.com',
                'updated_at' => $app->updated_at,
                'updated_by_user_email' => 'superadmin@localhost.com',
                'pppoe_username' => 'pppoe_user_' . $app->id,
                'pppoe_password' => 'secret123',
                'installation_landmark' => $app->landmark,
                'start_time' => $timestamp,
                'end_time' => (clone $timestamp)->addHours(2),
                'proof_image_url' => 'https://example.com/proof.jpg',
                'organization_id' => null,
                'technicians' => json_encode(['tech1@localhost.com', 'tech2@localhost.com']),
                'client_tagging_url' => null,
                'commission_status' => 'pending',
            ];
        }

        DB::table('job_orders')->insert($records);
    }
}

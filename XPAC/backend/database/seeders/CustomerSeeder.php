<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class CustomerSeeder extends Seeder
{
    public function run(): void
    {
        $firstNames = ['Juan', 'Maria', 'Jose', 'Pedro', 'Ana', 'Manuel', 'Elizabeth', 'Robert', 'Jennie', 'Mark', 'Carlos', 'Patricia', 'Grace', 'David', 'Joseph', 'Sarah', 'Paul', 'Michelle', 'Daniel', 'Karen'];
        $lastNames = ['Dela Cruz', 'Santos', 'Reyes', 'Diaz', 'Aquino', 'Marcos', 'Castro', 'Gonzales', 'Bautista', 'Villanueva', 'Fernandez', 'Lopez', 'Cruz', 'Santiago', 'Ramos', 'Gomez', 'Garcia', 'Torres', 'Diaz', 'Rivera'];
        $barangays = ['San Jose', 'Poblacion', 'San Antonio', 'Bagong Pag-asa', 'Santa Cruz', 'San Roque', 'Concepcion', 'Santo Nino'];
        $housingStatuses = ['Owned', 'Rented', 'Living with Parents'];
        
        // Fetch default Plan ID and Billing Status ID to prevent foreign key issues
        $planId = DB::table('plan_list')->first()?->id ?? null;
        $billingStatusId = DB::table('billing_status')->first()?->id ?? null;

        for ($i = 0; $i < 20; $i++) {
            $firstName = $firstNames[$i % count($firstNames)];
            $lastName = $lastNames[$i % count($lastNames)];
            $email = strtolower($firstName . '.' . str_replace(' ', '', $lastName) . '@example.com');
            $barangay = $barangays[$i % count($barangays)];
            $housingStatus = $housingStatuses[$i % count($housingStatuses)];
            $createdDaysAgo = 30 - $i;
            $timestamp = Carbon::now()->subDays($createdDaysAgo);
            
            // Generate unique account number
            $accountNo = '2026000' . str_pad($i + 1, 4, '0', STR_PAD_LEFT);

            // 1. Insert Customer
            $customerId = DB::table('customers')->insertGetId([
                'first_name' => $firstName,
                'middle_initial' => chr(65 + ($i % 26)), // A-Z
                'last_name' => $lastName,
                'email_address' => $email,
                'contact_number_primary' => '0917' . str_pad($i * 59, 7, '0', STR_PAD_LEFT),
                'contact_number_secondary' => null,
                'address' => 'House #' . ($i + 100) . ', Street ' . ($i + 1) . ', Barangay ' . $barangay,
                'location' => 'Calamba, Laguna',
                'barangay' => $barangay,
                'city' => 'Calamba',
                'region' => 'Region IV-A',
                'address_coordinates' => '14.21' . $i . ',121.16' . $i,
                'housing_status' => $housingStatus,
                'referred_by' => null,
                'group_name' => 'Calamba Group',
                'created_by' => 'superadmin@localhost.com',
                'desired_plan' => 'Plan 1599 - 50 Mbps',
                'house_front_picture_url' => 'https://example.com/house.jpg',
                'account_no' => $accountNo,
                'proof_of_billing_url' => 'https://example.com/billing.jpg',
                'government_valid_id_url' => 'https://example.com/id.jpg',
                'second_government_valid_id_url' => null,
                'document_attachment_url' => null,
                'other_isp_bill_url' => null,
                'organization_id' => null,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);

            // 2. Insert Billing Account
            $accountId = DB::table('billing_accounts')->insertGetId([
                'customer_id' => $customerId,
                'account_no' => $accountNo,
                'date_installed' => $timestamp->copy()->addDays(2)->format('Y-m-d'),
                'plan_id' => $planId,
                'account_balance' => 0.00,
                'balance_update_date' => $timestamp,
                'billing_day' => 15,
                'billing_status_id' => $billingStatusId,
                'created_by' => 'superadmin@localhost.com',
                'vip_expiration' => null,
                'organization_id' => null,
                'vip_remarks' => null,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);

            // 3. Insert Technical Detail
            DB::table('technical_details')->insert([
                'organization_id' => null,
                'account_id' => $accountId,
                'account_no' => $accountNo,
                'username' => 'pppoe_user_' . ($i + 1001),
                'username_status' => 'active',
                'connection_type' => 'FTTH',
                'router_model' => 'Huawei HG8145V5',
                'router_modem_sn' => 'SN-MODEM-' . str_pad($i * 43, 8, '0', STR_PAD_LEFT),
                'ip_address' => '192.168.100.' . ($i + 20),
                'lcp' => 'LCP-' . (($i % 4) + 1),
                'nap' => 'NAP-' . (($i % 4) + 1),
                'port' => 'Port ' . (($i % 8) + 1),
                'vlan' => '100' . ($i % 4),
                'lcpnap' => 'LCP-NAP-' . (($i % 4) + 1),
                'usage_type' => 'Residential',
                'created_by' => 'superadmin@localhost.com',
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);
        }
    }
}

<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class TransactionSeeder extends Seeder
{
    public function run(): void
    {
        $billingAccounts = DB::table('billing_accounts')->get();
        if ($billingAccounts->isEmpty()) {
            $this->command->info('No billing accounts found. Please seed customers first.');
            return;
        }

        $records = [];
        $paymentMethods = ['Cash', 'GCash', 'Bank Transfer'];

        foreach ($billingAccounts as $i => $account) {
            $createdDaysAgo = 30 - $i;
            $timestamp = Carbon::now()->subDays($createdDaysAgo);
            
            // Transaction 1: Installation Fee (Paid via Cash/Bank Transfer)
            $pm1 = $paymentMethods[$i % 3 === 0 ? 0 : 2]; // Cash or Bank Transfer
            $records[] = [
                'organization_id' => null,
                'account_no' => $account->account_no,
                'transaction_type' => 'Installation Fee',
                'received_payment' => 1500.00,
                'account_balance_before' => 1500.00,
                'payment_date' => $timestamp->copy()->addDays(2),
                'date_processed' => $timestamp->copy()->addDays(2),
                'processed_by_user' => 'superadmin@localhost.com',
                'payment_method' => $pm1,
                'reference_no' => 'TXN-REF-' . str_pad($account->id * 47, 8, '0', STR_PAD_LEFT),
                'or_no' => 'OR-' . str_pad($account->id * 47, 8, '0', STR_PAD_LEFT),
                'remarks' => 'Initial installation fee payment.',
                'status' => 'approved',
                'image_url' => null,
                'created_by_user' => 'superadmin@localhost.com',
                'updated_by_user' => 'superadmin@localhost.com',
                'approved_by' => 'Super Admin',
                'created_at' => $timestamp->copy()->addDays(2),
                'updated_at' => $timestamp->copy()->addDays(2),
            ];

            // Transaction 2: Recurring Fee (Paid via GCash/Bank Transfer)
            $pm2 = $paymentMethods[$i % 2 === 0 ? 1 : 2]; // GCash or Bank Transfer
            $records[] = [
                'organization_id' => null,
                'account_no' => $account->account_no,
                'transaction_type' => 'Recurring Fee',
                'received_payment' => 1499.00,
                'account_balance_before' => 1499.00,
                'payment_date' => $timestamp->copy()->addDays(15),
                'date_processed' => $timestamp->copy()->addDays(15),
                'processed_by_user' => 'superadmin@localhost.com',
                'payment_method' => $pm2,
                'reference_no' => 'TXN-REF-RC-' . str_pad($account->id * 89, 8, '0', STR_PAD_LEFT),
                'or_no' => 'OR-RC-' . str_pad($account->id * 89, 8, '0', STR_PAD_LEFT),
                'remarks' => 'Monthly service subscription payment.',
                'status' => 'approved',
                'image_url' => null,
                'created_by_user' => 'superadmin@localhost.com',
                'updated_by_user' => 'superadmin@localhost.com',
                'approved_by' => 'Super Admin',
                'created_at' => $timestamp->copy()->addDays(15),
                'updated_at' => $timestamp->copy()->addDays(15),
            ];
        }

        DB::table('transactions')->insert($records);
    }
}

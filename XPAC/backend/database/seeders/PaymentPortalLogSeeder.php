<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class PaymentPortalLogSeeder extends Seeder
{
    public function run(): void
    {
        $billingAccounts = DB::table('billing_accounts')->get();
        if ($billingAccounts->isEmpty()) {
            $this->command->info('No billing accounts found. Please seed customers first.');
            return;
        }

        $records = [];
        $wallets = ['GCASH', 'MAYA', 'GRABPAY'];
        $statuses = ['PAID', 'PENDING', 'EXPIRED'];

        foreach ($billingAccounts as $i => $account) {
            $createdDaysAgo = 30 - $i;
            $timestamp = Carbon::now()->subDays($createdDaysAgo);
            $wallet = $wallets[$i % count($wallets)];
            $status = $statuses[$i % count($statuses)];
            $amount = 1499.00;

            $records[] = [
                'organization_id' => null,
                'reference_no' => 'REF-PP-' . str_pad($account->id * 53, 8, '0', STR_PAD_LEFT),
                'account_id' => $account->id,
                'total_amount' => $amount,
                'account_balance_before' => $amount,
                'date_time' => $timestamp->copy()->addDays(10),
                'checkout_id' => 'ch_' . str_pad($account->id * 73, 12, '0', STR_PAD_LEFT),
                'status' => $status,
                'transaction_status' => $status === 'PAID' ? 'SUCCESS' : ($status === 'PENDING' ? 'PENDING' : 'FAILED'),
                'ewallet_type' => $wallet,
                'payment_channel' => 'EWALLET',
                'type' => 'xendit',
                'payment_url' => 'https://checkout.xendit.co/v2/' . str_pad($account->id * 73, 12, '0', STR_PAD_LEFT),
                'json_payload' => json_encode([
                    'external_id' => 'REF-PP-' . str_pad($account->id * 53, 8, '0', STR_PAD_LEFT),
                    'amount' => $amount,
                    'payer_email' => 'customer' . $account->id . '@example.com',
                    'description' => 'Payment for Account ' . $account->account_no,
                ]),
                'callback_payload' => $status === 'PAID' ? json_encode([
                    'id' => 'ev_' . str_pad($account->id * 97, 12, '0', STR_PAD_LEFT),
                    'event' => 'payment.succeeded',
                    'business_id' => 'biz_1234567890',
                    'created' => $timestamp->copy()->addDays(10)->toIso8601String(),
                ]) : null,
                'created_at' => $timestamp->copy()->addDays(10),
                'updated_at' => $timestamp->copy()->addDays(10),
            ];
        }

        DB::table('payment_portal_logs')->insert($records);
    }
}

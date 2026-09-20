<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class DiscountsRebatesNoticeSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Fetch billing accounts
        $billingAccounts = DB::table('billing_accounts')->get();
        if ($billingAccounts->isEmpty()) {
            $this->command->info('No billing accounts found. Please seed customers and invoices first.');
            return;
        }

        // 2. Fetch the first user
        $userId = DB::table('users')->first()?->id ?? null;

        // 3. Clear existing records safely
        DB::statement('SET FOREIGN_KEY_CHECKS=0;');
        DB::table('dc_notice')->truncate();
        DB::table('discounts')->truncate();
        DB::table('rebates')->truncate();
        DB::table('rebates_usage')->truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1;');

        // 4. Seed master Rebates records
        $rebate1Id = DB::table('rebates')->insertGetId([
            'organization_id' => null,
            'number_of_dates' => 5,
            'rebate_type' => 'Disruption Refund',
            'selected_rebate' => '100.00',
            'status' => 'active',
            'created_by' => 'superadmin@localhost.com',
            'modified_by' => null,
            'modified_date' => null,
            'month' => Carbon::now()->format('F Y'),
        ]);

        $rebate2Id = DB::table('rebates')->insertGetId([
            'organization_id' => null,
            'number_of_dates' => 2,
            'rebate_type' => 'Promo Rebate',
            'selected_rebate' => '50.00',
            'status' => 'active',
            'created_by' => 'superadmin@localhost.com',
            'modified_by' => null,
            'modified_date' => null,
            'month' => Carbon::now()->format('F Y'),
        ]);

        // 5. Seed records per billing account
        foreach ($billingAccounts as $i => $account) {
            // Fetch invoices for this account (needed for linking dc_notice and discounts)
            $invoices = DB::table('invoices')->where('account_no', $account->account_no)->get();

            //---------------------------------------------------------
            // Seed Disconnection Notices (dc_notice) for Overdue Accounts
            //---------------------------------------------------------
            // Accounts 15-19 are configured to have overdue invoices
            if ($i >= 15) {
                $overdueInvoice = $invoices->where('status', 'unpaid')->first();
                if ($overdueInvoice) {
                    DB::table('dc_notice')->insert([
                        'account_id' => $account->id,
                        'invoice_id' => $overdueInvoice->id,
                        'dc_notice_date' => Carbon::parse($overdueInvoice->due_date)->addDay(),
                        'print_link' => 'https://example.com/dc-notice/' . $account->account_no . '.pdf',
                        'created_by_user_id' => $userId,
                        'updated_by_user_id' => $userId,
                        'organization_id' => $account->organization_id,
                        'created_at' => Carbon::parse($overdueInvoice->due_date)->addDay(),
                        'updated_at' => Carbon::parse($overdueInvoice->due_date)->addDay(),
                    ]);
                }
            }

            //---------------------------------------------------------
            // Seed Discounts (discounts)
            //---------------------------------------------------------
            // Accounts 0-4: Seed a used/applied discount
            if ($i < 5) {
                $paidInvoice = $invoices->where('status', 'paid')->last();
                if ($paidInvoice) {
                    DB::table('discounts')->insert([
                        'organization_id' => $account->organization_id,
                        'account_no' => $account->account_no,
                        'invoice_used_id' => $paidInvoice->id,
                        'discount_amount' => 100.00,
                        'remaining' => 0,
                        'status' => 'used',
                        'used_date' => Carbon::parse($paidInvoice->invoice_date)->addDays(1),
                        'processed_date' => Carbon::parse($paidInvoice->invoice_date),
                        'processed_by_user_id' => $userId,
                        'approved_by_user_id' => $userId,
                        'remarks' => 'Early payment discount applied.',
                        'created_by_user_id' => $userId,
                        'updated_by_user_id' => $userId,
                        'created_at' => Carbon::parse($paidInvoice->invoice_date),
                        'updated_at' => Carbon::parse($paidInvoice->invoice_date)->addDays(1),
                    ]);
                }
            }

            // Accounts 5-9: Seed an active, unused discount
            if ($i >= 5 && $i < 10) {
                DB::table('discounts')->insert([
                    'organization_id' => $account->organization_id,
                    'account_no' => $account->account_no,
                    'invoice_used_id' => null,
                    'discount_amount' => 150.00,
                    'remaining' => 1,
                    'status' => 'active',
                    'used_date' => null,
                    'processed_date' => Carbon::now(),
                    'processed_by_user_id' => $userId,
                    'approved_by_user_id' => $userId,
                    'remarks' => 'Loyalty program discount.',
                    'created_by_user_id' => $userId,
                    'updated_by_user_id' => $userId,
                    'created_at' => Carbon::now(),
                    'updated_at' => Carbon::now(),
                ]);
            }

            //---------------------------------------------------------
            // Seed Rebates Usage (rebates_usage)
            //---------------------------------------------------------
            // We apply rebate entries to even-numbered billing account indices
            if ($i % 2 === 0) {
                DB::table('rebates_usage')->insert([
                    'organization_id' => $account->organization_id,
                    'rebates_id' => ($i % 4 === 0) ? $rebate1Id : $rebate2Id,
                    'account_no' => $account->account_no,
                    'status' => 'applied',
                    'month' => Carbon::now()->format('F Y'),
                ]);
            }
        }
    }
}

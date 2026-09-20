<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class InvoiceSoaOverdueSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Fetch billing accounts
        $billingAccounts = DB::table('billing_accounts')->get();
        if ($billingAccounts->isEmpty()) {
            $this->command->info('No billing accounts found. Please seed customers first.');
            return;
        }

        // 2. Fetch the first user to assign user IDs for overdue logs
        $userId = DB::table('users')->first()?->id ?? null;

        // 3. Clear existing records in invoices, statement_of_accounts, and overdue tables to avoid duplication
        DB::table('overdue')->truncate();
        DB::table('statement_of_accounts')->truncate();
        
        // Temporarily disable foreign key checks to safely truncate invoices (which is referenced by overdue)
        DB::statement('SET FOREIGN_KEY_CHECKS=0;');
        DB::table('invoices')->truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1;');

        foreach ($billingAccounts as $i => $account) {
            // Set base timestamp based on account age
            $createdDaysAgo = 30 - $i;
            $baseTimestamp = Carbon::now()->subDays($createdDaysAgo);

            //---------------------------------------------------------
            // Transaction/Invoice 1: Installation & Setup (Always Paid)
            //---------------------------------------------------------
            $invoice1Date = $baseTimestamp->copy()->addDays(2);
            $invoice1DueDate = $invoice1Date->copy()->addDays(15);

            $invoice1Id = DB::table('invoices')->insertGetId([
                'account_no' => $account->account_no,
                'invoice_date' => $invoice1Date,
                'invoice_balance' => 0.00,
                'others_and_basic_charges' => 0.00,
                'total_amount' => 1500.00,
                'received_payment' => 1500.00,
                'due_date' => $invoice1DueDate,
                'status' => 'paid',
                'payment_portal_log_ref' => null,
                'transaction_id' => null,
                'created_by' => 'superadmin@localhost.com',
                'updated_by' => 'superadmin@localhost.com',
                'service_charge' => 0.00,
                'rebate' => 0.00,
                'discounts' => 0.00,
                'staggered' => 0.00,
                'organization_id' => $account->organization_id,
                'created_at' => $invoice1Date,
                'updated_at' => $invoice1Date,
            ]);

            // Create Statement of Account for Invoice 1
            DB::table('statement_of_accounts')->insert([
                'account_no' => $account->account_no,
                'statement_date' => $invoice1Date,
                'balance_from_previous_bill' => 0.00,
                'payment_received_previous' => 0.00,
                'remaining_balance_previous' => 0.00,
                'monthly_service_fee' => 1500.00,
                'others_and_basic_charges' => 0.00,
                'vat' => 0.00,
                'due_date' => $invoice1DueDate,
                'amount_due' => 1500.00,
                'total_amount_due' => 1500.00,
                'print_link' => 'https://example.com/soa/' . $account->account_no . '_initial.pdf',
                'created_by' => 'superadmin@localhost.com',
                'updated_by' => 'superadmin@localhost.com',
                'service_charge' => 0.00,
                'rebate' => 0.00,
                'discounts' => 0.00,
                'staggered' => 0.00,
                'organization_id' => $account->organization_id,
                'created_at' => $invoice1Date,
                'updated_at' => $invoice1Date,
            ]);

            //---------------------------------------------------------
            // Transaction/Invoice 2: Monthly Service Subscription Fee
            //---------------------------------------------------------
            // We alternate the status of the monthly service fee across accounts:
            // - Accounts 0-9: Paid
            // - Accounts 10-14: Unpaid (due in future, e.g. active balance)
            // - Accounts 15-19: Unpaid & Overdue (due date has passed)
            //---------------------------------------------------------
            $invoice2Date = $baseTimestamp->copy()->addDays(15);
            $invoice2DueDate = $invoice2Date->copy()->addDays(15);

            if ($i < 10) {
                $status = 'paid';
                $invoiceBalance = 0.00;
                $receivedPayment = 1499.00;
            } else {
                $status = 'unpaid';
                $invoiceBalance = 1499.00;
                $receivedPayment = 0.00;
            }

            // Adjust date for overdue entries
            if ($i >= 15) {
                $invoice2DueDate = Carbon::now()->subDays(3); // Due 3 days ago
                $invoice2Date = $invoice2DueDate->copy()->subDays(15);
            }

            $invoice2Id = DB::table('invoices')->insertGetId([
                'account_no' => $account->account_no,
                'invoice_date' => $invoice2Date,
                'invoice_balance' => $invoiceBalance,
                'others_and_basic_charges' => 0.00,
                'total_amount' => 1499.00,
                'received_payment' => $receivedPayment,
                'due_date' => $invoice2DueDate,
                'status' => $status,
                'payment_portal_log_ref' => null,
                'transaction_id' => null,
                'created_by' => 'superadmin@localhost.com',
                'updated_by' => 'superadmin@localhost.com',
                'service_charge' => 0.00,
                'rebate' => 0.00,
                'discounts' => 0.00,
                'staggered' => 0.00,
                'organization_id' => $account->organization_id,
                'created_at' => $invoice2Date,
                'updated_at' => $invoice2Date,
            ]);

            // Create Statement of Account for Invoice 2
            DB::table('statement_of_accounts')->insert([
                'account_no' => $account->account_no,
                'statement_date' => $invoice2Date,
                'balance_from_previous_bill' => 1500.00,
                'payment_received_previous' => 1500.00,
                'remaining_balance_previous' => 0.00,
                'monthly_service_fee' => 1499.00,
                'others_and_basic_charges' => 0.00,
                'vat' => 0.00,
                'due_date' => $invoice2DueDate,
                'amount_due' => 1499.00,
                'total_amount_due' => 1499.00,
                'print_link' => 'https://example.com/soa/' . $account->account_no . '_recurring.pdf',
                'created_by' => 'superadmin@localhost.com',
                'updated_by' => 'superadmin@localhost.com',
                'service_charge' => 0.00,
                'rebate' => 0.00,
                'discounts' => 0.00,
                'staggered' => 0.00,
                'organization_id' => $account->organization_id,
                'created_at' => $invoice2Date,
                'updated_at' => $invoice2Date,
            ]);

            //---------------------------------------------------------
            // 3. Seed Overdue entry if unpaid and due date has passed ($i >= 15)
            //---------------------------------------------------------
            if ($i >= 15) {
                DB::table('overdue')->insert([
                    'organization_id' => $account->organization_id,
                    'account_no' => $account->account_no,
                    'invoice_id' => $invoice2Id,
                    'overdue_date' => $invoice2DueDate->copy()->addDays(1),
                    'print_link' => 'https://example.com/overdue/' . $account->account_no . '.pdf',
                    'created_by_user_id' => $userId,
                    'updated_by_user_id' => $userId,
                    'created_at' => $invoice2DueDate->copy()->addDays(1),
                    'updated_at' => $invoice2DueDate->copy()->addDays(1),
                ]);
            }
        }
    }
}

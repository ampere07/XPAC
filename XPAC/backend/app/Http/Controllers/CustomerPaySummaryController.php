<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The smallest response that lets the customer dashboard show an amount due and enable
 * Pay Now.
 *
 * The balance card used to wait on three separate requests, the slowest of which was
 * doing far more work than the card needed:
 *
 *  - `/customer-detail/{accountNo}` for the balance. That endpoint eager-loads four
 *    relations, looks up the LCP/NAP location, computes two payment SUMs for a
 *    `totalPaid` the customer dashboard never renders, and returns the full customer
 *    record including document URLs and the raw online-status row. The balance is one
 *    column of one row of all that.
 *  - `/billing-generation/invoices?account_no=…` for the due date. Returns the account's
 *    entire invoice history so the page can read `due_date` off the newest one.
 *  - `/payments/check-pending` for the button label.
 *
 * This is three indexed single-row reads and a few hundred bytes, so the figure the
 * customer is actually waiting for no longer queues behind data belonging to other
 * parts of the app. The heavier endpoints still load in parallel for the name, plan,
 * address and history.
 *
 * Deliberately NOT returned here: the pending payment's `payment_url`. The dashboard
 * only needs to know a payment is already in progress, to label the button; Pay Now
 * re-checks and gets the URL when it is actually clicked. Keeping a live payment link
 * out of this response means adding a fast path costs no extra exposure.
 */
class CustomerPaySummaryController extends Controller
{
    public function show($accountNo): JsonResponse
    {
        try {
            $account = DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->select('account_no', 'account_balance', 'balance_update_date', 'billing_day')
                ->first();

            if (!$account) {
                // Logged, not just returned. The customer portal asks for this
                // with the signed-in username, which is the only thing tying a
                // login to a billing account — there is no key on the users
                // table. So a miss here means that convention has broken for
                // this account, and the dashboard shows "Balance unavailable"
                // with the row sitting in the database. Naming the account in
                // the log is what makes that answerable without asking the
                // customer to open their browser console.
                \Log::warning('CustomerPaySummaryController - No billing account for the requested identifier', [
                    'requested' => $accountNo,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Billing account not found'
                ], 404);
            }

            // Ordered the same way BillingGenerationController::getInvoices orders the
            // list the dashboard reads today (invoice_date desc, first row), so the date
            // shown does not change depending on which response arrived first.
            $latestInvoice = DB::table('invoices')
                ->where('account_no', $accountNo)
                ->orderByDesc('invoice_date')
                ->select('due_date')
                ->first();

            // Same window as XenditPaymentController::checkPendingPayment. That endpoint
            // also sweeps stale rows to EXPIRED before reading; this one does not, because
            // filtering the read by the same 24-hour window gives the same answer without
            // a table-wide UPDATE on a path the customer is waiting on. The sweep still
            // happens when Pay Now is clicked.
            $hasPendingPayment = DB::table('pending_payments')
                ->where('account_no', $accountNo)
                ->where('status', 'PENDING')
                ->where('payment_date', '>', now()->subHours(24))
                ->exists();

            return response()->json([
                'success' => true,
                'data' => [
                    'accountNo' => $account->account_no,
                    // Cast so the client gets a number rather than a decimal string; a
                    // settled account reads 0, which is a real value and must survive.
                    'accountBalance' => (float) $account->account_balance,
                    'balanceUpdateDate' => $account->balance_update_date,
                    'billingDay' => $account->billing_day,
                    'dueDate' => $latestInvoice->due_date ?? null,
                    'hasPendingPayment' => $hasPendingPayment,
                ]
            ]);
        } catch (\Exception $e) {
            \Log::error('CustomerPaySummaryController - Unexpected Error:', [
                'account_no' => $accountNo,
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'An error occurred while fetching the payment summary'
            ], 500);
        }
    }
}

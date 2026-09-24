<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use App\Models\BillingAccount;
use App\Models\OnlineStatus;
use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use App\Services\ManualRadiusOperationsService;
use App\Events\TransactionUpdated;
use App\Events\TransactionViewingUpdate;

class TransactionController extends Controller
{
    public function broadcastViewing(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'transaction_id' => 'required|string',
                'action' => 'required|string|in:started_viewing,stopped_viewing'
            ]);

            $username = Auth::user()->username ?? Auth::user()->name ?? 'Unknown User';
            
            \Log::info('[Presence] Transaction broadcast:', [
                'transaction_id' => $validated['transaction_id'],
                'username' => $username,
                'action' => $validated['action']
            ]);

            event(new TransactionViewingUpdate(
                $validated['transaction_id'],
                $username,
                $validated['action']
            ));

            return response()->json([
                'success' => true,
                'message' => 'Viewing status broadcasted successfully'
            ]);
        } catch (\Exception $e) {
            \Log::error('Error broadcasting viewing status: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to broadcast viewing status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function index(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $limit = $request->input('limit');
            $offset = $request->input('offset');

            $query = Transaction::with(['account.customer', 'account.technicalDetails', 'processor', 'paymentMethodInfo', 'revert_request']);

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }

            if ($request->has('updated_since')) {
                $query->where('updated_at', '>', $request->input('updated_since'));
                // Increase limit for updates to ensure we get all recent changes
                $limit = $request->input('limit', 1000);
            }

            $query->orderBy('created_at', 'desc')
                ->orderBy('id', 'desc');

            if ($limit && $limit > 0) {
                $transactions = $query->skip($offset ?? 0)->take($limit)->get();
            }
            else {
                $transactions = $query->get();
            }

            \Log::info('Fetched transactions', [
                'count' => $transactions->count(),
                'sample_transaction' => $transactions->first() ? [
                    'id' => $transactions->first()->id,
                    'account_no' => $transactions->first()->account_no,
                    'has_account' => $transactions->first()->account ? true : false,
                    'has_customer' => $transactions->first()->account && $transactions->first()->account->customer ? true : false,
                    'customer_full_name' => $transactions->first()->account && $transactions->first()->account->customer ? $transactions->first()->account->customer->full_name : null
                ] : null
            ]);

            return response()->json([
                'success' => true,
                'data' => $transactions,
                'count' => $transactions->count(),
                'total' => $isSuperAdmin ? Transaction::count() : Transaction::where('organization_id', $organizationId)->count()
            ]);
        }
        catch (\Exception $e) {
            \Log::error('Error fetching transactions: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch transactions',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            \Log::info('Transaction store request received', [
                'request_data' => $request->all()
            ]);

            $validated = $request->validate([
                'account_no' => 'nullable|exists:billing_accounts,account_no',
                // Which types are legal depends on whether the account is prepaid or postpaid —
                // 'Top Up' and 'Recurring Fee' are mutually exclusive. See resolveTypeRule().
                'transaction_type' => $this->resolveTypeRule($request->input('account_no')),
                'received_payment' => 'required|numeric|min:0',
                'payment_date' => 'required|date',
                'date_processed' => 'nullable|date',
                'processed_by_user_id' => 'nullable|exists:users,id',
                'processed_by_user' => 'nullable|string|max:255',
                'created_by_user' => 'nullable|string|max:255',
                'payment_method' => 'required|string|max:255',
                'reference_no' => 'required|string|max:255',
                'or_no' => 'required|string|max:255',
                'remarks' => 'nullable|string',
                'status' => 'nullable|string|max:100',
                'image_url' => 'nullable|string|max:255',
                'auto_apply_payment' => 'nullable|boolean',
                // Prepaid only: the plan this payment buys. Acted on at approval.
                'selected_plan_id' => 'nullable|integer|exists:plan_list,id',
                // Prepaid only: start that plan immediately, forfeiting the rest of the period.
                'activate_now' => 'nullable|boolean',
            ]);

            $this->assertPrepaidOnlyFields($request);

            \Log::info('Transaction validation passed', [
                'validated_data' => $validated
            ]);

            DB::beginTransaction();

            $validated['payment_date'] = \Carbon\Carbon::parse($validated['payment_date'])->format('Y-m-d H:i:s');
            $validated['date_processed'] = isset($validated['date_processed'])
                ?\Carbon\Carbon::parse($validated['date_processed'])->format('Y-m-d H:i:s')
                : now()->format('Y-m-d H:i:s');
            $validated['status'] = $validated['status'] ?? 'Pending';
            $validated['created_by_user'] = $validated['created_by_user'] ?? (Auth::check() ?Auth::user()->email_address : 'unknown');
            $validated['updated_by_user'] = Auth::check() ?Auth::user()->email_address : 'unknown';

            // If processed_by_user is not provided in request, default to authenticated user
            if (!isset($validated['processed_by_user'])) {
                $validated['processed_by_user'] = Auth::check() ?Auth::user()->email_address : 'unknown';
            }

            // Auto-assign organization_id
            $authUser = auth()->user();
            if ($authUser && !isset($validated['organization_id'])) {
                $validated['organization_id'] = $authUser->organization_id;
            }

            $autoApplyPayment = $validated['auto_apply_payment'] ?? false;
            unset($validated['auto_apply_payment']);

            \Log::info('Creating transaction record', [
                'data_to_create' => $validated
            ]);

            $transaction = Transaction::create($validated);

            \Log::info('Transaction record created', [
                'transaction_id' => $transaction->id,
                'account_no' => $transaction->account_no
            ]);

            if ($autoApplyPayment && $transaction->account_no && $transaction->transaction_type !== 'Security Deposit') {
                \Log::info('Auto-applying payment', [
                    'transaction_id' => $transaction->id,
                    'account_no' => $transaction->account_no
                ]);

                $billingAccount = BillingAccount::where('account_no', $transaction->account_no)->first();
                if ($billingAccount) {
                    $appliedData = $this->applyPaymentToAccount(
                        $billingAccount->id,
                        $transaction->account_no,
                        $transaction->received_payment,
                        $transaction->id,
                        Auth::id(),
                        now(),
                        $transaction->transaction_type
                    );

                    $transaction->status = 'Done';
                    $transaction->account_balance_before = $appliedData['old_balance'];
                    $transaction->approved_by = Auth::check() ?Auth::user()->email : 'unknown';
                    $transaction->save();

                    \Log::info('Payment auto-applied successfully', [
                        'transaction_id' => $transaction->id
                    ]);

                    // Send Approval Notifications
                    if ($billingAccount) {
                        $this->sendApprovalSms($billingAccount, $appliedData['invoices_updated']['invoices_paid'] ?? [], $transaction->received_payment, $transaction->payment_date);
                        $this->sendApprovalEmail($billingAccount, $appliedData['invoices_updated']['invoices_paid'] ?? [], $transaction->received_payment, $transaction->payment_date);

                        // Attempt reconnection for auto-applied payments
                        $this->attemptReconnectionAfterApproval($billingAccount, $transaction->updated_by_user, $transaction->transaction_type, $transaction->payment_date, $transaction->selected_plan_id, $transaction->activate_now, (string) ($transaction->reference_no ?? $transaction->id));
                    }

                }
                else {
                    \Log::warning('Billing account not found for auto-apply', [
                        'account_no' => $transaction->account_no
                    ]);
                }
            }

            DB::commit();

            \Log::info('Transaction created successfully', [
                'transaction_id' => $transaction->id
            ]);

            event(new TransactionUpdated(['action' => 'created', 'transaction_id' => $transaction->id, 'account_no' => $transaction->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Transaction created successfully',
                'data' => $transaction->load(['account.customer', 'account.technicalDetails', 'processor', 'paymentMethodInfo'])
            ], 201);
        }
        catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            \Log::error('Transaction validation failed', [
                'errors' => $e->errors(),
                'request_data' => $request->all()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        }
        catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error creating transaction', [
                'error_message' => $e->getMessage(),
                'error_file' => $e->getFile(),
                'error_line' => $e->getLine(),
                'stack_trace' => $e->getTraceAsString(),
                'request_data' => $request->all()
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Failed to create transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show(string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $transaction = Transaction::with(['account.customer', 'account.technicalDetails', 'processor', 'paymentMethodInfo', 'revert_request'])
                ->findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to transaction'
                ], 403);
            }

            return response()->json([
                'success' => true,
                'data' => $transaction
            ]);
        }
        catch (\Exception $e) {
            \Log::error('Error fetching transaction: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Transaction not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    /**
     * The print-ready projection of one transaction, for the receipt / invoice templates.
     *
     * Separate from show() because it answers a different question. show() returns the row as
     * stored; this returns the row as it must PRINT, with every field resolved to something
     * displayable — see TransactionReceiptFormatter for why migrated rows need that and what
     * each fallback chain is for.
     *
     * The client keeps its own derivation and only prefers this block when the call succeeds,
     * so a receipt still prints if this endpoint is unreachable.
     */
    public function receipt(string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // Same eager loads as show(): the formatter reads through these relations first and
            // only falls back to a direct lookup when one of them comes back empty, so loading
            // them here is what keeps a page of reprints from turning into an N+1.
            $transaction = Transaction::with(['account.customer', 'processor', 'paymentMethodInfo'])
                ->findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to transaction'
                ], 403);
            }

            $formatter = app(\App\Services\TransactionReceiptFormatter::class);

            if (!$formatter->isPrintable($transaction->status)) {
                return response()->json([
                    'success' => false,
                    'message' => 'No receipt is available for a transaction that has not been settled',
                    'status' => $transaction->status,
                ], 409);
            }

            return response()->json([
                'success' => true,
                'data' => $formatter->format($transaction),
            ]);
        }
        catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Transaction not found'
            ], 404);
        }
        catch (\Exception $e) {
            \Log::error('Error building transaction receipt: ' . $e->getMessage(), [
                'transaction_id' => $id,
                'trace' => $e->getTraceAsString(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to build receipt',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $request->validate([
                'approved_by' => 'nullable|string|email'
            ]);

            DB::beginTransaction();

            $transaction = Transaction::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to transaction'
                ], 403);
            }

            if ($transaction->status !== 'Pending') {
                return response()->json([
                    'success' => false,
                    'message' => 'Only pending transactions can be approved'
                ], 400);
            }

            $accountNo = $transaction->account_no;
            $paymentReceived = $transaction->received_payment;
            $transactionId = $transaction->id;
            $userId = Auth::id();
            $currentTime = now();

            if (!$accountNo) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Transaction has no associated account number'
                ], 400);
            }

            $billingAccount = BillingAccount::where('account_no', $accountNo)->first();
            if (!$billingAccount) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Billing account not found'
                ], 404);
            }

            \Log::info('Transaction approval started', [
                'transaction_id' => $transactionId,
                'account_no' => $accountNo,
                'account_id' => $billingAccount->id,
                'payment_received' => $paymentReceived,
                'current_balance' => $billingAccount->account_balance
            ]);

            $currentBalance = floatval($billingAccount->account_balance ?? 0);
            $newBalance = $currentBalance;
            $invoiceUpdateResult = ['invoices_paid' => [], 'invoices_partial' => [], 'distribution' => []];

            // --- Snapshot old state BEFORE any changes ---
            $oldBillingAccountBalance = $currentBalance;
            $oldBillingStatusId = $billingAccount->billing_status_id;

            $oldPrepaidState = $this->buildPrepaidSnapshot($billingAccount, $accountNo);

            // Fetch invoices that will be affected (Unpaid/Partial for this account)
            $invoicesBeforeUpdate = \App\Models\Invoice::where('account_no', $accountNo)
                ->whereIn('status', ['Unpaid', 'Partial'])
                ->orderBy('invoice_date', 'asc')
                ->get()
                ->map(fn($inv) => [
                    'table'            => 'invoices',
                    'invoice_id'       => $inv->id,
                    'invoice_date'     => $inv->invoice_date,
                    'old_status'       => $inv->status,
                    'old_received_payment' => floatval($inv->received_payment ?? 0),
                ])
                ->toArray();

            // Snapshot online_status session_group before approval triggers reconnection
            $onlineStatusSnapshot = null;
            $onlineStatusRecord = OnlineStatus::where('account_id', $billingAccount->id)->first();
            if ($onlineStatusRecord) {
                $onlineStatusSnapshot = [
                    'table'               => 'online_status',
                    'account_id'          => $onlineStatusRecord->account_id,
                    'username'            => $onlineStatusRecord->username,
                    'old_session_group'   => $onlineStatusRecord->session_group,
                    'old_session_status'  => $onlineStatusRecord->session_status,
                ];
            }

            if ($transaction->transaction_type !== 'Security Deposit') {
                $newBalance = $currentBalance - $paymentReceived;
                // Prepaid accounts never carry a credit (negative) balance — a settling payment
                // renews the prepaid period instead of banking credit, so overpayment floors to 0.
                // Postpaid / blank generation_type keep the real (possibly negative) balance.
                if (BillingAccount::isPrepaidType($billingAccount->generation_type) && $newBalance < 0) {
                    $newBalance = 0;
                }

                $billingAccount->account_balance = round($newBalance, 2);
                $billingAccount->balance_update_date = $currentTime;
                $billingAccount->updated_by = $userId;
                $billingAccount->save();

                \Log::info('Account balance updated', [
                    'account_no' => $accountNo,
                    'account_id' => $billingAccount->id,
                    'old_balance' => $currentBalance,
                    'new_balance' => $newBalance,
                    'payment_applied' => $paymentReceived
                ]);

                // Service Charge is balance-only: the SO charge it pays for is not an invoice
                // yet (it lands on the NEXT monthly bill), so distributing this payment would mark
                // an unrelated monthly invoice Paid. See Transaction::settlesInvoices().
                if (Transaction::settlesInvoices($transaction->transaction_type)) {
                    $invoiceUpdateResult = $this->updateInvoiceDetails($accountNo, $paymentReceived, $transactionId, $userId, $currentTime);
                }
            }
            else {
                \Log::info('Transaction is Security Deposit, skipping balance and invoice updates', [
                    'transaction_id' => $transactionId,
                    'account_no' => $accountNo
                ]);
            }

            $transaction->status = 'Done';
            $transaction->date_processed = $currentTime;
            $transaction->updated_by_user = $request->input('updated_by_user') ?? (Auth::check() ?Auth::user()->email_address : 'unknown');
            $transaction->approved_by = $request->input('approved_by') ?? (Auth::check() ?Auth::user()->email_address : 'unknown');
            $transaction->account_balance_before = $currentBalance;

            // Build updated_column snapshot of OLD data before this approval
            $updatedColumnSnapshot = [
                [
                    'table'                  => 'billing_accounts',
                    'account_no'             => $accountNo,
                    'old_account_balance'    => round($oldBillingAccountBalance, 2),
                    'old_billing_status_id'  => $oldBillingStatusId,
                ],
            ];
            foreach ($invoicesBeforeUpdate as $inv) {
                $updatedColumnSnapshot[] = $inv;
            }
            if ($onlineStatusSnapshot) {
                $updatedColumnSnapshot[] = $onlineStatusSnapshot;
            }
            // Prepaid expiry / plan / pending-plan, so a revert can undo what
            // attemptReconnectionAfterApproval() is about to change.
            $updatedColumnSnapshot[] = $oldPrepaidState;
            $transaction->updated_column = $updatedColumnSnapshot;

            $transaction->save();

            DB::commit();

            // Create Activity Log
            \App\Models\ActivityLog::log(
                'Transaction Approved',
                "Transaction #{$transactionId} ($accountNo) approved by " . (Auth::user()->email_address ?? 'User'),
                'info',
            [
                'resource_type' => 'Transaction',
                'resource_id' => $transactionId,
                'additional_data' => [
                    'account_no' => $accountNo,
                    'payment_received' => $paymentReceived,
                    'new_balance' => $newBalance,
                    'invoices_paid' => $invoiceUpdateResult['invoices_paid'],
                    'distribution' => $invoiceUpdateResult['distribution']
                ]
            ]
            );

            \Log::info('Transaction approved successfully', [
                'transaction_id' => $transactionId,
                'account_no' => $accountNo,
                'status' => 'Done',
                'invoices_paid' => $invoiceUpdateResult['invoices_paid'],
                'invoices_partial' => $invoiceUpdateResult['invoices_partial']
            ]);

            // Send Approval Notifications (previously only on Paid status)
            $this->sendApprovalSms($billingAccount, $invoiceUpdateResult['invoices_paid'] ?? [], $paymentReceived, $transaction->payment_date);
            $this->sendApprovalEmail($billingAccount, $invoiceUpdateResult['invoices_paid'] ?? [], $paymentReceived, $transaction->payment_date);


            // Attempt reconnection after successful approval
            $reconnectStatus = $this->attemptReconnectionAfterApproval($billingAccount, $transaction->updated_by_user, $transaction->transaction_type, $transaction->payment_date, $transaction->selected_plan_id, $transaction->activate_now, (string) ($transaction->reference_no ?? $transaction->id));

            event(new TransactionUpdated(['action' => 'approved', 'transaction_id' => $transactionId, 'account_no' => $accountNo]));

            return response()->json([
                'success' => true,
                'message' => 'Transaction approved successfully',
                'data' => [
                    'transaction' => $transaction,
                    'new_balance' => $newBalance,
                    'status' => 'Done',
                    'invoices_paid' => $invoiceUpdateResult['invoices_paid'],
                    'invoices_partial' => $invoiceUpdateResult['invoices_partial'],
                    'payment_distribution' => $invoiceUpdateResult['distribution'],
                    'reconnect_status' => $reconnectStatus
                ]
            ]);
        }
        catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error approving transaction: ' . $e->getMessage());
            \Log::error('Stack trace: ' . $e->getTraceAsString());
            return response()->json([
                'success' => false,
                'message' => 'Failed to approve transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function revert(Request $request, string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            DB::beginTransaction();

            $transaction = Transaction::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to transaction'
                ], 403);
            }

            if ($transaction->status !== 'Done') {
                return response()->json([
                    'success' => false,
                    'message' => 'Only approved transactions can be reverted'
                ], 400);
            }

            $accountNo = $transaction->account_no;
            $paymentToRevert = floatval($transaction->received_payment);
            $transactionId = $transaction->id;
            $userId = Auth::id();
            $currentTime = now();

            if (!$accountNo) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Transaction has no associated account number'
                ], 400);
            }

            $billingAccount = BillingAccount::where('account_no', $accountNo)->first();
            if (!$billingAccount) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Billing account not found'
                ], 404);
            }

            $currentBalance = floatval($billingAccount->account_balance ?? 0);

            \Log::info('Transaction revert started', [
                'transaction_id' => $transactionId,
                'account_no' => $accountNo,
                'payment_to_revert' => $paymentToRevert,
                'current_balance' => $currentBalance
            ]);

            $revertedInvoices = [];
            $newBalance = $currentBalance;

            if ($transaction->transaction_type !== 'Security Deposit') {
                // 1. Revert Account Balance
                $newBalance = $currentBalance + $paymentToRevert;

                $billingAccount->account_balance = round($newBalance, 2);
                $billingAccount->balance_update_date = $currentTime;
                $billingAccount->updated_by = $userId;
                $billingAccount->save();

                // 2. Revert Invoice Payments
                // Find invoices updated by this transaction
                $invoices = \App\Models\Invoice::where('transaction_id', (string)$transactionId)
                    ->orderBy('invoice_date', 'desc') // Revert in reverse order of application
                    ->get();

                $remainingToRevert = $paymentToRevert;

                foreach ($invoices as $invoice) {
                    if ($remainingToRevert <= 0)
                        break;

                    $currentReceived = floatval($invoice->received_payment ?? 0);

                    // Subtract as much as possible from this invoice
                    $toSubtract = min($currentReceived, $remainingToRevert);

                    $newReceived = $currentReceived - $toSubtract;
                    $invoice->received_payment = round($newReceived, 2);

                    // Update status
                    if ($newReceived <= 0) {
                        $invoice->status = 'Unpaid';
                    }
                    else {
                        $invoice->status = 'Partial';
                    }

                    // Clear transaction_id since we're reverting
                    $invoice->transaction_id = null;
                    $invoice->updated_by = Auth::check() ?Auth::user()->email_address : 'unknown';
                    $invoice->updated_at = $currentTime;
                    $invoice->save();

                    $remainingToRevert -= $toSubtract;
                    $revertedInvoices[] = [
                        'invoice_id' => $invoice->id,
                        'amount_reverted' => $toSubtract,
                        'new_status' => $invoice->status
                    ];
                }
            }
            else {
                \Log::info('Transaction is Security Deposit, skipping balance and invoice reverts', [
                    'transaction_id' => $transactionId,
                    'account_no' => $accountNo
                ]);
            }

            // 3. Update Transaction Status
            $transaction->status = 'Pending';
            $transaction->date_processed = null;
            $transaction->approved_by = null;
            $transaction->account_balance_before = null;
            $transaction->updated_by_user = $request->input('updated_by_user') ?? (Auth::check() ?Auth::user()->email_address : 'unknown');
            $transaction->save();

            DB::commit();

            // Create Activity Log
            \App\Models\ActivityLog::log(
                'Transaction Reverted',
                "Transaction #{$transactionId} ($accountNo) reverted by " . (Auth::user()->email_address ?? 'User'),
                'warning',
            [
                'resource_type' => 'Transaction',
                'resource_id' => $transactionId,
                'additional_data' => [
                    'account_no' => $accountNo,
                    'payment_amount' => $paymentToRevert,
                    'new_balance' => $newBalance,
                    'reverted_invoices' => $revertedInvoices
                ]
            ]
            );

            // Reconcile billing_status/RADIUS against the account's current prepaid_expires_at,
            // now that the revert is durable. This endpoint (unlike the admin-approval revert
            // workflow) never touched billing_status/RADIUS before, so a reverted payment that had
            // extended a prepaid period or reconnected the customer left both stale. Security
            // Deposit transactions never affect balance/expiry, so there is nothing to reconcile.
            // Never throws — see the service's contract.
            $prepaidEnforcement = null;
            if ($transaction->transaction_type !== 'Security Deposit') {
                $prepaidEnforcement = app(\App\Services\PrepaidRevertReconciliationService::class)->reconcileAfterRevert(
                    $accountNo,
                    null,
                    Auth::check() ? Auth::user()->email_address : 'System',
                    $userId
                );
            }

            return response()->json([
                'success' => true,
                'message' => 'Transaction reverted successfully',
                'data' => [
                    'transaction' => $transaction,
                    'new_balance' => $newBalance,
                    'reverted_invoices' => $revertedInvoices
                ],
                'prepaid_enforcement' => $prepaidEnforcement
            ]);
        }
        catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error reverting transaction: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to revert transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Validation rule for transaction_type, narrowed to what the account may actually record.
     *
     * A prepaid account gets 'Top Up' and a postpaid one 'Recurring Fee'; the other three types
     * are legal on both. This is the server-side half of the dropdown the transaction form builds
     * from the same list ({@see Transaction::typesForGenerationType()}) — the client is filtered
     * for usability, but the client is not what enforces it. Without this, a stale browser tab
     * open since before the deploy would happily post 'Recurring Fee' against a prepaid account
     * and produce exactly the mislabelled row the backfill migration exists to clean up.
     *
     * When the account cannot be resolved (no account_no — a transaction not tied to an account)
     * every known type is accepted, since there is no account type to contradict.
     *
     * @param bool $required store() demands a type; update() leaves it optional.
     * @param string|null $currentType The type the transaction ALREADY has, on an edit. Always
     *   permitted, even when retired: 'Security Deposit' is no longer offered for new
     *   transactions, but a pending one recorded before it was retired must still be editable —
     *   correcting its OR number should not be blocked by, or silently change, its type.
     * @return array<int, mixed>
     */
    private function resolveTypeRule(?string $accountNo, bool $required = true, ?string $currentType = null): array
    {
        $generationType = $accountNo
            ? BillingAccount::where('account_no', $accountNo)->value('generation_type')
            : null;

        $allowed = $accountNo
            ? Transaction::typesForGenerationType($generationType)
            : array_merge([Transaction::TYPE_RECURRING_FEE, Transaction::TYPE_TOP_UP], Transaction::SHARED_TYPES);

        if ($currentType !== null && !in_array($currentType, $allowed, true)) {
            $allowed[] = $currentType;
        }

        return [$required ? 'required' : 'nullable', \Illuminate\Validation\Rule::in($allowed)];
    }

    /**
     * Reject the prepaid-only fields when the account is postpaid.
     *
     * selected_plan_id and activate_now describe buying a prepaid plan. On a postpaid account the
     * approval path ignores both — PrepaidPlanChangeService no-ops on a non-prepaid account — so
     * accepting them would silently swallow a caller's intent and leave a row whose columns claim
     * something that never happened. Better to say so.
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    private function assertPrepaidOnlyFields(Request $request, ?string $accountNo = null): void
    {
        $accountNo = $accountNo ?? $request->input('account_no');

        if (!$accountNo) {
            return;
        }

        $generationType = BillingAccount::where('account_no', $accountNo)->value('generation_type');

        if (BillingAccount::isPrepaidType($generationType)) {
            return;
        }

        $offending = [];

        if (filled($request->input('selected_plan_id'))) {
            $offending['selected_plan_id'] = 'A plan can only be bought on a prepaid account.';
        }

        // boolean() rather than filled(): an explicit `activate_now: false` is a client saying
        // "no", which is the correct answer for a postpaid account and must not be an error.
        if ($request->boolean('activate_now')) {
            $offending['activate_now'] = 'Activate Now applies to prepaid accounts only.';
        }

        if ($offending === []) {
            return;
        }

        throw \Illuminate\Validation\ValidationException::withMessages($offending);
    }

    /**
     * Capture the prepaid-specific state of an account before an approval mutates it.
     *
     * Needed because attemptReconnectionAfterApproval() runs AFTER the approval commits
     * and changes fields nothing else recorded, leaving a revert unable to undo them:
     *
     *   PrepaidRenewalService     moves prepaid_expires_at forward (+30 days)
     *   PrepaidPlanChangeService  either switches plan_id immediately, or queues the
     *                             switch via pending_plan_id / pending_plan_effective_at
     *
     * Must be called with the account as loaded BEFORE any mutation, so the values are
     * the genuine pre-approval ones.
     *
     * Recorded for every account, prepaid or not. `was_prepaid` lets the revert decide
     * what to do, and capturing unconditionally means an account whose generation_type
     * changes between approve and revert still restores correctly. Datetimes are stored
     * as strings so the JSON snapshot round-trips without depending on cast behaviour.
     *
     * @return array<string, mixed> one `updated_column` entry
     */
    private function buildPrepaidSnapshot(BillingAccount $billingAccount, string $accountNo): array
    {
        $asString = static function ($value): ?string {
            if (empty($value)) {
                return null;
            }
            try {
                return \Carbon\Carbon::parse($value)->toDateTimeString();
            } catch (\Throwable $e) {
                return null;
            }
        };

        return [
            'table'                         => 'billing_accounts_prepaid',
            'account_no'                    => $accountNo,
            'was_prepaid'                   => BillingAccount::isPrepaidType($billingAccount->generation_type),
            'old_generation_type'           => $billingAccount->generation_type,
            'old_prepaid_expires_at'        => $asString($billingAccount->prepaid_expires_at),
            'old_plan_id'                   => $billingAccount->plan_id,
            'old_pending_plan_id'           => $billingAccount->pending_plan_id ?? null,
            'old_pending_plan_effective_at' => $asString($billingAccount->pending_plan_effective_at ?? null),
        ];
    }

    /**
     * @param string|null $transactionType Decides whether the payment is also distributed across
     *   unpaid invoices or is balance-only. See {@see Transaction::settlesInvoices()}. Defaults to
     *   null, which settles invoices — the historical behaviour for every caller that predates the
     *   prepaid/postpaid split.
     */
    private function applyPaymentToAccount(int $accountId, string $accountNo, float $paymentReceived, int $transactionId, ?int $userId, $currentTime, ?string $transactionType = null): array
    {
        $billingAccount = BillingAccount::find($accountId);
        if (!$billingAccount) {
            throw new \Exception('Billing account not found');
        }

        $currentBalance = floatval($billingAccount->account_balance ?? 0);
        $newBalance = $currentBalance - $paymentReceived;
        // Prepaid accounts never carry a credit (negative) balance — overpayment floors to 0.
        // Postpaid / blank generation_type keep the real (possibly negative) balance.
        if (BillingAccount::isPrepaidType($billingAccount->generation_type) && $newBalance < 0) {
            $newBalance = 0;
        }

        $billingAccount->account_balance = round($newBalance, 2);
        $billingAccount->balance_update_date = $currentTime;
        $billingAccount->updated_by = $userId;
        $billingAccount->save();

        // Balance-only for Service Charge — see Transaction::settlesInvoices().
        $invoiceResults = Transaction::settlesInvoices($transactionType)
            ? $this->updateInvoiceDetails($accountNo, $paymentReceived, $transactionId, $userId, $currentTime)
            : ['invoices_paid' => [], 'invoices_partial' => [], 'distribution' => []];

        return [
            'old_balance' => $currentBalance,
            'new_balance' => $newBalance,
            'payment_applied' => $paymentReceived,
            'invoices_updated' => $invoiceResults
        ];
    }

    private function updateInvoiceDetails(string $accountNo, float $paymentReceived, int $transactionId, ?int $userId, $currentTime): array
    {
        $invoices = \App\Models\Invoice::where('account_no', $accountNo)
            ->whereIn('status', ['Unpaid', 'Partial'])
            ->orderBy('invoice_date', 'asc')
            ->get();

        \Log::info('Processing invoices for payment', [
            'account_no' => $accountNo,
            'payment_amount' => $paymentReceived,
            'unpaid_invoices_count' => $invoices->count()
        ]);

        $remainingPayment = $paymentReceived;
        $invoicesPaid = [];
        $invoicesPartial = [];
        $distribution = [];

        foreach ($invoices as $invoice) {
            if ($remainingPayment <= 0) {
                break;
            }

            $totalAmount = floatval($invoice->total_amount ?? 0);
            $currentReceived = floatval($invoice->received_payment ?? 0);
            $amountDue = $totalAmount - $currentReceived;

            \Log::info('Processing invoice', [
                'invoice_id' => $invoice->id,
                'total_amount' => $totalAmount,
                'current_received' => $currentReceived,
                'amount_due' => $amountDue,
                'remaining_payment' => $remainingPayment
            ]);

            $paymentApplied = 0;

            if ($remainingPayment >= $amountDue) {
                $invoice->received_payment = round($totalAmount, 2);
                $invoice->status = 'Paid';
                $paymentApplied = $amountDue;
                $remainingPayment -= $amountDue;
                $invoicesPaid[] = [
                    'invoice_id' => $invoice->id,
                    'invoice_date' => $invoice->invoice_date,
                    'amount_paid' => $amountDue,
                    'total_amount' => $totalAmount,
                    'status' => 'Paid'
                ];
                \Log::info('Invoice fully paid', [
                    'invoice_id' => $invoice->id,
                    'amount_paid' => $amountDue,
                    'remaining_payment' => $remainingPayment
                ]);
            }
            else {
                $invoice->received_payment = round($currentReceived + $remainingPayment, 2);
                $invoice->status = 'Partial';
                $paymentApplied = $remainingPayment;
                $invoicesPartial[] = [
                    'invoice_id' => $invoice->id,
                    'invoice_date' => $invoice->invoice_date,
                    'amount_paid' => $remainingPayment,
                    'amount_due' => $amountDue - $remainingPayment,
                    'total_amount' => $totalAmount,
                    'status' => 'Partial'
                ];
                \Log::info('Invoice partially paid', [
                    'invoice_id' => $invoice->id,
                    'amount_paid' => $remainingPayment,
                    'new_received' => $invoice->received_payment,
                    'still_owed' => $amountDue - $remainingPayment
                ]);
                $remainingPayment = 0;
            }

            $distribution[] = [
                'invoice_id' => $invoice->id,
                'invoice_date' => $invoice->invoice_date,
                'total_amount' => $totalAmount,
                'previous_received' => $currentReceived,
                'payment_applied' => $paymentApplied,
                'new_received' => $invoice->received_payment,
                'status' => $invoice->status
            ];

            $invoice->transaction_id = $transactionId;
            $invoice->updated_by = Auth::check() ?Auth::user()->email_address : 'unknown';
            $invoice->updated_at = $currentTime;
            $invoice->save();
        }

        \Log::info('Invoice payment distribution complete', [
            'total_payment' => $paymentReceived,
            'remaining_payment' => $remainingPayment,
            'invoices_paid_count' => count($invoicesPaid),
            'invoices_partial_count' => count($invoicesPartial)
        ]);

        return [
            'invoices_paid' => $invoicesPaid,
            'invoices_partial' => $invoicesPartial,
            'distribution' => $distribution,
            'remaining_payment' => $remainingPayment
        ];
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $request->validate([
                'status' => 'required|string|in:Pending,Done,Processing,Cancelled,Failed'
            ]);

            DB::beginTransaction();

            $transaction = Transaction::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to transaction'
                ], 403);
            }
            $transaction->status = $request->status;
            $transaction->updated_by_user = Auth::check() ?Auth::user()->email_address : 'unknown';
            $transaction->save();

            DB::commit();

            event(new TransactionUpdated(['action' => 'status_updated', 'transaction_id' => $transaction->id]));

            return response()->json([
                'success' => true,
                'message' => 'Transaction status updated successfully',
                'data' => $transaction
            ]);
        }
        catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error updating transaction status: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update transaction status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            // The account cannot be reassigned by an edit, so the type rule is judged against the
            // account the transaction already belongs to. Read before validate() because that is
            // what decides whether 'Top Up' or 'Recurring Fee' is the legal recurring type here —
            // and because the row's existing type stays permitted even if it has since been
            // retired, so an old pending transaction remains editable.
            $existing = Transaction::where('id', $id)->first(['account_no', 'transaction_type']);
            $existingAccountNo = $existing->account_no ?? null;

            $validated = $request->validate([
                'transaction_type' => $this->resolveTypeRule($existingAccountNo, false, $existing->transaction_type ?? null),
                'received_payment' => 'nullable|numeric|min:0',
                'payment_date' => 'nullable|date',
                'payment_method' => 'nullable|string|max:255',
                'reference_no' => 'nullable|string|max:255',
                'or_no' => 'nullable|string|max:255',
                'remarks' => 'nullable|string',
                'image_url' => 'nullable|string|max:255',
                // Kept editable while the transaction is still Pending, so a mis-keyed plan can
                // be corrected before approval acts on it.
                'selected_plan_id' => 'nullable|integer|exists:plan_list,id',
                'activate_now' => 'nullable|boolean',
            ]);

            $this->assertPrepaidOnlyFields($request, $existingAccountNo);

            DB::beginTransaction();

            $transaction = Transaction::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to transaction'
                ], 403);
            }

            if ($transaction->status !== 'Pending') {
                return response()->json([
                    'success' => false,
                    'message' => 'Only pending transactions can be edited'
                ], 400);
            }

            if (isset($validated['payment_date'])) {
                $validated['payment_date'] = \Carbon\Carbon::parse($validated['payment_date'])->format('Y-m-d H:i:s');
            }

            $validated['updated_by_user'] = Auth::check() ? Auth::user()->email_address : 'unknown';

            $transaction->update($validated);

            DB::commit();

            event(new TransactionUpdated(['action' => 'updated', 'transaction_id' => $transaction->id, 'account_no' => $transaction->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Transaction updated successfully',
                'data' => $transaction->load(['account.customer', 'account.technicalDetails', 'processor', 'paymentMethodInfo'])
            ]);
        }
        // Ahead of the generic handler below, which would otherwise report a rejected field as a
        // 500 "Failed to update transaction" and give the form nothing to show against the input.
        // Mirrors store(), which has always separated the two.
        catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        }
        catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error updating transaction: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function batchApprove(Request $request): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            \Log::info('Batch approve request received', [
                'transaction_ids' => $request->input('transaction_ids'),
                'transaction_ids_type' => gettype($request->input('transaction_ids')),
                'first_id_type' => $request->input('transaction_ids.0') ? gettype($request->input('transaction_ids.0')) : 'null'
            ]);

            $validated = $request->validate([
                'transaction_ids' => 'required|array',
                'transaction_ids.*' => 'required|exists:transactions,id',
                'approved_by' => 'nullable|string|email'
            ]);

            $transactionIds = $validated['transaction_ids'];
            $results = [
                'success' => [],
                'failed' => [],
                'total' => count($transactionIds)
            ];

            $accountPayments = []; // Track consolidated payments per account for notifications

            foreach ($transactionIds as $transactionId) {
                try {
                    DB::beginTransaction();

                    $transaction = Transaction::findOrFail($transactionId);

                    if (!$isSuperAdmin && $organizationId && $transaction->organization_id !== $organizationId) {
                        $results['failed'][] = [
                            'transaction_id' => $transactionId,
                            'reason' => 'Unauthorized access to transaction'
                        ];
                        DB::rollBack();
                        continue;
                    }

                    if ($transaction->status !== 'Pending') {
                        $results['failed'][] = [
                            'transaction_id' => $transactionId,
                            'reason' => 'Only pending transactions can be approved',
                            'current_status' => $transaction->status
                        ];
                        DB::rollBack();
                        continue;
                    }

                    $accountNo = $transaction->account_no;
                    $paymentReceived = $transaction->received_payment;
                    $userId = Auth::id();
                    $currentTime = now();

                    if (!$accountNo) {
                        $results['failed'][] = [
                            'transaction_id' => $transactionId,
                            'reason' => 'Transaction has no associated account number'
                        ];
                        DB::rollBack();
                        continue;
                    }

                    $billingAccount = BillingAccount::where('account_no', $accountNo)->first();
                    if (!$billingAccount) {
                        $results['failed'][] = [
                            'transaction_id' => $transactionId,
                            'reason' => 'Billing account not found',
                            'account_no' => $accountNo
                        ];
                        DB::rollBack();
                        continue;
                    }

                    $currentBalance = floatval($billingAccount->account_balance ?? 0);
                    $newBalance = $currentBalance;
                    $invoiceUpdateResult = ['invoices_paid' => [], 'invoices_partial' => [], 'distribution' => []];

                    // --- Snapshot old state BEFORE any changes ---
                    $oldBillingAccountBalance = $currentBalance;
                    $oldBillingStatusId = $billingAccount->billing_status_id;
                    // Same prepaid capture as the single approve() path, so a batch-approved
                    // transaction is just as revertable as an individually approved one.
                    $batchPrepaidState = $this->buildPrepaidSnapshot($billingAccount, $accountNo);
                    $invoicesBeforeUpdate = \App\Models\Invoice::where('account_no', $accountNo)
                        ->whereIn('status', ['Unpaid', 'Partial'])
                        ->orderBy('invoice_date', 'asc')
                        ->get()
                        ->map(fn($inv) => [
                            'table'            => 'invoices',
                            'invoice_id'       => $inv->id,
                            'invoice_date'     => $inv->invoice_date,
                            'old_status'       => $inv->status,
                            'old_received_payment' => floatval($inv->received_payment ?? 0),
                        ])
                        ->toArray();

                    // Snapshot online_status session_group before approval triggers reconnection
                    $batchOnlineStatusSnapshot = null;
                    $batchOnlineStatusRecord = OnlineStatus::where('account_id', $billingAccount->id)->first();
                    if ($batchOnlineStatusRecord) {
                        $batchOnlineStatusSnapshot = [
                            'table'               => 'online_status',
                            'account_id'          => $batchOnlineStatusRecord->account_id,
                            'username'            => $batchOnlineStatusRecord->username,
                            'old_session_group'   => $batchOnlineStatusRecord->session_group,
                            'old_session_status'  => $batchOnlineStatusRecord->session_status,
                        ];
                    }

                    if ($transaction->transaction_type !== 'Security Deposit') {
                        $newBalance = $currentBalance - $paymentReceived;
                        // Prepaid accounts never carry a credit (negative) balance — overpayment floors to 0.
                        // Postpaid / blank generation_type keep the real (possibly negative) balance.
                        if (BillingAccount::isPrepaidType($billingAccount->generation_type) && $newBalance < 0) {
                            $newBalance = 0;
                        }

                        $billingAccount->account_balance = round($newBalance, 2);
                        $billingAccount->balance_update_date = $currentTime;
                        $billingAccount->updated_by = $userId;
                        $billingAccount->save();

                        // Balance-only for Service Charge — see approve() and
                        // Transaction::settlesInvoices().
                        if (Transaction::settlesInvoices($transaction->transaction_type)) {
                            $invoiceUpdateResult = $this->updateInvoiceDetails($accountNo, $paymentReceived, $transaction->id, $userId, $currentTime);
                        }
                    }

                    $transaction->status = 'Done';
                    $transaction->date_processed = $currentTime;
                    $transaction->updated_by_user = $request->input('updated_by_user') ?? (Auth::check() ?Auth::user()->email_address : 'unknown');
                    $transaction->approved_by = $request->input('approved_by') ?? (Auth::check() ?Auth::user()->email_address : 'unknown');
                    $transaction->account_balance_before = $currentBalance;

                    // Build updated_column snapshot of OLD data before this approval
                    $batchSnapshot = [
                        [
                            'table'                  => 'billing_accounts',
                            'account_no'             => $accountNo,
                            'old_account_balance'    => round($oldBillingAccountBalance, 2),
                            'old_billing_status_id'  => $oldBillingStatusId,
                        ],
                    ];
                    foreach ($invoicesBeforeUpdate as $inv) {
                        $batchSnapshot[] = $inv;
                    }
                    if ($batchOnlineStatusSnapshot) {
                        $batchSnapshot[] = $batchOnlineStatusSnapshot;
                    }
                    $batchSnapshot[] = $batchPrepaidState;
                    $transaction->updated_column = $batchSnapshot;

                    $transaction->save();

                    DB::commit();

                    // Track for consolidated notification (Always track success now)
                    if (!isset($accountPayments[$accountNo])) {
                        $accountPayments[$accountNo] = [
                            'account' => $billingAccount,
                            'invoices' => [],
                            'total' => 0,
                            'payment_date' => $transaction->payment_date
                        ];
                    }
                    if (!empty($invoiceUpdateResult['invoices_paid'])) {
                        $accountPayments[$accountNo]['invoices'] = array_merge($accountPayments[$accountNo]['invoices'], $invoiceUpdateResult['invoices_paid']);
                    }
                    $accountPayments[$accountNo]['total'] += $paymentReceived;

                    // Attempt reconnection after successful approval
                    $reconnectStatus = $this->attemptReconnectionAfterApproval($billingAccount, $transaction->updated_by_user, $transaction->transaction_type, $transaction->payment_date, $transaction->selected_plan_id, $transaction->activate_now, (string) ($transaction->reference_no ?? $transaction->id));

                    $results['success'][] = [
                        'transaction_id' => $transactionId,
                        'account_no' => $accountNo,
                        'payment_applied' => $paymentReceived,
                        'new_balance' => $newBalance,
                        'invoices_paid' => count($invoiceUpdateResult['invoices_paid']),
                        'invoices_partial' => count($invoiceUpdateResult['invoices_partial']),
                        'reconnect_status' => $reconnectStatus
                    ];

                    \Log::info('Batch approval - Transaction approved', [
                        'transaction_id' => $transactionId,
                        'account_no' => $accountNo,
                        'reconnect_status' => $reconnectStatus
                    ]);
                }
                catch (\Exception $e) {
                    DB::rollBack();
                    $results['failed'][] = [
                        'transaction_id' => $transactionId,
                        'reason' => $e->getMessage()
                    ];
                    \Log::error('Batch approval - Transaction failed', [
                        'transaction_id' => $transactionId,
                        'error' => $e->getMessage()
                    ]);
                }
            }

            // Send consolidated notifications for each account (Successfully approved)
            foreach ($accountPayments as $accountNo => $data) {
                $this->sendApprovalSms($data['account'], $data['invoices'], $data['total'], $data['payment_date'] ?? null);
                $this->sendApprovalEmail($data['account'], $data['invoices'], $data['total'], $data['payment_date'] ?? null);
            }


            $successCount = count($results['success']);
            $failedCount = count($results['failed']);

            \Log::info('Batch approval completed', [
                'total' => $results['total'],
                'success' => $successCount,
                'failed' => $failedCount
            ]);

            event(new TransactionUpdated(['action' => 'batch_approved', 'success_count' => $successCount]));

            return response()->json([
                'success' => true,
                'message' => "Batch approval completed: {$successCount} successful, {$failedCount} failed",
                'data' => $results
            ]);
        }
        catch (\Exception $e) {
            \Log::error('Batch approval error: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to process batch approval',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function uploadImages(Request $request): JsonResponse
    {
        try {
            $folderName = $request->input('folder_name', 'transactions');

            $googleDriveService = new \App\Services\GoogleDriveService();
            $folderId = $googleDriveService->createFolder($folderName);

            $imageUrls = [];

            if ($request->hasFile('payment_proof_image')) {
                $file = $request->file('payment_proof_image');
                $fileName = 'payment_proof_' . time() . '.' . $file->getClientOriginalExtension();

                $fileUrl = $googleDriveService->uploadFile(
                    $file,
                    $folderId,
                    $fileName,
                    $file->getMimeType()
                );

                if ($fileUrl) {
                    $imageUrls['payment_proof_image_url'] = $fileUrl;
                }
            }

            return response()->json([
                'success' => true,
                'message' => 'Images uploaded successfully',
                'data' => $imageUrls,
                'folder_id' => $folderId
            ]);
        }
        catch (\Exception $e) {
            \Log::error('Error uploading transaction images: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to upload images',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Attempt to reconnect user account after transaction approval
     * Only reconnects if billing_status_id is not 1 (Active) and balance is 0 or negative
     */
    private function attemptReconnectionAfterApproval($billingAccount, $updatedByUser = 'System', $transactionType = null, $paymentDate = null, $selectedPlanId = null, $activateNow = false, ?string $paymentReference = null): string
    {
        try {
            // Reload billing account to get latest balance and status
            $billingAccount = BillingAccount::find($billingAccount->id);
            $accountNo = $billingAccount->account_no;

            \Log::info('[TRANSACTION RECONNECT] Starting check for account: ' . $accountNo);

            // Step 1: Check if balance qualifies (0 or negative)
            $balance = floatval($billingAccount->account_balance ?? 0);
            if ($balance > 0) {
                \Log::info('[TRANSACTION RECONNECT SKIP] Balance is positive: ₱' . $balance);
                return 'balance_positive';
            }

            // The balance is settled, so this account's pullouts are void — closed
            // here, before any of the RADIUS checks below can return early.
            app(\App\Services\PulloutServiceOrderCloser::class)
                ->closeIfSettled($accountNo, $balance, 'transaction approval', $paymentReference);

            // Prepaid: a settling *service* payment extends (if still active) or restarts (if
            // expired) the prepaid service period, and acts on any plan bought with it. Done
            // BEFORE the already-online short-circuit below so an early payer whose session is
            // still up still gets extended. No-op for postpaid accounts. Anchored to the actual
            // payment date.
            //
            // Guarded by Transaction::grantsService(): a Security Deposit, Installation Fee or
            // Service Charge is not payment for service time, so none of them may grant prepaid
            // days OR switch a customer's plan.
            if (Transaction::grantsService($transactionType)) {
                $prepaidPayDate = $paymentDate ? \Carbon\Carbon::parse($paymentDate) : null;

                // One call rather than renew-then-plan-change: "Activate Now" makes the two steps
                // interdependent, and settlePayment() owns that ordering for both payment
                // pipelines. Mirrors PaymentWorkerService.
                $settled = app(\App\Services\PrepaidPlanChangeService::class)
                    ->settlePayment($accountNo, $selectedPlanId, (bool) $activateNow, $prepaidPayDate);

                $prepaidRenewal = $settled['renewal'];
                $planChange = $settled['plan_change'];

                if (!empty($prepaidRenewal['prepaid'])) {
                    \Log::info("[TRANSACTION RECONNECT] Prepaid period {$prepaidRenewal['mode']} for {$accountNo} — new expiry: {$prepaidRenewal['new_expiry']}"
                        . (!empty($prepaidRenewal['forfeited_days']) ? " ({$prepaidRenewal['forfeited_days']} day(s) forfeited)" : ''));
                }

                if (($planChange['action'] ?? 'none') !== 'none') {
                    \Log::info("[TRANSACTION RECONNECT] Prepaid plan {$planChange['action']} for {$accountNo} — plan: {$planChange['plan']}"
                        . (isset($planChange['effective_at']) ? " effective {$planChange['effective_at']}" : ''));
                }
            }

            // Step 2: Check current billing status.
            $isAlreadyActive = ($billingAccount->billing_status_id == 1);

            // Step 2b: If the account is already active in billing AND the customer is
            // genuinely Online in RADIUS, there is nothing to fix — the payment's balance
            // deduction and invoice update are already committed. Do nothing else: no queue
            // cancel, no RADIUS reconnect, no pullout handling. Just record and return.
            //
            // Only when the customer is NOT Online (Offline / Disconnected / Restricted /
            // missing) — or the account is not active — do we run the settlement flow below
            // (cancel queued disconnects, RADIUS reconnect, fail pullout SOs).
            if ($isAlreadyActive) {
                $sessionStatus = DB::table('online_status')
                    ->where('account_no', $accountNo)
                    ->value('session_status');

                if (strcasecmp(trim((string) $sessionStatus), 'Online') === 0) {
                    \Log::info("[TRANSACTION RECONNECT SKIP] Account {$accountNo} already active and session_status=Online — balance deducted & invoice updated only, no further action.");
                    return 'already_online';
                }

                \Log::info("[TRANSACTION RECONNECT PROCEED] Account {$accountNo} active in billing but session_status='" . ($sessionStatus ?? 'null') . "' (not Online) — proceeding with RADIUS reconnect.");
            }

            // Balance is now settled (0 or negative) and a reconnect is warranted. Cancel any
            // pending disconnection / restriction still queued for this account so the RADIUS
            // queue cron won't restrict a customer who has already paid.
            $this->cancelPendingDisconnectionsInQueue($accountNo, $updatedByUser);

            // Step 3: Get account details (PPPoE Username and Plan)
            // Join with technical_details for username, and customers for plan
            $accountInfo = DB::table('billing_accounts')
                ->leftJoin('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                ->leftJoin('technical_details', 'billing_accounts.id', '=', 'technical_details.account_id')
                ->where('billing_accounts.id', $billingAccount->id)
                ->select('technical_details.username as pppoe_username', 'customers.desired_plan')
                ->first();

            $username = $accountInfo->pppoe_username ?? null;
            $plan = $accountInfo->desired_plan ?? null;

            if (empty($username)) {
                \Log::info('[TRANSACTION RECONNECT SKIP] No PPPoE username found in technical_details');
                return 'no_username';
            }

            if (empty($plan)) {
                \Log::info('[TRANSACTION RECONNECT SKIP] No plan found');
                return 'no_plan';
            }
            \Log::info('[TRANSACTION RECONNECT PROCEED] Conditions met - Proceeding with reconnection. Current Status Active: ' . ($isAlreadyActive ? 'Yes' : 'No') . ', Balance: ₱' . $balance);

            // Step 5: Prepare parameters for ManualRadiusOperationsService
            $params = [
                'accountNumber' => $accountNo,
                'username' => $username,
                'plan' => $plan,
                'updatedBy' => $updatedByUser,
                'remarks' => 'Transaction Approval Auto-Reconnect'
            ];

            // Step 6: Call ManualRadiusOperationsService reconnectUser
            // This will:
            // 1. Update Radius Group (to plan name)
            // 2. Kill User Session (isDisconnectAction = true)
            // 3. Update DB Status (again)
            \Log::info('[TRANSACTION RECONNECT EXECUTE] Calling ManualRadiusOperationsService for ' . $username);

            $manualRadiusService = new ManualRadiusOperationsService();
            $radiusSuccess = false;
            $lastRadiusError = '';
            
            for ($attempt = 1; $attempt <= 3; $attempt++) {
                try {
                    $result = $manualRadiusService->reconnectUser($params);
                    if (($result['status'] ?? '') === 'success') {
                        $radiusSuccess = true;
                        \Log::info("[TRANSACTION RECONNECT EXECUTE] Success on attempt {$attempt}");
                        break;
                    }
                    $lastRadiusError = $result['message'] ?? 'Operation returned failure';
                    \Log::warning("[TRANSACTION RECONNECT EXECUTE] Attempt {$attempt}/3 failed: {$lastRadiusError}");
                } catch (\Exception $radEx) {
                    $lastRadiusError = $radEx->getMessage();
                    \Log::warning("[TRANSACTION RECONNECT EXECUTE] Attempt {$attempt}/3 exception: {$lastRadiusError}");
                }
                if ($attempt < 3) sleep(2);
            }

            if (!$radiusSuccess) {
                \Log::error('[TRANSACTION RECONNECT EXECUTE] All 3 attempts failed. Queuing for retry.');
                \App\Services\RadiusQueueService::queue([
                    'organization_id' => null,
                    'source_type' => 'transaction_approval',
                    'source_id' => $billingAccount->id,
                    'account_no' => $accountNo,
                    'operation' => 'reconnect_user',
                    'params' => $params,
                    'last_error' => $lastRadiusError,
                    'created_by' => $updatedByUser,
                ]);
            }

            // Always proceed with local DB updates even if queued
            if (true) {
                \Log::info('[TRANSACTION RECONNECT SUCCESS] Reconnection completed or queued successfully');

                // Step 7: Update billing_status_id to 1 (Active) if not already 1
                if (!$isAlreadyActive) {
                    $billingAccount->billing_status_id = 1;
                    $billingAccount->updated_at = now();
                    $billingAccount->updated_by = Auth::id();
                    $billingAccount->save();
                    \Log::info('[TRANSACTION RECONNECT DB] Updated billing_status_id to 1 for Account: ' . $accountNo);
                } else {
                    \Log::info('[TRANSACTION RECONNECT DB SKIP] Account already 1, skipping status update');
                }

                // Customer lookup for both notification paths below.
                //
                // Fetched here rather than inside the SMS branch: it used to be loaded only
                // when an active Reconnect SMS template existed, but the email block further
                // down reads the same variable. Disabling the SMS template therefore left
                // $customerInfo undefined, and the resulting warning — which Laravel raises
                // as an ErrorException — was swallowed by the email block's catch. The
                // reconnect email silently stopped sending because an unrelated SMS template
                // was switched off. One fetch, used by both, keeps them independent.
                $customerInfo = null;
                if (!$isAlreadyActive) {
                    $customerInfo = DB::table('billing_accounts')
                        ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
                        ->where('billing_accounts.account_no', $accountNo)
                        ->select(
                            'customers.contact_number_primary',
                            'customers.email_address',
                            DB::raw("CONCAT(customers.first_name, ' ', IFNULL(customers.middle_initial, ''), ' ', customers.last_name) as full_name")
                        )
                        ->first();
                }

                // Send SMS Notification
                if (!$isAlreadyActive) {
                    try {
                        // Fetch SMS template
                        $smsTemplate = DB::table('sms_templates')
                            ->where('template_type', 'Reconnect')
                            ->where('is_active', 1)
                            ->first();

                        if ($smsTemplate) {
                            if ($customerInfo && !empty($customerInfo->contact_number_primary)) {
                                // Replace variables
                                $message = $smsTemplate->message_content;
                                $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                                $planNameFormatted = str_replace('₱', 'P', $plan ?? '');

                                $message = str_replace('{{customer_name}}', $customerName, $message);
                                $message = str_replace('{{account_no}}', $accountNo, $message);
                                $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                                $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);

                                // Send SMS
                                $smsService = new \App\Services\ItexmoSmsService();
                                $smsResult = $smsService->send([
                                    'contact_no' => $customerInfo->contact_number_primary,
                                    'message' => $message
                                ]);

                                if ($smsResult['success']) {
                                    \Log::info('[TRANSACTION RECONNECT SMS] SMS sent to ' . $customerInfo->contact_number_primary);
                                }
                                else {
                                    \Log::error('[TRANSACTION RECONNECT SMS FAILED] ' . ($smsResult['error'] ?? 'Unknown error'));
                                }
                            }
                            else {
                                \Log::warning('[TRANSACTION RECONNECT SMS SKIP] No contact number found for account ' . $accountNo);
                            }
                        }
                        else {
                            \Log::warning('[TRANSACTION RECONNECT SMS SKIP] No active Reconnect SMS template found');
                        }
                    }
                    catch (\Exception $e) {
                        \Log::error('[TRANSACTION RECONNECT SMS EXCEPTION] ' . $e->getMessage());
                    }
                }

                // Send Email Notification
                if (!$isAlreadyActive) {
                    try {
                        // Is_Active matters here: EmailQueueService::queueFromTemplate() only
                        // accepts active templates, so checking without it let a deliberately
                        // disabled template pass this guard and then fail inside the service,
                        // which logged it as a missing template. Same condition, both places.
                        $emailTemplate = \App\Models\EmailTemplate::where('Template_Code', 'RECONNECT')
                            ->where('Is_Active', true)
                            ->first();

                        if ($emailTemplate && $customerInfo && !empty($customerInfo->email_address)) {
                            $emailService = app(\App\Services\EmailQueueService::class);
                            $customerName = preg_replace('/\s+/', ' ', trim($customerInfo->full_name));
                            $planNameFormatted = str_replace('₱', 'P', $plan ?? '');

                            $emailData = [
                                'customer_name' => $customerName,
                                'account_no' => $accountNo,
                                'plan_name' => $planNameFormatted,
                                'recipient_email' => $customerInfo->email_address,
                            ];
                            $emailService->queueFromTemplate('RECONNECT', $emailData);
                            \Log::info('[TRANSACTION RECONNECT EMAIL] Email queued for: ' . $customerInfo->email_address);
                        }
                    } catch (\Exception $e) {
                        \Log::error('[TRANSACTION RECONNECT EMAIL EXCEPTION] ' . $e->getMessage());
                    }
                }

                return $radiusSuccess ? 'success' : 'queued';
            }

        }
        catch (\Exception $e) {
            \Log::error('[TRANSACTION RECONNECT EXCEPTION] ' . $e->getMessage());
            \Log::error('[TRANSACTION RECONNECT EXCEPTION] Trace: ' . $e->getTraceAsString());
            \Log::channel('radiusrelated')->error('[TRANSACTION RECONNECT EXCEPTION] Account: ' . ($accountNo ?? 'Unknown') . ' - Error: ' . $e->getMessage());
            return 'exception';
        }
    }

    /**
     * Cancel any still-pending disconnection / restriction operations queued in
     * radius_operation_queue for this account.
     *
     * Fired from attemptReconnectionAfterApproval once the account balance has
     * settled to 0 (or negative). Without this, a disconnect/restrict operation
     * queued before the payment could still be picked up by the ProcessRadiusQueue
     * cron and restrict a customer who has already paid.
     *
     * Only rows still in the 'pending' state are touched (an operation already
     * 'processing'/'success'/'failed' is left alone). Matching rows are marked
     * 'cancelled' so the cron will skip them.
     */
    private function cancelPendingDisconnectionsInQueue(string $accountNo, $updatedByUser = 'System'): void
    {
        try {
            if (!\Illuminate\Support\Facades\Schema::hasTable('radius_operation_queue')) {
                return;
            }

            // Balance guard: only cancel queued disconnections once the account
            // balance has actually reached 0 (fully paid). A small epsilon absorbs
            // rounding residuals. If the balance is still positive, do nothing.
            $balance = floatval(DB::table('billing_accounts')
                ->where('account_no', $accountNo)
                ->value('account_balance') ?? 0);

            if ($balance > 0.01) {
                \Log::info('[TRANSACTION RECONNECT QUEUE SKIP] Account balance still positive (₱' . number_format($balance, 2) . ') - not cancelling queued disconnections for account: ' . $accountNo);
                return;
            }

            $disconnectOperations = ['disconnect_user', 'restricted_user'];

            $cancelled = DB::table('radius_operation_queue')
                ->where('account_no', $accountNo)
                ->where('status', 'pending')
                ->whereIn('operation', $disconnectOperations)
                ->update([
                    'status'       => 'cancelled',
                    'last_error'   => 'Cancelled - payment received, account balance settled to 0 (by ' . $updatedByUser . ')',
                    'completed_at' => now(),
                    'updated_at'   => now(),
                ]);

            if ($cancelled > 0) {
                \Log::info('[TRANSACTION RECONNECT QUEUE] Cancelled ' . $cancelled . ' pending disconnection/restriction operation(s) for account: ' . $accountNo);
                \Log::channel('radiusrelated')->info('[Radius_Queue] [CANCELLED] ' . $cancelled . ' pending disconnect/restrict op(s) for account ' . $accountNo . ' - payment received, balance settled.');
            } else {
                \Log::info('[TRANSACTION RECONNECT QUEUE] No pending disconnection/restriction operations to cancel for account: ' . $accountNo);
            }
        }
        catch (\Exception $e) {
            \Log::error('[TRANSACTION RECONNECT QUEUE EXCEPTION] Failed to cancel pending disconnections for account ' . $accountNo . ': ' . $e->getMessage());
        }
    }



    private function replaceGlobalVariables(string $message): string
    {
        $portalUrl = 'sync.xpacsconnect.ph';
        $brandName = DB::table('form_ui')->value('brand_name') ?? 'Your ISP';

        $message = str_replace('{{portal_url}}', $portalUrl, $message);
        $message = str_replace('{{company_name}}', $brandName, $message);

        return $message;
    }

    /**
     * Send Transaction Approval SMS notification
     */
    private function sendApprovalSms($billingAccount, $invoicesPaid, $totalPaidAmount, $paymentDate = null)
    {
        try {
            $billingAccount->load('customer');
            $customer = $billingAccount->customer;

            if ($customer && !empty($customer->contact_number_primary)) {
                $paidTemplate = DB::table('sms_templates')
                    ->where('template_type', 'Paid')
                    ->where('is_active', 1)
                    ->first();

                if ($paidTemplate) {
                    $smsService = new \App\Services\ItexmoSmsService();

                    // Consolidate invoice IDs or use N/A if none
                    $invoiceIds = !empty($invoicesPaid)
                        ? collect($invoicesPaid)->pluck('invoice_id')->unique()->implode(', ')
                        : 'N/A';

                    $message = $paidTemplate->message_content;

                    // Replace variables
                    $customerName = preg_replace('/\s+/', ' ', trim($customer->full_name));
                    $planNameRaw = $billingAccount->plan ? $billingAccount->plan->plan_name : ($customer->desired_plan ?? 'N/A');
                    $planNameFormatted = str_replace('₱', 'P', $planNameRaw);

                    $message = str_replace('{{customer_name}}', $customerName, $message);
                    $message = str_replace('{{account_no}}', $billingAccount->account_no, $message);
                    $message = str_replace('{{plan_name}}', $planNameFormatted, $message);
                    $message = str_replace('{{plan_nam}}', $planNameFormatted, $message);
                    $message = str_replace('{{invoice_id}}', $invoiceIds, $message);

                    // Support multiple variations of placeholders
                    $formattedAmount = number_format($totalPaidAmount, 2);
                    $txDate = $paymentDate ? date('Y-m-d', strtotime($paymentDate)) : date('Y-m-d');

                    $message = str_replace('{{amount_paid}}', $formattedAmount, $message);
                    $message = str_replace('{{amount}}', $formattedAmount, $message);
                    $message = str_replace('{{date}}', $txDate, $message);
                    $message = str_replace('{{payment_date}}', $txDate, $message);

                    $message = $this->replaceGlobalVariables($message);

                    $result = $smsService->send([
                        'contact_no' => $customer->contact_number_primary,
                        'message' => $message
                    ]);

                    if ($result['success']) {
                        \Log::info('Approval SMS sent', [
                            'account_no' => $billingAccount->account_no,
                            'transaction_id' => !empty($invoicesPaid) ? null : 'approved'
                        ]);
                    }
                    else {
                        \Log::error('Approval SMS Failed: ' . ($result['error'] ?? 'Unknown error'));
                    }
                }
            }
        }
        catch (\Exception $e) {
            \Log::error('Failed to send Approval SMS: ' . $e->getMessage());
        }
    }

    /**
     * Send Transaction Approval Email notification
     */
    private function sendApprovalEmail($billingAccount, $invoicesPaid, $totalPaidAmount, $paymentDate = null)
    {
        try {
            $billingAccount->load('customer');
            $customer = $billingAccount->customer;

            if ($customer && !empty($customer->email_address)) {
                $emailService = app(\App\Services\EmailQueueService::class);

                // Consolidate invoice IDs or use N/A
                $invoiceIds = !empty($invoicesPaid)
                    ? collect($invoicesPaid)->pluck('invoice_id')->unique()->implode(', ')
                    : 'N/A';

                $brandName = DB::table('form_ui')->value('brand_name') ?? 'Your ISP';
                $txDate = $paymentDate ? date('Y-m-d', strtotime($paymentDate)) : date('Y-m-d');
                $formattedAmount = number_format($totalPaidAmount, 2);

                $emailData = [
                    'Amount' => $formattedAmount,
                    'amount' => $formattedAmount,
                    'amount_paid' => $formattedAmount,
                    'Company_Name' => $brandName,
                    'Account_No' => $billingAccount->account_no,
                    'account_no' => $billingAccount->account_no,
                    'Date' => $txDate,
                    'payment_date' => $txDate,
                    'date' => $txDate,
                    'Full_Name' => $customer->full_name,
                    'invoice_ids' => $invoiceIds,
                    'recipient_email' => $customer->email_address,
                ];

                $emailService->queueFromTemplate('PAID', $emailData);

                \Log::info('Approval Email queued via template', [
                    'account_no' => $billingAccount->account_no
                ]);
            }
        }
        catch (\Exception $e) {
            \Log::error('Failed to send Approval Email: ' . $e->getMessage());
        }
    }

    public function destroy(string $id): JsonResponse
    {
        try {
            DB::beginTransaction();

            $transaction = Transaction::findOrFail($id);

            // Safety check: Don't allow deleting approved transactions
            if ($transaction->status === 'Done') {
                return response()->json([
                    'success' => false,
                    'message' => 'Approved transactions cannot be deleted. Revert them first if necessary.'
                ], 400);
            }

            // Remove associated invoices' transaction_id if any (just in case)
            DB::table('invoices')
                ->where('transaction_id', (string)$transaction->id)
                ->update([
                'transaction_id' => null,
                'updated_at' => now()
            ]);

            $transactionData = $transaction->toArray();
            $transaction->delete();

            DB::commit();

            // Create Activity Log
            \App\Models\ActivityLog::log(
                'Transaction Deleted',
                "Transaction #{$id} (" . ($transactionData['account_no'] ?? 'N/A') . ") deleted by " . (Auth::user()->email_address ?? 'User'),
                'warning',
            [
                'resource_type' => 'Transaction',
                'resource_id' => $id,
                'additional_data' => [
                    'transaction_data' => $transactionData
                ]
            ]
            );

            event(new TransactionUpdated(['action' => 'deleted', 'transaction_id' => $id]));

            return response()->json([
                'success' => true,
                'message' => 'Transaction deleted successfully'
            ]);
        }
        catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error deleting transaction: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete transaction',
                'error' => $e->getMessage()
            ], 500);
        }
    }



}


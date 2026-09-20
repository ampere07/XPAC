<?php

namespace App\Http\Controllers;

use App\Models\TransactionRevert;
use App\Models\Transaction;
use App\Models\User;
use App\Models\BillingAccount;
use App\Models\OnlineStatus;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use App\Events\TransactionUpdated;
use App\Events\TransactionRevertViewingUpdate;

class TransactionRevertController extends Controller
{
    public function broadcastViewing(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'revert_id' => 'required|string',
                'action' => 'required|string|in:started_viewing,stopped_viewing'
            ]);

            $username = Auth::user()->username ?? Auth::user()->name ?? 'Unknown User';
            
            \Log::info('[Presence] Transaction Revert broadcast:', [
                'revert_id' => $validated['revert_id'],
                'username' => $username,
                'action' => $validated['action']
            ]);

            event(new TransactionRevertViewingUpdate(
                $validated['revert_id'],
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

            $query = TransactionRevert::with([
                'transaction.account.customer',
                'transaction.processor',
                'transaction.paymentMethodInfo',
                'requester',
                'updater'
            ]);

            if ($request->has('updated_since')) {
                $query->where('updated_at', '>', $request->input('updated_since'));
            }

            if (!$isSuperAdmin && $organizationId) {
                $query->where('organization_id', $organizationId);
            }

            $reverts = $query->orderBy('created_at', 'desc')->get();

            return response()->json([
                'success' => true,
                'data' => $reverts,
                'count' => $reverts->count(),
                'server_time' => now()->toISOString()
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching transaction reverts: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch revert requests',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $validated = $request->validate([
                'transaction_id' => 'required|exists:transactions,id',
                'remarks' => 'nullable|string',
                'reason' => 'required|string',
                'requested_by' => 'nullable|string',
            ]);

            // Find user by email address
            $requestedByUserId = null;
            if (!empty($validated['requested_by'])) {
                $user = User::where('email_address', $validated['requested_by'])->first();
                if ($user) {
                    $requestedByUserId = $user->id;
                }
            }

            // Check if there's already a pending revert request for this transaction
            $existing = TransactionRevert::where('transaction_id', $validated['transaction_id'])
                ->where('status', 'pending')
                ->first();

            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'There is already a pending revert request for this transaction'
                ], 400);
            }

            $revert = TransactionRevert::create([
                'transaction_id' => $validated['transaction_id'],
                'remarks' => $validated['remarks'] ?? null,
                'reason' => $validated['reason'],
                'status' => 'pending',
                'requested_by' => $requestedByUserId,
                'updated_by' => null,
                'organization_id' => auth()->user() ? auth()->user()->organization_id : null,
            ]);

            $revert->load(['transaction.account.customer', 'transaction.processor', 'transaction.paymentMethodInfo', 'requester', 'updater']);

            \Log::info('Transaction revert request created', [
                'revert_id' => $revert->id,
                'transaction_id' => $validated['transaction_id'],
                'requested_by' => $validated['requested_by']
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Revert request submitted successfully',
                'data' => $revert
            ], 201);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            \Log::error('Error creating transaction revert request: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to submit revert request',
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

            $revert = TransactionRevert::with([
                'transaction.account.customer',
                'transaction.processor',
                'transaction.paymentMethodInfo',
                'requester',
                'updater'
            ])->findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $revert->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to revert request'
                ], 403);
            }

            return response()->json([
                'success' => true,
                'data' => $revert
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Revert request not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        try {
            $authUser = auth()->user();
            $organizationId = $authUser ? $authUser->organization_id : null;
            $roleId = $authUser ? $authUser->role_id : null;
            $isSuperAdmin = !$authUser || $roleId == 7 || !$organizationId;

            $validated = $request->validate([
                'status' => 'required|string|in:pending,done,rejected',
                'updated_by' => 'nullable|string',
            ]);

            DB::beginTransaction();

            $revert = TransactionRevert::findOrFail($id);

            if (!$isSuperAdmin && $organizationId && $revert->organization_id !== $organizationId) {
                DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized access to revert request'
                ], 403);
            }

            $updatedByUserId = null;
            if (!empty($validated['updated_by'])) {
                $user = User::where('email_address', $validated['updated_by'])->first();
                if ($user) {
                    $updatedByUserId = $user->id;
                }
            }

            $revert->status = $validated['status'];
            $revert->updated_by = $updatedByUserId ?? (Auth::id() ?? $revert->updated_by);
            $revert->save();

            // If status is being set to 'done', perform the actual revert on the transaction
            if ($validated['status'] === 'done') {
                $transaction = Transaction::findOrFail($revert->transaction_id);

                if ($transaction->status === 'Done') {
                    $accountNo = $transaction->account_no;
                    $transactionId = $transaction->id;
                    $userId = Auth::id();
                    $currentTime = now();

                    // Decode updated_column snapshot (old state before approval)
                    $snapshot = $transaction->updated_column; // already cast to array by model

                    if (!empty($snapshot) && is_array($snapshot)) {
                        // --- Restore billing_accounts balance from snapshot ---
                        $billingAccountSnapshot = collect($snapshot)->firstWhere('table', 'billing_accounts');

                        if ($billingAccountSnapshot && $accountNo) {
                            $billingAccount = BillingAccount::where('account_no', $accountNo)->first();

                            if ($billingAccount && $transaction->transaction_type !== 'Security Deposit') {
                                $billingAccount->account_balance = round(floatval($billingAccountSnapshot['old_account_balance']), 2);
                                $billingAccount->balance_update_date = $currentTime;
                                $billingAccount->updated_by = $userId;

                                // Restore billing_status_id only if the snapshot recorded it
                                // AND it actually changed during approval (e.g. reconnection set it to Active)
                                $snapshotStatusId = $billingAccountSnapshot['old_billing_status_id'] ?? null;
                                $currentStatusId  = $billingAccount->billing_status_id;

                                if ($snapshotStatusId !== null && $snapshotStatusId !== $currentStatusId) {
                                    $billingAccount->billing_status_id = $snapshotStatusId;
                                    \Log::info('Revert via snapshot: billing_status_id restored', [
                                        'account_no'   => $accountNo,
                                        'from_status'  => $currentStatusId,
                                        'to_status'    => $snapshotStatusId,
                                    ]);
                                } else {
                                    \Log::info('Revert via snapshot: billing_status_id unchanged, no restore needed', [
                                        'account_no'  => $accountNo,
                                        'status_id'   => $currentStatusId,
                                    ]);
                                }

                                $billingAccount->save();

                                \Log::info('Revert via snapshot: billing_accounts balance restored', [
                                    'account_no'       => $accountNo,
                                    'restored_balance' => $billingAccountSnapshot['old_account_balance'],
                                ]);
                            }
                        }

                        // --- Restore each invoice from snapshot ---
                        $invoiceSnapshots = collect($snapshot)->where('table', 'invoices')->values();

                        foreach ($invoiceSnapshots as $invSnap) {
                            $invoice = \App\Models\Invoice::find($invSnap['invoice_id']);
                            if (!$invoice) continue;

                            $invoice->received_payment = round(floatval($invSnap['old_received_payment']), 2);
                            $invoice->status           = $invSnap['old_status'];
                            $invoice->transaction_id   = null;
                            $invoice->updated_by       = Auth::check() ? Auth::user()->email_address : 'unknown';
                            $invoice->updated_at       = $currentTime;
                            $invoice->save();

                            \Log::info('Revert via snapshot: invoice restored', [
                                'invoice_id'           => $invSnap['invoice_id'],
                                'restored_status'      => $invSnap['old_status'],
                                'restored_received'    => $invSnap['old_received_payment'],
                            ]);
                        }

                        // Also clear transaction_id from any invoice that still references this transaction
                        // but was NOT in the snapshot (edge-case guard)
                        \App\Models\Invoice::where('transaction_id', (string)$transactionId)
                            ->whereNotIn('id', $invoiceSnapshots->pluck('invoice_id')->toArray())
                            ->update(['transaction_id' => null, 'updated_at' => $currentTime]);

                        // --- Restore online_status session_group from snapshot ---
                        $onlineStatusSnapshot = collect($snapshot)->firstWhere('table', 'online_status');
                        if ($onlineStatusSnapshot) {
                            $onlineStatusRecord = OnlineStatus::where('account_id', $onlineStatusSnapshot['account_id'])->first();
                            if ($onlineStatusRecord) {
                                $snapshotGroup  = $onlineStatusSnapshot['old_session_group'] ?? null;
                                $snapshotStatus = $onlineStatusSnapshot['old_session_status'] ?? null;
                                $username       = $onlineStatusSnapshot['username'] ?? $onlineStatusRecord->username;

                                $normalizedGroup = strtolower(trim($snapshotGroup ?? ''));

                                if ($normalizedGroup === 'restricted') {
                                    // Old session_group was Restricted — push user back to Restricted in RADIUS
                                    try {
                                        $manualRadiusService = new \App\Services\ManualRadiusOperationsService();
                                        $result = $manualRadiusService->restrictedUser([
                                            'accountNumber' => $accountNo,
                                            'username'      => $username,
                                            'remarks'       => 'Transaction Revert — restoring Restricted status',
                                            'updatedBy'     => Auth::check() ? Auth::user()->email_address : 'unknown',
                                        ]);

                                        if ($result['status'] === 'success') {
                                            \Log::info('Revert: RADIUS restrictedUser called successfully', [
                                                'account_no' => $accountNo,
                                                'username'   => $username,
                                            ]);
                                        } else {
                                            \Log::warning('Revert: RADIUS restrictedUser call failed', [
                                                'account_no' => $accountNo,
                                                'username'   => $username,
                                                'reason'     => $result['message'] ?? 'unknown',
                                            ]);
                                        }
                                    } catch (\Throwable $radiusEx) {
                                        \Log::error('Revert: Exception calling restrictedUser', [
                                            'account_no' => $accountNo,
                                            'username'   => $username,
                                            'error'      => $radiusEx->getMessage(),
                                        ]);
                                    }

                                } elseif ($normalizedGroup === 'disconnected') {
                                    // Old session_group was Disconnected — push user back to Disconnected in RADIUS
                                    try {
                                        $manualRadiusService = new \App\Services\ManualRadiusOperationsService();
                                        $result = $manualRadiusService->disconnectUser([
                                            'accountNumber' => $accountNo,
                                            'username'      => $username,
                                            'remarks'       => 'Transaction Revert — restoring Disconnected status',
                                            'updatedBy'     => Auth::check() ? Auth::user()->email_address : 'unknown',
                                        ]);

                                        if ($result['status'] === 'success') {
                                            \Log::info('Revert: RADIUS disconnectUser called successfully', [
                                                'account_no' => $accountNo,
                                                'username'   => $username,
                                            ]);
                                        } else {
                                            \Log::warning('Revert: RADIUS disconnectUser call failed', [
                                                'account_no' => $accountNo,
                                                'username'   => $username,
                                                'reason'     => $result['message'] ?? 'unknown',
                                            ]);
                                        }
                                    } catch (\Throwable $radiusEx) {
                                        \Log::error('Revert: Exception calling disconnectUser', [
                                            'account_no' => $accountNo,
                                            'username'   => $username,
                                            'error'      => $radiusEx->getMessage(),
                                        ]);
                                    }

                                } else {
                                    // Old session_group is a plan name — no RADIUS call needed.
                                    // The DB-side online_status record is already correct after
                                    // reconnectUser() ran during approval; approval already set it
                                    // to the plan group, which is what it was before, so nothing to undo.
                                    \Log::info('Revert: online_status session_group is a plan name — no RADIUS action required', [
                                        'account_no'    => $accountNo,
                                        'username'      => $username,
                                        'session_group' => $snapshotGroup,
                                    ]);
                                }
                            }
                        }

                    } else {
                        // --- Fallback: no snapshot, use old subtraction-based logic ---
                        \Log::warning('Revert: no updated_column snapshot found, falling back to payment-subtraction logic', [
                            'transaction_id' => $transactionId,
                        ]);

                        if ($accountNo) {
                            $billingAccount = BillingAccount::where('account_no', $accountNo)->first();
                            $paymentToRevert = floatval($transaction->received_payment);

                            if ($billingAccount && $transaction->transaction_type !== 'Security Deposit') {
                                $billingAccount->account_balance = round(floatval($billingAccount->account_balance) + $paymentToRevert, 2);
                                $billingAccount->balance_update_date = $currentTime;
                                $billingAccount->updated_by = $userId;

                                // Fallback: no snapshot available for billing_status_id.
                                // We cannot safely restore the old status here, so we log a warning.
                                \Log::warning('Revert fallback: billing_status_id not restored (no snapshot)', [
                                    'transaction_id' => $transactionId,
                                    'account_no'     => $accountNo,
                                ]);

                                $billingAccount->save();

                                $invoices = \App\Models\Invoice::where('transaction_id', (string)$transactionId)
                                    ->orderBy('invoice_date', 'desc')
                                    ->get();

                                $remainingToRevert = $paymentToRevert;

                                foreach ($invoices as $invoice) {
                                    if ($remainingToRevert <= 0) break;

                                    $currentReceived = floatval($invoice->received_payment ?? 0);
                                    if ($currentReceived <= 0) continue;

                                    $toSubtract  = min($currentReceived, $remainingToRevert);
                                    $newReceived = $currentReceived - $toSubtract;

                                    $invoice->received_payment = round($newReceived, 2);
                                    $invoice->status           = $newReceived <= 0 ? 'Unpaid' : 'Partial';
                                    $invoice->transaction_id   = null;
                                    $invoice->updated_by       = Auth::check() ? Auth::user()->email_address : 'unknown';
                                    $invoice->updated_at       = $currentTime;
                                    $invoice->save();

                                    $remainingToRevert -= $toSubtract;
                                }
                            }
                        }
                    }

                    // Update transaction back to Pending and clear updated_column
                    $transaction->status               = 'Pending';
                    $transaction->date_processed       = null;
                    $transaction->approved_by          = null;
                    $transaction->account_balance_before = null;
                    $transaction->updated_column       = null;
                    $transaction->updated_by_user      = Auth::check() ? Auth::user()->email_address : 'unknown';
                    $transaction->save();

                    // Activity log
                    \App\Models\ActivityLog::log(
                        'Transaction Reverted via Revert Request',
                        "Transaction #{$transactionId} ({$accountNo}) reverted after revert request #{$revert->id} approved",
                        'warning',
                        [
                            'resource_type' => 'Transaction',
                            'resource_id'   => $transactionId,
                            'additional_data' => [
                                'revert_request_id' => $revert->id,
                                'account_no'        => $accountNo,
                                'used_snapshot'     => !empty($snapshot),
                            ]
                        ]
                    );

                    event(new TransactionUpdated(['action' => 'reverted', 'transaction_id' => $transactionId, 'account_no' => $accountNo]));
                }
            }

            DB::commit();

            $revert->load(['transaction.account.customer', 'transaction.processor', 'transaction.paymentMethodInfo', 'requester', 'updater']);

            return response()->json([
                'success' => true,
                'message' => 'Revert request status updated successfully',
                'data' => $revert
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            \Log::error('Error updating revert request status: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update status',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


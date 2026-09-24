<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Events\MonthlyPayableUpdated;
use App\Http\Controllers\Controller;
use App\Http\Requests\GeneratePayableBatchRequest;
use App\Http\Requests\RecordPaymentRequest;
use App\Http\Requests\StorePayableRequest;
use App\Http\Requests\UpdatePayableRequest;
use App\Models\ActivityLog;
use App\Models\MonthlyPayable;
use App\Models\PayablePayment;
use App\Services\GoogleDriveService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Monthly Payables — recurring and scheduled obligations (rent, utilities, bandwidth,
 * subscriptions, vendor retainers, supplier dues).
 *
 * Two invariants hold everywhere in here:
 *
 *  1. `payable_payments` is the source of truth for money received. `monthly_payables.
 *     amount_paid` is only ever rewritten as the sum of that ledger, never incremented.
 *  2. `status` is derived, never trusted from the client. The only status a caller can set
 *     is 'cancelled' (and back to 'pending'); the rest follow the amounts and the due date.
 */
class MonthlyPayableController extends Controller
{
    private const RECEIPT_FOLDER = 'Payable Receipts';

    private const DEFAULT_PER_PAGE = 25;
    private const MAX_PER_PAGE     = 200;

    /** Half a centavo — below the smallest real amount, above decimal→float noise. */
    private const SETTLEMENT_EPSILON = 0.005;

    /**
     * Resolved on demand, not constructor-injected: GoogleDriveService builds a Google
     * client in its constructor, which would make the read-only index depend on Drive
     * credentials being configured. Only uploads need it.
     */
    private function drive(): GoogleDriveService
    {
        return app(GoogleDriveService::class);
    }

    // ------------------------------------------------------------- plumbing

    private function currentOrganizationId()
    {
        return auth()->user()->organization_id ?? null;
    }

    private function currentUserEmail(Request $request): string
    {
        if (auth()->check()) {
            return (string) (auth()->user()->email_address ?? 'System');
        }

        return (string) ($request->input('user_email') ?? $request->input('modified_by') ?? 'System');
    }

    /** Base query, already org-scoped and eager-loaded per the module's read pattern. */
    private function baseQuery(): Builder
    {
        return MonthlyPayable::query()
            ->with(['category', 'payments'])
            ->forOrganization($this->currentOrganizationId());
    }

    /**
     * Filter bar: billing month, status, category, free-text search.
     *
     * billing_month defaults to the current period — the page opens on "this month" — and
     * accepts the literal 'all' to lift the restriction for cross-period reporting.
     */
    private function applyFilters(Builder $query, Request $request): Builder
    {
        $month = (string) ($request->input('billing_month') ?: MonthlyPayable::currentBillingMonth());

        if (strtolower($month) !== 'all') {
            $query->forMonth($month);
        }

        if ($request->filled('status')) {
            $status = (string) $request->input('status');
            if (in_array($status, MonthlyPayable::STATUSES, true)) {
                $query->where('status', $status);
            }
        }

        if ($request->filled('category_id')) {
            $query->where('category_id', (int) $request->input('category_id'));
        }

        if ($request->filled('search')) {
            $search = (string) $request->input('search');
            $query->where(function (Builder $q) use ($search): void {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('vendor_name', 'like', "%{$search}%")
                    ->orWhere('account_number', 'like', "%{$search}%")
                    ->orWhere('notes', 'like', "%{$search}%");
            });
        }

        return $query;
    }

    private function formatPayment(PayablePayment $payment): array
    {
        return [
            'id'             => (int) $payment->id,
            'payableId'      => (int) $payment->monthly_payable_id,
            'amount'         => (float) $payment->amount,
            'paymentDate'    => $payment->payment_date ? Carbon::parse($payment->payment_date)->format('n/j/Y') : '',
            'paymentDateRaw' => $payment->payment_date ? Carbon::parse($payment->payment_date)->format('Y-m-d') : '',
            'paymentMethod'  => $payment->payment_method ?? '',
            'referenceNo'    => $payment->reference_no ?? '',
            'receiptPath'    => $payment->receipt_path,
            'notes'          => $payment->notes ?? '',
            'recordedBy'     => $payment->recorded_by ?? '',
            'recordedAt'     => $payment->created_at ? Carbon::parse($payment->created_at)->format('n/j/Y g:i A') : '',
        ];
    }

    private function format(MonthlyPayable $payable): array
    {
        $dueDate  = $payable->due_date ? Carbon::parse($payable->due_date) : null;
        $pastDue  = $payable->isPastDue();
        $settled  = $payable->status === MonthlyPayable::STATUS_PAID
            || $payable->status === MonthlyPayable::STATUS_CANCELLED;

        return [
            'id'            => (int) $payable->id,
            'title'         => $payable->title,
            'categoryId'    => (int) $payable->category_id,
            'categoryName'  => $payable->category->category_name ?? 'Uncategorized',
            'vendorName'    => $payable->vendor_name ?? '',
            'accountNumber' => $payable->account_number ?? '',
            'amountDue'     => (float) $payable->amount_due,
            'amountPaid'    => (float) $payable->amount_paid,
            'balance'       => $payable->balance,
            'dueDate'       => $dueDate ? $dueDate->format('n/j/Y') : '',
            'dueDateRaw'    => $dueDate ? $dueDate->format('Y-m-d') : '',
            'billingMonth'  => $payable->billing_month,
            'status'        => $payable->status,
            'isRecurring'   => (bool) $payable->is_recurring,
            // Drives the red due-date highlight. Deliberately independent of `status`: a
            // part-paid bill reads 'partial' but is still late, and the table must say so.
            'isPastDue'     => $pastDue && !$settled,
            'daysOverdue'   => $pastDue && !$settled && $dueDate
                ? $dueDate->startOfDay()->diffInDays(Carbon::today())
                : 0,
            'notes'         => $payable->notes ?? '',
            'receiptPath'   => $payable->receipt_path,
            'createdBy'     => $payable->created_by ?? '',
            'modifiedBy'    => $payable->modified_by ?? '',
            'updatedAt'     => $payable->updated_at ? Carbon::parse($payable->updated_at)->format('n/j/Y g:i A') : '',
            'paymentCount'  => $payable->payments->count(),
            'payments'      => $payable->payments->map(fn (PayablePayment $p) => $this->formatPayment($p))->values(),
        ];
    }

    /**
     * Metric cards. Computed over the whole filtered set, not the current page, so the
     * banner totals do not change as the user pages through the table.
     *
     * Cancelled rows are excluded from the money totals — a cancelled bill is not a debt —
     * but are still counted in the status breakdown so nothing silently disappears.
     */
    private function summarise(Builder $filtered): array
    {
        // These are aggregate reads. setEagerLoads([]) drops the with(['category','payments'])
        // the base query carries — otherwise every SUM() would drag two relation queries
        // behind it, keyed off a synthetic row that has no id.
        $filtered = (clone $filtered)->setEagerLoads([]);

        $money = (clone $filtered)->where('status', '!=', MonthlyPayable::STATUS_CANCELLED);

        $totals = (clone $money)
            ->selectRaw('
                COALESCE(SUM(amount_due), 0)  as total_due,
                COALESCE(SUM(amount_paid), 0) as total_paid,
                COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) as outstanding,
                COUNT(*) as total_count
            ')
            ->first();

        $overdue = (clone $money)->overdue()
            ->selectRaw('
                COUNT(*) as overdue_count,
                COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) as overdue_amount
            ')
            ->first();

        $dueToday = (clone $money)->outstanding()
            ->whereDate('due_date', Carbon::today())
            ->count();

        $statusCounts = (clone $filtered)
            ->select('status', DB::raw('COUNT(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status');

        $byStatus = [];
        foreach (MonthlyPayable::STATUSES as $status) {
            $byStatus[$status] = (int) ($statusCounts[$status] ?? 0);
        }

        return [
            'total_due'      => (float) ($totals->total_due ?? 0),
            'total_paid'     => (float) ($totals->total_paid ?? 0),
            'outstanding'    => (float) ($totals->outstanding ?? 0),
            'total_count'    => (int) ($totals->total_count ?? 0),
            'overdue_count'  => (int) ($overdue->overdue_count ?? 0),
            'overdue_amount' => (float) ($overdue->overdue_amount ?? 0),
            'due_today'      => $dueToday,
            'by_status'      => $byStatus,
        ];
    }

    private function uploadReceipt($file): ?string
    {
        try {
            $drive = $this->drive();

            $folderId = $drive->findFolder(self::RECEIPT_FOLDER)
                ?? $drive->createFolder(self::RECEIPT_FOLDER);

            $fileName = 'payable_' . time() . '_' . Str::random(6) . '.' . $file->getClientOriginalExtension();

            return $drive->uploadFile($file, $folderId, $fileName, $file->getMimeType());
        } catch (\Exception $e) {
            Log::error('Failed to upload payable receipt to Google Drive', ['error' => $e->getMessage()]);
            throw $e;
        }
    }

    /** Upload wins over a pasted link when both are present. */
    private function resolveReceipt(Request $request): ?string
    {
        if ($request->hasFile('receipt')) {
            return $this->uploadReceipt($request->file('receipt'));
        }

        $path = $request->input('receipt_path');

        return $path !== null && $path !== '' ? (string) $path : null;
    }

    private function findOrFail(int $id): ?MonthlyPayable
    {
        return $this->baseQuery()->where('id', $id)->first();
    }

    private function error(string $message, int $code = 500, array $errors = []): JsonResponse
    {
        $body = ['status' => 'error', 'message' => $message];
        if ($errors !== []) {
            $body['errors'] = $errors;
        }

        return response()->json($body, $code);
    }

    /**
     * MonthlyPayableUpdated is ShouldBroadcastNow and QUEUE_CONNECTION is sync, so the
     * Pusher/Soketi call happens inline, inside the request, after the row is already
     * committed. If Soketi is unreachable (BROADCAST_DRIVER=pusher pointed at
     * 127.0.0.1:6001) that throws — and an unguarded throw here would turn a payment that
     * *did* save into a 500, telling the user their payment failed when it did not.
     *
     * Throwable, not Exception: a transport-level TypeError in the broadcaster is an Error
     * and would otherwise sail straight past a catch(\Exception).
     */
    private function broadcast(string $action, array $extra = []): void
    {
        try {
            event(new MonthlyPayableUpdated(array_merge(['action' => $action], $extra)));
        } catch (\Throwable $e) {
            // Realtime is a nicety; the write already succeeded. Clients still pick the
            // change up on their next fetch or the sidebar's 10-minute refresh.
            Log::warning('MonthlyPayable broadcast failed (write was committed)', [
                'action' => $action,
                'error'  => $e->getMessage(),
            ]);
        }
    }

    // -------------------------------------------------------------- actions

    /**
     * Filtered, paginated list plus the metric-card totals for the same filter set.
     */
    public function index(Request $request): JsonResponse
    {
        try {
            // Self-healing: rows whose due date passed since the last request are flipped to
            // 'overdue' here, so the list is correct on a deployment with no scheduler.
            MonthlyPayable::refreshOverdueStatuses($this->currentOrganizationId());

            $filtered = $this->applyFilters($this->baseQuery(), $request);

            $summary = $this->summarise(clone $filtered);

            $perPage = (int) $request->input('per_page', (string) self::DEFAULT_PER_PAGE);
            $perPage = max(1, min($perPage, self::MAX_PER_PAGE));

            $payables = $filtered
                // Unsettled first, then by urgency. `id` breaks ties so paging is stable.
                ->orderByRaw("FIELD(status, 'overdue', 'partial', 'pending', 'paid', 'cancelled')")
                ->orderBy('due_date', 'asc')
                ->orderBy('id', 'asc')
                ->paginate($perPage);

            return response()->json([
                'status'  => 'success',
                'data'    => collect($payables->items())->map(fn (MonthlyPayable $p) => $this->format($p))->values(),
                'summary' => $summary,
                'meta'    => [
                    'current_page'  => $payables->currentPage(),
                    'last_page'     => $payables->lastPage(),
                    'per_page'      => $payables->perPage(),
                    'total'         => $payables->total(),
                    'billing_month' => (string) ($request->input('billing_month') ?: MonthlyPayable::currentBillingMonth()),
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('Monthly payables index failed', ['error' => $e->getMessage()]);

            return $this->error($e->getMessage());
        }
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $payable = $this->findOrFail($id);

        if (!$payable) {
            return $this->error('Payable not found', 404);
        }

        return response()->json(['status' => 'success', 'data' => $this->format($payable)]);
    }

    /**
     * Counts feeding the sidebar badge: everything late plus everything falling due today.
     * The two sets are disjoint (overdue is strictly before today), so they add cleanly.
     */
    public function alertCount(Request $request): JsonResponse
    {
        try {
            $orgId = $this->currentOrganizationId();
            MonthlyPayable::refreshOverdueStatuses($orgId);

            $overdue = MonthlyPayable::query()->forOrganization($orgId)->overdue()->count();

            $dueToday = MonthlyPayable::query()->forOrganization($orgId)->outstanding()
                ->whereDate('due_date', Carbon::today())
                ->count();

            return response()->json([
                'status' => 'success',
                'data'   => [
                    'overdue'   => $overdue,
                    'due_today' => $dueToday,
                    'count'     => $overdue + $dueToday,
                ],
            ]);
        } catch (\Exception $e) {
            return $this->error($e->getMessage());
        }
    }

    public function store(StorePayableRequest $request): JsonResponse
    {
        try {
            $userEmail = $this->currentUserEmail($request);

            $payable = new MonthlyPayable();
            $payable->organization_id = $this->currentOrganizationId();
            $payable->title           = (string) $request->input('title');
            $payable->category_id     = (int) $request->input('category_id');
            $payable->vendor_name     = $request->input('vendor_name');
            $payable->account_number  = $request->input('account_number');
            $payable->amount_due      = (string) $request->input('amount_due');
            $payable->amount_paid     = '0.00';
            $payable->due_date        = (string) $request->input('due_date');
            $payable->billing_month   = (string) $request->input('billing_month');
            $payable->is_recurring    = (bool) $request->input('is_recurring', false);
            $payable->notes           = $request->input('notes');
            $payable->receipt_path    = $this->resolveReceipt($request);
            $payable->created_by      = $userEmail;
            $payable->modified_by     = $userEmail;

            // Honour an explicit cancel, otherwise derive. syncStatus() leaves 'cancelled'
            // alone, so setting it first is what makes it stick.
            $payable->status = $request->input('status') === MonthlyPayable::STATUS_CANCELLED
                ? MonthlyPayable::STATUS_CANCELLED
                : MonthlyPayable::STATUS_PENDING;
            $payable->syncStatus()->save();

            ActivityLog::log(
                'Monthly Payable Created',
                "Payable created: {$payable->title} — {$payable->amount_due} due "
                    . Carbon::parse($payable->due_date)->format('Y-m-d'),
                'info',
                [
                    'resource_type'    => 'MonthlyPayable',
                    'resource_id'      => $payable->id,
                    'additional_data'  => $payable->toArray(),
                    'organization_id'  => $payable->organization_id,
                ]
            );

            $this->broadcast('created', ['payable_id' => $payable->id]);

            return response()->json([
                'status'  => 'success',
                'message' => 'Payable created successfully',
                'data'    => $this->format($payable->load(['category', 'payments'])),
            ], 201);
        } catch (\Exception $e) {
            return $this->error('Error creating payable: ' . $e->getMessage());
        }
    }

    public function update(UpdatePayableRequest $request, int $id): JsonResponse
    {
        $payable = $this->findOrFail($id);

        if (!$payable) {
            return $this->error('Payable not found', 404);
        }

        try {
            foreach (['title', 'category_id', 'vendor_name', 'account_number', 'amount_due',
                      'due_date', 'billing_month', 'notes'] as $field) {
                if ($request->has($field)) {
                    $payable->{$field} = $request->input($field);
                }
            }

            if ($request->has('is_recurring')) {
                $payable->is_recurring = (bool) $request->input('is_recurring');
            }

            $receipt = $this->resolveReceipt($request);
            if ($receipt !== null) {
                $payable->receipt_path = $receipt;
            }

            // Cancelling, or un-cancelling back into the derived lifecycle.
            $requestedStatus = $request->input('status');
            if ($requestedStatus === MonthlyPayable::STATUS_CANCELLED) {
                $payable->status = MonthlyPayable::STATUS_CANCELLED;
            } elseif ($requestedStatus === MonthlyPayable::STATUS_PENDING) {
                $payable->status = MonthlyPayable::STATUS_PENDING;
            }

            $payable->modified_by = $this->currentUserEmail($request);

            // Lowering amount_due below what has already been paid would otherwise leave a
            // stale 'partial'; re-deriving here settles it instead.
            $payable->syncStatus()->save();

            ActivityLog::log(
                'Monthly Payable Updated',
                "Payable updated: {$payable->title} (ID: {$id})",
                'info',
                [
                    'resource_type'   => 'MonthlyPayable',
                    'resource_id'     => $payable->id,
                    'additional_data' => $payable->toArray(),
                    'organization_id' => $payable->organization_id,
                ]
            );

            $this->broadcast('updated', ['payable_id' => $payable->id]);

            return response()->json([
                'status'  => 'success',
                'message' => 'Payable updated successfully',
                'data'    => $this->format($payable->load(['category', 'payments'])),
            ]);
        } catch (\Exception $e) {
            return $this->error('Error updating payable: ' . $e->getMessage());
        }
    }

    /** Soft delete — the payment ledger stays attached and the row stays recoverable. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $payable = $this->findOrFail($id);

        if (!$payable) {
            return $this->error('Payable not found', 404);
        }

        try {
            $snapshot = $payable->toArray();
            $label    = $payable->title;
            $orgId    = $payable->organization_id;

            $payable->delete();

            ActivityLog::log(
                'Monthly Payable Deleted',
                "Payable deleted: {$label} (ID: {$id})",
                'warning',
                [
                    'resource_type'   => 'MonthlyPayable',
                    'resource_id'     => $id,
                    'additional_data' => $snapshot,
                    'organization_id' => $orgId,
                ]
            );

            $this->broadcast('deleted', ['payable_id' => $id]);

            return response()->json(['status' => 'success', 'message' => 'Payable deleted successfully']);
        } catch (\Exception $e) {
            return $this->error('Error deleting payable: ' . $e->getMessage());
        }
    }

    /**
     * Logs one payment and re-derives the payable from its ledger.
     *
     * The read-check-write runs inside a transaction with the payable row locked, because
     * without it two payments submitted at the same moment can both see the full balance
     * and both pass the overpayment check.
     */
    public function recordPayment(RecordPaymentRequest $request, int $id): JsonResponse
    {
        $payable = $this->findOrFail($id);

        if (!$payable) {
            return $this->error('Payable not found', 404);
        }

        if ($payable->status === MonthlyPayable::STATUS_CANCELLED) {
            return $this->error('This payable is cancelled — reopen it before logging a payment.', 422);
        }

        $amount = round((float) $request->input('amount'), 2);

        // Upload before the transaction: a Drive round-trip is slow and holding a row lock
        // across it would serialise every other payment on this payable behind the network.
        try {
            $receiptPath = $this->resolveReceipt($request);
        } catch (\Exception $e) {
            return $this->error('Receipt upload failed: ' . $e->getMessage());
        }

        try {
            $result = DB::transaction(function () use ($payable, $request, $amount, $receiptPath) {
                /** @var MonthlyPayable $locked */
                $locked = MonthlyPayable::query()->lockForUpdate()->findOrFail($payable->id);

                $balance = round((float) $locked->amount_due - (float) $locked->amount_paid, 2);

                if ($amount > $balance + self::SETTLEMENT_EPSILON) {
                    return ['overpaid' => true, 'balance' => $balance];
                }

                $payment = new PayablePayment();
                $payment->monthly_payable_id = $locked->id;
                $payment->amount             = (string) $amount;
                $payment->payment_date       = (string) $request->input('payment_date');
                $payment->payment_method     = $request->input('payment_method');
                $payment->reference_no       = $request->input('reference_no');
                $payment->receipt_path       = $receiptPath;
                $payment->notes              = $request->input('notes');
                $payment->recorded_by        = $this->currentUserEmail($request);
                $payment->save();

                // Rebuild from the ledger rather than incrementing, so the total can never
                // drift from the rows it is supposed to summarise.
                $locked->recalculateFromPayments();
                $locked->modified_by = $payment->recorded_by;

                // Mirror the newest receipt onto the payable so the list's "View Receipt"
                // has something to open without joining the ledger.
                if ($receiptPath !== null) {
                    $locked->receipt_path = $receiptPath;
                }

                $locked->save();

                return ['overpaid' => false, 'payment' => $payment, 'payable' => $locked];
            });

            if ($result['overpaid']) {
                return $this->error(
                    'Payment exceeds the remaining balance.',
                    422,
                    ['amount' => ['Remaining balance is only ' . number_format($result['balance'], 2) . '.']]
                );
            }

            /** @var MonthlyPayable $updated */
            $updated = $result['payable'];
            $updated->load(['category', 'payments']);

            ActivityLog::log(
                'Payable Payment Recorded',
                "Payment of {$amount} recorded against {$updated->title} — now {$updated->status}",
                'info',
                [
                    'resource_type'   => 'MonthlyPayable',
                    'resource_id'     => $updated->id,
                    'additional_data' => [
                        'payment' => $result['payment']->toArray(),
                        'balance' => $updated->balance,
                    ],
                    'organization_id' => $updated->organization_id,
                ]
            );

            $this->broadcast('payment-recorded', [
                'payable_id' => $updated->id,
                'status'     => $updated->status,
            ]);

            return response()->json([
                'status'  => 'success',
                'message' => 'Payment recorded successfully',
                'data'    => $this->format($updated),
            ], 201);
        } catch (\Exception $e) {
            return $this->error('Error recording payment: ' . $e->getMessage());
        }
    }

    /**
     * Removes one ledger entry and walks the payable's status back down. This is what makes
     * a mis-keyed payment correctable without hand-editing a running total.
     */
    public function deletePayment(Request $request, int $id, int $paymentId): JsonResponse
    {
        $payable = $this->findOrFail($id);

        if (!$payable) {
            return $this->error('Payable not found', 404);
        }

        $payment = PayablePayment::query()
            ->where('id', $paymentId)
            ->where('monthly_payable_id', $payable->id)
            ->first();

        if (!$payment) {
            return $this->error('Payment not found', 404);
        }

        try {
            $snapshot = $payment->toArray();

            DB::transaction(function () use ($payable, $payment, $request): void {
                $payment->delete();

                /** @var MonthlyPayable $locked */
                $locked = MonthlyPayable::query()->lockForUpdate()->findOrFail($payable->id);
                $locked->recalculateFromPayments();
                $locked->modified_by = $this->currentUserEmail($request);
                $locked->save();
            });

            $payable->refresh()->load(['category', 'payments']);

            ActivityLog::log(
                'Payable Payment Removed',
                "Payment #{$paymentId} removed from {$payable->title} — now {$payable->status}",
                'warning',
                [
                    'resource_type'   => 'MonthlyPayable',
                    'resource_id'     => $payable->id,
                    'additional_data' => $snapshot,
                    'organization_id' => $payable->organization_id,
                ]
            );

            $this->broadcast('payment-removed', ['payable_id' => $payable->id]);

            return response()->json([
                'status'  => 'success',
                'message' => 'Payment removed successfully',
                'data'    => $this->format($payable),
            ]);
        } catch (\Exception $e) {
            return $this->error('Error removing payment: ' . $e->getMessage());
        }
    }

    /**
     * Rolls the recurring payables of one billing month forward into another.
     *
     * Copies every `is_recurring` row from `source_month` (default: the month before the
     * target) into `billing_month`, resetting the amounts paid and the receipt. Idempotent:
     * a title+category already present in the target month is skipped, so running it twice
     * on the 1st does not double-bill.
     *
     * Due dates shift by the same number of months with `addMonthsNoOverflow`, which keeps
     * a 31st due date on the last day of a shorter month instead of spilling into the next.
     */
    public function generateMonthlyBatch(GeneratePayableBatchRequest $request): JsonResponse
    {
        $target = (string) $request->input('billing_month');

        $targetStart = Carbon::createFromFormat('Y-m-d', $target . '-01')->startOfDay();
        $source      = (string) ($request->input('source_month')
            ?: $targetStart->copy()->subMonthNoOverflow()->format('Y-m'));

        if ($source === $target) {
            return $this->error('Source and target billing months must differ.', 422);
        }

        $sourceStart = Carbon::createFromFormat('Y-m-d', $source . '-01')->startOfDay();
        $monthShift  = (int) $sourceStart->diffInMonths($targetStart, false);

        try {
            $orgId     = $this->currentOrganizationId();
            $userEmail = $this->currentUserEmail($request);

            $templates = MonthlyPayable::query()
                ->forOrganization($orgId)
                ->forMonth($source)
                ->where('is_recurring', true)
                ->where('status', '!=', MonthlyPayable::STATUS_CANCELLED)
                ->orderBy('id')
                ->get();

            if ($templates->isEmpty()) {
                return response()->json([
                    'status'  => 'success',
                    'message' => "No recurring payables found in {$source} to carry forward.",
                    'data'    => ['created' => 0, 'skipped' => 0, 'source_month' => $source, 'billing_month' => $target],
                ]);
            }

            /** @var array<string, bool> $existingKeys */
            $existingKeys = [];
            MonthlyPayable::query()
                ->forOrganization($orgId)
                ->forMonth($target)
                ->get(['title', 'category_id'])
                ->each(function (MonthlyPayable $row) use (&$existingKeys): void {
                    $existingKeys[$this->batchKey($row->title, (int) $row->category_id)] = true;
                });

            $created = 0;
            $skipped = 0;

            DB::transaction(function () use (
                $templates, &$existingKeys, $target, $monthShift, $orgId, $userEmail, &$created, &$skipped
            ): void {
                foreach ($templates as $template) {
                    $key = $this->batchKey($template->title, (int) $template->category_id);

                    if (isset($existingKeys[$key])) {
                        $skipped++;
                        continue;
                    }

                    $copy = new MonthlyPayable();
                    $copy->organization_id = $orgId;
                    $copy->title           = $template->title;
                    $copy->category_id     = $template->category_id;
                    $copy->vendor_name     = $template->vendor_name;
                    $copy->account_number  = $template->account_number;
                    $copy->amount_due      = $template->amount_due;
                    $copy->amount_paid     = '0.00';
                    $copy->due_date        = Carbon::parse($template->due_date)->addMonthsNoOverflow($monthShift);
                    $copy->billing_month   = $target;
                    $copy->is_recurring    = true;
                    $copy->notes           = $template->notes;
                    $copy->receipt_path    = null;
                    $copy->created_by      = $userEmail;
                    $copy->modified_by     = $userEmail;
                    $copy->status          = MonthlyPayable::STATUS_PENDING;
                    $copy->syncStatus()->save();

                    // Guards against a source month holding two rows with the same key.
                    $existingKeys[$key] = true;
                    $created++;
                }
            });

            ActivityLog::log(
                'Monthly Payables Generated',
                "Generated {$created} payable(s) for {$target} from {$source} ({$skipped} skipped as existing)",
                'info',
                [
                    'resource_type'   => 'MonthlyPayable',
                    'additional_data' => ['created' => $created, 'skipped' => $skipped, 'source' => $source, 'target' => $target],
                    'organization_id' => $orgId,
                ]
            );

            $this->broadcast('batch-generated', ['billing_month' => $target, 'created' => $created]);

            return response()->json([
                'status'  => 'success',
                'message' => $created > 0
                    ? "Generated {$created} payable(s) for {$target}." . ($skipped > 0 ? " {$skipped} already existed." : '')
                    : "Nothing to generate — all {$skipped} recurring payable(s) already exist in {$target}.",
                'data'    => [
                    'created'       => $created,
                    'skipped'       => $skipped,
                    'source_month'  => $source,
                    'billing_month' => $target,
                ],
            ]);
        } catch (\Exception $e) {
            return $this->error('Error generating monthly batch: ' . $e->getMessage());
        }
    }

    /** Dedupe key for batch generation: same bill, same category, same month. */
    private function batchKey(?string $title, int $categoryId): string
    {
        return strtolower(trim((string) $title)) . '|' . $categoryId;
    }
}

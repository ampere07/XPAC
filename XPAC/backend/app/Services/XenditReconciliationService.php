<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Psr\Log\LoggerInterface;
use Exception;
use Throwable;

/**
 * Asks Xendit what actually happened to a payment, instead of waiting to be told.
 *
 * The webhook is the fast path and stays the fast path. This is the safety net
 * underneath it: every payment we created but never saw settle gets re-checked
 * against Xendit's own record on a widening schedule until it reaches a final
 * state. A dropped callback now costs a customer minutes, not their connection.
 *
 * What this service deliberately does NOT do is post the payment. Ledger
 * distribution, invoice settlement, the receipt SMS and email, and the RADIUS
 * reconnect all live in PaymentWorkerService and stay there. When Xendit
 * confirms a payment, this service does exactly what the webhook does — moves
 * the row to QUEUED and records the gateway payload — and the existing worker
 * posts it on its next pass. One posting path, one place double-posting has to
 * be prevented, and that guard is PaymentWorkerService::claimForProcessing().
 *
 * Ordering matters here: the Xendit call happens outside any transaction, and
 * the status flip happens inside a short one that takes lockForUpdate() on the
 * row. An HTTP call inside a transaction would hold a row lock open for the
 * length of a network round trip against a third party.
 */
class XenditReconciliationService
{
    /**
     * Backoff tiers in minutes, indexed by attempts already made.
     *
     * The first two tiers are tight because the overwhelming majority of real
     * payments settle within a few minutes and a dropped webhook should not
     * cost the customer more than one billing cycle of patience. Past that the
     * gaps widen fast — an invoice still unpaid after an hour is usually an
     * abandoned checkout, and there is no point asking Xendit about it every
     * two minutes for the rest of the day.
     */
    private const BACKOFF_MINUTES = [2, 5, 15, 30, 60, 180, 360, 720];

    /**
     * How far back to keep asking.
     *
     * Xendit invoices are created with a 24-hour duration, so every payment has
     * reached a final state at Xendit by then. The window is deliberately wider
     * than that: a customer who pays at hour 23 produces a final state we must
     * still be able to observe, and checkPendingPayment() locally ages PENDING
     * rows out at 24 hours without consulting the gateway. Sweeping to 48 hours
     * guarantees at least one post-expiry confirmation before we stop looking.
     */
    private const WINDOW_HOURS = 48;

    /** Rows per pass. Bounded so one sweep cannot run long enough to overlap the next. */
    private const BATCH_SIZE = 50;

    /** Seconds to wait on any single Xendit call. */
    private const HTTP_TIMEOUT = 20;

    /** Money comparison tolerance, matching PaymentWorkerService's settlement epsilon. */
    private const AMOUNT_EPSILON = 0.01;

    // ---- Operator audit surface ---------------------------------------------

    /**
     * How far back the audit screen looks by default.
     *
     * Wider than the cron's sweep window on purpose: the cron only cares about rows
     * it can still act on automatically, while an operator investigating a customer
     * who says they paid last week needs to see the row that proves it.
     */
    public const AUDIT_WINDOW_DAYS = 30;

    /**
     * Collation both sides of the account-number join are forced into.
     *
     * A constant rather than an inline literal because it appears in three queries
     * and must never disagree between them. It is interpolated into raw SQL, so it
     * is deliberately a class constant and never anything caller-supplied.
     */
    private const JOIN_COLLATION = 'utf8mb4_unicode_ci';

    public const FILTER_ALL = 'all';
    public const FILTER_PENDING = 'pending';
    public const FILTER_UNPOSTED = 'unposted';
    public const FILTER_SETTLED = 'settled';
    public const FILTER_EXPIRED = 'expired';

    /**
     * Which `pending_payments.status` values each filter tab covers.
     *
     * `unposted` is the tab that matters: Xendit has the money and billing does not
     * yet reflect it. QUEUED is waiting for the worker, PROCESSING was claimed by it,
     * and API_RETRY is a posting attempt that failed partway and needs a person.
     * An empty list means "no status filter".
     *
     * @var array<string, array<int, string>>
     */
    public const FILTER_STATUSES = [
        self::FILTER_ALL => [],
        self::FILTER_PENDING => ['PENDING'],
        self::FILTER_UNPOSTED => ['QUEUED', 'PROCESSING', 'API_RETRY'],
        self::FILTER_SETTLED => ['PAID'],
        self::FILTER_EXPIRED => ['EXPIRED', 'FAILED'],
    ];

    private string $apiKey;
    private string $baseUrl;
    private string $apiVersion;
    private ?LoggerInterface $logger = null;

    public function __construct()
    {
        $this->apiKey = (string) (config('services.xendit.api_key') ?: env('XENDIT_API_KEY', ''));
        $this->baseUrl = rtrim((string) (config('services.xendit.base_url') ?: 'https://api.xendit.co'), '/');
        $this->apiVersion = (string) (config('services.xendit.api_version') ?: '2024-11-11');
    }

    /**
     * One reconciliation pass.
     *
     * @return array{success:int,failed:int,skipped:int,errors:array,payments:array}
     */
    public function reconcilePending(): array
    {
        $result = [
            'success' => 0,
            'failed' => 0,
            'skipped' => 0,
            'errors' => [],
            'payments' => [],
        ];

        $started = microtime(true);
        $log = $this->logger();

        $log->info('=== Xendit reconciliation started ===', [
            'timestamp' => now()->toDateTimeString(),
            'window_hours' => self::WINDOW_HOURS,
            'batch_size' => self::BATCH_SIZE,
            // Whether a key is present is operationally important. Its value is not.
            'api_key_configured' => $this->apiKey !== '',
            'base_url' => $this->baseUrl,
        ]);

        if ($this->apiKey === '') {
            // Failing loudly beats silently marking every payment unreconciled.
            $log->error('Xendit API key is not configured — reconciliation cannot run');
            $result['errors'][] = 'Xendit API key is not configured';
            return $result;
        }

        try {
            $due = $this->fetchDuePayments();
        } catch (Throwable $e) {
            $log->error('Failed to load payments due for reconciliation', ['error' => $e->getMessage()]);
            $result['errors'][] = 'Failed to load due payments: ' . $e->getMessage();
            return $result;
        }

        $log->info('Payments due for reconciliation: ' . $due->count());

        foreach ($due as $payment) {
            try {
                $outcome = $this->reconcileOne($payment);

                $result['payments'][] = [
                    'reference_no' => $payment->reference_no,
                    'outcome' => $outcome,
                ];

                if ($outcome === 'still_pending' || $outcome === 'unverifiable') {
                    $result['skipped']++;
                } else {
                    $result['success']++;
                }
            } catch (Throwable $e) {
                // One unreachable payment must not abandon the other 49.
                $result['failed']++;
                $result['errors'][] = [
                    'reference_no' => $payment->reference_no,
                    'error' => $e->getMessage(),
                ];

                $log->error('Reconciliation failed for payment', [
                    'reference_no' => $payment->reference_no,
                    'payment_id' => $payment->payment_id,
                    'error' => $e->getMessage(),
                ]);

                // Back the row off anyway. Without this a payment whose lookup
                // throws every time is retried on every pass forever.
                $this->scheduleRetry($payment);
            }
        }

        $log->info('=== Xendit reconciliation completed ===', [
            'succeeded' => $result['success'],
            'failed' => $result['failed'],
            'skipped' => $result['skipped'],
            'duration_seconds' => round(microtime(true) - $started, 2),
        ]);

        return $result;
    }

    // =========================================================================
    // Operator-facing audit surface
    // =========================================================================

    /**
     * The pending_payments → billing_accounts → customers join, built once.
     *
     * The account-number join is forced to a single collation on both sides. It has
     * to be: `pending_payments` was created without naming a collation and inherited
     * whatever the server default was, which on MariaDB 11.4+ is
     * `utf8mb4_uca1400_ai_ci`, while `billing_accounts` is `utf8mb4_unicode_ci`.
     * Comparing them raises
     *
     *   SQLSTATE[HY000] 1267: Illegal mix of collations ... for operation '='
     *
     * and the whole audit endpoint returns a 500. Migration
     * 2026_08_18_000001_fix_pending_payments_collation converts the table, but the
     * COLLATE clause stays here on purpose: it is what keeps this query working on a
     * database where that migration has not run yet, and on any future deployment
     * seeded from a server with a different default.
     *
     * The cost is real and worth naming — an explicit COLLATE on the join predicate
     * prevents MySQL using an index on `billing_accounts.account_no`. This join is
     * against a window of recent payments, not the whole table, so the row count is
     * small; once every deployment has run the migration both sides agree natively
     * and the clause can be dropped.
     *
     * @return \Illuminate\Database\Query\Builder
     */
    private function auditBase()
    {
        $collation = self::JOIN_COLLATION;

        return DB::table('pending_payments as pp')
            ->leftJoin('billing_accounts as ba', function ($join) use ($collation) {
                $join->on(
                    DB::raw("ba.account_no COLLATE {$collation}"),
                    '=',
                    DB::raw("pp.account_no COLLATE {$collation}")
                );
            })
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id');
    }

    /**
     * The reconciliation worklist the tool renders, plus its stat cards.
     *
     * Read-only and gateway-free: every column comes from what we already hold, so
     * opening the screen costs no Xendit quota. Asking the gateway is an explicit
     * per-row action (verifyPayment) or the cron's job.
     *
     * One query, joined and paginated. `channel` and the gateway's own last-known
     * status are read out of the stored callback payload rather than carried in
     * their own columns — the payload is the record of what the gateway said, and a
     * second copy of it would be a second source of truth about money.
     *
     * @param array{filter?:string, search?:string, days?:int, page?:int, per_page?:int} $options
     * @return array{rows:array<int,array<string,mixed>>, summary:array<string,int>, total:int, page:int, per_page:int, filter:string}
     */
    public function getAuditList(array $options = [], ?int $organizationId = null): array
    {
        $filter = (string) ($options['filter'] ?? self::FILTER_ALL);
        $search = trim((string) ($options['search'] ?? ''));
        $days = max(1, min(365, (int) ($options['days'] ?? self::AUDIT_WINDOW_DAYS)));
        $page = max(1, (int) ($options['page'] ?? 1));
        $perPage = max(10, min(200, (int) ($options['per_page'] ?? 50)));

        if (!array_key_exists($filter, self::FILTER_STATUSES)) {
            $filter = self::FILTER_ALL;
        }

        $since = now()->subDays($days);

        $base = $this->auditBase()->where('pp.payment_date', '>=', $since);

        if ($organizationId !== null) {
            $base->where(function ($q) use ($organizationId) {
                $q->where('pp.organization_id', $organizationId)->orWhereNull('pp.organization_id');
            });
        }

        // The stat cards describe the same window the table does, so they are
        // counted from the same filtered base rather than a second definition.
        $summary = $this->summarizeAudit(clone $base);

        $statuses = self::FILTER_STATUSES[$filter];
        if ($statuses !== []) {
            $base->whereIn('pp.status', $statuses);
        }

        if ($search !== '') {
            $base->where(function ($q) use ($search) {
                $like = '%' . $search . '%';
                $q->where('pp.reference_no', 'like', $like)
                    ->orWhere('pp.account_no', 'like', $like)
                    ->orWhere('pp.payment_id', 'like', $like)
                    ->orWhere('c.first_name', 'like', $like)
                    ->orWhere('c.last_name', 'like', $like);
            });
        }

        $total = (clone $base)->count('pp.id');

        $records = $base
            ->select([
                'pp.id',
                'pp.reference_no',
                'pp.account_no',
                'pp.amount',
                'pp.status',
                'pp.provider',
                'pp.payment_id',
                'pp.xendit_payment_id',
                'pp.payment_date',
                'pp.currency',
                'pp.callback_payload',
                'pp.reconciliation_attempts',
                'pp.last_reconciled_at',
                'pp.next_reconciliation_at',
                'pp.reconnect_status',
                'pp.created_at',
                'pp.updated_at',
                'ba.id as billing_account_id',
                'c.first_name',
                'c.last_name',
            ])
            ->orderByDesc('pp.payment_date')
            ->orderByDesc('pp.id')
            ->forPage($page, $perPage)
            ->get();

        $rows = [];
        foreach ($records as $record) {
            $rows[] = $this->presentAuditRow($record);
        }

        return [
            'rows' => $rows,
            'summary' => $summary,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'filter' => $filter,
            'days' => $days,
        ];
    }

    /**
     * Stat-card counts over the same window as the table.
     *
     * @param \Illuminate\Database\Query\Builder $base
     * @return array<string, int>
     */
    private function summarizeAudit($base): array
    {
        // Both counts branch off their own copy. Query builder methods mutate and
        // return $this, so running the grouped count first would leave the GROUP BY
        // on $base — and a grouped ->count() returns the first group's tally, not the
        // total, which silently undercounted "Missing in DB".
        $grouped = clone $base;
        $orphans = clone $base;

        $counts = $grouped
            ->select('pp.status', DB::raw('COUNT(*) as total'))
            ->groupBy('pp.status')
            ->pluck('total', 'status');

        $sum = static function (array $statuses) use ($counts): int {
            $total = 0;
            foreach ($statuses as $status) {
                $total += (int) ($counts[$status] ?? 0);
            }
            return $total;
        };

        return [
            'unreconciled' => $sum(self::FILTER_STATUSES[self::FILTER_PENDING]),
            'unposted' => $sum(self::FILTER_STATUSES[self::FILTER_UNPOSTED]),
            'settled' => $sum(self::FILTER_STATUSES[self::FILTER_SETTLED]),
            'expired' => $sum(self::FILTER_STATUSES[self::FILTER_EXPIRED]),
            // A payment whose account_no matches no billing account. Real, and the
            // reason a settled transaction can never be posted: there is nothing to
            // credit. Counted separately because it needs a person, not a retry.
            'missing_in_db' => (int) $orphans->whereNull('ba.id')->count('pp.id'),
        ];
    }

    /**
     * Shape one audit row for the table, including what the gateway last said.
     *
     * @return array<string, mixed>
     */
    private function presentAuditRow(object $record): array
    {
        $payload = [];
        if (!empty($record->callback_payload)) {
            $decoded = json_decode((string) $record->callback_payload, true);
            $payload = is_array($decoded) ? $decoded : [];
        }

        $name = trim(($record->first_name ?? '') . ' ' . ($record->last_name ?? ''));

        return [
            'id' => (int) $record->id,
            'reference_no' => (string) $record->reference_no,
            'invoice_id' => (string) ($record->payment_id ?? ''),
            'xendit_payment_id' => $record->xendit_payment_id,
            'account_no' => (string) $record->account_no,
            'subscriber_name' => $name !== '' ? $name : null,
            'account_exists' => $record->billing_account_id !== null,
            'amount' => (float) $record->amount,
            'currency' => (string) ($record->currency ?: 'PHP'),
            'channel' => $this->extractChannel($payload, (string) ($record->provider ?? '')),
            'xendit_status' => strtoupper((string) ($payload['status'] ?? '')) ?: null,
            'billing_status' => (string) $record->status,
            'settled_at' => $this->extractSettledAt($payload),
            'payment_date' => $record->payment_date,
            // The three dates the reconciliation table sorts on.
            //
            // Created and updated come off our own row; expiry is the gateway's, and
            // only Xendit knows it — `pending_payments` has no expiry column, so it is
            // read out of the stored callback payload and is null until one arrives.
            'created_at' => $record->created_at,
            // The same instant, pre-formatted, for the Date Created column. Served
            // beside the raw value rather than instead of it: the table sorts on the
            // raw timestamp and displays this.
            'date_created' => $this->formatStamp($record->created_at ?? null),
            'updated_at' => $record->updated_at,
            'expiry_date' => $this->extractExpiryDate($payload),
            'attempts' => (int) ($record->reconciliation_attempts ?? 0),
            'last_reconciled_at' => $record->last_reconciled_at,
            'next_reconciliation_at' => $record->next_reconciliation_at,
            'reconnect_status' => $record->reconnect_status,
            'can_force_post' => $this->canForcePost((string) $record->status, $payload),
            'can_mark_expired' => (string) $record->status === 'PENDING',
        ];
    }

    /**
     * A stored timestamp as `YYYY-MM-DD HH:MM:SS`, or null where there is none.
     *
     * Pinned rather than localised: this screen reconciles a gateway against a
     * ledger, and an ambiguous day/month is exactly the reading that costs an hour.
     * An unparseable value is returned as-is rather than becoming a wrong date.
     */
    private function formatStamp(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse($value)->format('Y-m-d H:i:s');
        } catch (Throwable $e) {
            return (string) $value;
        }
    }

    /**
     * Which rail the customer actually paid on.
     */
    private function extractChannel(array $payload, string $provider): string
    {
        foreach (['payment_channel', 'payment_method', 'ewallet_type', 'bank_code', 'channel_code'] as $key) {
            $value = $payload[$key] ?? null;

            if (is_string($value) && trim($value) !== '') {
                return strtoupper(trim($value));
            }

            // v3 payment requests nest the rail under payment_method.
            if (is_array($value) && is_string($value['type'] ?? null) && trim($value['type']) !== '') {
                return strtoupper(trim($value['type']));
            }
        }

        return $provider !== '' ? strtoupper($provider) : 'UNKNOWN';
    }

    /**
     * When the gateway says the request stops being payable.
     *
     * Mirrors extractSettledAt(): Xendit names this field differently across the
     * invoice and payment-request APIs, and a v3 payment request nests it under
     * `actions`, so the recognised names are tried in order rather than assuming one.
     *
     * Null is a real answer — a payload that carries no expiry at all, or a row whose
     * callback has not arrived yet — and the table renders it as unknown rather than
     * inventing a date.
     */
    private function extractExpiryDate(array $payload): ?string
    {
        foreach (['expiry_date', 'expires_at', 'expiration_date', 'expired_at'] as $key) {
            $value = $payload[$key] ?? null;

            if (is_string($value) && trim($value) !== '') {
                return $value;
            }
        }

        return null;
    }

    /**
     * When the gateway says the money arrived, in whichever field it used.
     */
    private function extractSettledAt(array $payload): ?string
    {
        foreach (['paid_at', 'settled_at', 'updated', 'succeeded_at', 'created'] as $key) {
            $value = $payload[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return $value;
            }
        }

        return null;
    }

    /**
     * May this row be posted by hand?
     *
     * Only when the gateway has actually told us it is paid. A PENDING row with no
     * confirmation is not a posting candidate at any price — force-posting one would
     * credit an account for money nobody has received.
     */
    private function canForcePost(string $status, array $payload): bool
    {
        if (in_array($status, ['PAID', 'PROCESSING'], true)) {
            return false;
        }

        return $this->isPaid(strtoupper((string) ($payload['status'] ?? '')));
    }

    /**
     * Ask Xendit about one payment, now, and record what it says.
     *
     * This is the row-level "Verify with Xendit" action. It reuses the same lookup,
     * verification and state-transition path as the cron, so a payment confirmed here
     * lands in exactly the state the cron would have left it in — QUEUED for the
     * payment worker, never posted directly from this method.
     *
     * @return array{success:bool, skipped:bool, message:string, outcome:string|null, row:array<string,mixed>|null}
     */
    public function verifyPayment(int $pendingPaymentId, ?int $organizationId = null): array
    {
        if ($this->apiKey === '') {
            return ['success' => false, 'skipped' => false, 'message' => 'The Xendit API key is not configured.', 'outcome' => null, 'row' => null];
        }

        $payment = $this->findPayment($pendingPaymentId, $organizationId);

        if ($payment === null) {
            return ['success' => false, 'skipped' => false, 'message' => "Payment #{$pendingPaymentId} does not exist.", 'outcome' => null, 'row' => null];
        }

        if (empty($payment->payment_id)) {
            return [
                'success' => false,
                'skipped' => false,
                'message' => "Payment {$payment->reference_no} carries no gateway id, so Xendit has nothing to look up.",
                'outcome' => null,
                'row' => null,
            ];
        }

        try {
            // reconcileOne() does the network call outside any transaction and takes
            // the row lock only for the status flip.
            $outcome = $this->reconcileOne($payment);
        } catch (Throwable $e) {
            $this->logger()->error('Manual verification failed', [
                'reference_no' => $payment->reference_no,
                'error' => $e->getMessage(),
            ]);

            return ['success' => false, 'skipped' => false, 'message' => 'Xendit lookup failed: ' . $e->getMessage(), 'outcome' => null, 'row' => null];
        }

        $messages = [
            'queued' => 'Xendit confirmed the payment. It is queued and the payment worker will post it.',
            'expired' => 'Xendit reports this checkout as expired.',
            'failed' => 'Xendit reports this payment as failed or voided.',
            'still_pending' => 'Xendit still shows this payment as open.',
            'unverifiable' => 'Xendit could not confirm this payment — it is held for review.',
        ];

        return [
            'success' => true,
            'skipped' => in_array($outcome, ['still_pending', 'unverifiable'], true),
            'message' => $messages[$outcome] ?? 'Verification completed.',
            'outcome' => $outcome,
            'row' => $this->reloadRow($pendingPaymentId),
        ];
    }

    /**
     * Post a gateway-confirmed payment to billing without waiting for the worker.
     *
     * Two guards stand in front of the money. The stored payload must say Xendit
     * paid it — an unconfirmed row can never be forced. And the posting itself is
     * PaymentWorkerService::postPayment(), whose lockForUpdate() claim is the single
     * place double-posting is prevented; this method adds no second posting path and
     * opens no transaction of its own around it.
     *
     * @return array{success:bool, skipped:bool, message:string, row:array<string,mixed>|null}
     */
    public function forcePost(int $pendingPaymentId, PaymentWorkerService $worker, ?int $organizationId = null): array
    {
        $payment = $this->findPayment($pendingPaymentId, $organizationId);

        if ($payment === null) {
            return ['success' => false, 'skipped' => false, 'message' => "Payment #{$pendingPaymentId} does not exist.", 'row' => null];
        }

        $payload = [];
        if (!empty($payment->callback_payload)) {
            $decoded = json_decode((string) $payment->callback_payload, true);
            $payload = is_array($decoded) ? $decoded : [];
        }

        if (!$this->canForcePost((string) $payment->status, $payload)) {
            return [
                'success' => false,
                'skipped' => false,
                'message' => in_array($payment->status, ['PAID', 'PROCESSING'], true)
                    ? "Payment {$payment->reference_no} has already been posted."
                    : "Payment {$payment->reference_no} has no confirmed-paid record from Xendit. Verify it first — a payment the gateway has not confirmed must never be posted.",
                'row' => $this->reloadRow($pendingPaymentId),
            ];
        }

        // The account has to exist or there is nothing to credit.
        $accountExists = DB::table('billing_accounts')->where('account_no', $payment->account_no)->exists();

        if (!$accountExists) {
            return [
                'success' => false,
                'skipped' => false,
                'message' => "No billing account carries account number {$payment->account_no}, so this payment cannot be posted.",
                'row' => $this->reloadRow($pendingPaymentId),
            ];
        }

        $this->logger()->info('Force-post requested from the reconciliation tool', [
            'reference_no' => $payment->reference_no,
            'account_no' => $payment->account_no,
            'amount' => $payment->amount,
            'user_id' => auth()->id(),
        ]);

        $outcome = $worker->postPayment($pendingPaymentId);

        return [
            'success' => (bool) $outcome['success'],
            'skipped' => (bool) $outcome['skipped'],
            'message' => $outcome['message'],
            'row' => $this->reloadRow($pendingPaymentId),
        ];
    }

    /**
     * Write off an abandoned checkout.
     *
     * Guarded on PENDING so it can never walk back a payment the webhook, the cron
     * or the worker has already moved on, and refused outright when the stored
     * payload says the gateway paid it — that row needs posting, not burying.
     *
     * @return array{success:bool, skipped:bool, message:string, row:array<string,mixed>|null}
     */
    public function markExpired(int $pendingPaymentId, ?string $reason = null, ?int $organizationId = null): array
    {
        $payment = $this->findPayment($pendingPaymentId, $organizationId);

        if ($payment === null) {
            return ['success' => false, 'skipped' => false, 'message' => "Payment #{$pendingPaymentId} does not exist.", 'row' => null];
        }

        if ($payment->status !== 'PENDING') {
            return [
                'success' => true,
                'skipped' => true,
                'message' => "Payment {$payment->reference_no} is already {$payment->status}.",
                'row' => $this->reloadRow($pendingPaymentId),
            ];
        }

        $payload = [];
        if (!empty($payment->callback_payload)) {
            $decoded = json_decode((string) $payment->callback_payload, true);
            $payload = is_array($decoded) ? $decoded : [];
        }

        if ($this->isPaid(strtoupper((string) ($payload['status'] ?? '')))) {
            return [
                'success' => false,
                'skipped' => false,
                'message' => "Xendit has confirmed payment {$payment->reference_no} as paid. It cannot be expired — post it instead.",
                'row' => $this->reloadRow($pendingPaymentId),
            ];
        }

        $affected = DB::table('pending_payments')
            ->where('id', $pendingPaymentId)
            ->where('status', 'PENDING')
            ->update([
                'status' => 'EXPIRED',
                'next_reconciliation_at' => null,
                'last_reconciled_at' => now(),
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            // Something moved it between the read and the write.
            return [
                'success' => true,
                'skipped' => true,
                'message' => "Payment {$payment->reference_no} changed status before it could be expired.",
                'row' => $this->reloadRow($pendingPaymentId),
            ];
        }

        $this->logger()->info('Payment manually marked expired', [
            'reference_no' => $payment->reference_no,
            'account_no' => $payment->account_no,
            'reason' => $reason,
            'user_id' => auth()->id(),
        ]);

        return [
            'success' => true,
            'skipped' => false,
            'message' => "Payment {$payment->reference_no} marked expired.",
            'row' => $this->reloadRow($pendingPaymentId),
        ];
    }

    /**
     * One payment by id, scoped to the caller's organization.
     */
    private function findPayment(int $id, ?int $organizationId = null): ?object
    {
        $query = DB::table('pending_payments')->where('id', $id);

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId) {
                $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
            });
        }

        return $query->first();
    }

    /**
     * Re-read one row in table shape, so an action can hand the UI the new state.
     *
     * @return array<string, mixed>|null
     */
    private function reloadRow(int $id): ?array
    {
        $record = $this->auditBase()
            ->where('pp.id', $id)
            ->select([
                'pp.id',
                'pp.reference_no',
                'pp.account_no',
                'pp.amount',
                'pp.status',
                'pp.provider',
                'pp.payment_id',
                'pp.xendit_payment_id',
                'pp.payment_date',
                'pp.currency',
                'pp.callback_payload',
                'pp.reconciliation_attempts',
                'pp.last_reconciled_at',
                'pp.next_reconciliation_at',
                'pp.reconnect_status',
                // created_at is not optional here. presentAuditRow() reads it, and a
                // column missing from a query-builder row raises an undefined-property
                // warning that Laravel turns into an ErrorException - which is what
                // made Verify with Xendit report a failure after it had succeeded.
                'pp.created_at',
                'pp.updated_at',
                'ba.id as billing_account_id',
                'c.first_name',
                'c.last_name',
            ])
            ->first();

        return $record === null ? null : $this->presentAuditRow($record);
    }

    /**
     * PENDING rows inside the window whose next check is due.
     *
     * A null next_reconciliation_at means the row predates this feature or has
     * never been swept; both are due immediately.
     */
    private function fetchDuePayments()
    {
        return DB::table('pending_payments')
            ->where('status', 'PENDING')
            ->where('payment_date', '>=', now()->subHours(self::WINDOW_HOURS))
            ->whereNotNull('payment_id')
            ->where(function ($q) {
                $q->whereNull('next_reconciliation_at')
                    ->orWhere('next_reconciliation_at', '<=', now());
            })
            ->select(
                'id',
                'reference_no',
                'account_no',
                'amount',
                'status',
                'payment_id',
                'currency',
                'payment_date',
                'reconciliation_attempts'
            )
            ->orderBy('payment_date', 'asc')
            ->limit(self::BATCH_SIZE)
            ->get();
    }

    /**
     * Reconcile a single payment against Xendit.
     *
     * @return string one of: queued, expired, failed, still_pending, unverifiable
     */
    private function reconcileOne($payment): string
    {
        $log = $this->logger();

        // Network call first, and outside any transaction.
        $remote = $this->fetchRemoteStatus((string) $payment->payment_id);

        if ($remote === null) {
            $log->warning('No usable response from Xendit', [
                'reference_no' => $payment->reference_no,
                'payment_id' => $payment->payment_id,
            ]);
            $this->scheduleRetry($payment);
            return 'unverifiable';
        }

        $status = strtoupper((string) ($remote['status'] ?? ''));

        $log->info('Xendit reported status', [
            'reference_no' => $payment->reference_no,
            'remote_status' => $status,
            'attempt' => (int) $payment->reconciliation_attempts + 1,
        ]);

        if ($this->isPaid($status)) {
            return $this->handlePaid($payment, $remote, $status);
        }

        if ($status === 'EXPIRED') {
            $this->markTerminal($payment, 'EXPIRED', $remote);
            return 'expired';
        }

        if (in_array($status, ['FAILED', 'PAYMENT_FAILED', 'VOIDED', 'CANCELED', 'CANCELLED'], true)) {
            $this->markTerminal($payment, 'FAILED', $remote);
            return 'failed';
        }

        // Genuinely still open at Xendit. Widen the gap and come back.
        $this->scheduleRetry($payment);
        return 'still_pending';
    }

    /**
     * Xendit's terminal "we have the money" vocabulary.
     *
     * Kept in one place because the invoice API and the payment request API
     * spell it differently, and reading either as anything but paid would leave
     * a settled customer disconnected.
     */
    private function isPaid(string $status): bool
    {
        return in_array($status, ['PAID', 'SETTLED', 'COMPLETED', 'SUCCEEDED', 'PAYMENT_SUCCESS'], true);
    }

    /**
     * Xendit says this is paid. Verify it is the payment we think it is, then
     * hand it to the existing worker.
     */
    private function handlePaid($payment, array $remote, string $status): string
    {
        $log = $this->logger();

        $mismatch = $this->verify($payment, $remote);

        if ($mismatch !== null) {
            // Never settle a payment we cannot match to this row. Queuing on a
            // mismatched reference or amount would credit the wrong customer or
            // the wrong sum, and PaymentWorkerService trusts what it is given.
            $log->error('Reconciliation refused — payment does not match our record', [
                'reference_no' => $payment->reference_no,
                'payment_id' => $payment->payment_id,
                'mismatch' => $mismatch,
            ]);

            // Hold it for a human rather than retrying a check that will fail
            // identically. The row stays PENDING and stops being swept.
            $this->scheduleRetry($payment, true);
            return 'unverifiable';
        }

        $remotePaymentId = $this->extractPaymentId($remote);
        $payload = json_encode($remote);

        // Narrow transaction: claim the row, or discover the webhook beat us.
        $queued = DB::transaction(function () use ($payment, $payload, $remotePaymentId, $status) {
            $fresh = DB::table('pending_payments')
                ->where('id', $payment->id)
                ->lockForUpdate()
                ->first();

            // The webhook may have landed between our Xendit call and this lock.
            // Anything past PENDING is already someone else's to finish.
            if (!$fresh || $fresh->status !== 'PENDING') {
                return false;
            }

            DB::table('pending_payments')
                ->where('id', $payment->id)
                ->update([
                    'status' => 'QUEUED',
                    'callback_payload' => $payload,
                    'xendit_payment_id' => $remotePaymentId,
                    'reconciliation_attempts' => (int) $payment->reconciliation_attempts + 1,
                    'last_reconciled_at' => now(),
                    'next_reconciliation_at' => null,
                    'updated_at' => now(),
                ]);

            return true;
        });

        if (!$queued) {
            $log->info('Already handled elsewhere — skipping', [
                'reference_no' => $payment->reference_no,
            ]);
            return 'still_pending';
        }

        $log->info('Payment confirmed by Xendit and queued for posting', [
            'reference_no' => $payment->reference_no,
            'account_no' => $payment->account_no,
            'amount' => $payment->amount,
            'remote_status' => $status,
            'xendit_payment_id' => $remotePaymentId,
        ]);

        return 'queued';
    }

    /**
     * Confirm the gateway is describing this exact payment.
     *
     * @return string|null null when everything matches, else what did not
     */
    private function verify($payment, array $remote): ?string
    {
        $remoteRef = (string) ($remote['external_id'] ?? $remote['reference_id'] ?? '');
        if ($remoteRef !== '' && $remoteRef !== (string) $payment->reference_no) {
            return 'reference_no expected ' . $payment->reference_no . ', gateway reported ' . $remoteRef;
        }

        // Invoices report `amount`; payment requests report `request_amount`.
        $remoteAmount = $remote['amount'] ?? $remote['request_amount'] ?? null;
        if ($remoteAmount !== null && abs((float) $remoteAmount - (float) $payment->amount) > self::AMOUNT_EPSILON) {
            return 'amount expected ' . $payment->amount . ', gateway reported ' . $remoteAmount;
        }

        $expectedCurrency = strtoupper((string) ($payment->currency ?: 'PHP'));
        $remoteCurrency = strtoupper((string) ($remote['currency'] ?? ''));
        if ($remoteCurrency !== '' && $remoteCurrency !== $expectedCurrency) {
            return 'currency expected ' . $expectedCurrency . ', gateway reported ' . $remoteCurrency;
        }

        return null;
    }

    /**
     * The id of the payment that settled the request, where the response carries one.
     */
    private function extractPaymentId(array $remote): ?string
    {
        if (!empty($remote['payment_id'])) {
            return (string) $remote['payment_id'];
        }

        // v3 payment requests nest the actual payments under `payments`.
        if (!empty($remote['payments']) && is_array($remote['payments'])) {
            $latest = end($remote['payments']);
            if (is_array($latest) && !empty($latest['id'])) {
                return (string) $latest['id'];
            }
        }

        return null;
    }

    /**
     * Read a payment's current state from Xendit.
     *
     * Two APIs can hold the record. Checkouts created with POST /v2/invoices are read
     * back from /v2/invoices/{id}; those created through the v3 Payments API are read
     * from /v3/payment_requests/{id}. The id's own shape says which is likely - Xendit
     * prefixes payment-request ids `pr-` - but that is a hint, not a guarantee, and a
     * deployment that has moved between the two create paths has historical rows of
     * both kinds under one column.
     *
     * So the likely endpoint is tried first and the other one only on a 404. A 404 is
     * the one status that means "this API does not hold this record"; any other
     * failure is about the call itself and is raised rather than retried against an
     * endpoint that was never going to have it either. At most one extra request is
     * ever made, and only for a row the first endpoint disowned.
     *
     * @return array|null decoded body, or null when the state is not knowable
     */
    private function fetchRemoteStatus(string $id): ?array
    {
        $order = $this->looksLikePaymentRequest($id)
            ? [true, false]
            : [false, true];

        foreach ($order as $asPaymentRequest) {
            $response = $this->requestRemoteStatus($id, $asPaymentRequest);

            if ($response->successful()) {
                $body = $response->json();

                return is_array($body) ? $body : null;
            }

            if ($response->status() === 404) {
                continue;
            }

            // Body is logged because Xendit's error envelope carries the reason and
            // never contains our key. The Authorization header is not logged.
            $this->logger()->error('Xendit lookup failed', [
                'payment_id' => $id,
                'endpoint' => $asPaymentRequest ? 'payment_requests' : 'invoices',
                'http_status' => $response->status(),
                'body' => $response->body(),
            ]);

            throw new Exception('Xendit lookup failed with HTTP ' . $response->status());
        }

        // Neither API has such a record. Retrying cannot change that, but neither can
        // we call it paid - leave it for the operator.
        $this->logger()->warning('Xendit has no record of this payment on either API', [
            'payment_id' => $id,
        ]);

        return null;
    }

    /**
     * Is this id shaped like a v3 payment request rather than a v2 invoice?
     *
     * Xendit prefixes payment-request ids `pr-` (older sandbox keys used `pr_`);
     * invoice ids are a bare 24-character object id.
     */
    private function looksLikePaymentRequest(string $id): bool
    {
        return str_starts_with($id, 'pr-') || str_starts_with($id, 'pr_');
    }

    /**
     * One lookup against one of the two APIs. No retry and no interpretation - the
     * caller decides what a given status means.
     */
    private function requestRemoteStatus(string $id, bool $asPaymentRequest): Response
    {
        $url = $asPaymentRequest
            ? $this->baseUrl . '/v3/payment_requests/' . rawurlencode($id)
            : $this->baseUrl . '/v2/invoices/' . rawurlencode($id);

        $request = Http::withBasicAuth($this->apiKey, '')->timeout(self::HTTP_TIMEOUT);

        if ($asPaymentRequest) {
            $request = $request->withHeaders(['api-version' => $this->apiVersion]);
        }

        return $request->get($url);
    }

    /**
     * Record a terminal non-paid outcome.
     *
     * Guarded on status = PENDING so this can never walk back a row the webhook
     * or the payment worker has already moved on.
     */
    private function markTerminal($payment, string $newStatus, array $remote): void
    {
        $affected = DB::table('pending_payments')
            ->where('id', $payment->id)
            ->where('status', 'PENDING')
            ->update([
                'status' => $newStatus,
                'callback_payload' => json_encode($remote),
                'reconciliation_attempts' => (int) $payment->reconciliation_attempts + 1,
                'last_reconciled_at' => now(),
                'next_reconciliation_at' => null,
                'updated_at' => now(),
            ]);

        if ($affected > 0) {
            $this->logger()->info('Payment marked ' . $newStatus . ' from gateway record', [
                'reference_no' => $payment->reference_no,
                'account_no' => $payment->account_no,
            ]);
        }
    }

    /**
     * Move the row to its next backoff tier.
     *
     * @param bool $park when true the row is taken out of the sweep entirely and
     *                   needs an operator. Used for verification mismatches,
     *                   where retrying asks a question already answered.
     */
    private function scheduleRetry($payment, bool $park = false): void
    {
        $attempts = (int) $payment->reconciliation_attempts + 1;

        if ($park) {
            $next = null;
        } else {
            $tier = min($attempts, count(self::BACKOFF_MINUTES)) - 1;
            $next = now()->addMinutes(self::BACKOFF_MINUTES[$tier]);
        }

        DB::table('pending_payments')
            ->where('id', $payment->id)
            ->where('status', 'PENDING')
            ->update([
                'reconciliation_attempts' => $attempts,
                'last_reconciled_at' => now(),
                'next_reconciliation_at' => $next,
                'updated_at' => now(),
            ]);
    }

    /**
     * Dedicated reconciliation log, matching the cron channel pattern used by
     * the other sweeps. A run must be reconstructable from this file alone.
     */
    private function logger(): LoggerInterface
    {
        if ($this->logger !== null) {
            return $this->logger;
        }

        try {
            $path = storage_path('logs/xendit');
            if (!file_exists($path)) {
                mkdir($path, 0755, true);
            }

            $this->logger = Log::build([
                'driver' => 'single',
                'path' => $path . '/reconciliation.log',
            ]);
        } catch (Throwable $e) {
            // An unwritable log directory must not stop payments reconciling.
            $this->logger = Log::channel('stack');
        }

        return $this->logger;
    }
}

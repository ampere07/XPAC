<?php

namespace App\Services;

use App\Models\BillingAccount;
use App\Support\PlanGroup;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Why a subscriber who should have been billed this cycle has no invoice.
 *
 * The nightly generator reports how many invoices it raised. What it has never
 * reported is who it silently passed over, and every one of those is a month of
 * revenue nobody notices until the customer calls. An account with no billing day, a
 * plan that was unlinked during a plan change, a plan priced at 0.00, a status left on
 * Suspended after a reconnection, an onboarding whose job order was never closed — the
 * generator's WHERE clause drops all of them without a word. This service is that
 * missing report, plus the ability to raise the bill by hand once the reason is known.
 *
 * Read-only on the audit path: no gateway call, no generation, no write. Opening the
 * screen costs one chunked sweep of billing_accounts and three lookups per chunk.
 *
 * Generation delegates to EnhancedBillingGenerationServiceWithNotifications — the same
 * service the cron uses, through its per-account entry point, so an invoice raised here
 * carries the identical VAT, withholding, prorate and notification behaviour as one
 * raised at 01:00. Nothing about the billing maths is reimplemented in this file.
 */
class BillingReconciliationService
{
    /** activity_logs.resource_type for everything this service records. */
    public const RESOURCE_TYPE = 'billing_reconcile_tool';

    private const LOG_CHANNEL = 'billingreconcile';
    private const LOG_PREFIX = 'Billing_Reconciliation';

    /** Accounts read per sweep chunk. Keeps memory and query size flat on a large estate. */
    private const ACCOUNT_CHUNK = 500;

    /** Ceiling on accounts one generate request may bill. */
    public const MAX_GENERATE_BATCH = 200;

    /** billing_status_id that means the account is live and billable. */
    public const BILLING_STATUS_ACTIVE = 1;

    /** billing_day sentinel meaning "every end of month". A real value, not a missing one. */
    public const END_OF_MONTH_BILLING = 0;

    /**
     * Job-order statuses that mean onboarding is finished.
     *
     * Anything else open against the account means the install is still in flight, and
     * billing a line that is not yet delivered is the one mistake here that reaches the
     * customer as a bill they will dispute.
     */
    public const CLOSED_JOB_STATUSES = ['done', 'completed', 'cancelled', 'canceled'];

    // ---- Reason codes -------------------------------------------------------
    public const REASON_READY = 'ready';
    public const REASON_MISSING_BILLING_DAY = 'missing_billing_day';
    public const REASON_MISSING_PLAN = 'missing_plan';
    public const REASON_ZERO_PRICE = 'zero_price';
    public const REASON_INACTIVE_STATUS = 'inactive_status';
    public const REASON_PREPAID = 'prepaid';
    public const REASON_ALREADY_INVOICED = 'already_invoiced';
    public const REASON_OPEN_JOB_ORDER = 'open_job_order';
    public const REASON_DISMISSED = 'dismissed';

    /** @var array<string, string> */
    public const REASON_LABELS = [
        self::REASON_READY => 'Ready to Generate',
        self::REASON_MISSING_BILLING_DAY => 'Missing Billing Day',
        self::REASON_MISSING_PLAN => 'Missing / Unlinked Plan',
        self::REASON_ZERO_PRICE => 'Plan Price is 0.00',
        self::REASON_INACTIVE_STATUS => 'Inactive / Suspended / Terminated Status',
        self::REASON_PREPAID => 'Prepaid Account (Awaiting Renewal)',
        self::REASON_ALREADY_INVOICED => 'Already Invoiced for Current Cycle',
        self::REASON_OPEN_JOB_ORDER => 'Incomplete Onboarding (Open Job Order)',
        self::REASON_DISMISSED => 'Dismissed (Do Not Generate)',
    ];

    /**
     * Reasons an operator can clear by generating the bill from this screen.
     *
     * Deliberately short. Everything else is a data problem that has to be fixed on the
     * account first — raising an invoice against an unlinked plan or a 0.00 price would
     * produce a bill for nothing and settle the discrepancy by hiding it.
     */
    public const GENERATABLE_REASONS = [self::REASON_READY];

    /**
     * Whether `billing_accounts.generation_type` exists in this deployment.
     *
     * Prepaid is a GOWISER-only feature. ATSS and AKMIIS have no prepaid suite and no
     * such column, and selecting it there fails the whole sweep with SQLSTATE[42S22].
     * Probed once per request and memoized rather than assumed, because the three
     * schemas were hand-built and genuinely differ. Absent reads as "not prepaid",
     * which is the same answer BillingAccount::isPrepaidType(null) gives.
     */
    private ?bool $hasGenerationType = null;

    public function __construct(
        private EnhancedBillingGenerationServiceWithNotifications $generator
    ) {
    }

    private function hasGenerationType(): bool
    {
        if ($this->hasGenerationType === null) {
            $this->hasGenerationType = Schema::hasColumn('billing_accounts', 'generation_type');
        }

        return $this->hasGenerationType;
    }

    // =========================================================================
    // Audit
    // =========================================================================

    /**
     * Every account whose current cycle did not produce an invoice, and why.
     *
     * "Due this cycle" means the day the generator would have run for this account has
     * already passed. That day is the account's billing day pulled forward by
     * `billing_config.advance_generation_day`, which is how the scheduled path picks its
     * targets (see calculateTargetBillingDays); end-of-month accounts are due only once
     * the month's last day has arrived. An account whose day is still ahead of us is not
     * a miss and is not listed.
     *
     * One chunked pass over billing_accounts, with the plan and status joined rather
     * than lazily loaded, plus three set-based lookups per chunk (invoices raised this
     * period, open job orders, dismissals). Query count grows with the number of chunks,
     * not with the number of subscribers.
     *
     * @param array{reason?:string, billing_status?:string, billing_day?:int|string, search?:string, include_ok?:bool} $options
     * @return array{
     *     period: string,
     *     as_of: string,
     *     advance_generation_day: int,
     *     summary: array<string, int>,
     *     rows: array<int, array<string, mixed>>,
     *     filter: array<string, mixed>
     * }
     */
    public function getAudit(array $options = [], ?int $organizationId = null): array
    {
        $today = Carbon::now('Asia/Manila');
        $period = $today->format('Y-m');
        $advance = $this->advanceGenerationDay();

        $reasonFilter = (string) ($options['reason'] ?? '');
        if ($reasonFilter !== '' && !array_key_exists($reasonFilter, self::REASON_LABELS)) {
            $reasonFilter = '';
        }
        $statusFilter = trim((string) ($options['billing_status'] ?? ''));
        $search = trim((string) ($options['search'] ?? ''));
        $dayFilter = $options['billing_day'] ?? null;
        $dayFilter = ($dayFilter === null || $dayFilter === '') ? null : (int) $dayFilter;
        // An account already invoiced is not a finding; it is only carried when the
        // operator asks for it, so the default worklist is what needs attention.
        $includeOk = (bool) ($options['include_ok'] ?? false) || $reasonFilter === self::REASON_ALREADY_INVOICED;

        $summary = array_fill_keys(array_keys(self::REASON_LABELS), 0);
        $summary['due'] = 0;
        $summary['ungenerated'] = 0;
        // Accounts whose linked plan and sold plan genuinely name different plans,
        // judged on the first word rather than the whole label. Additive: it counts a
        // condition, it does not reclassify any row's reason.
        $summary['plan_mismatch'] = 0;

        // Hoisted above the sweep: one read of plan_list serves every chunk, and every
        // account inside it, instead of a lookup per row.
        $planIndex = $this->planIndex();

        $rows = [];

        $columns = [
            'ba.id',
            'ba.account_no',
            'ba.customer_id',
            'ba.plan_id',
            'ba.billing_day',
            'ba.billing_status_id',
            'ba.date_installed',
            'ba.account_balance',
            'ba.organization_id',
            'p.plan_name',
            'p.price as plan_price',
            'bs.status_name as billing_status_name',
            'c.first_name',
            'c.last_name',
            // What the subscriber was sold, as the application recorded it. Carried so
            // the audit can tell a genuinely unlinked plan from a label that merely
            // wears a price suffix — see planIndex() and describePlan().
            'c.desired_plan',
        ];

        if ($this->hasGenerationType()) {
            $columns[] = 'ba.generation_type';
        }

        $query = DB::table('billing_accounts as ba')
            ->leftJoin('plan_list as p', 'p.id', '=', 'ba.plan_id')
            ->leftJoin('billing_status as bs', 'bs.id', '=', 'ba.billing_status_id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->whereNotNull('ba.account_no')
            ->select($columns);

        if ($organizationId !== null) {
            $query->where(function ($q) use ($organizationId) {
                $q->where('ba.organization_id', $organizationId)->orWhereNull('ba.organization_id');
            });
        }

        if ($search !== '') {
            $like = '%' . $search . '%';
            $query->where(function ($q) use ($like) {
                $q->where('ba.account_no', 'like', $like)
                    ->orWhere('c.first_name', 'like', $like)
                    ->orWhere('c.last_name', 'like', $like)
                    ->orWhere('p.plan_name', 'like', $like);
            });
        }

        if ($dayFilter !== null) {
            $query->where('ba.billing_day', $dayFilter);
        }

        if ($statusFilter !== '') {
            $query->where('bs.status_name', $statusFilter);
        }

        // chunkById, not chunk: an offset-paged sweep of a table this size can skip or
        // repeat rows when an account is created or removed while it runs, and a skipped
        // row here is an unbilled subscriber nobody is told about.
        $query->chunkById(self::ACCOUNT_CHUNK, function ($accounts) use (
            &$rows, &$summary, $today, $period, $advance, $reasonFilter, $includeOk, $planIndex
        ): void {
            $accountNos = [];
            $accountIds = [];
            foreach ($accounts as $account) {
                $accountNos[] = (string) $account->account_no;
                $accountIds[] = (int) $account->id;
            }

            $invoiced = $this->invoicedThisPeriod($accountNos, $today);
            $openJobs = $this->openJobOrders($accountIds);
            $dismissed = $this->dismissedForPeriod($accountIds, $period);

            foreach ($accounts as $account) {
                $due = $this->isDueThisCycle($account, $today, $advance);
                $hasInvoice = isset($invoiced[(string) $account->account_no]);

                if ($due) {
                    $summary['due']++;
                }

                $reason = $this->resolveReason(
                    $account,
                    $due,
                    $hasInvoice,
                    isset($openJobs[(int) $account->id]),
                    $dismissed[(int) $account->id] ?? null
                );

                if ($reason === null) {
                    // Not due yet and nothing wrong with it — outside this report.
                    continue;
                }

                $summary[$reason] = ($summary[$reason] ?? 0) + 1;

                $plan = $this->describePlan($account, $planIndex);

                if ($plan['plan_match'] === 'mismatch') {
                    $summary['plan_mismatch']++;
                }

                // `ungenerated` is the headline "this cycle lost money" figure, so it
                // counts only accounts that SHOULD have been billed on the cycle and
                // were not. An account already invoiced obviously does not qualify, and
                // neither does a prepaid one: prepaid bills at renewal, so counting it
                // here would have reported 2,072 phantom misses on a prepaid-only estate.
                if ($reason !== self::REASON_ALREADY_INVOICED && $reason !== self::REASON_PREPAID) {
                    $summary['ungenerated']++;
                }

                if ($reason === self::REASON_ALREADY_INVOICED && !$includeOk) {
                    continue;
                }

                if ($reasonFilter !== '' && $reason !== $reasonFilter) {
                    continue;
                }

                $rows[] = $this->presentRow($account, $reason, $due, $invoiced, $dismissed, $plan);
            }
        }, 'ba.id', 'id');

        return [
            'period' => $period,
            'as_of' => $today->toIso8601String(),
            'advance_generation_day' => $advance,
            'summary' => $summary,
            'rows' => $rows,
            'filter' => [
                'reason' => $reasonFilter,
                'billing_status' => $statusFilter,
                'billing_day' => $dayFilter,
                'search' => $search,
                'include_ok' => $includeOk,
            ],
        ];
    }

    /**
     * Has this account's generation day for the current cycle already passed?
     *
     * An account with no billing day at all has no such day, and is reported as a
     * finding in its own right rather than being quietly excluded here.
     */
    private function isDueThisCycle(object $account, Carbon $today, int $advance): bool
    {
        if ($account->billing_day === null) {
            return false;
        }

        $billingDay = (int) $account->billing_day;

        if ($billingDay === self::END_OF_MONTH_BILLING) {
            // End-of-month accounts are generated on the month's last day, and only then.
            return $today->isLastOfMonth();
        }

        $lastDay = $today->copy()->endOfMonth()->day;

        // The day the scheduled pass would have targeted this account: its billing day,
        // pulled forward by the advance-generation offset, clamped into the month. A
        // billing day of 31 in a 30-day month generates on the 30th, not never.
        $generationDay = max(1, min($lastDay, $billingDay - $advance));

        return $today->day >= $generationDay;
    }

    /**
     * The single reason this account has no invoice for the cycle, or null when there
     * is nothing to report.
     *
     * Ordered by what an operator should act on first. `already_invoiced` is checked
     * before everything else because a raised invoice settles the question whatever
     * else is true of the account, and `dismissed` next because the operator has
     * already ruled on this row for this cycle and must not be asked again.
     */
    private function resolveReason(
        object $account,
        bool $due,
        bool $hasInvoice,
        bool $hasOpenJobOrder,
        ?object $dismissal
    ): ?string {
        if ($hasInvoice) {
            return $due ? self::REASON_ALREADY_INVOICED : null;
        }

        if ($account->billing_day === null) {
            // A prepaid account legitimately has no billing day: it is billed once at
            // onboarding and again at renewal, never on a billing-day cadence. Calling
            // that a missing billing day put every prepaid subscriber on the worklist as
            // a fault - 60 of them on GOWISER, which is a prepaid-only estate.
            if (BillingAccount::isPrepaidType($account->generation_type ?? null)) {
                return self::REASON_PREPAID;
            }

            // Otherwise reported whether or not it is "due": an account with no billing
            // day can never become due, so waiting for that would mean never reporting it.
            return self::REASON_MISSING_BILLING_DAY;
        }

        if (!$due) {
            return null;
        }

        if ($dismissal !== null) {
            return self::REASON_DISMISSED;
        }

        if ((int) $account->billing_status_id !== self::BILLING_STATUS_ACTIVE) {
            return self::REASON_INACTIVE_STATUS;
        }

        if (BillingAccount::isPrepaidType($account->generation_type ?? null)) {
            return self::REASON_PREPAID;
        }

        if ($account->plan_id === null || $account->plan_name === null) {
            return self::REASON_MISSING_PLAN;
        }

        if ((float) $account->plan_price <= 0.0) {
            return self::REASON_ZERO_PRICE;
        }

        if ($hasOpenJobOrder) {
            return self::REASON_OPEN_JOB_ORDER;
        }

        return self::REASON_READY;
    }

    /**
     * Every plan in the catalogue, indexed by the identities a label can be matched on.
     *
     * Read once per audit and passed down into the chunk closure, so a sweep of 4,000
     * accounts costs one query here rather than one per row. Both indexes are built in
     * the same pass:
     *
     *  - `by_name`  the whole plan_name, lowercased - an exact link
     *  - `by_word`  the plan_name's first word - the identity the device and the Job
     *               Order creation path actually use
     *
     * A first word claimed by more than one plan is recorded as ambiguous and never
     * resolved: "SWIFT 1000" and "SWIFT 2000" both reduce to "SWIFT", and guessing
     * which one a subscriber is on would put a wrong price in front of an operator.
     *
     * @return array{by_name: array<string, array<string, mixed>>, by_word: array<string, array<string, mixed>|null>}
     */
    private function planIndex(): array
    {
        $byName = [];
        $byWord = [];

        try {
            $plans = DB::table('plan_list')
                ->select(['id', 'plan_name', 'price'])
                ->whereNotNull('plan_name')
                ->orderBy('id')
                ->get();
        } catch (Throwable $e) {
            // The plan identity block is advisory. Losing it must not take the
            // worklist down with it.
            $this->log('warning', 'Could not read the plan catalogue for plan matching.', [
                'error' => $e->getMessage(),
            ]);

            return ['by_name' => [], 'by_word' => []];
        }

        foreach ($plans as $plan) {
            $name = trim((string) $plan->plan_name);

            if ($name === '') {
                continue;
            }

            $entry = [
                'id' => (int) $plan->id,
                'plan_name' => $name,
                'price' => $plan->price === null ? null : (float) $plan->price,
            ];

            $byName[mb_strtolower($name)] = $entry;

            $word = mb_strtolower(PlanGroup::firstWord($name));

            if ($word === '') {
                continue;
            }

            if (!array_key_exists($word, $byWord)) {
                $byWord[$word] = $entry;
            } elseif ($byWord[$word] !== null && $byWord[$word]['id'] !== $entry['id']) {
                // Ambiguous - two priced plans share a first word. Recorded as null so
                // describePlan() declines to suggest one rather than picking wrong.
                $byWord[$word] = null;
            }
        }

        return ['by_name' => $byName, 'by_word' => $byWord];
    }

    /**
     * How this account's linked plan relates to the plan the subscriber was sold.
     *
     * This is the fix for the plan half of the audit reporting discrepancies that are
     * not real. `billing_accounts.plan_id` points at a catalogue row whose name is the
     * bare group ("SWIFT"), while `customers.desired_plan` carries the label the
     * application recorded ("SWIFT 1000") - the same suffix Job Order account creation
     * strips before it picks a User Manager group. Compared whole, those two read as a
     * disagreement on every single sweep; compared on the first word, they are the same
     * plan and nothing is reported.
     *
     * Deliberately advisory. Nothing here changes the row's `reason` or its
     * `can_generate` flag: an account with no plan_id still cannot be billed from this
     * screen, it now simply says which catalogue row would fix it.
     *
     *  - `linked`     the linked plan and the sold plan name the same plan
     *  - `suggested`  no plan is linked, but the sold label resolves to exactly one
     *  - `mismatch`   both are known and they name genuinely different plans
     *  - `none`       nothing to compare - no link and no usable sold label
     *
     * @param array{by_name: array<string, array<string, mixed>>, by_word: array<string, array<string, mixed>|null>} $index
     * @return array<string, mixed>
     */
    private function describePlan(object $account, array $index): array
    {
        $desired = trim((string) ($account->desired_plan ?? ''));
        $linked = $account->plan_id === null ? null : trim((string) ($account->plan_name ?? ''));

        $result = [
            'desired_plan' => $desired !== '' ? $desired : null,
            'plan_match' => 'none',
            'suggested_plan_id' => null,
            'suggested_plan_name' => null,
            'suggested_plan_price' => null,
        ];

        if ($linked !== null && $linked !== '') {
            if ($desired === '') {
                // Linked and nothing to contradict it. Not a discrepancy.
                $result['plan_match'] = 'linked';

                return $result;
            }

            $result['plan_match'] = PlanGroup::matches($linked, $desired) ? 'linked' : 'mismatch';

            if ($result['plan_match'] === 'mismatch') {
                // Name what the sold label points at, so a real mismatch arrives with
                // the plan that would settle it rather than just a complaint.
                $match = $this->resolvePlan($desired, $index);

                if ($match !== null) {
                    $result['suggested_plan_id'] = $match['id'];
                    $result['suggested_plan_name'] = $match['plan_name'];
                    $result['suggested_plan_price'] = $match['price'];
                }
            }

            return $result;
        }

        if ($desired === '') {
            return $result;
        }

        $match = $this->resolvePlan($desired, $index);

        if ($match === null) {
            return $result;
        }

        $result['plan_match'] = 'suggested';
        $result['suggested_plan_id'] = $match['id'];
        $result['suggested_plan_name'] = $match['plan_name'];
        $result['suggested_plan_price'] = $match['price'];

        return $result;
    }

    /**
     * The catalogue row a sold plan label names: exact first, then by first word.
     *
     * @param array{by_name: array<string, array<string, mixed>>, by_word: array<string, array<string, mixed>|null>} $index
     * @return array<string, mixed>|null
     */
    private function resolvePlan(string $label, array $index): ?array
    {
        $exact = $index['by_name'][mb_strtolower(trim($label))] ?? null;

        if ($exact !== null) {
            return $exact;
        }

        $bare = $index['by_name'][mb_strtolower(PlanGroup::bare($label))] ?? null;

        if ($bare !== null) {
            return $bare;
        }

        $word = mb_strtolower(PlanGroup::firstWord($label));

        if ($word === '') {
            return null;
        }

        // null here means the first word is claimed by more than one plan - see
        // planIndex(). Ambiguity is answered with "no suggestion", never a guess.
        return $index['by_word'][$word] ?? null;
    }

    /**
     * @param array<int, string> $accountNos
     * @return array<string, object>
     */
    private function invoicedThisPeriod(array $accountNos, Carbon $today): array
    {
        if ($accountNos === []) {
            return [];
        }

        return DB::table('invoices')
            ->whereIn('account_no', $accountNos)
            ->whereMonth('invoice_date', $today->month)
            ->whereYear('invoice_date', $today->year)
            ->select(['account_no', DB::raw('MAX(invoice_date) as invoice_date'), DB::raw('COUNT(*) as invoice_count')])
            ->groupBy('account_no')
            ->get()
            ->keyBy('account_no')
            ->all();
    }

    /**
     * @param array<int, int> $accountIds
     * @return array<int, object>
     */
    private function openJobOrders(array $accountIds): array
    {
        if ($accountIds === []) {
            return [];
        }

        return DB::table('job_orders')
            ->whereIn('account_id', $accountIds)
            ->where(function ($q) {
                // A job order with no status at all is still open work: it has not been
                // closed, so it cannot be read as finished onboarding.
                $q->whereNull('status')
                    ->orWhereNotIn(DB::raw('LOWER(TRIM(status))'), self::CLOSED_JOB_STATUSES);
            })
            ->select(['account_id', DB::raw('MAX(id) as job_order_id'), DB::raw('COUNT(*) as open_count')])
            ->groupBy('account_id')
            ->get()
            ->keyBy('account_id')
            ->all();
    }

    /**
     * @param array<int, int> $accountIds
     * @return array<int, object>
     */
    private function dismissedForPeriod(array $accountIds, string $period): array
    {
        if ($accountIds === []) {
            return [];
        }

        try {
            return DB::table('billing_reconciliation_dismissals')
                ->whereIn('billing_account_id', $accountIds)
                ->where('billing_period', $period)
                ->get(['billing_account_id', 'reason', 'user_id', 'created_at'])
                ->keyBy('billing_account_id')
                ->all();
        } catch (Throwable $e) {
            // A missing table means the migration has not run yet. That degrades the
            // report to "nothing dismissed", which is safe: every row simply reappears
            // on the worklist. It must not take the whole screen down.
            $this->log('warning', 'Could not read reconciliation dismissals.', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * @param array<string, object> $invoiced
     * @param array<int, object> $dismissed
     * @return array<string, mixed>
     */
    private function presentRow(
        object $account,
        string $reason,
        bool $due,
        array $invoiced,
        array $dismissed,
        array $plan = []
    ): array {
        $name = trim(((string) ($account->first_name ?? '')) . ' ' . ((string) ($account->last_name ?? '')));
        $invoice = $invoiced[(string) $account->account_no] ?? null;
        $dismissal = $dismissed[(int) $account->id] ?? null;

        return [
            'billing_account_id' => (int) $account->id,
            'account_no' => (string) $account->account_no,
            'customer_name' => $name !== '' ? $name : null,
            'plan_name' => $account->plan_name,
            'plan_price' => $account->plan_price === null ? null : (float) $account->plan_price,
            'billing_day' => $account->billing_day === null ? null : (int) $account->billing_day,
            'billing_status' => $account->billing_status_name,
            'billing_status_id' => $account->billing_status_id === null ? null : (int) $account->billing_status_id,
            'generation_type' => $account->generation_type ?? null,
            'date_installed' => $account->date_installed,
            'account_balance' => (float) ($account->account_balance ?? 0),
            'due_this_cycle' => $due,
            'reason' => $reason,
            'reason_label' => self::REASON_LABELS[$reason],
            // Only rows whose reason this screen can actually clear are offered a
            // Generate button; everything else needs the account fixed first.
            'can_generate' => in_array($reason, self::GENERATABLE_REASONS, true),
            'can_dismiss' => $reason !== self::REASON_ALREADY_INVOICED && $reason !== self::REASON_DISMISSED,
            'last_invoice_date' => $invoice->invoice_date ?? null,
            'dismissed_reason' => $dismissal->reason ?? null,
            'dismissed_at' => $dismissal->created_at ?? null,
            // Additive plan-identity block. Every existing key above is untouched;
            // these describe how the linked plan relates to the sold one so the screen
            // can stop reporting a suffix as a discrepancy. See describePlan().
            'desired_plan' => $plan['desired_plan'] ?? null,
            'plan_match' => $plan['plan_match'] ?? 'none',
            'suggested_plan_id' => $plan['suggested_plan_id'] ?? null,
            'suggested_plan_name' => $plan['suggested_plan_name'] ?? null,
            'suggested_plan_price' => $plan['suggested_plan_price'] ?? null,
        ];
    }

    // =========================================================================
    // Generation
    // =========================================================================

    /**
     * Raise the current cycle's bill for the accounts named, one at a time.
     *
     * Each account is billed through the same generator the cron uses, so the VAT
     * treatment, withholding, prorate, staggered charges and the customer notification
     * are identical to a scheduled run. This service adds no billing arithmetic.
     *
     * Safe to re-run. The generator's own per-cycle guards mean an account that already
     * has this month's invoice is skipped rather than billed twice, and the eligibility
     * re-check below runs against live state rather than the preview the operator was
     * looking at — a row billed by the nightly cron in the meantime is a skip, not a
     * duplicate.
     *
     * Each account is its own attempt with its own try/catch: one bad account cannot
     * cost the other 199 their invoices.
     *
     * @param array<int, int> $accountIds
     * @return array{success:int, failed:int, skipped:int, errors:array<int, array<string, mixed>>, accounts:array<int, array<string, mixed>>}
     */
    public function generate(array $accountIds, int $userId, ?int $organizationId = null): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => [], 'accounts' => []];

        $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds))));

        if ($accountIds === []) {
            return $result;
        }

        if (count($accountIds) > self::MAX_GENERATE_BATCH) {
            $accountIds = array_slice($accountIds, 0, self::MAX_GENERATE_BATCH);
        }

        $today = Carbon::now('Asia/Manila');
        $period = $today->format('Y-m');
        $advance = $this->advanceGenerationDay();

        $this->log('info', 'Manual billing generation starting.', [
            'accounts' => count($accountIds),
            'period' => $period,
            'user_id' => $userId,
        ]);

        foreach ($accountIds as $accountId) {
            try {
                $account = BillingAccount::with('plan')->find($accountId);

                if ($account === null) {
                    $result['failed']++;
                    $result['errors'][] = ['billing_account_id' => $accountId, 'error' => 'The billing account no longer exists.'];
                    continue;
                }

                if ($organizationId !== null
                    && $account->organization_id !== null
                    && (int) $account->organization_id !== $organizationId) {
                    // Out of scope: refused, not billed. Mirrors the scoping the audit
                    // applies, so a posted id cannot reach another organization's account.
                    $result['skipped']++;
                    $result['accounts'][] = [
                        'billing_account_id' => $accountId,
                        'account_no' => $account->account_no,
                        'outcome' => 'blocked',
                        'message' => 'This account belongs to another organization.',
                    ];
                    continue;
                }

                $blocker = $this->generationBlocker($account, $today, $advance, $period);

                if ($blocker !== null) {
                    $result['skipped']++;
                    $result['accounts'][] = [
                        'billing_account_id' => $accountId,
                        'account_no' => $account->account_no,
                        'outcome' => 'blocked',
                        'message' => $blocker,
                    ];
                    continue;
                }

                $generated = $this->generator->generateCurrentCycleBilling($account, $userId);

                if (!($generated['success'] ?? false)) {
                    $result['failed']++;
                    $result['errors'][] = [
                        'billing_account_id' => $accountId,
                        'account_no' => $account->account_no,
                        'error' => $generated['error'] ?? 'The generator reported a failure.',
                    ];
                    continue;
                }

                if ($generated['skipped'] ?? false) {
                    $result['skipped']++;
                    $result['accounts'][] = [
                        'billing_account_id' => $accountId,
                        'account_no' => $account->account_no,
                        'outcome' => 'skipped',
                        'message' => 'This cycle was already billed.',
                    ];
                    continue;
                }

                $result['success']++;
                $result['accounts'][] = [
                    'billing_account_id' => $accountId,
                    'account_no' => $account->account_no,
                    'outcome' => 'generated',
                    'statement_created' => (bool) ($generated['statement_created'] ?? false),
                    'invoice_created' => (bool) ($generated['invoice_created'] ?? false),
                    'message' => 'Billing generated for ' . $period . '.',
                ];

                $this->log('info', 'Manual billing generated.', [
                    'account_no' => $account->account_no,
                    'period' => $period,
                    'invoice_created' => (bool) ($generated['invoice_created'] ?? false),
                    'statement_created' => (bool) ($generated['statement_created'] ?? false),
                    'user_id' => $userId,
                ]);
            } catch (Throwable $e) {
                $result['failed']++;
                $result['errors'][] = ['billing_account_id' => $accountId, 'error' => $e->getMessage()];
                $this->log('error', 'Manual billing generation failed.', [
                    'billing_account_id' => $accountId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->log('info', 'Manual billing generation finished.', [
            'success' => $result['success'],
            'skipped' => $result['skipped'],
            'failed' => $result['failed'],
            'period' => $period,
        ]);

        return $result;
    }

    /**
     * Why this account must not be billed right now, re-checked against live state.
     *
     * The operator acted on a preview that may be minutes old. Everything the audit
     * used to decide the row was generatable is re-read here, so a plan unlinked or a
     * status changed in between blocks the write instead of producing a bill nobody
     * would have approved.
     */
    private function generationBlocker(BillingAccount $account, Carbon $today, int $advance, string $period): ?string
    {
        if ($account->billing_day === null) {
            return 'This account has no billing day set.';
        }

        if ((int) $account->billing_status_id !== self::BILLING_STATUS_ACTIVE) {
            return 'The billing status is not Active.';
        }

        if (BillingAccount::isPrepaidType($account->generation_type)) {
            return 'Prepaid accounts are billed at renewal, not on a billing day.';
        }

        if ($account->plan_id === null || $account->plan === null) {
            return 'No plan is linked to this account.';
        }

        if ((float) $account->plan->price <= 0.0) {
            return 'The linked plan is priced at 0.00.';
        }

        $openJobOrder = DB::table('job_orders')
            ->where('account_id', $account->id)
            ->where(function ($q) {
                $q->whereNull('status')
                    ->orWhereNotIn(DB::raw('LOWER(TRIM(status))'), self::CLOSED_JOB_STATUSES);
            })
            ->exists();

        if ($openJobOrder) {
            return 'Onboarding is not finished — a job order is still open.';
        }

        $dismissed = DB::table('billing_reconciliation_dismissals')
            ->where('billing_account_id', $account->id)
            ->where('billing_period', $period)
            ->exists();

        if ($dismissed) {
            return 'This account was marked do-not-generate for ' . $period . '.';
        }

        $accountRow = (object) [
            'billing_day' => $account->billing_day,
        ];

        if (!$this->isDueThisCycle($accountRow, $today, $advance)) {
            return 'This account is not due for billing yet this cycle.';
        }

        return null;
    }

    // =========================================================================
    // Dismissal
    // =========================================================================

    /**
     * Record that these accounts are deliberately not being billed this cycle.
     *
     * Idempotent by index: `billing_reconciliation_dismissals` carries a unique key on
     * (billing_account_id, billing_period), and the write is an updateOrInsert, so a
     * repeated batch refreshes the reason rather than adding a second row.
     *
     * @param array<int, int> $accountIds
     * @return array{success:int, failed:int, skipped:int, errors:array<int, array<string, mixed>>}
     */
    public function dismiss(array $accountIds, ?string $reason, int $userId, ?int $organizationId = null): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => []];

        $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds))));

        if ($accountIds === []) {
            return $result;
        }

        $period = Carbon::now('Asia/Manila')->format('Y-m');
        $reason = $reason === null ? null : mb_substr(trim($reason), 0, 255);

        $accounts = BillingAccount::whereIn('id', $accountIds)->get(['id', 'account_no', 'organization_id']);

        foreach ($accounts as $account) {
            try {
                if ($organizationId !== null
                    && $account->organization_id !== null
                    && (int) $account->organization_id !== $organizationId) {
                    $result['skipped']++;
                    continue;
                }

                DB::table('billing_reconciliation_dismissals')->updateOrInsert(
                    ['billing_account_id' => $account->id, 'billing_period' => $period],
                    [
                        'account_no' => $account->account_no,
                        'reason' => $reason,
                        'user_id' => $userId,
                        'organization_id' => $account->organization_id,
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );

                $result['success']++;
            } catch (Throwable $e) {
                $result['failed']++;
                $result['errors'][] = ['billing_account_id' => (int) $account->id, 'error' => $e->getMessage()];
                $this->log('error', 'Could not record a billing dismissal.', [
                    'billing_account_id' => (int) $account->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $this->log('info', 'Billing dismissals recorded.', [
            'period' => $period,
            'success' => $result['success'],
            'skipped' => $result['skipped'],
            'failed' => $result['failed'],
            'user_id' => $userId,
        ]);

        return $result;
    }

    /**
     * Undo a dismissal, putting the account back on this cycle's worklist.
     *
     * @param array<int, int> $accountIds
     * @return array{success:int, failed:int, skipped:int, errors:array<int, array<string, mixed>>}
     */
    public function restore(array $accountIds, ?int $organizationId = null): array
    {
        $result = ['success' => 0, 'failed' => 0, 'skipped' => 0, 'errors' => []];

        $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds))));

        if ($accountIds === []) {
            return $result;
        }

        $period = Carbon::now('Asia/Manila')->format('Y-m');

        try {
            $query = DB::table('billing_reconciliation_dismissals')
                ->whereIn('billing_account_id', $accountIds)
                ->where('billing_period', $period);

            if ($organizationId !== null) {
                $query->where(function ($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
                });
            }

            $result['success'] = $query->delete();
        } catch (Throwable $e) {
            $result['failed'] = count($accountIds);
            $result['errors'][] = ['error' => $e->getMessage()];
            $this->log('error', 'Could not restore billing dismissals.', ['error' => $e->getMessage()]);
        }

        return $result;
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * How many days before its billing day an account is generated.
     *
     * Read once per request and passed down rather than re-queried per account — the
     * whole point of hoisting a configuration lookup above the loop.
     */
    private function advanceGenerationDay(): int
    {
        try {
            $value = DB::table('billing_config')->value('advance_generation_day');

            return max(0, (int) ($value ?? 0));
        } catch (Throwable $e) {
            $this->log('warning', 'Could not read billing_config.advance_generation_day; assuming 0.', [
                'error' => $e->getMessage(),
            ]);

            return 0;
        }
    }

    /**
     * @param array<string, mixed> $context
     */
    private function log(string $level, string $message, array $context = []): void
    {
        Log::channel(self::LOG_CHANNEL)->{$level}('[' . self::LOG_PREFIX . '] ' . $message, $context);
    }
}

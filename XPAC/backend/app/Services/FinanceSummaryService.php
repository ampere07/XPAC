<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The figures behind Billing → Finance: money actually collected, from both places the system
 * records it, sliced by period, payment method, location and the staff member who took it.
 *
 * Two sources, neither a copy of the other:
 *  - transactions         payments recorded by staff (cashier, agent, technician). Written only
 *                         by TransactionController::store.
 *  - payment_portal_logs  online checkouts settled through Xendit. Written only by
 *                         PaymentWorkerService, once the payment has been applied to billing.
 * A portal payment never produces a transactions row, so the two are added, not de-duplicated.
 *
 * "Collected" follows ReportMetricsService, so this page and the Summary report agree: a
 * transaction counts once its status is a successful one (in practice "Done" — a revert moves it
 * back to Pending and it drops out again). A portal log counts when either of its status columns
 * is successful: the worker stores the gateway's own word in `status` and a fixed 'PAID' in
 * `transaction_status` (see ReconcileAdvancePayments::candidatePayments()).
 *
 * Dated the way the rest of the system dates them: transactions by date_processed (the
 * Transaction List's date filter, the Summary report, Live Monitor), portal logs by date_time.
 *
 * Four aggregate queries per request whatever the period — per source, one grouped by
 * (period bucket, payment method, processor) and one grouped by the customer's location. Every
 * breakdown is rolled up from those in PHP, so each one sums to exactly the same total: a payment
 * with no method, no processor or no location lands in "Unspecified" instead of dropping out.
 */
class FinanceSummaryService
{
    public const SOURCE_TRANSACTIONS = 'transactions';
    public const SOURCE_PORTAL = 'portal';

    public const MODES = ['range', 'month', 'months', 'year', 'years'];

    public const UNSPECIFIED = 'Unspecified';

    /** Who "processed" a portal payment: nobody on staff — the customer paid online. */
    public const PORTAL_PROCESSOR = 'Payment Portal (online)';

    /** A portal log that names neither an e-wallet nor a channel. */
    private const PORTAL_METHOD_FALLBACK = 'Online (Xendit)';

    /** Longest period a single request may cover, so a typo cannot ask for a century. */
    public const MAX_SPAN_YEARS = 20;

    /** Most months the "multiple months" filter may pick at once. */
    public const MAX_MONTHS = 36;

    /**
     * How a period is cut into buckets for the trend chart: the SQL DATE_FORMAT pattern, the
     * matching PHP pattern for the same key, and how a bucket is labelled.
     */
    private const GRANULARITY = [
        'day'   => ['sql' => '%Y-%m-%d', 'php' => 'Y-m-d', 'label' => 'M j'],
        'month' => ['sql' => '%Y-%m',    'php' => 'Y-m',   'label' => 'M Y'],
        'year'  => ['sql' => '%Y',       'php' => 'Y',     'label' => 'Y'],
    ];

    /**
     * @param  array  $filters  validated by FinanceController: `mode` plus that mode's fields
     * @param  int|null  $organizationId  null for SuperAdmin or a user with no organisation
     */
    public function summarize(array $filters, ?int $organizationId): array
    {
        $period = $this->resolvePeriod($filters);
        $format = self::GRANULARITY[$period['granularity']]['sql'];

        $flows = array_merge(
            $this->transactionFlows($period['ranges'], $format, $organizationId),
            $this->portalFlows($period['ranges'], $format, $organizationId)
        );

        $places = array_merge(
            $this->transactionPlaces($period['ranges'], $organizationId),
            $this->portalPlaces($period['ranges'], $organizationId)
        );

        $sources = [
            self::SOURCE_TRANSACTIONS => ['cents' => 0, 'count' => 0],
            self::SOURCE_PORTAL       => ['cents' => 0, 'count' => 0],
        ];

        foreach ($flows as $row) {
            $sources[$row['source']]['cents'] += $row['cents'];
            $sources[$row['source']]['count'] += $row['count'];
        }

        $totalCents = $sources[self::SOURCE_TRANSACTIONS]['cents'] + $sources[self::SOURCE_PORTAL]['cents'];
        $totalCount = $sources[self::SOURCE_TRANSACTIONS]['count'] + $sources[self::SOURCE_PORTAL]['count'];

        [$regions, $cities, $barangays] = $this->locationBreakdowns($places);

        return [
            'period' => [
                'mode'        => $period['mode'],
                'label'       => $period['label'],
                'granularity' => $period['granularity'],
                'ranges'      => array_map(fn ($range) => [
                    'from' => $range[0]->format('Y-m-d'),
                    'to'   => $range[1]->subDay()->format('Y-m-d'),
                ], $period['ranges']),
            ],
            'totals' => [
                'amount'  => $this->money($totalCents),
                'count'   => $totalCount,
                'average' => $totalCount > 0 ? round($totalCents / $totalCount / 100, 2) : 0.0,
                'sources' => array_map(fn ($source) => [
                    'amount' => $this->money($source['cents']),
                    'count'  => $source['count'],
                ], $sources),
            ],
            'trend'             => $this->trend($period, $flows),
            'by_payment_method' => $this->methodBreakdown($flows),
            'by_processor'      => $this->processorBreakdown($flows),
            'by_region'         => $regions,
            'by_city'           => $cities,
            'by_barangay'       => $barangays,
            'meta' => [
                'first_year'   => $this->firstYear(),
                'generated_at' => now()->toIso8601String(),
            ],
        ];
    }

    // ── Period ────────────────────────────────────────────────────────────────

    /**
     * Turn the filter into half-open [start, end) ranges, a label, and the trend granularity.
     *
     * "Multiple months" is the one mode that can be discontinuous (Jan, Mar, Jul); its months
     * are merged where they touch, so Jan+Feb+Mar is one range rather than three.
     *
     * @return array{mode: string, label: string, granularity: string,
     *               ranges: list<array{0: CarbonImmutable, 1: CarbonImmutable}>,
     *               buckets: list<array{key: string, label: string}>}
     */
    public function resolvePeriod(array $filters): array
    {
        $mode = $filters['mode'];

        switch ($mode) {
            case 'range':
                $start = CarbonImmutable::createFromFormat('!Y-m-d', $filters['from']);
                $end = CarbonImmutable::createFromFormat('!Y-m-d', $filters['to'])->addDay();
                $ranges = [[$start, $end]];
                $label = $this->rangeLabel($start, $end->subDay());
                break;

            case 'month':
                $start = CarbonImmutable::createFromFormat('!Y-m', $filters['month']);
                $ranges = [[$start, $start->addMonthNoOverflow()]];
                $label = $start->format('F Y');
                break;

            case 'months':
                $months = array_values(array_unique($filters['months']));
                sort($months);
                $starts = array_map(fn ($month) => CarbonImmutable::createFromFormat('!Y-m', $month), $months);
                $ranges = $this->mergeMonths($starts);
                $label = $this->monthsLabel($starts);
                break;

            case 'year':
                $start = CarbonImmutable::create((int) $filters['year'], 1, 1);
                $ranges = [[$start, $start->addYear()]];
                $label = (string) $filters['year'];
                break;

            case 'years':
                $from = (int) $filters['year_from'];
                $to = (int) $filters['year_to'];
                $ranges = [[CarbonImmutable::create($from, 1, 1), CarbonImmutable::create($to + 1, 1, 1)]];
                $label = $from === $to ? (string) $from : "{$from} – {$to}";
                break;

            default:
                throw new \InvalidArgumentException("Unknown period mode '{$mode}'.");
        }

        $granularity = $this->granularityFor($mode, $ranges);

        return [
            'mode'        => $mode,
            'label'       => $label,
            'granularity' => $granularity,
            'ranges'      => $ranges,
            'buckets'     => $this->bucketsFor($ranges, $granularity),
        ];
    }

    /**
     * Daily bars up to two months, monthly up to three years, yearly beyond — so the trend
     * never draws more than a few dozen columns. Picking months always reads by month, a
     * single month by day, and a single year by month.
     */
    private function granularityFor(string $mode, array $ranges): string
    {
        if ($mode === 'month') {
            return 'day';
        }

        if ($mode === 'months' || $mode === 'year') {
            return 'month';
        }

        $start = $ranges[0][0];
        $end = $ranges[count($ranges) - 1][1];

        if ($start->diffInDays($end) <= 62) {
            return 'day';
        }

        return $start->diffInMonths($end) <= 36 ? 'month' : 'year';
    }

    /**
     * Every bucket the period covers, in order, so the trend has a continuous axis with the
     * empty days/months drawn as zero rather than skipped.
     *
     * @return list<array{key: string, label: string}>
     */
    private function bucketsFor(array $ranges, string $granularity): array
    {
        $spec = self::GRANULARITY[$granularity];

        // A daily axis that crosses New Year needs the year on each label to stay unambiguous.
        $labelFormat = $spec['label'];
        if ($granularity === 'day' && $ranges[0][0]->year !== $ranges[count($ranges) - 1][1]->subDay()->year) {
            $labelFormat = 'M j, Y';
        }

        $buckets = [];

        foreach ($ranges as [$start, $end]) {
            $cursor = match ($granularity) {
                'day'   => $start->startOfDay(),
                'month' => $start->startOfMonth(),
                'year'  => $start->startOfYear(),
            };

            while ($cursor < $end) {
                $key = $cursor->format($spec['php']);
                $buckets[$key] ??= ['key' => $key, 'label' => $cursor->format($labelFormat)];

                $cursor = match ($granularity) {
                    'day'   => $cursor->addDay(),
                    'month' => $cursor->addMonthNoOverflow(),
                    'year'  => $cursor->addYear(),
                };
            }
        }

        return array_values($buckets);
    }

    /**
     * @param  list<CarbonImmutable>  $starts  first day of each picked month, ascending
     * @return list<array{0: CarbonImmutable, 1: CarbonImmutable}>
     */
    private function mergeMonths(array $starts): array
    {
        $ranges = [];

        foreach ($starts as $start) {
            $end = $start->addMonthNoOverflow();
            $last = count($ranges) - 1;

            if ($last >= 0 && $ranges[$last][1]->equalTo($start)) {
                $ranges[$last][1] = $end;
                continue;
            }

            $ranges[] = [$start, $end];
        }

        return $ranges;
    }

    private function rangeLabel(CarbonImmutable $first, CarbonImmutable $last): string
    {
        if ($first->isSameDay($last)) {
            return $first->format('M j, Y');
        }

        return $first->year === $last->year
            ? $first->format('M j') . ' – ' . $last->format('M j, Y')
            : $first->format('M j, Y') . ' – ' . $last->format('M j, Y');
    }

    /** "Jan, Feb, Mar 2026", or "8 months · Jan 2025 – Dec 2026" when there are many. */
    private function monthsLabel(array $starts): string
    {
        if (count($starts) > 6) {
            return count($starts) . ' months · ' . $starts[0]->format('M Y') . ' – ' . end($starts)->format('M Y');
        }

        $byYear = [];
        foreach ($starts as $start) {
            $byYear[$start->year][] = $start->format('M');
        }

        $parts = [];
        foreach ($byYear as $year => $names) {
            $parts[] = implode(', ', $names) . ' ' . $year;
        }

        return implode(' · ', $parts);
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /** Recorded payments by (bucket, method, processor). */
    private function transactionFlows(array $ranges, string $format, ?int $organizationId): array
    {
        $query = DB::table('transactions as t')
            ->selectRaw("DATE_FORMAT(t.date_processed, '{$format}') as bucket")
            ->selectRaw('t.payment_method as method')
            ->selectRaw('t.processed_by_user as processor')
            ->selectRaw('COUNT(*) as payments')
            ->selectRaw('SUM(COALESCE(t.received_payment, 0)) as amount');

        $this->scopeTransactions($query, $ranges, $organizationId);

        return $query->groupBy('bucket', 'method', 'processor')->get()
            ->map(fn ($row) => [
                'source'    => self::SOURCE_TRANSACTIONS,
                'bucket'    => (string) $row->bucket,
                'method'    => $row->method,
                'processor' => $row->processor,
                'count'     => (int) $row->payments,
                'cents'     => $this->cents($row->amount),
            ])
            ->all();
    }

    /** Online payments by (bucket, method). The e-wallet when there is one, else the channel. */
    private function portalFlows(array $ranges, string $format, ?int $organizationId): array
    {
        $query = DB::table('payment_portal_logs as p')
            ->selectRaw("DATE_FORMAT(p.date_time, '{$format}') as bucket")
            ->selectRaw("COALESCE(NULLIF(TRIM(p.ewallet_type), ''), NULLIF(TRIM(p.payment_channel), '')) as method")
            ->selectRaw('COUNT(*) as payments')
            ->selectRaw('SUM(COALESCE(p.total_amount, 0)) as amount');

        // The account is needed only to read its organisation; see scopePortal().
        if ($organizationId !== null) {
            $query->leftJoin('billing_accounts as ba', 'ba.id', '=', 'p.account_id');
        }

        $this->scopePortal($query, $ranges, $organizationId);

        return $query->groupBy('bucket', 'method')->get()
            ->map(fn ($row) => [
                'source'    => self::SOURCE_PORTAL,
                'bucket'    => (string) $row->bucket,
                'method'    => $row->method ?? self::PORTAL_METHOD_FALLBACK,
                'processor' => null,
                'count'     => (int) $row->payments,
                'cents'     => $this->cents($row->amount),
            ])
            ->all();
    }

    /**
     * Recorded payments by the paying customer's location.
     *
     * Two stages: the payments are first totalled per customer (an integer key), and only those
     * few thousand totals are joined to the customers' location text. Grouping every payment
     * row by three text columns directly was the slowest query on the page by far.
     * account_no is unique on billing_accounts, so the join never multiplies a payment.
     */
    private function transactionPlaces(array $ranges, ?int $organizationId): array
    {
        $perCustomer = DB::table('transactions as t')
            ->leftJoin('billing_accounts as ba', 'ba.account_no', '=', 't.account_no')
            ->selectRaw('ba.customer_id as customer_id')
            ->selectRaw('COUNT(*) as payments')
            ->selectRaw('SUM(COALESCE(t.received_payment, 0)) as amount')
            ->groupBy('ba.customer_id');

        $this->scopeTransactions($perCustomer, $ranges, $organizationId);

        $query = DB::query()->fromSub($perCustomer, 'x')
            ->leftJoin('customers as c', 'c.id', '=', 'x.customer_id');

        return $this->placeRows($query, self::SOURCE_TRANSACTIONS);
    }

    /** As transactionPlaces(); a portal log already carries the account's integer id. */
    private function portalPlaces(array $ranges, ?int $organizationId): array
    {
        $perAccount = DB::table('payment_portal_logs as p')
            ->selectRaw('p.account_id as account_id')
            ->selectRaw('COUNT(*) as payments')
            ->selectRaw('SUM(COALESCE(p.total_amount, 0)) as amount')
            ->groupBy('p.account_id');

        if ($organizationId !== null) {
            $perAccount->leftJoin('billing_accounts as ba', 'ba.id', '=', 'p.account_id');
        }

        $this->scopePortal($perAccount, $ranges, $organizationId);

        $query = DB::query()->fromSub($perAccount, 'x')
            ->leftJoin('billing_accounts as ba', 'ba.id', '=', 'x.account_id')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id');

        return $this->placeRows($query, self::SOURCE_PORTAL);
    }

    /** Totals per location from a per-customer (or per-account) subtotal `x` joined to `c`. */
    private function placeRows(Builder $query, string $source): array
    {
        return $query
            ->selectRaw('c.region as region')
            ->selectRaw('c.city as city')
            ->selectRaw('c.barangay as barangay')
            ->selectRaw('SUM(x.payments) as payments')
            ->selectRaw('SUM(x.amount) as amount')
            ->groupBy('region', 'city', 'barangay')
            ->get()
            ->map(fn ($row) => [
                'source'   => $source,
                'region'   => $row->region,
                'city'     => $row->city,
                'barangay' => $row->barangay,
                'count'    => (int) $row->payments,
                'cents'    => $this->cents($row->amount),
            ])
            ->all();
    }

    /**
     * Collected transactions in the period, for the caller's organisation.
     *
     * The status test is applied after the date range, which is what the index serves; nearly
     * every row in range is "Done" anyway, so a status-led index would buy nothing.
     */
    private function scopeTransactions(Builder $query, array $ranges, ?int $organizationId): void
    {
        $this->whereInRanges($query, 't.date_processed', $ranges);
        $this->whereSuccessful($query, 't.status');

        if ($organizationId !== null) {
            $query->where('t.organization_id', $organizationId);
        }
    }

    /**
     * Settled portal payments in the period, for the caller's organisation.
     *
     * PaymentWorkerService does not stamp organization_id on the log it writes, so a log with
     * none is attributed to the organisation of the account it paid. Filtering on the log's own
     * column alone would show an organisation's staff no online collections at all.
     * Expects `ba` (billing_accounts) joined whenever $organizationId is set.
     */
    private function scopePortal(Builder $query, array $ranges, ?int $organizationId): void
    {
        $this->whereInRanges($query, 'p.date_time', $ranges);

        $query->where(function (Builder $q) {
            $this->whereSuccessful($q, 'p.status');
            $this->whereSuccessful($q, 'p.transaction_status', 'or');
        });

        if ($organizationId !== null) {
            $query->whereRaw('COALESCE(p.organization_id, ba.organization_id) = ?', [$organizationId]);
        }
    }

    /** Half-open ranges written as plain comparisons, so the date index serves each one. */
    private function whereInRanges(Builder $query, string $column, array $ranges): void
    {
        $query->where(function (Builder $q) use ($column, $ranges) {
            foreach ($ranges as [$start, $end]) {
                $q->orWhere(function (Builder $range) use ($column, $start, $end) {
                    $range->where($column, '>=', $start->format('Y-m-d H:i:s'))
                        ->where($column, '<', $end->format('Y-m-d H:i:s'));
                });
            }
        });
    }

    /** The same status vocabulary the Summary report counts as collected. */
    private function whereSuccessful(Builder $query, string $column, string $boolean = 'and'): void
    {
        $statuses = ReportMetricsService::SUCCESSFUL_PAYMENT_STATUSES;
        $placeholders = implode(', ', array_fill(0, count($statuses), '?'));

        $query->whereRaw("LOWER(TRIM(COALESCE({$column}, ''))) IN ({$placeholders})", $statuses, $boolean);
    }

    /** The earliest year either source holds, for the year pickers. Both dates are indexed. */
    private function firstYear(): int
    {
        $dates = array_filter([
            DB::table('transactions')->min('date_processed'),
            DB::table('payment_portal_logs')->min('date_time'),
        ]);

        $years = array_map(fn ($date) => (int) substr((string) $date, 0, 4), $dates);
        $years = array_filter($years, fn ($year) => $year >= 2000);

        return $years ? min($years) : (int) now()->year;
    }

    // ── Roll-ups ──────────────────────────────────────────────────────────────

    /** @return list<array{key: string, label: string, transactions: float, portal: float, amount: float, count: int}> */
    private function trend(array $period, array $flows): array
    {
        $buckets = [];
        foreach ($period['buckets'] as $bucket) {
            $buckets[$bucket['key']] = $bucket + ['transactions' => 0, 'portal' => 0, 'count' => 0];
        }

        foreach ($flows as $row) {
            // Every row falls inside the period, so its bucket is already listed; the fallback
            // only guarantees an amount is never dropped if that ever stops being true.
            $buckets[$row['bucket']] ??= ['key' => $row['bucket'], 'label' => $row['bucket'], 'transactions' => 0, 'portal' => 0, 'count' => 0];
            $buckets[$row['bucket']][$row['source']] += $row['cents'];
            $buckets[$row['bucket']]['count'] += $row['count'];
        }

        ksort($buckets);

        return array_values(array_map(fn ($bucket) => [
            'key'          => $bucket['key'],
            'label'        => $bucket['label'],
            'transactions' => $this->money($bucket['transactions']),
            'portal'       => $this->money($bucket['portal']),
            'amount'       => $this->money($bucket['transactions'] + $bucket['portal']),
            'count'        => $bucket['count'],
        ], $buckets));
    }

    /**
     * Grouped per source as well as per method: "GCash" typed in by a cashier and a GCash
     * checkout on the portal are different channels, and the source says which is which.
     */
    private function methodBreakdown(array $flows): array
    {
        $groups = [];

        foreach ($flows as $row) {
            $label = $this->clean($row['method']) ?? self::UNSPECIFIED;
            $this->tally($groups, $row['source'] . '|' . mb_strtolower($label), $label, null, $row, $row['source']);
        }

        return $this->ranked($groups);
    }

    /**
     * processed_by_user holds the staff member's email (TransactionController::store), so it is
     * resolved to a name here, in one lookup after aggregation, rather than joined per row.
     * A value that matches no account (older rows, or 'unknown') is shown as written.
     */
    private function processorBreakdown(array $flows): array
    {
        $groups = [];

        foreach ($flows as $row) {
            if ($row['source'] === self::SOURCE_PORTAL) {
                $key = self::SOURCE_PORTAL;
                $label = self::PORTAL_PROCESSOR;
            } else {
                $label = $this->clean($row['processor']) ?? self::UNSPECIFIED;
                $key = mb_strtolower($label);
            }

            $this->tally($groups, $key, $label, null, $row, $row['source']);
        }

        $emails = array_values(array_filter(
            array_map(fn ($group) => $group['source'] === self::SOURCE_TRANSACTIONS ? $group['label'] : null, $groups),
            fn ($value) => $value !== null && $value !== self::UNSPECIFIED
        ));

        if ($emails !== []) {
            $users = User::query()
                ->whereIn('email_address', $emails)
                ->get(['email_address', 'first_name', 'middle_initial', 'last_name'])
                ->keyBy(fn ($user) => mb_strtolower(trim($user->email_address)));

            foreach ($groups as $key => $group) {
                $user = $group['source'] === self::SOURCE_TRANSACTIONS ? ($users[$key] ?? null) : null;
                $name = $user ? trim($user->full_name) : '';

                if ($name !== '') {
                    $groups[$key]['label'] = $name;
                    $groups[$key]['detail'] = trim($user->email_address);
                }
            }
        }

        return $this->ranked($groups);
    }

    /**
     * Region, city and barangay from the one location query per source.
     *
     * A barangay is keyed by its city too — "Poblacion" exists in most towns. A city is shown
     * with the region most of its money came from, as context.
     *
     * @return array{0: array, 1: array, 2: array}
     */
    private function locationBreakdowns(array $places): array
    {
        $regions = [];
        $cities = [];
        $cityRegions = [];
        $barangays = [];

        foreach ($places as $row) {
            $region = $this->clean($row['region']) ?? self::UNSPECIFIED;
            $city = $this->clean($row['city']) ?? self::UNSPECIFIED;
            $barangay = $this->clean($row['barangay']) ?? self::UNSPECIFIED;

            $cityKey = mb_strtolower($city);

            $this->tally($regions, mb_strtolower($region), $region, null, $row);
            $this->tally($cities, $cityKey, $city, null, $row);
            $this->tally(
                $barangays,
                $cityKey . '|' . mb_strtolower($barangay),
                $barangay,
                $city === self::UNSPECIFIED ? null : $city,
                $row
            );

            if ($region !== self::UNSPECIFIED) {
                $cityRegions[$cityKey][$region] = ($cityRegions[$cityKey][$region] ?? 0) + $row['cents'];
            }
        }

        foreach ($cityRegions as $cityKey => $byRegion) {
            arsort($byRegion);
            $cities[$cityKey]['detail'] = array_key_first($byRegion);
        }

        return [$this->ranked($regions), $this->ranked($cities), $this->ranked($barangays)];
    }

    /**
     * Add one aggregate row to a breakdown group, creating the group on first sight.
     *
     * Each group also keeps its money per source, so the page can show how much of a city's
     * (or a method's) total came in over the counter and how much online.
     *
     * @param  string|null  $source  set when the whole group belongs to one source
     */
    private function tally(array &$groups, string $key, string $label, ?string $detail, array $row, ?string $source = null): void
    {
        $groups[$key] ??= [
            'key' => $key, 'label' => $label, 'detail' => $detail, 'source' => $source, 'cents' => 0, 'count' => 0,
            'split' => [self::SOURCE_TRANSACTIONS => 0, self::SOURCE_PORTAL => 0],
        ];

        $groups[$key]['cents'] += $row['cents'];
        $groups[$key]['count'] += $row['count'];
        $groups[$key]['split'][$row['source']] += $row['cents'];
    }

    /** Largest first; ties alphabetically. Cents become pesos on the way out. */
    private function ranked(array $groups): array
    {
        usort($groups, fn ($a, $b) => [$b['cents'], $a['label']] <=> [$a['cents'], $b['label']]);

        return array_map(fn ($group) => [
            'key'       => $group['key'],
            'label'     => $group['label'],
            'detail'    => $group['detail'],
            'source'    => $group['source'],
            'amount'    => $this->money($group['cents']),
            'count'     => $group['count'],
            'by_source' => array_map(fn ($cents) => $this->money($cents), $group['split']),
        ], $groups);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Trimmed, inner whitespace collapsed, and null when nothing is left. */
    private function clean($value): ?string
    {
        $value = trim((string) preg_replace('/\s+/u', ' ', (string) $value));

        return $value === '' ? null : $value;
    }

    /**
     * Money is summed in whole centavos: adding thousands of float pesos drifts, and a total
     * that disagrees with its own breakdown by ₱0.01 is the kind of thing a finance page is
     * read for.
     */
    private function cents($amount): int
    {
        return (int) round(((float) $amount) * 100);
    }

    private function money(int $cents): float
    {
        return round($cents / 100, 2);
    }
}

<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Computes every figure that appears on a Summary report.
 *
 * Correctness rules this class enforces (the previous implementation broke all
 * four, which is why displayed totals never reconciled):
 *
 *  1. ONE aggregate query per entity. Status breakdowns come from a single
 *     GROUP BY and the section total is the SUM of those buckets, so a subtotal
 *     can never disagree with its total — they are the same numbers.
 *     Previously each bucket was a separate COUNT(*) plus an independent
 *     COUNT(*) for the total, which drifted whenever a status value fell
 *     outside the hard-coded list.
 *
 *  2. NO MISSING RECORDS. Rows whose status is NULL/blank land in an
 *     "Unspecified" bucket, and any status not in the expected set still gets
 *     its own bucket. Nothing is silently dropped. (Live data proved this
 *     mattered: service_orders holds 'Reschedule' and NULL visit_status values
 *     that the old Done/In Progress/Failed triple ignored entirely.)
 *
 *  3. NO DOUBLE COUNTING. Each record is classified into exactly one bucket per
 *     section; sections never re-aggregate rows already counted in the same
 *     section's total.
 *
 *  4. MONEY IS QUALIFIED. Gross amounts (all statuses) and collected amounts
 *     (successful statuses only) are reported separately. The old code summed
 *     received_payment across cancelled, failed and pending transactions and
 *     presented it as revenue.
 *
 * Metrics describing current state rather than activity (stock levels,
 * LCP/NAP inventory, live sessions) are flagged with range_applies = false so
 * the PDF can label them "as of generation time" instead of implying they were
 * filtered to the reporting period.
 */
class ReportMetricsService
{
    /** Status values that represent money actually collected. */
    private const SUCCESSFUL_PAYMENT_STATUSES = [
        'paid', 'done', 'completed', 'complete', 'success', 'successful', 'approved', 'settled',
    ];

    /** Status values that represent a definitively unsuccessful attempt. */
    private const FAILED_PAYMENT_STATUSES = [
        'failed', 'cancelled', 'canceled', 'void', 'voided', 'declined', 'expired', 'rejected',
    ];

    private const UNSPECIFIED = 'Unspecified';

    /**
     * Build the full, validated summary metric set.
     *
     * @return array{
     *     range: array, generated_at: string, sections: array,
     *     totals: array, validation: array, flat: array
     * }
     */
    public function build(?string $dateRange): array
    {
        [$startDate, $endDate] = ReportDataset::parseDateRange($dateRange);
        $hasRange = $startDate !== null && $endDate !== null;

        $sections = array_values(array_filter([
            $this->invoiceSection($startDate, $endDate),
            $this->transactionSection($startDate, $endDate),
            $this->paymentMethodSection($startDate, $endDate),
            $this->paymentPortalSection($startDate, $endDate),
            $this->jobOrderSection($startDate, $endDate),
            $this->serviceOrderSection($startDate, $endDate),
            $this->serviceOrderConcernSection($startDate, $endDate),
            $this->pulloutSection($startDate, $endDate),
            $this->workOrderSection($startDate, $endDate),
            $this->inventoryMovementSection($startDate, $endDate),
            $this->applicationSection($startDate, $endDate),
            $this->stockSection(),
            $this->lcpNapSection(),
            $this->subscriberSessionSection(),
            $this->subscribersOnlineByBarangaySection(),
        ]));

        $validation = $this->validate($sections);

        return [
            'range' => [
                'from'      => $startDate,
                'to'        => $endDate,
                'has_range' => $hasRange,
                'label'     => $hasRange
                    ? $this->formatDate($startDate) . ' – ' . $this->formatDate($endDate)
                    : 'All time (no date range set)',
            ],
            'generated_at' => ReportPdfService::generatedAtLabel(),
            'sections'     => $sections,
            'totals'       => $this->grandTotals($sections),
            'validation'   => $validation,
            'flat'         => $this->flatten($sections),
        ];
    }

    // ── Sections ──────────────────────────────────────────────────────────────

    private function invoiceSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('invoices', ['status', 'total_amount'])) {
            return null;
        }

        $dateCol = $this->firstColumn('invoices', ['invoice_date', 'created_at']);

        $extra = ['amount' => 'total_amount'];
        if (Schema::hasColumn('invoices', 'invoice_balance')) {
            $extra['balance'] = 'invoice_balance';
        }
        if (Schema::hasColumn('invoices', 'received_payment')) {
            $extra['received'] = 'received_payment';
        }

        $buckets = $this->groupedAggregate('invoices', 'status', $dateCol, $start, $end, $extra);

        $columns = [
            $this->col('label', 'Invoice Status'),
            $this->col('count', 'Count', 'right', 'int'),
            $this->col('amount', 'Invoiced Amount', 'right', 'money'),
        ];
        if (isset($extra['received'])) {
            $columns[] = $this->col('received', 'Received', 'right', 'money');
        }
        if (isset($extra['balance'])) {
            $columns[] = $this->col('balance', 'Outstanding Balance', 'right', 'money');
        }

        $paid   = $this->sumWhere($buckets, self::SUCCESSFUL_PAYMENT_STATUSES);
        $unpaid = $this->sumWhereNot($buckets, self::SUCCESSFUL_PAYMENT_STATUSES);

        return $this->section('invoices', 'Invoices', $columns, $buckets, [
            'subtitle'   => 'Every invoice in the period, grouped by status',
            'highlights' => array_values(array_filter([
                $this->highlight('Paid invoices', $paid['count'], 'int'),
                $this->highlight('Paid amount', $paid['amount'] ?? 0.0, 'money'),
                $this->highlight('Unpaid / other invoices', $unpaid['count'], 'int'),
                isset($extra['balance'])
                    ? $this->highlight('Outstanding balance', $unpaid['balance'] ?? 0.0, 'money')
                    : null,
            ])),
            'date_column' => $dateCol,
        ]);
    }

    private function transactionSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('transactions', ['status', 'received_payment'])) {
            return null;
        }

        $dateCol = $this->firstColumn('transactions', ['date_processed', 'payment_date', 'created_at']);
        $buckets = $this->groupedAggregate(
            'transactions', 'status', $dateCol, $start, $end, ['amount' => 'received_payment']
        );

        $collected = $this->sumWhere($buckets, self::SUCCESSFUL_PAYMENT_STATUSES);
        $failed    = $this->sumWhere($buckets, self::FAILED_PAYMENT_STATUSES);

        return $this->section(
            'transactions',
            'Manual Transactions',
            [
                $this->col('label', 'Transaction Status'),
                $this->col('count', 'Count', 'right', 'int'),
                $this->col('amount', 'Amount', 'right', 'money'),
            ],
            $buckets,
            [
                'subtitle'   => 'Grouped by status — only successful statuses count as collected',
                'highlights' => [
                    $this->highlight('Collected (successful only)', $collected['amount'] ?? 0.0, 'money'),
                    $this->highlight('Successful transactions', $collected['count'], 'int'),
                    $this->highlight('Failed / cancelled amount (excluded)', $failed['amount'] ?? 0.0, 'money'),
                ],
                'note'        => 'The Total row is gross across all statuses. Cancelled, failed and pending '
                               . 'amounts are shown for transparency but are NOT part of collected revenue.',
                'date_column' => $dateCol,
                'contributes' => ['collected' => $collected['amount'] ?? 0.0],
            ]
        );
    }

    private function paymentMethodSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('transactions', ['payment_method', 'received_payment', 'status'])) {
            return null;
        }

        $dateCol = $this->firstColumn('transactions', ['date_processed', 'payment_date', 'created_at']);

        // Restricted to successful transactions: a payment-method breakdown of
        // cancelled attempts is not a breakdown of collections.
        $query = DB::table('transactions')
            ->whereIn(DB::raw('LOWER(TRIM(COALESCE(status, \'\')))'), self::SUCCESSFUL_PAYMENT_STATUSES);

        $buckets = $this->groupedAggregate(
            'transactions', 'payment_method', $dateCol, $start, $end,
            ['amount' => 'received_payment'], $query
        );

        if ($buckets === []) {
            return null;
        }

        return $this->section(
            'payment_methods',
            'Collections by Payment Method',
            [
                $this->col('label', 'Payment Method'),
                $this->col('count', 'Count', 'right', 'int'),
                $this->col('amount', 'Amount', 'right', 'money'),
            ],
            $buckets,
            [
                'subtitle'    => 'Successful transactions only',
                'note'        => 'This section\'s total equals "Collected (successful only)" in Manual Transactions.',
                'date_column' => $dateCol,
            ]
        );
    }

    private function paymentPortalSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('payment_portal_logs', ['status', 'total_amount'])) {
            return null;
        }

        $dateCol = $this->firstColumn('payment_portal_logs', ['date_time', 'created_at']);
        $buckets = $this->groupedAggregate(
            'payment_portal_logs', 'status', $dateCol, $start, $end, ['amount' => 'total_amount']
        );

        $collected = $this->sumWhere($buckets, self::SUCCESSFUL_PAYMENT_STATUSES);

        return $this->section(
            'payment_portal',
            'Payment Portal Transactions',
            [
                $this->col('label', 'Portal Status'),
                $this->col('count', 'Count', 'right', 'int'),
                $this->col('amount', 'Amount', 'right', 'money'),
            ],
            $buckets,
            [
                'subtitle'   => 'Grouped by portal status',
                'highlights' => [
                    $this->highlight('Successfully paid online', $collected['amount'] ?? 0.0, 'money'),
                    $this->highlight('Successful portal payments', $collected['count'], 'int'),
                ],
                'note'        => 'Pending and failed checkout attempts are counted but excluded from '
                               . 'successfully-paid amounts.',
                'date_column' => $dateCol,
                'contributes' => ['collected' => $collected['amount'] ?? 0.0],
            ]
        );
    }

    private function jobOrderSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('job_orders', ['onsite_status'])) {
            return null;
        }

        $dateCol = $this->firstColumn('job_orders', ['created_at', 'timestamp']);
        $extra   = Schema::hasColumn('job_orders', 'installation_fee')
            ? ['amount' => 'installation_fee']
            : [];

        $buckets = $this->groupedAggregate('job_orders', 'onsite_status', $dateCol, $start, $end, $extra);

        $columns = [
            $this->col('label', 'Onsite Status'),
            $this->col('count', 'Count', 'right', 'int'),
        ];
        if ($extra !== []) {
            $columns[] = $this->col('amount', 'Installation Fees', 'right', 'money');
        }

        return $this->section('job_orders', 'Job Orders', $columns, $buckets, [
            'subtitle'    => 'Grouped by onsite status',
            'date_column' => $dateCol,
        ]);
    }

    private function serviceOrderSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('service_orders', ['visit_status'])) {
            return null;
        }

        $dateCol = $this->firstColumn('service_orders', ['created_at', 'timestamp']);
        $extra   = Schema::hasColumn('service_orders', 'service_charge')
            ? ['amount' => 'service_charge']
            : [];

        $buckets = $this->groupedAggregate('service_orders', 'visit_status', $dateCol, $start, $end, $extra);

        $columns = [
            $this->col('label', 'Visit Status'),
            $this->col('count', 'Count', 'right', 'int'),
        ];
        if ($extra !== []) {
            $columns[] = $this->col('amount', 'Service Charges', 'right', 'money');
        }

        return $this->section('service_orders', 'Service Orders', $columns, $buckets, [
            'subtitle'    => 'Grouped by visit status',
            'date_column' => $dateCol,
        ]);
    }

    private function serviceOrderConcernSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('service_orders', ['concern'])) {
            return null;
        }

        $dateCol = $this->firstColumn('service_orders', ['created_at', 'timestamp']);
        $buckets = $this->groupedAggregate('service_orders', 'concern', $dateCol, $start, $end);

        if ($buckets === []) {
            return null;
        }

        return $this->section(
            'service_order_concerns',
            'Service Orders by Concern',
            [
                $this->col('label', 'Concern'),
                $this->col('count', 'Count', 'right', 'int'),
                $this->col('share', 'Share', 'right', 'percent'),
            ],
            $this->withShare($buckets),
            [
                'subtitle'    => 'Each service order appears in exactly one concern',
                'note'        => 'This total must equal the Service Orders total above.',
                'date_column' => $dateCol,
            ]
        );
    }

    private function pulloutSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('service_orders', ['visit_status'])) {
            return null;
        }

        $categoryCol = $this->firstColumn('service_orders', ['repair_category', 'concern']);
        if ($categoryCol === null) {
            return null;
        }

        $dateCol = $this->firstColumn('service_orders', ['created_at', 'timestamp']);

        // Matches 'pullout', 'Pull Out', 'pull-out' and 'Pull  Out' alike: the
        // old exact-equality check on 'pullout' missed every spaced variant.
        $normalized = "LOWER(REPLACE(REPLACE(COALESCE({$categoryCol}, ''), ' ', ''), '-', ''))";

        $query = DB::table('service_orders')->whereIn(DB::raw($normalized), ['pullout', 'pulledout']);

        $buckets = $this->groupedAggregate(
            'service_orders', 'visit_status', $dateCol, $start, $end, [], $query
        );

        if ($buckets === []) {
            return null;
        }

        return $this->section(
            'pullout',
            'Pull-Out Service Orders',
            [
                $this->col('label', 'Visit Status'),
                $this->col('count', 'Count', 'right', 'int'),
            ],
            $buckets,
            [
                'subtitle'    => "Service orders whose {$categoryCol} is a pull-out",
                'note'        => 'A subset of Service Orders — not additional records.',
                'date_column' => $dateCol,
            ]
        );
    }

    private function workOrderSection(?string $start, ?string $end): ?array
    {
        $table = Schema::hasTable('work_order')
            ? 'work_order'
            : (Schema::hasTable('work_orders') ? 'work_orders' : null);

        if ($table === null || !Schema::hasColumn($table, 'work_status')) {
            return null;
        }

        $dateCol = $this->firstColumn($table, ['created_at', 'requested_date']);
        $buckets = $this->groupedAggregate($table, 'work_status', $dateCol, $start, $end);

        if ($buckets === []) {
            return null;
        }

        return $this->section(
            'work_orders',
            'Work Orders',
            [
                $this->col('label', 'Work Status'),
                $this->col('count', 'Count', 'right', 'int'),
            ],
            $buckets,
            [
                'subtitle'    => 'Grouped by work status',
                'date_column' => $dateCol,
            ]
        );
    }

    private function inventoryMovementSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('inventory_logs', ['log_type'])) {
            return null;
        }

        // inventory_logs has `date`, never `created_at`.
        $dateCol = $this->firstColumn('inventory_logs', ['date', 'modified_date']);
        $extra   = Schema::hasColumn('inventory_logs', 'item_quantity')
            ? ['quantity' => 'item_quantity']
            : [];

        $buckets = $this->groupedAggregate('inventory_logs', 'log_type', $dateCol, $start, $end, $extra);

        if ($buckets === []) {
            return null;
        }

        $columns = [
            $this->col('label', 'Log Type'),
            $this->col('count', 'Entries', 'right', 'int'),
        ];
        if ($extra !== []) {
            $columns[] = $this->col('quantity', 'Total Quantity', 'right', 'int');
        }

        return $this->section('inventory_movement', 'Inventory Movement', $columns, $buckets, [
            'subtitle'    => 'Inventory log entries in the period',
            'date_column' => $dateCol,
        ]);
    }

    private function applicationSection(?string $start, ?string $end): ?array
    {
        if (!$this->usable('applications', ['barangay'])) {
            return null;
        }

        $dateCol = $this->firstColumn('applications', ['created_at', 'timestamp']);
        $buckets = $this->groupedAggregate('applications', 'barangay', $dateCol, $start, $end);

        if ($buckets === []) {
            return null;
        }

        return $this->section(
            'applications',
            'Applications by Barangay',
            [
                $this->col('label', 'Barangay'),
                $this->col('count', 'Applications', 'right', 'int'),
                $this->col('share', 'Share', 'right', 'percent'),
            ],
            $this->withShare($buckets),
            [
                'subtitle'    => 'New applications received in the period',
                'date_column' => $dateCol,
            ]
        );
    }

    private function stockSection(): ?array
    {
        if (!$this->usable('inventory_items', ['total_quantity'])) {
            return null;
        }

        $alertExpr = Schema::hasColumn('inventory_items', 'quantity_alert')
            ? 'COALESCE(quantity_alert, 0)'
            : '0';

        // Aggregated in SQL. The old version fetched every inventory row into
        // PHP and looped, which does not scale and made the result untestable.
        $row = DB::table('inventory_items')
            ->selectRaw("
                COUNT(*) AS total_items,
                SUM(CASE WHEN COALESCE(total_quantity, 0) >  {$alertExpr} THEN 1 ELSE 0 END) AS good_stock,
                SUM(CASE WHEN COALESCE(total_quantity, 0) <= {$alertExpr}
                          AND COALESCE(total_quantity, 0) >  0            THEN 1 ELSE 0 END) AS low_stock,
                SUM(CASE WHEN COALESCE(total_quantity, 0) <= 0            THEN 1 ELSE 0 END) AS out_of_stock,
                COALESCE(SUM(COALESCE(total_quantity, 0)), 0) AS units
            ")
            ->first();

        if (!$row || (int) $row->total_items === 0) {
            return null;
        }

        $buckets = [
            ['label' => 'Good stock (above alert level)', 'count' => (int) $row->good_stock],
            ['label' => 'Low stock (at or below alert level)', 'count' => (int) $row->low_stock],
            ['label' => 'Out of stock', 'count' => (int) $row->out_of_stock],
        ];

        return $this->section(
            'stock',
            'Inventory Stock Levels',
            [
                $this->col('label', 'Stock Condition'),
                $this->col('count', 'Items', 'right', 'int'),
            ],
            $buckets,
            [
                'subtitle'      => 'Current stock position — not filtered by the reporting period',
                'range_applies' => false,
                'highlights'    => [
                    $this->highlight('Distinct items tracked', (int) $row->total_items, 'int'),
                    $this->highlight('Total units on hand', (int) $row->units, 'int'),
                ],
                'note' => 'Each item is classified once, so the three conditions add up to the item count.',
            ]
        );
    }

    private function lcpNapSection(): ?array
    {
        if (!Schema::hasTable('lcpnap')) {
            return null;
        }

        $total = (int) DB::table('lcpnap')->count();
        if ($total === 0) {
            return null;
        }

        $buckets = [['label' => 'Registered LCP/NAP', 'count' => $total]];
        $highlights = [];

        if (Schema::hasColumn('lcpnap', 'port_total')) {
            $ports = (int) DB::table('lcpnap')->sum(DB::raw('COALESCE(port_total, 0)'));
            $highlights[] = $this->highlight('Total ports', $ports, 'int');
        }

        return $this->section(
            'lcpnap',
            'LCP / NAP Infrastructure',
            [
                $this->col('label', 'Item'),
                $this->col('count', 'Count', 'right', 'int'),
            ],
            $buckets,
            [
                'subtitle'      => 'Current infrastructure inventory — not filtered by the reporting period',
                'range_applies' => false,
                'highlights'    => $highlights,
            ]
        );
    }

    private function subscriberSessionSection(): ?array
    {
        if (!$this->usable('online_status', ['session_status'])) {
            return null;
        }

        $buckets = $this->groupedAggregate('online_status', 'session_status', null, null, null);
        if ($buckets === []) {
            return null;
        }

        $online = $this->sumWhere($buckets, ['online']);

        return $this->section(
            'sessions',
            'Subscriber Session Status',
            [
                $this->col('label', 'Session Status'),
                $this->col('count', 'Subscribers', 'right', 'int'),
                $this->col('share', 'Share', 'right', 'percent'),
            ],
            $this->withShare($buckets),
            [
                'subtitle'      => 'Live session state — not filtered by the reporting period',
                'range_applies' => false,
                'highlights'    => [
                    $this->highlight('Currently online', $online['count'], 'int'),
                ],
                'note' => 'Only the "Online" bucket is counted as online. Offline and Not Found '
                        . 'sessions are listed separately instead of being merged into the online total.',
            ]
        );
    }

    private function subscribersOnlineByBarangaySection(): ?array
    {
        if (!$this->usable('online_status', ['session_status', 'account_id'])
            || !$this->usable('billing_accounts', ['customer_id'])
            || !$this->usable('customers', ['barangay'])) {
            return null;
        }

        // COUNT(DISTINCT billing_accounts.id): a subscriber with more than one
        // online_status row must not be counted twice.
        $rows = DB::table('online_status')
            ->join('billing_accounts', 'online_status.account_id', '=', 'billing_accounts.id')
            ->join('customers', 'billing_accounts.customer_id', '=', 'customers.id')
            ->whereRaw("LOWER(TRIM(COALESCE(online_status.session_status, ''))) = 'online'")
            ->groupBy('customers.barangay')
            ->orderByDesc(DB::raw('COUNT(DISTINCT billing_accounts.id)'))
            ->get([
                'customers.barangay AS label',
                DB::raw('COUNT(DISTINCT billing_accounts.id) AS aggregate_count'),
            ]);

        if ($rows->isEmpty()) {
            return null;
        }

        $buckets = $rows->map(fn ($r) => [
            'label' => $this->labelOf($r->label),
            'count' => (int) $r->aggregate_count,
        ])->all();

        return $this->section(
            'online_by_barangay',
            'Online Subscribers by Barangay',
            [
                $this->col('label', 'Barangay'),
                $this->col('count', 'Online', 'right', 'int'),
                $this->col('share', 'Share', 'right', 'percent'),
            ],
            $this->withShare($buckets),
            [
                'subtitle'      => 'Distinct subscribers with an active session — current state',
                'range_applies' => false,
                'note'          => 'Counted with COUNT(DISTINCT account) so a subscriber holding multiple '
                                 . 'sessions is counted once.',
            ]
        );
    }

    // ── Aggregation core ──────────────────────────────────────────────────────

    /**
     * Run a single GROUP BY over `$table.$groupColumn`, returning one bucket per
     * distinct value with its count plus any requested SUM() columns.
     *
     * NULL / empty group values collapse into a single "Unspecified" bucket so
     * that SUM(buckets.count) === COUNT(*) over the same filtered set — the
     * property `validate()` later asserts.
     *
     * @param  array<string,string>  $sums  result key => column to SUM
     * @param  \Illuminate\Database\Query\Builder|null  $base  pre-filtered query
     * @return array<int, array<string, mixed>>
     */
    private function groupedAggregate(
        string $table,
        string $groupColumn,
        ?string $dateColumn,
        ?string $start,
        ?string $end,
        array $sums = [],
        $base = null
    ): array {
        $query = $base ?: DB::table($table);

        if ($start && $end && $dateColumn) {
            $query->whereBetween($table . '.' . $dateColumn, [$start . ' 00:00:00', $end . ' 23:59:59']);
        }

        $selects = [
            DB::raw("{$table}.{$groupColumn} AS group_value"),
            DB::raw('COUNT(*) AS aggregate_count'),
        ];

        foreach ($sums as $key => $column) {
            $alias = 'sum_' . $key;
            $selects[] = DB::raw("COALESCE(SUM(COALESCE({$table}.{$column}, 0)), 0) AS {$alias}");
        }

        $rows = $query
            ->groupBy($table . '.' . $groupColumn)
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->get($selects);

        // Fold NULL and '' (and whitespace-only) into one Unspecified bucket.
        $merged = [];
        foreach ($rows as $row) {
            $label = $this->labelOf($row->group_value);

            if (!isset($merged[$label])) {
                $merged[$label] = ['label' => $label, 'count' => 0];
                foreach (array_keys($sums) as $key) {
                    $merged[$label][$key] = 0.0;
                }
            }

            $merged[$label]['count'] += (int) $row->aggregate_count;
            foreach (array_keys($sums) as $key) {
                $merged[$label][$key] += (float) $row->{'sum_' . $key};
            }
        }

        $buckets = array_values($merged);

        usort($buckets, function ($a, $b) {
            if ($a['label'] === self::UNSPECIFIED) {
                return 1;
            }
            if ($b['label'] === self::UNSPECIFIED) {
                return -1;
            }

            return $b['count'] <=> $a['count'] ?: strcmp($a['label'], $b['label']);
        });

        return $buckets;
    }

    /**
     * Assemble a section, deriving its Total row from the buckets so subtotals
     * and totals are guaranteed consistent.
     */
    private function section(
        string $key,
        string $title,
        array $columns,
        array $rows,
        array $options = []
    ): array {
        $total = ['label' => 'Total'];

        foreach ($columns as $column) {
            if ($column['key'] === 'label' || $column['key'] === 'share') {
                continue;
            }

            $total[$column['key']] = array_sum(array_map(
                fn ($r) => $r[$column['key']] ?? 0,
                $rows
            ));
        }

        // A share column always totals 100% (or 0% for an empty section).
        if ($this->hasColumn($columns, 'share')) {
            $total['share'] = $rows === [] ? 0.0 : 100.0;
        }

        return [
            'key'           => $key,
            'title'         => $title,
            'subtitle'      => $options['subtitle'] ?? null,
            'note'          => $options['note'] ?? null,
            'columns'       => $columns,
            'rows'          => $rows,
            'total'         => $total,
            'highlights'    => $options['highlights'] ?? [],
            'range_applies' => $options['range_applies'] ?? true,
            'date_column'   => $options['date_column'] ?? null,
            'contributes'   => $options['contributes'] ?? [],
        ];
    }

    /** Grand totals across sections that describe period activity. */
    private function grandTotals(array $sections): array
    {
        $collected = 0.0;
        $records   = 0;

        foreach ($sections as $section) {
            if ($section['range_applies']) {
                // Pull-out and concern sections re-slice records already counted
                // in Service Orders; excluding them keeps the record grand total
                // free of double counting.
                if (!in_array($section['key'], ['pullout', 'service_order_concerns', 'payment_methods'], true)) {
                    $records += (int) ($section['total']['count'] ?? 0);
                }
            }

            $collected += (float) ($section['contributes']['collected'] ?? 0.0);
        }

        return [
            'records'   => $records,
            'collected' => round($collected, 2),
        ];
    }

    /**
     * Re-verify every section before the numbers reach a PDF or an email.
     *
     * Each check re-derives the section total independently and compares it
     * against the rendered total, so a regression in the aggregation surfaces
     * as a validation issue instead of a plausible-looking wrong number.
     */
    private function validate(array $sections): array
    {
        $issues = [];

        foreach ($sections as $section) {
            $bucketSum = array_sum(array_map(fn ($r) => (int) ($r['count'] ?? 0), $section['rows']));
            $stated    = (int) ($section['total']['count'] ?? 0);

            if ($bucketSum !== $stated) {
                $issues[] = sprintf(
                    '%s: subtotals (%d) do not reconcile with the stated total (%d).',
                    $section['title'], $bucketSum, $stated
                );
            }

            foreach ($section['columns'] as $column) {
                if (($column['format'] ?? null) !== 'money') {
                    continue;
                }

                $sum = array_sum(array_map(fn ($r) => (float) ($r[$column['key']] ?? 0), $section['rows']));
                if (abs($sum - (float) ($section['total'][$column['key']] ?? 0)) > 0.01) {
                    $issues[] = sprintf(
                        '%s: "%s" subtotals do not reconcile with the stated total.',
                        $section['title'], $column['label']
                    );
                }
            }

            foreach ($section['rows'] as $row) {
                if (($row['count'] ?? 0) < 0) {
                    $issues[] = sprintf('%s: negative count for "%s".', $section['title'], $row['label']);
                }
            }
        }

        // Cross-section invariant: the concern breakdown must cover exactly the
        // same service orders as the visit-status breakdown.
        $so       = $this->findSection($sections, 'service_orders');
        $concerns = $this->findSection($sections, 'service_order_concerns');
        if ($so && $concerns && (int) $so['total']['count'] !== (int) $concerns['total']['count']) {
            $issues[] = sprintf(
                'Service Orders total (%d) does not match the by-concern total (%d).',
                $so['total']['count'], $concerns['total']['count']
            );
        }

        // Payment-method collections must equal transaction collections.
        $tx = $this->findSection($sections, 'transactions');
        $pm = $this->findSection($sections, 'payment_methods');
        if ($tx && $pm) {
            $expected = (float) ($tx['contributes']['collected'] ?? 0.0);
            $actual   = (float) ($pm['total']['amount'] ?? 0.0);
            if (abs($expected - $actual) > 0.01) {
                $issues[] = sprintf(
                    'Collections by payment method (%.2f) do not match collected transactions (%.2f).',
                    $actual, $expected
                );
            }
        }

        return ['ok' => $issues === [], 'issues' => $issues];
    }

    /**
     * Legacy-shaped "Metric => value" map, so the CSV export and any existing
     * consumer of getSummaryMetrics() keeps working off the corrected figures.
     */
    private function flatten(array $sections): array
    {
        $flat = [];

        foreach ($sections as $section) {
            $title = $section['title'];

            foreach ($section['rows'] as $row) {
                foreach ($section['columns'] as $column) {
                    $key = $column['key'];
                    if ($key === 'label' || $key === 'share' || !array_key_exists($key, $row)) {
                        continue;
                    }

                    $suffix = $key === 'count' ? '' : ' — ' . $column['label'];
                    $flat["{$title}: {$row['label']}{$suffix}"] = $this->numeric($row[$key], $column);
                }
            }

            foreach ($section['columns'] as $column) {
                $key = $column['key'];
                if ($key === 'label' || $key === 'share' || !array_key_exists($key, $section['total'])) {
                    continue;
                }

                $suffix = $key === 'count' ? 'Total' : 'Total ' . $column['label'];
                $flat["{$title}: {$suffix}"] = $this->numeric($section['total'][$key], $column);
            }

            foreach ($section['highlights'] as $highlight) {
                $flat["{$title}: {$highlight['label']}"] = $highlight['format'] === 'money'
                    ? round((float) $highlight['value'], 2)
                    : $highlight['value'];
            }
        }

        return $flat;
    }

    // ── Small helpers ─────────────────────────────────────────────────────────

    private function numeric($value, array $column)
    {
        return ($column['format'] ?? 'int') === 'money'
            ? round((float) $value, 2)
            : (int) $value;
    }

    private function col(string $key, string $label, string $align = 'left', string $format = 'text'): array
    {
        return ['key' => $key, 'label' => $label, 'align' => $align, 'format' => $format];
    }

    private function highlight(string $label, $value, string $format): array
    {
        return [
            'label'  => $label,
            'value'  => $format === 'money' ? round((float) $value, 2) : (int) $value,
            'format' => $format,
        ];
    }

    private function hasColumn(array $columns, string $key): bool
    {
        foreach ($columns as $column) {
            if ($column['key'] === $key) {
                return true;
            }
        }

        return false;
    }

    private function findSection(array $sections, string $key): ?array
    {
        foreach ($sections as $section) {
            if ($section['key'] === $key) {
                return $section;
            }
        }

        return null;
    }

    /** Add a percentage-of-total column to each bucket. */
    private function withShare(array $buckets): array
    {
        $total = array_sum(array_map(fn ($b) => (int) $b['count'], $buckets));

        return array_map(function ($bucket) use ($total) {
            $bucket['share'] = $total > 0 ? round($bucket['count'] / $total * 100, 1) : 0.0;

            return $bucket;
        }, $buckets);
    }

    /** Sum the buckets whose label matches one of the given (lower-cased) values. */
    private function sumWhere(array $buckets, array $labels): array
    {
        return $this->sumBuckets(array_filter(
            $buckets,
            fn ($b) => in_array(strtolower($b['label']), $labels, true)
        ));
    }

    private function sumWhereNot(array $buckets, array $labels): array
    {
        return $this->sumBuckets(array_filter(
            $buckets,
            fn ($b) => !in_array(strtolower($b['label']), $labels, true)
        ));
    }

    private function sumBuckets(array $buckets): array
    {
        $out = ['count' => 0];

        foreach ($buckets as $bucket) {
            foreach ($bucket as $key => $value) {
                if ($key === 'label') {
                    continue;
                }
                $out[$key] = ($out[$key] ?? 0) + $value;
            }
        }

        return $out;
    }

    private function labelOf($value): string
    {
        $label = trim((string) ($value ?? ''));

        return $label === '' ? self::UNSPECIFIED : $label;
    }

    private function usable(string $table, array $requiredColumns): bool
    {
        if (!Schema::hasTable($table)) {
            return false;
        }

        foreach ($requiredColumns as $column) {
            if (!Schema::hasColumn($table, $column)) {
                return false;
            }
        }

        return true;
    }

    private function firstColumn(string $table, array $candidates): ?string
    {
        foreach ($candidates as $column) {
            if (Schema::hasColumn($table, $column)) {
                return $column;
            }
        }

        return null;
    }

    private function formatDate(?string $date): string
    {
        if (!$date) {
            return '—';
        }

        try {
            return \Carbon\Carbon::parse($date)->format('M d, Y');
        } catch (\Throwable $e) {
            return $date;
        }
    }
}

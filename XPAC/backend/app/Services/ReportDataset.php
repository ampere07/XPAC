<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Single source of truth for "which table / which columns / which date column"
 * backs each report type.
 *
 * Both ReportPdfService and ReportCsvService resolve through this class so a
 * PDF and its CSV twin can never disagree about the underlying record set.
 *
 * Every column referenced here is intersected against the live schema before
 * use, so a renamed/dropped column degrades gracefully instead of throwing
 * "Unknown column" at PDF-generation time.
 *
 * Two dataset shapes are supported:
 *
 *   SINGLE TABLE  one `table`, columns read straight off it.
 *
 *   UNION         several `sources`, each projecting its own columns onto one
 *                 shared set of aliases, combined with UNION ALL and wrapped in
 *                 a derived table. The wrapper is an ordinary query builder, so
 *                 every consumer downstream — counting, GROUP BY subtotals, the
 *                 row listing, CSV chunking — works on a union with no special
 *                 casing. Per-source date filters are applied INSIDE each branch,
 *                 before the combine, so each source filters on its own date
 *                 column and the totals only ever describe filtered rows.
 */
class ReportDataset
{
    /**
     * report type (lower-cased) => dataset definition.
     *
     *  table         primary table, first existing candidate wins
     *  date_column   column used for date-range filtering (candidates)
     *  order_column  column used for "most recent first" ordering (candidates)
     *  columns       curated display columns, in order
     *  numeric       columns that get subtotaled / grand-totaled
     *  money         subset of `numeric` rendered as currency
     *  group_by      column the subtotal breakdown groups on
     *  tiebreakers   extra ordering columns that make the sort a TOTAL order —
     *                required for correct LIMIT/OFFSET chunking when the primary
     *                sort column is not unique
     *  union         when true, `sources` replaces `table`
     *  sources       union branches; each maps aliases => column/expr/literal
     */
    private const DATASETS = [
        'manual transaction' => [
            'table'        => ['transactions'],
            'date_column'  => ['date_processed', 'payment_date', 'created_at'],
            'order_column' => ['date_processed', 'payment_date', 'id'],
            'columns'      => [
                'id', 'account_no', 'transaction_type', 'payment_method',
                'reference_no', 'or_no', 'status', 'date_processed', 'payment_date',
                'processed_by_user', 'received_payment',
            ],
            'numeric'      => ['received_payment'],
            'money'        => ['received_payment'],
            'group_by'     => 'status',
        ],

        'payment portal' => [
            'table'        => ['payment_portal_logs'],
            'date_column'  => ['date_time', 'created_at'],
            'order_column' => ['date_time', 'id'],
            'columns'      => [
                'id', 'reference_no', 'account_id', 'payment_channel',
                'ewallet_type', 'type', 'status', 'transaction_status',
                'date_time', 'total_amount',
            ],
            'numeric'      => ['total_amount'],
            'money'        => ['total_amount'],
            'group_by'     => 'status',
        ],

        /*
         * Manual Transactions + Payment Portal in one report.
         *
         * The two tables describe the same business event (money received) with
         * different column names, so each branch projects onto a shared alias
         * set. Grouping on `source` means the existing subtotal machinery
         * produces the Manual / Portal split and the combined grand total with
         * no bespoke total-calculating code.
         *
         * Alias order below IS the UNION column order and the PDF column order;
         * it mirrors the Manual Transaction layout with `source` prepended.
         */
        'combined transactions' => [
            'union'    => true,
            'columns'  => [
                'source', 'record_id', 'account_ref', 'transaction_type',
                'payment_method', 'reference_no', 'or_no', 'status',
                'transacted_at', 'processed_by', 'amount',
            ],
            'numeric'  => ['amount'],
            'money'    => ['amount'],
            'group_by' => 'source',
            // transacted_at is not unique, so chunking needs a total order.
            'order_column' => 'transacted_at',
            'tiebreakers'  => ['source', 'record_id'],
            'date_column'  => 'transacted_at',
            /*
             * Declared alias types drive an explicit CAST/CONVERT on both
             * branches. This is not cosmetic — it is required:
             *
             *   transactions        is utf8mb4_unicode_ci
             *   payment_portal_logs is utf8mb4_general_ci
             *
             * and MariaDB rejects a UNION of differing collations outright with
             * "Illegal mix of collations for operation 'UNION'". Normalising
             * every string alias to one collation also makes the report immune
             * to a future table being created with a third collation.
             *
             * The casts additionally reconcile genuine type differences:
             * account_no is varchar on one side and account_id is bigint on the
             * other.
             */
            'types' => [
                'source'           => 'string',
                'record_id'        => 'int',
                'account_ref'      => 'string',
                'transaction_type' => 'string',
                'payment_method'   => 'string',
                'reference_no'     => 'string',
                'or_no'            => 'string',
                'status'           => 'string',
                'transacted_at'    => 'datetime',
                'processed_by'     => 'string',
                'amount'           => 'decimal',
            ],
            'sources' => [
                [
                    'label'       => 'Manual Transaction',
                    'table'       => ['transactions'],
                    'date_column' => ['date_processed', 'payment_date', 'created_at'],
                    'map'         => [
                        'source'           => ['literal' => "'Manual Transaction'"],
                        'record_id'        => ['column' => ['id']],
                        'account_ref'      => ['column' => ['account_no']],
                        'transaction_type' => ['column' => ['transaction_type']],
                        'payment_method'   => ['column' => ['payment_method']],
                        'reference_no'     => ['column' => ['reference_no']],
                        'or_no'            => ['column' => ['or_no']],
                        'status'           => ['column' => ['status']],
                        'transacted_at'    => ['column' => ['date_processed', 'payment_date', 'created_at']],
                        'processed_by'     => ['column' => ['processed_by_user', 'created_by_user']],
                        'amount'           => ['column' => ['received_payment']],
                    ],
                ],
                [
                    'label'       => 'Payment Portal',
                    'table'       => ['payment_portal_logs'],
                    'date_column' => ['date_time', 'created_at'],
                    'map'         => [
                        'source'    => ['literal' => "'Payment Portal'"],
                        'record_id' => ['column' => ['id']],
                        // bigint here, varchar on transactions — reconciled by
                        // the declared 'string' type coercion.
                        'account_ref'      => ['column' => ['account_id']],
                        'transaction_type' => ['column' => ['type']],
                        // ewallet_type is null for card payments and
                        // payment_channel is null for some wallets.
                        'payment_method'   => [
                            'expr'     => "COALESCE(NULLIF(`ewallet_type`, ''), NULLIF(`payment_channel`, ''))",
                            'requires' => ['ewallet_type', 'payment_channel'],
                            'column'   => ['payment_channel', 'ewallet_type'],
                        ],
                        'reference_no'  => ['column' => ['reference_no']],
                        // No official-receipt equivalent online. Deliberately
                        // NULL rather than borrowing checkout_id, which is not
                        // an OR number and would misrepresent the record.
                        'or_no'         => null,
                        'status'        => ['column' => ['status']],
                        'transacted_at' => ['column' => ['date_time', 'created_at']],
                        // Portal payments are self-service; there is no operator.
                        'processed_by'  => null,
                        'amount'        => ['column' => ['total_amount']],
                    ],
                ],
            ],
        ],

        // NOTE: inventory_logs has no created_at column — its date column is
        // `date`. The previous mapping to created_at made every Inventory
        // report fail with "Unknown column 'created_at'".
        'inventory' => [
            'table'        => ['inventory_logs'],
            'date_column'  => ['date', 'modified_date'],
            'order_column' => ['date', 'id'],
            'columns'      => [
                'id', 'date', 'item_name', 'log_type', 'sn', 'account_no',
                'requested_by', 'status', 'remarks', 'item_quantity',
            ],
            'numeric'      => ['item_quantity'],
            'money'        => [],
            'group_by'     => 'log_type',
        ],

        'job order' => [
            'table'        => ['job_orders'],
            'date_column'  => ['created_at', 'timestamp'],
            'order_column' => ['created_at', 'id'],
            'columns'      => [
                'id', 'account_id', 'application_id', 'username',
                'connection_type', 'usage_type', 'lcpnap', 'port',
                'onsite_status', 'billing_status', 'date_installed',
                'assigned_email', 'created_at', 'installation_fee',
            ],
            'numeric'      => ['installation_fee'],
            'money'        => ['installation_fee'],
            'group_by'     => 'onsite_status',
        ],

        'service order' => [
            'table'        => ['service_orders'],
            'date_column'  => ['created_at', 'timestamp'],
            'order_column' => ['created_at', 'id'],
            'columns'      => [
                'id', 'account_no', 'ticket_id', 'concern', 'repair_category',
                'priority_level', 'visit_status', 'support_status',
                'assigned_email', 'created_at', 'service_charge',
            ],
            'numeric'      => ['service_charge'],
            'money'        => ['service_charge'],
            'group_by'     => 'visit_status',
        ],

        'work order' => [
            'table'        => ['work_order', 'work_orders'],
            'date_column'  => ['created_at', 'requested_date'],
            'order_column' => ['created_at', 'id'],
            'columns'      => [
                'id', 'work_category', 'work_status', 'report_to', 'assign_to',
                'requested_by', 'requested_date', 'created_at', 'remarks',
            ],
            'numeric'      => [],
            'money'        => [],
            'group_by'     => 'work_status',
        ],

        'pullout movement' => [
            'union'        => true,
            // For a union these name ALIASES in the combined result, not columns on a
            // base table - the date filter is applied per-branch, before the combine.
            'date_column'  => 'pullout_at',
            'order_column' => 'pullout_at',
            // pullout_at is not unique, so the sort is not a total order on its own.
            // Without a tiebreaker the LIMIT/OFFSET chunking the CSV export uses can
            // repeat or drop rows across page boundaries.
            'tiebreakers'  => ['account_no'],
            'columns'      => [
                'account_no', 'subscriber_name', 'pullout_reason', 'assigned_tech',
                'router_modem_sn', 'pullout_at', 'status_transition',
            ],
            'numeric'      => [],
            'money'        => [],
            'group_by'     => 'status_transition',
            'sources' => [
                [
                    'label'       => 'Pullout',
                    'table'       => ['service_orders'],
                    // The moment the order MOVED. service_orders has no
                    // status_changed_at in any deployment, so updated_at is the
                    // closest true transition stamp; end_time and created_at only
                    // stand in where it is absent.
                    'date_column' => ['updated_at', 'end_time', 'created_at'],
                    // Restricts the branch to pullout work. Bound, never interpolated.
                    'where_raw'   => [
                        'sql' => "(LOWER(COALESCE(`concern`, '')) LIKE ?"
                               . " OR LOWER(COALESCE(`concern`, '')) LIKE ?"
                               . " OR LOWER(COALESCE(`repair_category`, '')) LIKE ?)",
                        'bindings' => ['%pullout%', '%pull out%', '%pullout%'],
                        'requires' => ['concern'],
                    ],
                    'map' => [
                        'account_no'      => ['column' => ['account_no']],
                        // service_orders stores no subscriber name. Correlated rather
                        // than joined because the dataset contract is one table per
                        // branch; it is bounded by the PDF row cap and by the date
                        // filter, and account_no is indexed on billing_accounts.
                        'subscriber_name' => [
                            'expr'     => "(SELECT TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')))"
                                        . " FROM billing_accounts ba"
                                        . " JOIN customers c ON c.id = ba.customer_id"
                                        . " WHERE ba.account_no = `service_orders`.`account_no` LIMIT 1)",
                            'requires' => ['account_no'],
                            'column'   => ['account_no'],
                        ],
                        'pullout_reason'  => [
                            'expr'     => "COALESCE(NULLIF(`concern_remarks`, ''), NULLIF(`support_remarks`, ''), `concern`)",
                            'requires' => ['concern_remarks', 'support_remarks', 'concern'],
                            'column'   => ['concern_remarks', 'support_remarks', 'concern'],
                        ],
                        'assigned_tech'   => [
                            'expr'     => "COALESCE(NULLIF(`visit_by_user`, ''), NULLIF(`technicians`, ''), NULLIF(`assigned_email`, ''))",
                            'requires' => ['visit_by_user', 'technicians', 'assigned_email'],
                            'column'   => ['visit_by_user', 'assigned_email'],
                        ],
                        // The serial that came back off the wall.
                        'router_modem_sn' => ['column' => ['old_router_modem_sn', 'router_modem_sn']],
                        'pullout_at'      => ['column' => ['updated_at', 'end_time', 'created_at']],
                        // "For Visit -> Done". Built from the two columns that actually
                        // move; `status` is 'unused' on nearly every pullout row and
                        // would have made this column meaningless.
                        'status_transition' => [
                            'expr'     => "CONCAT(COALESCE(NULLIF(`support_status`, ''), 'Pending'), ' -> ',"
                                        . " COALESCE(NULLIF(`visit_status`, ''), 'Pending'))",
                            'requires' => ['support_status', 'visit_status'],
                            'column'   => ['visit_status', 'support_status'],
                        ],
                    ],
                ],
            ],
        ],
    ];

    /** Report types that are aggregate rather than record-listing. */
    public const SUMMARY_TYPES = ['summary'];

    /** Every report type this system can produce. */
    public static function reportTypes(): array
    {
        return array_merge(
            array_map(
                fn ($k) => ucwords($k),
                array_keys(self::DATASETS)
            ),
            ['Summary']
        );
    }

    public static function isSummary(?string $reportType): bool
    {
        return in_array(strtolower(trim((string) $reportType)), self::SUMMARY_TYPES, true);
    }

    public static function isKnownType(?string $reportType): bool
    {
        $key = strtolower(trim((string) $reportType));

        return $key !== '' && (isset(self::DATASETS[$key]) || self::isSummary($key));
    }

    /**
     * Resolve a report type into a concrete, schema-verified dataset.
     *
     * @throws \RuntimeException when the type is unknown or its table is absent
     */
    public static function resolve(string $reportType): array
    {
        $key = strtolower(trim($reportType));

        if (!isset(self::DATASETS[$key])) {
            throw new \RuntimeException("Unknown report type: {$reportType}");
        }

        $def = self::DATASETS[$key];

        if (!empty($def['union'])) {
            return self::resolveUnion($reportType, $def);
        }

        $table = self::firstExistingTable($def['table']);
        if ($table === null) {
            throw new \RuntimeException(
                "No table available for report type '{$reportType}' (tried: "
                . implode(', ', $def['table']) . ')'
            );
        }

        $available = Schema::getColumnListing($table);
        $availableLookup = array_flip($available);

        $exists = fn (string $c) => isset($availableLookup[$c]);

        // Keep only curated columns that really exist; if the curation matches
        // nothing at all, fall back to the full listing so the report is never
        // empty just because of a rename.
        $columns = array_values(array_filter($def['columns'], $exists));
        if ($columns === []) {
            $columns = $available;
        }

        $numeric = array_values(array_filter($def['numeric'], $exists));
        $money   = array_values(array_filter($def['money'], $exists));

        $groupBy = $exists($def['group_by']) ? $def['group_by'] : null;

        $orderColumn = self::firstExistingColumn($def['order_column'], $availableLookup) ?? 'id';

        // The primary sort column is usually a non-unique date, so the primary
        // key is appended to make the ordering total. Without that, LIMIT/OFFSET
        // chunking can repeat or skip rows across chunk boundaries.
        $tiebreakers = array_values(array_filter(
            $def['tiebreakers'] ?? ['id'],
            fn ($c) => $c !== $orderColumn && $exists($c)
        ));

        return [
            'type'         => $reportType,
            'union'        => false,
            'sources'      => [],
            'table'        => $table,
            'columns'      => $columns,
            'all_columns'  => $available,
            'numeric'      => $numeric,
            'money'        => $money,
            'group_by'     => $groupBy,
            'date_column'  => self::firstExistingColumn($def['date_column'], $availableLookup),
            'order_column' => $orderColumn,
            'tiebreakers'  => $tiebreakers,
            'types'        => [],
        ];
    }

    /**
     * Resolve a UNION dataset, verifying every branch against the live schema.
     *
     * A branch whose table is missing is dropped rather than fatal, so the
     * report still produces the half that does exist.
     */
    private static function resolveUnion(string $reportType, array $def): array
    {
        $sources = [];

        foreach ($def['sources'] as $source) {
            $table = self::firstExistingTable($source['table']);
            if ($table === null) {
                continue;
            }

            $available = array_flip(Schema::getColumnListing($table));

            $sources[] = [
                'label'       => $source['label'],
                'table'       => $table,
                'available'   => $available,
                'map'         => $source['map'],
                'date_column' => self::firstExistingColumn($source['date_column'], $available),
                // Optional branch restriction, e.g. "only pullout service orders".
                // Dropped when the columns it names are absent, so schema drift
                // narrows a report to nothing visible rather than throwing.
                'where_raw'   => self::branchFilter($source['where_raw'] ?? null, $available),
            ];
        }

        if ($sources === []) {
            throw new \RuntimeException(
                "No source table available for report type '{$reportType}'."
            );
        }

        return [
            'type'         => $reportType,
            'union'        => true,
            'sources'      => $sources,
            // Descriptive only — used in messages, never as a real table name.
            'table'        => implode(' + ', array_column($sources, 'table')),
            'columns'      => $def['columns'],
            'all_columns'  => $def['columns'],
            'numeric'      => $def['numeric'],
            'money'        => $def['money'],
            'group_by'     => $def['group_by'],
            'date_column'  => $def['date_column'],
            'order_column' => $def['order_column'],
            'tiebreakers'  => $def['tiebreakers'] ?? [],
            'types'        => $def['types'] ?? [],
        ];
    }

    /**
     * Build the base query for a dataset with the date range applied.
     *
     * Both the aggregate pass and the row-listing pass are built from this one
     * method, which is what guarantees the totals describe exactly the same
     * record set the rows come from.
     */
    public static function query(array $dataset, ?string $startDate, ?string $endDate)
    {
        if (!empty($dataset['union'])) {
            return self::unionQuery($dataset, $startDate, $endDate);
        }

        $query = DB::table($dataset['table']);

        if ($startDate && $endDate && $dataset['date_column']) {
            $col = $dataset['date_column'];
            $query->whereBetween($col, [$startDate . ' 00:00:00', $endDate . ' 23:59:59']);
        }

        return $query;
    }

    /**
     * UNION ALL of every branch, wrapped in a derived table.
     *
     * UNION ALL, never UNION: the branches read from different tables and can
     * never produce a genuinely duplicate row, so DISTINCT de-duplication would
     * only be able to do harm — two customers paying the same amount at the same
     * second through the same channel are two payments, and plain UNION would
     * silently collapse them into one and understate the total.
     *
     * The date range is applied inside each branch, on that branch's own date
     * column, before the combine.
     */
    private static function unionQuery(array $dataset, ?string $start, ?string $end)
    {
        $aliases = $dataset['columns'];
        $union   = null;

        foreach ($dataset['sources'] as $source) {
            $branch = DB::table($source['table'])
                ->select(self::branchSelects($source, $aliases, $dataset['types'] ?? []));

            // Applied inside the branch, before the combine, so it narrows this
            // source only. Bindings are passed to whereRaw rather than being
            // interpolated into the SQL.
            if (!empty($source['where_raw'])) {
                $branch->whereRaw($source['where_raw']['sql'], $source['where_raw']['bindings']);
            }

            if ($start && $end && $source['date_column']) {
                $branch->whereBetween(
                    $source['table'] . '.' . $source['date_column'],
                    [$start . ' 00:00:00', $end . ' 23:59:59']
                );
            }

            $union = $union === null ? $branch : $union->unionAll($branch);
        }

        // Wrapping in a derived table is what lets every downstream consumer
        // treat the union as an ordinary table.
        return DB::query()->fromSub($union, 'combined');
    }

    /**
     * Projection for one union branch.
     *
     * Alias order is identical across branches — UNION matches columns by
     * position, so a differing order would silently shuffle values between
     * columns rather than error.
     */
    private static function branchSelects(array $source, array $aliases, array $types): array
    {
        return array_map(
            function (string $alias) use ($source, $types) {
                $expr = self::branchExpression($source['map'][$alias] ?? null, $source['available']);
                $expr = self::coerce($expr, $types[$alias] ?? null);

                return DB::raw("{$expr} AS `{$alias}`");
            },
            $aliases
        );
    }

    /**
     * Force an expression to the alias's declared type.
     *
     * Strings are additionally pinned to a single collation, without which
     * MariaDB refuses a UNION whose branches carry different collations.
     */
    private static function coerce(string $expr, ?string $type): string
    {
        if ($expr === 'NULL' && $type === null) {
            return $expr;
        }

        switch ($type) {
            case 'string':
                $collation = (string) config('reports.union_collation', 'utf8mb4_general_ci');

                return "CONVERT({$expr} USING utf8mb4) COLLATE {$collation}";

            case 'int':
                return "CAST({$expr} AS SIGNED)";

            case 'decimal':
                return "CAST({$expr} AS DECIMAL(20,2))";

            case 'datetime':
                return "CAST({$expr} AS DATETIME)";

            default:
                return $expr;
        }
    }

    /**
     * Resolve one alias to SQL for one branch, degrading to NULL when the
     * underlying columns are absent, so schema drift cannot break the union.
     */
    private static function branchExpression($spec, array $available): string
    {
        if ($spec === null) {
            return 'NULL';
        }

        if (isset($spec['literal'])) {
            return $spec['literal'];
        }

        if (isset($spec['expr'])) {
            $satisfied = true;
            foreach ($spec['requires'] ?? [] as $column) {
                if (!isset($available[$column])) {
                    $satisfied = false;
                    break;
                }
            }

            if ($satisfied) {
                return $spec['expr'];
            }
            // falls through to the `column` fallback below
        }

        foreach ((array) ($spec['column'] ?? []) as $column) {
            if (isset($available[$column])) {
                return "`{$column}`";
            }
        }

        return 'NULL';
    }

    /**
     * Validate an optional branch filter against the live schema.
     *
     * Returns null when the filter names a column this deployment does not have.
     * Dropping the restriction would be worse than dropping the filter - an
     * unfiltered branch would report every service order as a pullout - so the
     * caller treats null as "this source cannot be filtered" and the dataset
     * simply yields nothing rather than yielding the wrong thing.
     *
     * @param array{sql: string, bindings: array, requires?: array}|null $filter
     * @return array{sql: string, bindings: array}|null
     */
    private static function branchFilter(?array $filter, array $available): ?array
    {
        if ($filter === null) {
            return null;
        }

        foreach ($filter['requires'] ?? [] as $column) {
            if (!isset($available[$column])) {
                return null;
            }
        }

        return ['sql' => $filter['sql'], 'bindings' => $filter['bindings'] ?? []];
    }

    private static function firstExistingTable(array $candidates): ?string
    {
        foreach ($candidates as $table) {
            if (Schema::hasTable($table)) {
                return $table;
            }
        }

        return null;
    }

    private static function firstExistingColumn(array $candidates, array $availableLookup): ?string
    {
        foreach ($candidates as $column) {
            if (isset($availableLookup[$column])) {
                return $column;
            }
        }

        return null;
    }

    /**
     * Parse the "YYYY-MM-DD to YYYY-MM-DD" range string stored on reports.
     *
     * Returns [null, null] when the value is absent or malformed, and always
     * returns the dates in chronological order so a reversed range still
     * selects records instead of silently matching nothing.
     *
     * @return array{0: ?string, 1: ?string}
     */
    public static function parseDateRange(?string $dateRange): array
    {
        if (!$dateRange || stripos($dateRange, ' to ') === false) {
            return [null, null];
        }

        $parts = preg_split('/\s+to\s+/i', $dateRange, 2);
        if (!$parts || count($parts) !== 2) {
            return [null, null];
        }

        $start = self::normalizeDate(trim($parts[0]));
        $end   = self::normalizeDate(trim($parts[1]));

        if ($start === null || $end === null) {
            return [null, null];
        }

        return $start <= $end ? [$start, $end] : [$end, $start];
    }

    private static function normalizeDate(string $value): ?string
    {
        if ($value === '') {
            return null;
        }

        try {
            return \Carbon\Carbon::parse($value)->format('Y-m-d');
        } catch (\Throwable $e) {
            return null;
        }
    }
}

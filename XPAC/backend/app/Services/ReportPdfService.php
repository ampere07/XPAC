<?php

namespace App\Services;

use Barryvdh\DomPDF\Facade\Pdf;
use App\Support\ChannelLogger;
use App\Support\ReportTheme;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReportPdfService
{
    /** Where generated attachments live until the email queue consumes them. */
    public const ATTACHMENT_DIR = 'app/report-attachments';

    private string $brand;

    public function __construct(?string $brand = null)
    {
        // Deliberately NOT config('app.name'): that is the Laravel instance name
        // ("Testing Development" on this deployment) and would end up printed as
        // the company name on documents mailed to customers.
        $this->brand = $brand ?: (string) config('reports.brand', 'ATSS FIBER');
    }

    /**
     * Rows printed in the detail listing. Aggregates are computed in SQL over
     * the full result set and are never affected by this value.
     */
    public function rowLimit(): int
    {
        return max(1, (int) config('reports.pdf_row_limit', 350));
    }

    /**
     * "Generated" stamp, in the timezone every report schedule is interpreted in.
     *
     * Shared with ReportMetricsService so the summary body and the page footer
     * can never disagree about when the document was produced.
     */
    public static function generatedAtLabel(): string
    {
        $now = now((string) config('reports.timezone', 'Asia/Manila'));

        return $now->format('F d, Y h:i A') . ' (' . self::timezoneLabel() . ')';
    }

    /**
     * Short UTC-offset label for the reporting timezone, e.g. "GMT+8".
     *
     * Derived from the real offset rather than hard-coded, so the label stays
     * truthful if reports.timezone is ever changed.
     */
    public static function timezoneLabel(): string
    {
        $minutes = (int) round(now((string) config('reports.timezone', 'Asia/Manila'))->getOffset() / 60);

        $sign  = $minutes < 0 ? '-' : '+';
        $hours = intdiv(abs($minutes), 60);
        $rest  = abs($minutes) % 60;

        return 'GMT' . $sign . $hours
            . ($rest > 0 ? ':' . str_pad((string) $rest, 2, '0', STR_PAD_LEFT) : '');
    }

    /**
     * Generate the PDF for a report, choosing the summary or tabular layout.
     *
     * @return string absolute path to the generated file
     */
    public function generate($report): string
    {
        return ReportDataset::isSummary($report->report_type ?? null)
            ? $this->generateSummaryPdf($report)
            : $this->generateTabularPdf($report);
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    public function generateSummaryPdf($report): string
    {
        $metrics = (new ReportMetricsService())->build($report->date_range ?? null);

        $this->logValidation($report, $metrics['validation']);

        $pdf = $this->render('pdf.summary_report', [
            'brand'   => $this->brand,
            'meta'    => $this->meta($report, $metrics['generated_at']),
            'metrics' => $metrics,
        ], 'portrait');

        return $this->save($pdf, $report, 'Summary');
    }

    // ── Tabular ───────────────────────────────────────────────────────────────

    public function generateTabularPdf($report): string
    {
        $dataset = ReportDataset::resolve((string) $report->report_type);
        [$startDate, $endDate] = ReportDataset::parseDateRange($report->date_range ?? null);

        $headers    = $this->headers($dataset);
        $aggregates = $this->aggregates($dataset, $startDate, $endDate);
        $listing    = $this->listing($dataset, $startDate, $endDate, $aggregates['record_count']);
        $validation = $this->validateTabular($dataset, $aggregates, $startDate, $endDate);

        $this->logValidation($report, $validation);

        $generatedAt = self::generatedAtLabel();

        $pdf = $this->render('pdf.tabular_report', [
            'brand'      => $this->brand,
            'meta'       => $this->meta($report, $generatedAt),
            'headers'    => $headers,
            'rows'       => $listing['rows'],
            'aggregates' => $aggregates,
            'listing'    => [
                'shown'     => count($listing['rows']),
                'total'     => $aggregates['record_count'],
                'limit'     => $this->rowLimit(),
                'truncated' => $listing['truncated'],
            ],
            'rangeLabel' => $this->rangeLabel($startDate, $endDate),
            'validation' => $validation,
        ], 'landscape');

        return $this->save($pdf, $report, $report->report_type);
    }

    /**
     * BC alias — routes/api.php called this name, which never existed and so
     * silently swallowed every non-summary migration attempt.
     */
    public function generateTablePdf($report): string
    {
        return $this->generateTabularPdf($report);
    }

    // ── Aggregation ───────────────────────────────────────────────────────────

    /**
     * Count and sum in the DATABASE over the whole filtered set.
     *
     * This is the fix for the old behaviour, where rows were capped at 2000 and
     * any total derived from them silently described a truncated slice. Totals
     * here are independent of how many rows the PDF ends up printing.
     */
    private function aggregates(array $dataset, ?string $start, ?string $end): array
    {
        $selects = [DB::raw('COUNT(*) AS record_count')];
        foreach ($dataset['numeric'] as $column) {
            $selects[] = DB::raw("COALESCE(SUM(COALESCE(`{$column}`, 0)), 0) AS sum_{$column}");
        }

        $totals = ReportDataset::query($dataset, $start, $end)->get($selects)->first();

        $recordCount = (int) ($totals->record_count ?? 0);

        $sums = [];
        foreach ($dataset['numeric'] as $column) {
            $sums[$column] = (float) ($totals->{'sum_' . $column} ?? 0);
        }

        return [
            'record_count' => $recordCount,
            'sums'         => $sums,
            'group_by'     => $dataset['group_by'],
            'group_label'  => $dataset['group_by'] ? $this->humanize($dataset['group_by']) : null,
            'groups'       => $dataset['group_by']
                ? $this->groups($dataset, $start, $end)
                : [],
        ];
    }

    /**
     * Subtotals per group value, from a single GROUP BY.
     *
     * NULL / blank group values fold into one "Unspecified" bucket so the
     * subtotals always add back up to record_count — no record is dropped and
     * none is counted twice.
     */
    private function groups(array $dataset, ?string $start, ?string $end): array
    {
        $groupBy = $dataset['group_by'];

        $selects = [
            DB::raw("`{$groupBy}` AS group_value"),
            DB::raw('COUNT(*) AS group_count'),
        ];
        foreach ($dataset['numeric'] as $column) {
            $selects[] = DB::raw("COALESCE(SUM(COALESCE(`{$column}`, 0)), 0) AS sum_{$column}");
        }

        $rows = ReportDataset::query($dataset, $start, $end)
            ->groupBy($groupBy)
            ->orderByDesc(DB::raw('COUNT(*)'))
            ->get($selects);

        $merged = [];
        foreach ($rows as $row) {
            $label = trim((string) ($row->group_value ?? ''));
            $label = $label === '' ? 'Unspecified' : $label;

            if (!isset($merged[$label])) {
                $merged[$label] = ['label' => $label, 'count' => 0, 'sums' => []];
                foreach ($dataset['numeric'] as $column) {
                    $merged[$label]['sums'][$column] = 0.0;
                }
            }

            $merged[$label]['count'] += (int) $row->group_count;
            foreach ($dataset['numeric'] as $column) {
                $merged[$label]['sums'][$column] += (float) $row->{'sum_' . $column};
            }
        }

        $groups = array_values($merged);

        usort($groups, function ($a, $b) {
            if ($a['label'] === 'Unspecified') {
                return 1;
            }
            if ($b['label'] === 'Unspecified') {
                return -1;
            }

            return $b['count'] <=> $a['count'] ?: strcmp($a['label'], $b['label']);
        });

        return $groups;
    }

    /** Fetch the display page: newest first, capped, with a truncation flag. */
    private function listing(array $dataset, ?string $start, ?string $end, int $recordCount): array
    {
        $query = ReportDataset::query($dataset, $start, $end);

        // Most recent first, then the dataset's tiebreakers so the order is
        // total and the LIMIT returns a stable page.
        $query->orderByDesc($dataset['order_column']);
        foreach ($dataset['tiebreakers'] as $tiebreaker) {
            $query->orderByDesc($tiebreaker);
        }

        $rows = $query
            ->limit($this->rowLimit())
            ->get($dataset['columns'])
            ->map(fn ($row) => (array) $row)
            ->all();

        return [
            'rows'      => $rows,
            'truncated' => $recordCount > count($rows),
        ];
    }

    // ── Presentation helpers ──────────────────────────────────────────────────

    /** Column definitions with an inferred display format per column. */
    private function headers(array $dataset): array
    {
        $money   = array_flip($dataset['money']);
        $numeric = array_flip($dataset['numeric']);

        return array_map(function (string $column) use ($money, $numeric) {
            if (isset($money[$column])) {
                $format = 'money';
            } elseif (isset($numeric[$column])) {
                $format = 'int';
            } elseif (Str::endsWith($column, ['_at', '_date', 'timestamp', 'date_time'])
                      || $column === 'date') {
                $format = Str::endsWith($column, '_date') && $column !== 'payment_date'
                    ? 'date'
                    : 'datetime';
            } else {
                $format = 'text';
            }

            return [
                'key'    => $column,
                'label'  => $this->humanize($column),
                'align'  => in_array($format, ['money', 'int'], true) ? 'right' : 'left',
                'format' => $format,
            ];
        }, $dataset['columns']);
    }

    private function humanize(string $column): string
    {
        $overrides = [
            'id'                => 'ID',
            'sn'                => 'Serial No.',
            'or_no'             => 'OR No.',
            'account_no'        => 'Account No.',
            'account_id'        => 'Account ID',
            'application_id'    => 'Application ID',
            'ticket_id'         => 'Ticket ID',
            'reference_no'      => 'Reference No.',
            'lcpnap'            => 'LCP/NAP',
            'vlan'              => 'VLAN',
            'date_time'         => 'Date & Time',
            'created_at'        => 'Created',
            'ewallet_type'      => 'E-Wallet',
            'processed_by_user' => 'Processed By',
            // Combined Transactions union aliases
            'source'            => 'Source',
            'record_id'         => 'Record ID',
            'account_ref'       => 'Account',
            'transacted_at'     => 'Transaction Date',
            'processed_by'      => 'Processed By',
            'amount'            => 'Amount',
        ];

        return $overrides[$column] ?? Str::title(str_replace('_', ' ', $column));
    }

    private function meta($report, string $generatedAt): array
    {
        return [
            'report_name'  => (string) ($report->report_name ?? 'Report'),
            'report_type'  => (string) ($report->report_type ?? ''),
            'schedule'     => $this->scheduleLabel($report),
            'date_range'   => (string) ($report->date_range ?? ''),
            'send_to'      => (string) ($report->send_to ?? ''),
            'created_by'   => (string) ($report->created_by ?? ''),
            'generated_at' => $generatedAt,
        ];
    }

    /** Human-readable schedule, e.g. "Every Month on day 15 at 5:40 PM (GMT+8)". */
    private function scheduleLabel($report): string
    {
        $schedule = trim((string) ($report->report_schedule ?? ''));
        if ($schedule === '') {
            return '';
        }

        $parts = [$schedule];

        if (method_exists($report, 'scheduleDetail')) {
            $detail = $report->scheduleDetail();
            if ($detail !== '') {
                $parts[] = $detail;
            }
        }

        if (!empty($report->report_time)) {
            try {
                $parts[] = 'at ' . \Carbon\Carbon::parse($report->report_time)->format('g:i A')
                    . ' (' . self::timezoneLabel() . ')';
            } catch (\Throwable $e) {
                $parts[] = 'at ' . $report->report_time;
            }
        }

        return implode(' ', $parts);
    }

    private function rangeLabel(?string $start, ?string $end): string
    {
        if (!$start || !$end) {
            return 'All time (no date range set)';
        }

        try {
            return \Carbon\Carbon::parse($start)->format('M d, Y')
                . ' – ' . \Carbon\Carbon::parse($end)->format('M d, Y');
        } catch (\Throwable $e) {
            return "{$start} – {$end}";
        }
    }

    // ── Validation ────────────────────────────────────────────────────────────

    /**
     * Independently re-derive the record count and each sum, then compare them
     * against the numbers about to be rendered. A mismatch is surfaced on the
     * PDF and logged rather than shipped as a plausible-looking wrong figure.
     */
    private function validateTabular(array $dataset, array $aggregates, ?string $start, ?string $end): array
    {
        $issues = [];

        if ($aggregates['group_by']) {
            $groupSum = array_sum(array_column($aggregates['groups'], 'count'));
            if ($groupSum !== $aggregates['record_count']) {
                $issues[] = sprintf(
                    'Subtotals by %s add up to %d records but the dataset holds %d.',
                    $aggregates['group_label'], $groupSum, $aggregates['record_count']
                );
            }

            foreach ($dataset['numeric'] as $column) {
                $groupTotal = array_sum(array_map(
                    fn ($g) => (float) ($g['sums'][$column] ?? 0),
                    $aggregates['groups']
                ));

                if (abs($groupTotal - $aggregates['sums'][$column]) > 0.01) {
                    $issues[] = sprintf(
                        '"%s" subtotals (%.2f) do not reconcile with the grand total (%.2f).',
                        $this->humanize($column), $groupTotal, $aggregates['sums'][$column]
                    );
                }
            }
        }

        // Second, independent COUNT(*) — catches a bad date filter or a query
        // mutation that only affects one of the two aggregate passes.
        $recount = (int) ReportDataset::query($dataset, $start, $end)->count();
        if ($recount !== $aggregates['record_count']) {
            $issues[] = sprintf(
                'Record count is unstable: %d on the aggregate pass, %d on re-count.',
                $aggregates['record_count'], $recount
            );
        }

        if ($start && $end && !$dataset['date_column']) {
            $issues[] = sprintf(
                'Table "%s" has no usable date column, so the date range was not applied.',
                $dataset['table']
            );
        }

        return ['ok' => $issues === [], 'issues' => $issues];
    }

    private function logValidation($report, array $validation): void
    {
        if ($validation['ok']) {
            return;
        }

        // Dedicated channel, not the default stack: LOG_LEVEL=error on this
        // deployment would discard a warning, and a report whose subtotals do not
        // reconcile is precisely the thing that must not vanish.
        ChannelLogger::for('reports')->warning(
            'Report calculation validation issues',
            [
                'report_id'   => $report->id ?? null,
                'report_name' => $report->report_name ?? null,
                'report_type' => $report->report_type ?? null,
                'issues'      => $validation['issues'],
            ]
        );
    }

    // ── Output ────────────────────────────────────────────────────────────────

    /**
     * Render and persist the PDF.
     *
     * Files go to storage/app/report-attachments rather than the system temp
     * directory: the email queue worker is a separate process (and may be a
     * separate container), and OS temp cleaners were free to delete a queued
     * attachment before it was ever sent.
     */
    private function save($pdf, $report, ?string $typeLabel): string
    {
        $directory = storage_path(self::ATTACHMENT_DIR);
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new \RuntimeException("Unable to create attachment directory: {$directory}");
        }

        $path = $directory . DIRECTORY_SEPARATOR . $this->fileName($report, $typeLabel);

        $output = $this->withMemoryLimit(fn () => $this->stampPageNumbers($pdf));

        if ($output === '' || strncmp($output, '%PDF', 4) !== 0) {
            throw new \RuntimeException('PDF renderer produced invalid output.');
        }

        if (file_put_contents($path, $output) === false) {
            throw new \RuntimeException("Unable to write PDF to {$path}");
        }

        return $path;
    }

    /**
     * Build a configured dompdf instance.
     *
     * Font subsetting is switched on explicitly: dompdf ships with it disabled,
     * which embeds the full ~700 KB DejaVu Sans family into every document.
     * These PDFs are email attachments, so the size matters.
     */
    private function render(string $view, array $data, string $orientation)
    {
        // Brand colours come from the active palette, so documents match the UI
        // instead of being locked to the hard-coded indigo.
        $data['theme'] = ReportTheme::resolve();

        return Pdf::loadView($view, $data)
            ->setPaper('a4', $orientation)
            ->setOptions([
                'defaultFont'            => 'DejaVu Sans',
                'isFontSubsettingEnabled' => true,
                'isRemoteEnabled'        => false,
                'isHtml5ParserEnabled'   => true,
                'dpi'                    => 96,
            ]);
    }

    /**
     * Render, then stamp "Page X of Y" onto every page.
     *
     * The total page count cannot come from CSS here: dompdf resolves
     * counter(pages) inside a position:fixed block before pagination finishes,
     * which is why the footer printed "Page 1 of 0". page_text() runs after
     * layout, when the real total is known, and is dompdf's supported idiom for
     * this.
     */
    private function stampPageNumbers($pdf): string
    {
        $dompdf = $pdf->getDomPDF();
        $dompdf->render();

        $canvas = $dompdf->getCanvas();
        $font   = $dompdf->getFontMetrics()->getFont('DejaVu Sans', 'normal');

        if ($font) {
            $canvas->page_text(
                $canvas->get_width() - 120,
                $canvas->get_height() - 38,
                'Page {PAGE_NUM} of {PAGE_COUNT}',
                $font,
                7.5,
                [0.6, 0.6, 0.6]
            );
        }

        return (string) $dompdf->output();
    }

    /**
     * Run the render under a raised memory ceiling, restoring the previous
     * value afterwards so one report cannot leave the whole worker process with
     * an inflated limit.
     */
    private function withMemoryLimit(callable $callback)
    {
        $previous = ini_get('memory_limit');
        $target   = (string) config('reports.pdf_memory_limit', '768M');

        if ($previous !== '-1' && $target !== '') {
            @ini_set('memory_limit', $target);
        }

        try {
            return $callback();
        } finally {
            if ($previous !== false && $previous !== '-1' && $target !== '') {
                @ini_set('memory_limit', $previous);
            }
        }
    }

    /** Safe, unique, human-readable filename. */
    private function fileName($report, ?string $typeLabel): string
    {
        $name = Str::slug((string) ($report->report_name ?? ''), '_');
        if ($name === '') {
            $name = Str::slug((string) $typeLabel, '_') ?: 'report';
        }

        $name = Str::limit($name, 60, '');
        $stamp = now(config('reports.timezone', 'Asia/Manila'))->format('Ymd_His');
        $id = $report->id ?? 'new';

        return "{$name}_{$id}_{$stamp}.pdf";
    }
}

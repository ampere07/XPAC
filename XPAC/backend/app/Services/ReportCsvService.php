<?php

namespace App\Services;

use Illuminate\Support\Str;

/**
 * CSV twin of ReportPdfService.
 *
 * Both resolve their record set through ReportDataset and their summary figures
 * through ReportMetricsService, so a CSV and the PDF generated for the same
 * report always describe the same records with the same totals.
 *
 * Unlike the PDF the CSV is not row-capped: it streams the complete result set
 * in chunks, which is why the PDF points readers here when its listing is
 * truncated.
 */
class ReportCsvService
{
    /**
     * @return string absolute path to the generated CSV
     */
    public function generateFile($reportType, $dateRange = null): string
    {
        $directory = storage_path(ReportPdfService::ATTACHMENT_DIR);
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new \RuntimeException("Unable to create attachment directory: {$directory}");
        }

        $slug = Str::slug((string) $reportType, '_') ?: 'report';
        $tempPath = $directory . DIRECTORY_SEPARATOR
            . $slug . '_' . now(config('reports.timezone', 'Asia/Manila'))->format('Ymd_His') . '.csv';

        $handle = fopen($tempPath, 'w');
        if ($handle === false) {
            throw new \RuntimeException("Unable to open {$tempPath} for writing.");
        }

        // BOM so Excel opens UTF-8 content (₱, ñ) correctly.
        fwrite($handle, "\xEF\xBB\xBF");

        try {
            if (ReportDataset::isSummary($reportType)) {
                $this->writeSummary($handle, $dateRange);
            } else {
                $this->writeRecords($handle, (string) $reportType, $dateRange);
            }
        } catch (\Throwable $e) {
            fclose($handle);
            @unlink($tempPath);
            throw $e;
        }

        fclose($handle);

        return $tempPath;
    }

    /**
     * Full record listing plus a reconciling subtotal block.
     */
    private function writeRecords($handle, string $reportType, $dateRange): void
    {
        $dataset = ReportDataset::resolve($reportType);
        [$startDate, $endDate] = ReportDataset::parseDateRange($dateRange);

        $columns = $dataset['columns'];
        fputcsv($handle, $columns);

        $written = 0;
        $sums = array_fill_keys($dataset['numeric'], 0.0);
        $groups = [];
        $groupBy = $dataset['group_by'];

        $query = ReportDataset::query($dataset, $startDate, $endDate)
            ->orderBy($dataset['order_column']);

        // chunk() paginates with LIMIT/OFFSET, so the ordering MUST be total or
        // rows get skipped and duplicated across chunk boundaries. Several of
        // these datasets order on a non-unique date column, so the dataset's
        // tiebreakers are appended to make the order total.
        foreach ($dataset['tiebreakers'] as $tiebreaker) {
            $query->orderBy($tiebreaker);
        }

        $query
            ->chunk(500, function ($rows) use ($handle, $columns, &$written, &$sums, &$groups, $groupBy, $dataset) {
                foreach ($rows as $row) {
                    $record = (array) $row;

                    $line = [];
                    foreach ($columns as $column) {
                        $line[] = $record[$column] ?? null;
                    }
                    fputcsv($handle, $line);
                    $written++;

                    foreach ($dataset['numeric'] as $numericColumn) {
                        $sums[$numericColumn] += (float) ($record[$numericColumn] ?? 0);
                    }

                    if ($groupBy !== null) {
                        $label = trim((string) ($record[$groupBy] ?? ''));
                        $label = $label === '' ? 'Unspecified' : $label;

                        if (!isset($groups[$label])) {
                            $groups[$label] = ['count' => 0, 'sums' => array_fill_keys($dataset['numeric'], 0.0)];
                        }
                        $groups[$label]['count']++;
                        foreach ($dataset['numeric'] as $numericColumn) {
                            $groups[$label]['sums'][$numericColumn] += (float) ($record[$numericColumn] ?? 0);
                        }
                    }
                }
            });

        // ── Totals block ─────────────────────────────────────────────────────
        fputcsv($handle, []);
        fputcsv($handle, ['TOTALS']);
        fputcsv($handle, ['Total Records', $written]);
        foreach ($dataset['numeric'] as $numericColumn) {
            fputcsv($handle, ['Total ' . $numericColumn, round($sums[$numericColumn], 2)]);
        }

        if ($groups !== []) {
            uasort($groups, fn ($a, $b) => $b['count'] <=> $a['count']);

            fputcsv($handle, []);
            fputcsv($handle, ['SUBTOTALS BY ' . strtoupper(str_replace('_', ' ', (string) $groupBy))]);
            fputcsv($handle, array_merge([$groupBy, 'Records'], array_map(
                fn ($c) => 'Total ' . $c,
                $dataset['numeric']
            )));

            $checkCount = 0;
            foreach ($groups as $label => $group) {
                $line = [$label, $group['count']];
                foreach ($dataset['numeric'] as $numericColumn) {
                    $line[] = round($group['sums'][$numericColumn], 2);
                }
                fputcsv($handle, $line);
                $checkCount += $group['count'];
            }

            $line = ['GRAND TOTAL', $checkCount];
            foreach ($dataset['numeric'] as $numericColumn) {
                $line[] = round($sums[$numericColumn], 2);
            }
            fputcsv($handle, $line);

            if ($checkCount !== $written) {
                fputcsv($handle, []);
                fputcsv($handle, [
                    'WARNING',
                    "Subtotals total {$checkCount} records but {$written} rows were written.",
                ]);
            }
        }
    }

    /**
     * Summary CSV: one section at a time with its own subtotals, mirroring the
     * PDF layout instead of the old single unreadable header/value pair of rows.
     */
    private function writeSummary($handle, $dateRange): void
    {
        $metrics = (new ReportMetricsService())->build($dateRange);

        fputcsv($handle, ['Reporting Period', $metrics['range']['label']]);
        fputcsv($handle, ['Generated', $metrics['generated_at']]);
        fputcsv($handle, ['Records Covered', $metrics['totals']['records']]);
        fputcsv($handle, ['Total Collected', round($metrics['totals']['collected'], 2)]);

        if (!$metrics['validation']['ok']) {
            fputcsv($handle, []);
            fputcsv($handle, ['VALIDATION WARNINGS']);
            foreach ($metrics['validation']['issues'] as $issue) {
                fputcsv($handle, ['', $issue]);
            }
        }

        foreach ($metrics['sections'] as $section) {
            fputcsv($handle, []);
            fputcsv($handle, [strtoupper($section['title'])]);

            if ($section['subtitle']) {
                fputcsv($handle, ['', $section['subtitle']]);
            }
            if (!$section['range_applies']) {
                fputcsv($handle, ['', 'Current state — not filtered by the reporting period.']);
            }

            fputcsv($handle, array_map(fn ($c) => $c['label'], $section['columns']));

            foreach ($section['rows'] as $row) {
                fputcsv($handle, array_map(
                    fn ($c) => $this->csvValue($row[$c['key']] ?? null, $c),
                    $section['columns']
                ));
            }

            fputcsv($handle, array_map(function ($c) use ($section) {
                if ($c['key'] === 'label') {
                    return 'TOTAL';
                }

                return array_key_exists($c['key'], $section['total'])
                    ? $this->csvValue($section['total'][$c['key']], $c)
                    : '';
            }, $section['columns']));

            foreach ($section['highlights'] as $highlight) {
                fputcsv($handle, ['', $highlight['label'], $highlight['value']]);
            }
        }
    }

    private function csvValue($value, array $column)
    {
        if ($value === null) {
            return '';
        }

        return match ($column['format'] ?? 'text') {
            'money'   => round((float) $value, 2),
            'percent' => round((float) $value, 1),
            'int'     => (int) $value,
            default   => $value,
        };
    }

    // ── Backwards-compatible shims ────────────────────────────────────────────

    /** @deprecated Use ReportDataset::parseDateRange(). */
    public function parseDateRange($dateRange): array
    {
        return ReportDataset::parseDateRange($dateRange);
    }

    /**
     * Flat "Metric => value" map, now sourced from the corrected calculations.
     *
     * @deprecated Prefer ReportMetricsService::build() for the structured form.
     */
    public function getSummaryMetrics($dateRange = null): array
    {
        return (new ReportMetricsService())->build($dateRange)['flat'];
    }
}

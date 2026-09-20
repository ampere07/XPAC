@php
    /**
     * Record-listing report PDF (Manual Transaction, Payment Portal, Inventory,
     * Job Order, Service Order, Work Order).
     *
     * Expects:
     *   $brand       string
     *   $meta        array{report_name,report_type,schedule,date_range,send_to,created_by,generated_at}
     *   $headers     array<array{key,label,align,format}>
     *   $rows        array<array<string,mixed>>   the (possibly capped) display page
     *   $aggregates  array{record_count,sums,groups,group_by,group_label}
     *   $listing     array{shown,total,limit,truncated}
     *   $rangeLabel  string
     *   $validation  array{ok,issues}
     */
    $fmt = function ($value, string $format) {
        if ($value === null || $value === '') {
            return null;
        }
        if ($format === 'money') {
            return '₱' . number_format((float) $value, 2);
        }
        if ($format === 'int') {
            return number_format((float) $value, 0);
        }
        if ($format === 'datetime') {
            try {
                return \Carbon\Carbon::parse($value)->format('m/d/Y h:i A');
            } catch (\Throwable $e) {
                return (string) $value;
            }
        }
        if ($format === 'date') {
            try {
                return \Carbon\Carbon::parse($value)->format('m/d/Y');
            } catch (\Throwable $e) {
                return (string) $value;
            }
        }

        // Long free-text fields (remarks, instructions) would otherwise blow the
        // column widths apart in landscape A4.
        $text = trim((string) $value);

        return \Illuminate\Support\Str::limit($text, 60);
    };
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $meta['report_name'] }}</title>
    @include('pdf.partials._styles', ['pageMargin' => '24mm 10mm 18mm 10mm'])
    <style>
        table.data thead th { font-size: 6.9px; padding: 1.4mm 1.2mm; }
        table.data tbody td { font-size: 6.9px; padding: 1.1mm 1.2mm; word-wrap: break-word; }
        table.data tfoot td { font-size: 7.4px; padding: 1.5mm 1.2mm; }
        table.data thead { display: table-header-group; }
        table.data tfoot { display: table-row-group; }
        .row-index { color: #9ca3af; font-size: 6.4px; }
    </style>
</head>
<body>

<div class="page-header">
    <table style="width:100%; border-collapse:collapse;">
        <tr>
            <td style="border:none; padding:0;" class="brand">{{ $brand }}</td>
            <td style="border:none; padding:0;" class="doc-title">
                {{ $meta['report_type'] }} Report &middot; {{ $rangeLabel }}
            </td>
        </tr>
    </table>
</div>

<div class="page-footer">
    <table style="width:100%; border-collapse:collapse;">
        <tr>
            <td style="border:none; padding:0;">
                Generated {{ $meta['generated_at'] }} &middot; {{ $brand }} automated reporting
            </td>
        </tr>
    </table>
</div>

<h1 class="report-title">{{ $meta['report_name'] }}</h1>
<p class="report-subtitle">{{ $meta['report_type'] }} records for {{ $rangeLabel }}</p>

<table class="meta-table">
    <tr>
        <td class="meta-label">Report Type</td>
        <td class="meta-value">{{ $meta['report_type'] ?: '—' }}</td>
        <td class="meta-label">Reporting Period</td>
        <td class="meta-value">{{ $rangeLabel }}</td>
    </tr>
    <tr>
        <td class="meta-label">Schedule</td>
        <td class="meta-value">{{ $meta['schedule'] ?: 'Not scheduled' }}</td>
        <td class="meta-label">Generated</td>
        <td class="meta-value">{{ $meta['generated_at'] }}</td>
    </tr>
    <tr>
        <td class="meta-label">Created By</td>
        <td class="meta-value">{{ $meta['created_by'] ?: '—' }}</td>
        <td class="meta-label">Recipients</td>
        <td class="meta-value">{{ $meta['send_to'] ?: '—' }}</td>
    </tr>
</table>

@unless ($validation['ok'])
    <div class="alert">
        <div class="alert-title">Data validation warnings</div>
        <ul>
            @foreach ($validation['issues'] as $issue)
                <li>{{ $issue }}</li>
            @endforeach
        </ul>
    </div>
@endunless

{{-- ── Headline figures ──────────────────────────────────────────────────── --}}
@php
    $kpis = [['label' => 'Total Records', 'value' => number_format($aggregates['record_count'])]];

    foreach ($headers as $header) {
        if (!array_key_exists($header['key'], $aggregates['sums'])) {
            continue;
        }
        $kpis[] = [
            'label' => 'Total ' . $header['label'],
            'value' => $header['format'] === 'money'
                ? '₱' . number_format((float) $aggregates['sums'][$header['key']], 2)
                : number_format((float) $aggregates['sums'][$header['key']], 0),
        ];
    }
@endphp

<table class="kpi-table">
    <tr>
        @foreach ($kpis as $kpi)
            <td class="kpi-cell" style="width:{{ round(100 / count($kpis), 2) }}%;">
                <div class="kpi-label">{{ $kpi['label'] }}</div>
                <div class="kpi-value">{{ $kpi['value'] }}</div>
            </td>
        @endforeach
    </tr>
</table>

{{-- ── Subtotals by group ────────────────────────────────────────────────── --}}
@if (!empty($aggregates['groups']))
    <div class="section">
        <div class="section-heading">Subtotals by {{ $aggregates['group_label'] }}</div>
        <div class="section-subtitle">
            Computed over all {{ number_format($aggregates['record_count']) }} matching records —
            every record falls into exactly one group.
        </div>

        <table class="data">
            <thead>
                <tr>
                    <th>{{ $aggregates['group_label'] }}</th>
                    <th class="num">Records</th>
                    <th class="num">Share</th>
                    @foreach ($headers as $header)
                        @if (array_key_exists($header['key'], $aggregates['sums']))
                            <th class="num">{{ $header['label'] }}</th>
                        @endif
                    @endforeach
                </tr>
            </thead>
            <tbody>
                @foreach ($aggregates['groups'] as $index => $group)
                    <tr class="{{ $index % 2 === 1 ? 'zebra' : '' }}">
                        <td class="{{ $group['label'] === 'Unspecified' ? 'unspecified' : '' }}">{{ $group['label'] }}</td>
                        <td class="num">{{ number_format($group['count']) }}</td>
                        <td class="num">
                            {{ $aggregates['record_count'] > 0
                                ? number_format($group['count'] / $aggregates['record_count'] * 100, 1) . '%'
                                : '0.0%' }}
                        </td>
                        @foreach ($headers as $header)
                            @if (array_key_exists($header['key'], $aggregates['sums']))
                                <td class="num">
                                    {{ $header['format'] === 'money'
                                        ? '₱' . number_format((float) ($group['sums'][$header['key']] ?? 0), 2)
                                        : number_format((float) ($group['sums'][$header['key']] ?? 0), 0) }}
                                </td>
                            @endif
                        @endforeach
                    </tr>
                @endforeach
            </tbody>
            <tfoot>
                <tr class="grand">
                    <td>Grand Total ({{ count($aggregates['groups']) }} groups)</td>
                    <td class="num">{{ number_format($aggregates['record_count']) }}</td>
                    <td class="num">{{ $aggregates['record_count'] > 0 ? '100.0%' : '0.0%' }}</td>
                    @foreach ($headers as $header)
                        @if (array_key_exists($header['key'], $aggregates['sums']))
                            <td class="num">
                                {{ $header['format'] === 'money'
                                    ? '₱' . number_format((float) $aggregates['sums'][$header['key']], 2)
                                    : number_format((float) $aggregates['sums'][$header['key']], 0) }}
                            </td>
                        @endif
                    @endforeach
                </tr>
            </tfoot>
        </table>
    </div>
@endif

{{-- ── Record listing ───────────────────────────────────────────────────── --}}
<div class="section-heading" style="margin-top:4mm;">Record Detail</div>
<div class="section-subtitle">
    @if ($listing['truncated'])
        Showing the {{ number_format($listing['shown']) }} most recent of
        {{ number_format($listing['total']) }} records. The totals above cover all
        {{ number_format($listing['total']) }} records, not just this listing.
    @else
        All {{ number_format($listing['total']) }} matching records.
    @endif
</div>

@if ($listing['truncated'])
    <div class="alert" style="border-color:#fcd34d; background-color:#fffbeb; color:#92400e;">
        <div class="alert-title">Listing capped at {{ number_format($listing['limit']) }} rows</div>
        This report matched {{ number_format($listing['total']) }} records, which exceeds the per-PDF
        row cap. Counts, subtotals and grand totals shown above are calculated in the database across
        the full {{ number_format($listing['total']) }} records and remain accurate. Export the CSV for
        the complete row-by-row listing.
    </div>
@endif

@if (empty($rows))
    <div class="empty-state">No records matched {{ $rangeLabel }}.</div>
@else
    <table class="data">
        <thead>
            <tr>
                <th style="width:8mm;">#</th>
                @foreach ($headers as $header)
                    <th class="{{ $header['align'] === 'right' ? 'num' : '' }}">{{ $header['label'] }}</th>
                @endforeach
            </tr>
        </thead>
        <tbody>
            @foreach ($rows as $index => $row)
                <tr class="{{ $index % 2 === 1 ? 'zebra' : '' }}">
                    <td class="row-index">{{ number_format($index + 1) }}</td>
                    @foreach ($headers as $header)
                        @php $display = $fmt($row[$header['key']] ?? null, $header['format']); @endphp
                        <td class="{{ $header['align'] === 'right' ? 'num' : '' }}">
                            @if ($display === null)
                                <span class="muted">—</span>
                            @else
                                {{ $display }}
                            @endif
                        </td>
                    @endforeach
                </tr>
            @endforeach
        </tbody>
        <tfoot>
            <tr>
                <td></td>
                @foreach ($headers as $header)
                    <td class="{{ $header['align'] === 'right' ? 'num' : '' }}">
                        @if ($loop->first)
                            {{ $listing['truncated'] ? 'Page subtotal' : 'Total' }}
                            ({{ number_format(count($rows)) }} rows)
                        @elseif (array_key_exists($header['key'], $aggregates['sums']))
                            @php
                                $pageSum = array_sum(array_map(
                                    fn ($r) => (float) ($r[$header['key']] ?? 0),
                                    $rows
                                ));
                            @endphp
                            {{ $header['format'] === 'money'
                                ? '₱' . number_format($pageSum, 2)
                                : number_format($pageSum, 0) }}
                        @endif
                    </td>
                @endforeach
            </tr>
            @if ($listing['truncated'])
                <tr class="grand">
                    <td></td>
                    @foreach ($headers as $header)
                        <td class="{{ $header['align'] === 'right' ? 'num' : '' }}">
                            @if ($loop->first)
                                Grand total ({{ number_format($aggregates['record_count']) }} records)
                            @elseif (array_key_exists($header['key'], $aggregates['sums']))
                                {{ $header['format'] === 'money'
                                    ? '₱' . number_format((float) $aggregates['sums'][$header['key']], 2)
                                    : number_format((float) $aggregates['sums'][$header['key']], 0) }}
                            @endif
                        </td>
                    @endforeach
                </tr>
            @endif
        </tfoot>
    </table>
@endif

</body>
</html>

@php
    /**
     * Summary report PDF.
     *
     * Expects:
     *   $brand       string
     *   $meta        array{report_name,report_type,schedule,date_range,send_to,created_by,generated_at}
     *   $metrics     array from ReportMetricsService::build()
     */
    $fmt = function ($value, string $format) {
        if ($format === 'money') {
            return '₱' . number_format((float) $value, 2);
        }
        if ($format === 'percent') {
            return number_format((float) $value, 1) . '%';
        }
        if ($format === 'int') {
            return number_format((int) $value);
        }

        return (string) $value;
    };

    $sections   = $metrics['sections'] ?? [];
    $totals     = $metrics['totals'] ?? ['records' => 0, 'collected' => 0.0];
    $validation = $metrics['validation'] ?? ['ok' => true, 'issues' => []];
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $meta['report_name'] }}</title>
    @include('pdf.partials._styles', ['pageMargin' => '26mm 14mm 20mm 14mm'])
</head>
<body>

<div class="page-header">
    <table style="width:100%; border-collapse:collapse;">
        <tr>
            <td style="border:none; padding:0;" class="brand">{{ $brand }}</td>
            <td style="border:none; padding:0;" class="doc-title">
                {{ $meta['report_type'] }} Report &middot; {{ $metrics['range']['label'] }}
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
<p class="report-subtitle">
    Consolidated summary for {{ $metrics['range']['label'] }}
</p>

<table class="meta-table">
    <tr>
        <td class="meta-label">Report Type</td>
        <td class="meta-value">{{ $meta['report_type'] ?: '—' }}</td>
        <td class="meta-label">Reporting Period</td>
        <td class="meta-value">{{ $metrics['range']['label'] }}</td>
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
<table class="kpi-table">
    <tr>
        <td class="kpi-cell" style="width:33.33%;">
            <div class="kpi-label">Records Covered</div>
            <div class="kpi-value">{{ number_format($totals['records']) }}</div>
        </td>
        <td class="kpi-cell" style="width:33.33%;">
            <div class="kpi-label">Total Collected</div>
            <div class="kpi-value">₱{{ number_format($totals['collected'], 2) }}</div>
        </td>
        <td class="kpi-cell" style="width:33.33%;">
            <div class="kpi-label">Sections Reported</div>
            <div class="kpi-value">{{ count($sections) }}</div>
        </td>
    </tr>
</table>

@if (empty($sections))
    <div class="empty-state">
        No data is available for {{ $metrics['range']['label'] }}.
    </div>
@endif

{{-- ── Sections ──────────────────────────────────────────────────────────── --}}
@foreach ($sections as $section)
    <div class="section">
        <div class="section-heading">
            {{ $section['title'] }}
            @unless ($section['range_applies'])
                <span class="badge badge-warn">Current state</span>
            @endunless
        </div>

        @if ($section['subtitle'])
            <div class="section-subtitle">{{ $section['subtitle'] }}</div>
        @endif

        @if (!empty($section['highlights']))
            <table class="kpi-table">
                <tr>
                    @foreach ($section['highlights'] as $highlight)
                        <td class="kpi-cell" style="width:{{ round(100 / max(count($section['highlights']), 1), 2) }}%; border-left-width:1.6px;">
                            <div class="kpi-label">{{ $highlight['label'] }}</div>
                            <div class="kpi-value" style="font-size:11px;">
                                {{ $fmt($highlight['value'], $highlight['format']) }}
                            </div>
                        </td>
                    @endforeach
                </tr>
            </table>
        @endif

        <table class="data">
            <thead>
                <tr>
                    @foreach ($section['columns'] as $column)
                        <th class="{{ $column['align'] === 'right' ? 'num' : '' }}">{{ $column['label'] }}</th>
                    @endforeach
                </tr>
            </thead>
            <tbody>
                @forelse ($section['rows'] as $index => $row)
                    <tr class="{{ $index % 2 === 1 ? 'zebra' : '' }}">
                        @foreach ($section['columns'] as $column)
                            @php
                                $key   = $column['key'];
                                $value = $row[$key] ?? null;
                            @endphp
                            <td class="{{ $column['align'] === 'right' ? 'num' : '' }}{{ $key === 'label' && $value === 'Unspecified' ? ' unspecified' : '' }}">
                                @if ($value === null || $value === '')
                                    <span class="muted">—</span>
                                @else
                                    {{ $fmt($value, $column['format']) }}
                                @endif
                            </td>
                        @endforeach
                    </tr>
                @empty
                    <tr>
                        <td colspan="{{ count($section['columns']) }}" class="muted" style="text-align:center; padding:4mm 0;">
                            No records in this period.
                        </td>
                    </tr>
                @endforelse
            </tbody>
            <tfoot>
                <tr>
                    @foreach ($section['columns'] as $column)
                        @php $key = $column['key']; @endphp
                        <td class="{{ $column['align'] === 'right' ? 'num' : '' }}">
                            @if ($key === 'label')
                                Total ({{ number_format(count($section['rows'])) }}
                                {{ \Illuminate\Support\Str::plural('group', count($section['rows'])) }})
                            @elseif (array_key_exists($key, $section['total']))
                                {{ $fmt($section['total'][$key], $column['format']) }}
                            @endif
                        </td>
                    @endforeach
                </tr>
            </tfoot>
        </table>

        @if ($section['note'])
            <div class="section-note">{{ $section['note'] }}</div>
        @endif
    </div>
@endforeach

{{-- ── Grand total recap ─────────────────────────────────────────────────── --}}
@if (!empty($sections))
    <div class="section" style="margin-top:2mm;">
        <div class="section-heading">Grand Totals</div>
        <div class="section-subtitle">
            Period-activity sections only. Sections marked “Current state”, and subsets that
            re-slice records already counted above, are excluded so nothing is double counted.
        </div>

        <table class="data">
            <thead>
                <tr>
                    <th>Section</th>
                    <th class="num">Records</th>
                    <th class="num">Amount</th>
                </tr>
            </thead>
            <tbody>
                @php $rowIndex = 0; @endphp
                @foreach ($sections as $section)
                    @php
                        $isSubset = in_array($section['key'], ['pullout', 'service_order_concerns', 'payment_methods'], true);
                        $counted  = $section['range_applies'] && !$isSubset;
                        $amount   = null;
                        foreach ($section['columns'] as $column) {
                            if (($column['format'] ?? null) === 'money' && array_key_exists($column['key'], $section['total'])) {
                                $amount = $section['total'][$column['key']];
                                break;
                            }
                        }
                    @endphp
                    <tr class="{{ $rowIndex++ % 2 === 1 ? 'zebra' : '' }}">
                        <td>
                            {{ $section['title'] }}
                            @unless ($counted)
                                <span class="muted">(not included)</span>
                            @endunless
                        </td>
                        <td class="num {{ $counted ? '' : 'muted' }}">
                            {{ number_format((int) ($section['total']['count'] ?? 0)) }}
                        </td>
                        <td class="num {{ $counted ? '' : 'muted' }}">
                            {{ $amount === null ? '—' : '₱' . number_format((float) $amount, 2) }}
                        </td>
                    </tr>
                @endforeach
            </tbody>
            <tfoot>
                <tr class="grand">
                    <td>Grand Total</td>
                    <td class="num">{{ number_format($totals['records']) }}</td>
                    <td class="num">₱{{ number_format($totals['collected'], 2) }}</td>
                </tr>
            </tfoot>
        </table>

        <div class="section-note">
            The grand-total amount is money actually collected — successful manual transactions plus
            successful payment-portal payments. Pending, failed and cancelled amounts appear in their
            own sections but are deliberately excluded here.
        </div>
    </div>
@endif

</body>
</html>

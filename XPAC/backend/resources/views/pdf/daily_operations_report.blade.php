@php
    /**
     * Executive daily operations report — single page, A4 portrait.
     *
     * Renders identically under dompdf (barryvdh/laravel-dompdf) and Browsershot,
     * so the layout is table-based only: dompdf has no flexbox, no grid and no
     * CSS custom properties. Backgrounds are printed explicitly via
     * print-color-adjust for the headless-Chrome path.
     *
     * Expects (all optional — every value degrades to an empty state):
     *   $company       string
     *   $reportTitle   string
     *   $date          string|DateTimeInterface
     *   $preparedBy    string
     *   $kpis          array{installs:int, repairs:int, total_jobs:int, revenue:string|float}
     *   $technicians   array<array{name:string, installs:int, repairs:int, income:string|float}>
     *   $installations array<array{name:string, count:int, amount:string|float}>  // optional
     *   $repairs       array<array{name:string, count:int}>                       // optional
     *
     * $installations / $repairs drive the dual-column breakdown. When they are
     * not supplied they are derived from $technicians, so the caller only has to
     * pass the leaderboard.
     */

    // ── Normalisation ────────────────────────────────────────────────────────
    // Values arrive either numeric (from the query) or pre-formatted ("₱8,600.00"
    // from a cached payload). Strip everything that is not part of a number so
    // both shapes total correctly.
    $num  = fn ($v) => is_numeric($v) ? (float) $v : (float) preg_replace('/[^0-9.\-]/', '', (string) $v);
    $peso = fn ($v) => '₱' . number_format($num($v), 2);

    $company     = $company     ?? 'GO WISER';
    $reportTitle = $reportTitle ?? 'Daily Operations Report';
    $preparedBy  = $preparedBy  ?? '';

    try {
        $reportDate = \Illuminate\Support\Carbon::parse($date ?? now());
    } catch (\Throwable $e) {
        $reportDate = \Illuminate\Support\Carbon::now();
    }

    $kpis = array_merge(
        ['installs' => 0, 'repairs' => 0, 'total_jobs' => 0, 'revenue' => 0],
        $kpis ?? []
    );

    $technicians = collect($technicians ?? [])
        ->map(fn ($t) => [
            'name'     => $t['name'] ?? 'Unassigned',
            'installs' => (int) ($t['installs'] ?? 0),
            'repairs'  => (int) ($t['repairs'] ?? 0),
            'income'   => $num($t['income'] ?? 0),
        ])
        ->map(fn ($t) => $t + ['jobs' => $t['installs'] + $t['repairs']])
        ->sortByDesc('jobs')
        ->values();

    // One page is the hard requirement, so the leaderboard is capped and the
    // remainder is rolled into a single summary row rather than overflowing.
    $rowCap    = 12;
    $leaders   = $technicians->take($rowCap);
    $overflow  = $technicians->slice($rowCap);
    $peakJobs  = max(1, (int) $technicians->max('jobs'));

    // Dual-column breakdown — derived unless the caller passed detail rows.
    $installList = collect($installations ?? $technicians
            ->filter(fn ($t) => $t['installs'] > 0)
            ->map(fn ($t) => ['name' => $t['name'], 'count' => $t['installs'], 'amount' => $t['income']]))
        ->map(fn ($r) => [
            'name'   => $r['name'] ?? 'Unassigned',
            'count'  => (int) ($r['count'] ?? 0),
            'amount' => $num($r['amount'] ?? 0),
        ])
        ->sortByDesc('count')
        ->values();

    $repairList = collect($repairs ?? $technicians
            ->filter(fn ($t) => $t['repairs'] > 0)
            ->map(fn ($t) => ['name' => $t['name'], 'count' => $t['repairs']]))
        ->map(fn ($r) => [
            'name'  => $r['name'] ?? 'Unassigned',
            'count' => (int) ($r['count'] ?? 0),
        ])
        ->sortByDesc('count')
        ->values();

    $colCap    = 10;
    $isEmpty   = $technicians->isEmpty() && (int) $kpis['total_jobs'] === 0;
    $generated = \Illuminate\Support\Carbon::now()->format('M j, Y g:i A');
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $reportTitle }} — {{ $reportDate->format('M j, Y') }}</title>
    <style>
        /* Tight margins: the whole report has to clear 297mm in one page. */
        @page { margin: 9mm 9mm 12mm 9mm; }

        * { box-sizing: border-box; }

        body {
            /* DejaVu Sans is the only dompdf-bundled face carrying ₱ (U+20B1). */
            font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif;
            font-size: 9px;
            line-height: 1.35;
            color: #0f172a;
            margin: 0;
            padding: 0;
            /* Browsershot / headless Chrome drops backgrounds without this. */
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }

        .muted { color: #64748b; }
        .num   { text-align: right; }
        .mid   { text-align: center; }

        /* ── Header ─────────────────────────────────────────────────────────── */
        .head            { border-bottom: 1.6px solid #0f172a; padding-bottom: 5px; }
        .head .company   { font-size: 15px; font-weight: bold; letter-spacing: 0.5px; color: #0f172a; }
        .head .subtitle  { font-size: 9px; color: #475569; padding-top: 1px; }
        .head .meta      { font-size: 8px; color: #64748b; text-align: right; }
        .head .meta .day { font-size: 10px; font-weight: bold; color: #0f172a; }
        .accent          { height: 2px; background-color: #2563eb; width: 46px; margin-top: 4px; }

        /* ── KPI mini-cards ─────────────────────────────────────────────────── */
        .kpi-row  { margin-top: 8px; }
        .kpi-cell { width: 25%; padding: 0 2px; }
        .kpi      { border: 0.8px solid #e2e8f0; border-left-width: 3px; border-radius: 3px; padding: 5px 7px; }
        .kpi-label{ font-size: 7px; font-weight: bold; letter-spacing: 0.7px; text-transform: uppercase; }
        .kpi-value{ font-size: 15px; font-weight: bold; color: #0f172a; padding-top: 1px; }
        .kpi-value.money { font-size: 12.5px; }
        .kpi-foot { font-size: 7px; color: #94a3b8; }

        .kpi-blue   { background-color: #eff6ff; border-color: #bfdbfe; border-left-color: #2563eb; }
        .kpi-amber  { background-color: #fffbeb; border-color: #fde68a; border-left-color: #d97706; }
        .kpi-green  { background-color: #ecfdf5; border-color: #a7f3d0; border-left-color: #059669; }
        .kpi-purple { background-color: #f5f3ff; border-color: #ddd6fe; border-left-color: #7c3aed; }

        .t-blue   { color: #2563eb; }
        .t-amber  { color: #b45309; }
        .t-green  { color: #047857; }
        .t-purple { color: #6d28d9; }

        /* ── Section chrome ─────────────────────────────────────────────────── */
        .section     { margin-top: 9px; }
        .sec-title   { font-size: 10px; font-weight: bold; color: #0f172a; border-bottom: 1.2px solid #cbd5e1;
                       padding-bottom: 2px; margin-bottom: 4px; }
        .sec-title .count { font-size: 7.5px; font-weight: normal; color: #64748b; }

        /* ── Leaderboard ────────────────────────────────────────────────────── */
        .board th { background-color: #0f172a; color: #ffffff; font-size: 7.5px; font-weight: bold;
                    letter-spacing: 0.5px; text-transform: uppercase; padding: 4px 6px; text-align: left; }
        .board td { padding: 4px 6px; border-bottom: 0.5px solid #e2e8f0; font-size: 9px; }
        .board tr.zebra td { background-color: #f8fafc; }
        .board .name { font-weight: bold; }
        .board tfoot td { background-color: #f1f5f9; font-weight: bold; border-top: 1px solid #cbd5e1;
                          border-bottom: none; }

        .rank { width: 13px; height: 13px; border-radius: 7px; background-color: #e2e8f0; color: #475569;
                font-size: 7.5px; font-weight: bold; text-align: center; line-height: 13px; }
        .rank-1 { background-color: #facc15; color: #713f12; }
        .rank-2 { background-color: #cbd5e1; color: #334155; }
        .rank-3 { background-color: #d8b4a0; color: #7c2d12; }

        .bar      { background-color: #e2e8f0; height: 5px; border-radius: 3px; width: 100%; }
        .bar-fill { background-color: #2563eb; height: 5px; border-radius: 3px; }

        /* ── Dual-column breakdown ──────────────────────────────────────────── */
        .split-left  { width: 50%; padding-right: 4px; }
        .split-right { width: 50%; padding-left: 4px; }

        .mini th { font-size: 7px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase;
                   padding: 3px 5px; text-align: left; border-bottom: 1px solid #cbd5e1; }
        .mini td { padding: 3px 5px; font-size: 8.5px; border-bottom: 0.5px solid #eef2f6; }
        .mini .head-install { background-color: #eff6ff; color: #1e40af; }
        .mini .head-repair  { background-color: #fffbeb; color: #92400e; }
        .mini tfoot td { font-weight: bold; background-color: #f8fafc; border-bottom: none;
                         border-top: 1px solid #cbd5e1; }

        /* ── Empty state ────────────────────────────────────────────────────── */
        .empty      { border: 1px dashed #cbd5e1; background-color: #f8fafc; border-radius: 4px;
                      padding: 18px 10px; text-align: center; color: #64748b; margin-top: 10px; }
        .empty-lead { font-size: 11px; font-weight: bold; color: #475569; }
        .empty-sub  { font-size: 8.5px; padding-top: 2px; }
        .empty-row  { text-align: center; color: #94a3b8; font-size: 8px; padding: 8px 0; font-style: italic; }

        /* ── Signature + footer ─────────────────────────────────────────────── */
        .sign        { margin-top: 14px; }
        .sign-line   { border-top: 1px solid #0f172a; width: 62mm; padding-top: 2px; }
        .sign-name   { font-size: 9px; font-weight: bold; letter-spacing: 0.3px; }
        .sign-role   { font-size: 7.5px; color: #64748b; }

        /* bottom:0 (not a negative offset) keeps the footer inside the page box.
           dompdf anchors it to the bottom of the content area; headless Chrome
           spills a negative offset onto a second page. */
        .foot { position: fixed; bottom: 0; left: 0; right: 0; font-size: 7px; color: #94a3b8;
                border-top: 0.5px solid #e2e8f0; padding-top: 2px; }
    </style>
</head>
<body>

{{-- ── Repeating footer (dompdf renders position:fixed on every page) ──────── --}}
<div class="foot">
    <table>
        <tr>
            <td style="border:none;">{{ $company }} — {{ $reportTitle }}</td>
            <td style="border:none; text-align:right;">Generated {{ $generated }}</td>
        </tr>
    </table>
</div>

{{-- ── Header ─────────────────────────────────────────────────────────────── --}}
<div class="head">
    <table>
        <tr>
            <td>
                <div class="company">{{ $company }}</div>
                <div class="subtitle">{{ $reportTitle }}</div>
                <div class="accent"></div>
            </td>
            <td class="meta">
                <div class="day">{{ $reportDate->format('l, F j, Y') }}</div>
                <div>Report date {{ $reportDate->format('Y-m-d') }}</div>
            </td>
        </tr>
    </table>
</div>

{{-- ── KPI mini-cards ─────────────────────────────────────────────────────── --}}
<table class="kpi-row">
    <tr>
        <td class="kpi-cell">
            <div class="kpi kpi-blue">
                <div class="kpi-label t-blue">Total Installs</div>
                <div class="kpi-value">{{ number_format((int) $kpis['installs']) }}</div>
                <div class="kpi-foot">Completed installations</div>
            </div>
        </td>
        <td class="kpi-cell">
            <div class="kpi kpi-amber">
                <div class="kpi-label t-amber">Total Repairs</div>
                <div class="kpi-value">{{ number_format((int) $kpis['repairs']) }}</div>
                <div class="kpi-foot">Completed repairs</div>
            </div>
        </td>
        <td class="kpi-cell">
            <div class="kpi kpi-green">
                <div class="kpi-label t-green">Total Jobs</div>
                <div class="kpi-value">{{ number_format((int) $kpis['total_jobs']) }}</div>
                <div class="kpi-foot">Installs + repairs</div>
            </div>
        </td>
        <td class="kpi-cell">
            <div class="kpi kpi-purple">
                <div class="kpi-label t-purple">Total Income</div>
                <div class="kpi-value money">{{ $peso($kpis['revenue']) }}</div>
                <div class="kpi-foot">Installation revenue</div>
            </div>
        </td>
    </tr>
</table>

@if ($isEmpty)
    {{-- ── Empty state: no activity recorded for the day ───────────────────── --}}
    <div class="empty">
        <div class="empty-lead">No completed installations or repairs on this date.</div>
        <div class="empty-sub">
            Nothing was logged for {{ $reportDate->format('F j, Y') }}. Job orders closed after
            this report was generated will appear on the next run.
        </div>
    </div>
@else
    {{-- ── Technician performance leaderboard ──────────────────────────────── --}}
    <div class="section">
        <div class="sec-title">
            Technician Performance
            <span class="count">— {{ $technicians->count() }} {{ \Illuminate\Support\Str::plural('technician', $technicians->count()) }} active</span>
        </div>

        <table class="board">
            <thead>
                <tr>
                    <th style="width:16px;">#</th>
                    <th>Technician</th>
                    <th style="width:31%;">Workload</th>
                    <th style="width:9%;" class="num">Inst.</th>
                    <th style="width:9%;" class="num">Rep.</th>
                    <th style="width:11%;" class="num">Jobs</th>
                    <th style="width:16%;" class="num">Income</th>
                </tr>
            </thead>
            <tbody>
                @forelse ($leaders as $i => $tech)
                    @php $rank = $i + 1; @endphp
                    <tr class="{{ $i % 2 === 1 ? 'zebra' : '' }}">
                        <td><div class="rank {{ $rank <= 3 ? 'rank-' . $rank : '' }}">{{ $rank }}</div></td>
                        <td class="name">{{ $tech['name'] }}</td>
                        <td>
                            <div class="bar">
                                <div class="bar-fill" style="width:{{ max(3, round($tech['jobs'] / $peakJobs * 100)) }}%;"></div>
                            </div>
                        </td>
                        <td class="num">{{ $tech['installs'] ?: '—' }}</td>
                        <td class="num">{{ $tech['repairs'] ?: '—' }}</td>
                        <td class="num"><strong>{{ $tech['jobs'] }}</strong></td>
                        <td class="num {{ $tech['income'] > 0 ? '' : 'muted' }}">{{ $peso($tech['income']) }}</td>
                    </tr>
                @empty
                    <tr><td colspan="7" class="empty-row">No technician data available for this date.</td></tr>
                @endforelse

                @if ($overflow->isNotEmpty())
                    <tr>
                        <td></td>
                        <td class="muted" colspan="2">
                            + {{ $overflow->count() }} other {{ \Illuminate\Support\Str::plural('technician', $overflow->count()) }}
                        </td>
                        <td class="num muted">{{ $overflow->sum('installs') }}</td>
                        <td class="num muted">{{ $overflow->sum('repairs') }}</td>
                        <td class="num muted">{{ $overflow->sum('jobs') }}</td>
                        <td class="num muted">{{ $peso($overflow->sum('income')) }}</td>
                    </tr>
                @endif
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="3">Total</td>
                    <td class="num">{{ $technicians->sum('installs') }}</td>
                    <td class="num">{{ $technicians->sum('repairs') }}</td>
                    <td class="num">{{ $technicians->sum('jobs') }}</td>
                    <td class="num">{{ $peso($technicians->sum('income')) }}</td>
                </tr>
            </tfoot>
        </table>
    </div>

    {{-- ── Dual-column job breakdown ───────────────────────────────────────── --}}
    <div class="section">
        <table>
            <tr>
                <td class="split-left">
                    <div class="sec-title">
                        Completed Installations
                        <span class="count">— {{ $installList->sum('count') }} total</span>
                    </div>
                    <table class="mini">
                        <thead>
                            <tr class="head-install">
                                <th>Technician</th>
                                <th style="width:18%;" class="num">Qty</th>
                                <th style="width:34%;" class="num">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            @forelse ($installList->take($colCap) as $row)
                                <tr>
                                    <td>{{ $row['name'] }}</td>
                                    <td class="num">{{ $row['count'] }}</td>
                                    <td class="num">{{ $peso($row['amount']) }}</td>
                                </tr>
                            @empty
                                <tr><td colspan="3" class="empty-row">No installations completed.</td></tr>
                            @endforelse
                            @if ($installList->count() > $colCap)
                                <tr>
                                    <td class="muted">+ {{ $installList->count() - $colCap }} more</td>
                                    <td class="num muted">{{ $installList->slice($colCap)->sum('count') }}</td>
                                    <td class="num muted">{{ $peso($installList->slice($colCap)->sum('amount')) }}</td>
                                </tr>
                            @endif
                        </tbody>
                        @if ($installList->isNotEmpty())
                            <tfoot>
                                <tr>
                                    <td>Total</td>
                                    <td class="num">{{ $installList->sum('count') }}</td>
                                    <td class="num">{{ $peso($installList->sum('amount')) }}</td>
                                </tr>
                            </tfoot>
                        @endif
                    </table>
                </td>

                <td class="split-right">
                    <div class="sec-title">
                        Completed Repairs
                        <span class="count">— {{ $repairList->sum('count') }} total</span>
                    </div>
                    <table class="mini">
                        <thead>
                            <tr class="head-repair">
                                <th>Technician</th>
                                <th style="width:18%;" class="num">Qty</th>
                                <th style="width:34%;" class="num">Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            @php $repairTotal = max(1, $repairList->sum('count')); @endphp
                            @forelse ($repairList->take($colCap) as $row)
                                <tr>
                                    <td>{{ $row['name'] }}</td>
                                    <td class="num">{{ $row['count'] }}</td>
                                    <td class="num">{{ number_format($row['count'] / $repairTotal * 100, 1) }}%</td>
                                </tr>
                            @empty
                                <tr><td colspan="3" class="empty-row">No repairs completed.</td></tr>
                            @endforelse
                            @if ($repairList->count() > $colCap)
                                <tr>
                                    <td class="muted">+ {{ $repairList->count() - $colCap }} more</td>
                                    <td class="num muted">{{ $repairList->slice($colCap)->sum('count') }}</td>
                                    <td class="num muted">
                                        {{ number_format($repairList->slice($colCap)->sum('count') / $repairTotal * 100, 1) }}%
                                    </td>
                                </tr>
                            @endif
                        </tbody>
                        @if ($repairList->isNotEmpty())
                            <tfoot>
                                <tr>
                                    <td>Total</td>
                                    <td class="num">{{ $repairList->sum('count') }}</td>
                                    <td class="num">100.0%</td>
                                </tr>
                            </tfoot>
                        @endif
                    </table>
                </td>
            </tr>
        </table>
    </div>
@endif

{{-- ── Signature block ────────────────────────────────────────────────────── --}}
<div class="sign">
    <table>
        <tr>
            <td style="width:50%;">&nbsp;</td>
            <td style="width:50%;">
                <div class="sign-line">
                    <div class="sign-name">{{ $preparedBy ?: '—' }}</div>
                    <div class="sign-role">Prepared By</div>
                </div>
            </td>
        </tr>
    </table>
</div>

</body>
</html>

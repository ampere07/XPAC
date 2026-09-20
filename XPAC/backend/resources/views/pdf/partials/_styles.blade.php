@php
    /**
     * Shared print stylesheet for report PDFs (dompdf).
     *
     * dompdf notes that shape this stylesheet:
     *   * no flexbox / grid — layout is done with tables and inline-block
     *   * "DejaVu Sans" is the only bundled font with full UTF-8 coverage
     *   * position: fixed elements repeat on every page (used for the footer)
     *
     * Brand colours come from the active settings_color_palette via
     * ReportTheme, so a generated document matches whatever palette the UI is
     * running. Resolved defensively here too, so the partial still renders if a
     * caller forgets to pass it.
     *
     * Greys stay grey and warnings stay amber/red on purpose: neutral chrome and
     * semantic status colours must not shift with the brand colour.
     */
    $theme = $theme ?? \App\Support\ReportTheme::resolve();
@endphp
<style>
    @page {
        margin: {{ $pageMargin ?? '26mm 14mm 20mm 14mm' }};
    }

    * { box-sizing: border-box; }

    body {
        font-family: "DejaVu Sans", sans-serif;
        font-size: 9px;
        color: #1f2937;
        margin: 0;
        padding: 0;
        line-height: 1.45;
    }

    /* ── Repeating page header / footer ───────────────────────────────────── */

    .page-header {
        position: fixed;
        top: -18mm;
        left: 0;
        right: 0;
        height: 12mm;
        border-bottom: 1.2px solid {{ $theme['rule'] }};
        padding-bottom: 2mm;
    }

    .page-header .brand {
        font-size: 13px;
        font-weight: bold;
        color: {{ $theme['brand'] }};
        letter-spacing: 0.6px;
    }

    .page-header .doc-title {
        font-size: 8.5px;
        color: #6b7280;
        text-align: right;
    }

    .page-footer {
        position: fixed;
        bottom: -14mm;
        left: 0;
        right: 0;
        height: 10mm;
        border-top: 0.6px solid #e5e7eb;
        padding-top: 1.6mm;
        font-size: 7.5px;
        color: #9ca3af;
    }

    /*
     * "Page X of Y" is stamped by ReportPdfService::stampPageNumbers() via
     * dompdf's page_text(), not by CSS counters: counter(pages) evaluates to 0
     * inside a position:fixed block because dompdf resolves it before
     * pagination completes.
     */

    /* ── Title block ─────────────────────────────────────────────────────── */

    .report-title {
        font-size: 17px;
        font-weight: bold;
        color: #111827;
        margin: 0 0 1mm 0;
    }

    .report-subtitle {
        font-size: 9.5px;
        color: #6b7280;
        margin: 0 0 4mm 0;
    }

    .meta-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 5mm;
        background-color: #f9fafb;
        border: 0.6px solid #e5e7eb;
    }

    .meta-table td {
        padding: 1.7mm 2.4mm;
        font-size: 8.2px;
        vertical-align: top;
        border-bottom: 0.6px solid #f3f4f6;
    }

    .meta-table tr:last-child td { border-bottom: none; }

    .meta-table .meta-label {
        color: #6b7280;
        width: 20%;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        font-size: 7.4px;
        white-space: nowrap;
    }

    .meta-table .meta-value {
        color: #111827;
        font-weight: bold;
        width: 30%;
    }

    /* ── KPI cards ───────────────────────────────────────────────────────── */

    .kpi-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 2mm 0;
        margin: 0 -2mm 4mm -2mm;
    }

    .kpi-cell {
        border: 0.6px solid #e5e7eb;
        border-left: 2.4px solid {{ $theme['rule'] }};
        background-color: {{ $theme['kpi_bg'] }};
        padding: 2.4mm 2.8mm;
        vertical-align: top;
    }

    .kpi-label {
        font-size: 7.2px;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }

    .kpi-value {
        font-size: 14px;
        font-weight: bold;
        color: #111827;
        padding-top: 0.8mm;
    }

    /* ── Sections ────────────────────────────────────────────────────────── */

    .section {
        margin-bottom: 5mm;
        page-break-inside: avoid;
    }

    .section-heading {
        font-size: 10.5px;
        font-weight: bold;
        color: #111827;
        border-left: 2.4px solid {{ $theme['rule'] }};
        padding: 0 0 0 2.2mm;
        margin-bottom: 0.8mm;
    }

    .section-subtitle {
        font-size: 7.8px;
        color: #6b7280;
        padding-left: 2.2mm;
        margin-bottom: 1.8mm;
    }

    .section-note {
        font-size: 7.2px;
        color: #6b7280;
        font-style: italic;
        padding: 1.4mm 2mm;
        background-color: {{ $theme['note_bg'] }};
        border-left: 1.6px solid {{ $theme['rule_soft'] }};
        margin-top: 1.4mm;
    }

    .badge {
        display: inline-block;
        font-size: 6.6px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 0.5mm 1.4mm;
        border-radius: 1mm;
        background-color: {{ $theme['badge_bg'] }};
        color: {{ $theme['badge_text'] }};
    }

    /* Semantic, deliberately not themed. */
    .badge-warn { background-color: #fef3c7; color: #92400e; }

    /* ── Data tables ─────────────────────────────────────────────────────── */

    table.data {
        width: 100%;
        border-collapse: collapse;
    }

    table.data thead th {
        background-color: {{ $theme['head_bg'] }};
        color: {{ $theme['head_text'] }};
        font-size: 7.8px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        padding: 1.8mm 2mm;
        border-bottom: 1px solid {{ $theme['head_border'] }};
        border-right: 0.5px solid {{ $theme['head_border_soft'] }};
        text-align: left;
    }

    table.data thead th:last-child { border-right: none; }

    table.data tbody td {
        padding: 1.5mm 2mm;
        font-size: 8.2px;
        border-bottom: 0.5px solid #f3f4f6;
        border-right: 0.5px solid #f9fafb;
        vertical-align: top;
    }

    table.data tbody td:last-child { border-right: none; }

    table.data tbody tr.zebra td { background-color: #fbfbfd; }

    table.data tfoot td {
        padding: 1.9mm 2mm;
        font-size: 8.6px;
        font-weight: bold;
        color: #111827;
        background-color: #f3f4f6;
        border-top: 1.1px solid #9ca3af;
        border-bottom: 1.1px solid #9ca3af;
    }

    table.data tfoot tr.grand td {
        background-color: {{ $theme['total_bg'] }};
        color: {{ $theme['total_text'] }};
        border-top: 1.4px double {{ $theme['total_border'] }};
        border-bottom: 1.4px double {{ $theme['total_border'] }};
    }

    .num  { text-align: right; white-space: nowrap; }
    .ctr  { text-align: center; }
    .muted { color: #9ca3af; }
    .unspecified { color: #b45309; font-style: italic; }

    /* ── Alerts (semantic, not themed) ───────────────────────────────────── */

    .alert {
        border: 0.8px solid #fca5a5;
        background-color: #fef2f2;
        color: #991b1b;
        padding: 2.4mm 3mm;
        font-size: 8px;
        margin-bottom: 4mm;
    }

    .alert-title { font-weight: bold; margin-bottom: 1mm; }
    .alert ul { margin: 0; padding-left: 4mm; }

    .empty-state {
        text-align: center;
        color: #9ca3af;
        font-size: 9px;
        font-style: italic;
        padding: 8mm 0;
        border: 0.6px dashed #e5e7eb;
    }
</style>

{{-- One invoice: the header artwork, the banner, the customer table, the
     totals and the sign-off.

     Rendered once for a single-invoice PDF and once per invoice for a bundle,
     so an invoice reads identically either way.

     The page number and the footer are NOT here. Both are position:fixed, which
     Dompdf repeats on every page of the document — declaring them per invoice
     would draw a bundle's copies on top of each other. They belong to the
     document, and each document template carries one.

     Expects: $invoice, $customerPages, $showReferrer, $peso, $invoiceDateLabel,
              $billedToLabel, $periodLabel, $headerImage --}}
{{-- Header artwork: the ATSS FIBER mark and watermark, full page width. --}}
@if ($headerImage)
    <img class="header-art" src="{{ $headerImage }}" alt="">
@endif

<div class="sheet">

    @unless ($headerImage)
        {{-- Artwork missing: the invoice still has to be a usable document. --}}
        <div class="brand-fallback"><span class="name">ATSS FIBER</span></div>
    @endunless

    <div class="banner">BOOTH - REFERRAL</div>

    <table class="meta">
        <tr>
            <td class="date">{{ $invoiceDateLabel }}</td>
            <td class="billed">{{ $billedToLabel }}</td>
            <td class="spacer"></td>
        </tr>
    </table>

    {{-- Itemised customers --}}
    {{-- One table per page, with the break placed deliberately between them.

         Left to itself Dompdf fills page one to the paper's edge, then finds
         the totals block will not fit; the block cannot be split, so the whole
         thing moves to page two and page one is left with a hand's depth of
         white space. Deciding the split here keeps the rows and the totals
         together on the last page.

         An invoice whose rows fit on one page is a single chunk and renders
         exactly as it always did. --}}
    @forelse ($customerPages as $pageIndex => $pageRows)
        @if ($pageIndex > 0)
            <div class="page-break"></div>
        @endif

        <table class="items">
            <thead>
            <tr>
                <th class="desc">DESCRIPTION</th>
                <th style="width: 24%;">UNIT PRICE</th>
                <th style="width: 16%;">QTY</th>
                <th style="width: 20%;">TOTAL</th>
            </tr>
            </thead>
            <tbody>
            @foreach ($pageRows as $customer)
                <tr>
                    <td class="desc">
                        {{ $customer['customer_name'] }}
                        @if ($showReferrer && !empty($customer['referred_by_name']))
                            <span class="by">referred by {{ $customer['referred_by_name'] }}</span>
                        @endif
                    </td>
                    <td>{{ $peso }} {{ number_format((float) $customer['unit_price'], 0) }}</td>
                    <td>{{ (int) $customer['quantity'] }}</td>
                    <td>{{ $peso }} {{ number_format((float) $customer['total'], 0) }}</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @empty
        <table class="items">
            <thead>
            <tr>
                <th class="desc">DESCRIPTION</th>
                <th style="width: 24%;">UNIT PRICE</th>
                <th style="width: 16%;">QTY</th>
                <th style="width: 20%;">TOTAL</th>
            </tr>
            </thead>
            <tbody>
            <tr>
                <td class="desc" colspan="4" style="color:#6b7280;">No referred customers for this period.</td>
            </tr>
            </tbody>
        </table>
    @endforelse

    {{-- Totals, sitting under the right-hand half of the table --}}
    {{-- Two rows, not two columns: the totals sit alone on the first, and the
         signature and sign-off share the second. Putting them in one row is
         what keeps them level — matching offsets by hand would drift the
         moment the totals block gained or lost a line. --}}
    <table class="totals-wrap">
        <tr>
            <td style="width: 52%;"></td>
            <td style="width: 48%;">
                <table class="totals">
                    <tr>
                        <td>TOTAL CLIENT INSTALLED</td>
                        <td class="value">{{ (int) $invoice->total_customers }}</td>
                    </tr>
                    <tr>
                        <td>INSTALLATION FEE</td>
                        <td class="value">{{ $peso }} {{ number_format((float) $invoice->installation_fee, 2) }}</td>
                    </tr>
                    {{-- TOTAL AMOUNT is what the referrals on this invoice come
                         to: the customer table's TOTAL column added up, which is
                         clients x the referring agent's rate. The stored
                         `commission` column is that sum, so it is what is
                         printed here — the reader can check the figure against
                         the rows above it.

                         INCENTIVE is the completed-quota payout, held in the
                         stored `total_amount` column. The two column names read
                         the other way round to these labels, which is a naming
                         accident on the table rather than a swap: `commission`
                         has always been the per-referral sum and `total_amount`
                         has always been the incentive. --}}
                    <tr>
                        <td>TOTAL AMOUNT</td>
                        <td class="value">{{ $peso }} {{ number_format((float) $invoice->commission, 2) }}</td>
                    </tr>
                    <tr>
                        <td>INCENTIVE</td>
                        <td class="value">{{ $peso }} {{ number_format((float) $invoice->total_amount, 2) }}</td>
                    </tr>
                    <tr class="grand">
                        <td>SUBTOTAL</td>
                        <td class="value">{{ $peso }} {{ number_format((float) $invoice->subtotal, 2) }}</td>
                    </tr>
                </table>
            </td>
        </tr>
        {{-- Both cells bottom-aligned, so the rule and the sign-off finish on
             the same line without either being nudged by hand. --}}
        <tr class="sign-off">
            <td>
                <div class="signature">SIGNATURE:</div>
                <div class="signature-line"></div>
            </td>
            <td>
                <div class="thanks">Thank you!</div>
            </td>
        </tr>
    </table>

    {{-- Pre-installation reference.
         Printed only when there is something to print, so an invoice whose
         referrals were all installed outright is unchanged. It sits after the
         sign-off because it explains the document rather than forming part of
         what is being charged. --}}
    @if (!empty($preInstallNotes))
        <table class="pre-install">
            <tr>
                <th colspan="2">PRE-INSTALLATION REMARKS</th>
            </tr>
            @foreach ($preInstallNotes as $note)
                <tr>
                    <td class="who">
                        {{ $note['customer'] }}
                        @if ($note['recorded_at'])
                            <span class="when">{{ $note['recorded_at'] }}</span>
                        @endif
                        @if ($note['recorded_by'])
                            <span class="when">{{ $note['recorded_by'] }}</span>
                        @endif
                    </td>
                    <td class="note">{{ $note['remarks'] }}</td>
                </tr>
            @endforeach
        </table>
    @endif

    <div class="page-note">
        {{ $invoice->invoice_number }} &nbsp;•&nbsp; Billing period {{ $periodLabel }}
    </div>
</div>

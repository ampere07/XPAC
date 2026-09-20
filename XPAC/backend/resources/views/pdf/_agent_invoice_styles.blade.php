{{-- The invoice stylesheet, shared by the single-invoice document and the
     bundle. Both set the same page box and the same fonts, so a change to
     either has to reach both — which is why it lives in one file.

     Expects: $fonts, $pageTopBand, $pageBottomBand, $pageNumberTop, $footerOffset --}}
        /*
            Page box.
            ────────────────────────────────────────────────────────────────────
            Two bands are reserved on every page, because both the header and
            the footer artwork are fully opaque and are painted after the flow:
            anything Dompdf lays out underneath them is simply lost.

              top    room for the page number, clear of all content. The header
                     artwork on page one is pulled back up into this band by an
                     equal negative margin, so page one still opens flush with
                     the top edge exactly as before.
              bottom the footer artwork's own height, plus a little air above it
                     and the gap it now stands off the bottom edge. Without the
                     band the table would run on beneath the artwork and those
                     rows would vanish rather than move to the next page.

            The footer band is 118pt: the artwork is 791x134px drawn at the full
            595.2756pt page width, so it stands 100.8pt tall, and it carries 8pt
            of air above it and a 10pt lift below.
        */
        @page { margin: {{ $pageTopBand }} 0 {{ $pageBottomBand }} 0; }

        {{-- One typeface per slot. Declared only where a file is installed;
             every rule below names Helvetica after its slot, so a missing font
             makes the invoice plainer rather than unissuable. --}}
        @foreach ($fonts as $slot => $url)
            @if ($url)
        @font-face {
            font-family: 'Invoice{{ ucfirst($slot) }}';
            font-style: normal;
            font-weight: normal;
            src: url('{{ $url }}') format('truetype');
        }
            @endif
        @endforeach

        body {
            margin: 0;
            padding: 0;
            font-family: Helvetica, Arial, sans-serif;
            color: #1f2937;
            font-size: 11px;
        }

        .sheet { padding: 0 40px 0 40px; }

        /* ── Page number ────────────────────────────────────────────────── */
        /* Just the figure — 1, 2, 3 — in the top right of every page, set by
           the page counter so it cannot fall out of step with the real page.
           It sits in the reserved top band, above the content box, so it can
           never land on a row, the totals block or the sign-off.
           On page one it falls over the header artwork's top right. Nothing of
           substance is there: the ATSS FIBER wordmark occupies the left third
           (x 62-273pt, and lower down at that), leaving nearly 280pt of
           clearance. All that lies under the figure is the pale watermark wash
           that covers the whole header — nothing darker than luminance 236 —
           which a navy numeral reads cleanly against. */
        .page-number {
            position: fixed;
            top: {{ $pageNumberTop }};
            right: 40px;
            text-align: right;
            font-family: Helvetica, Arial, sans-serif;
            font-size: 10px;
            color: #1a2e46;
        }
        /* The figure itself is NOT written here.
           counter(pages) resolves to 0 during layout — the total is not known
           until the document has been rendered — so every sheet came out
           reading "Page 1 of 0". AgentInvoicePdfService::stampPageNumbers()
           writes it onto the canvas afterwards instead, where Dompdf can
           substitute the real count. This rule only reserves the space. */

        /* ── Header ─────────────────────────────────────────────────────── */
        /* The supplied artwork carries the ATSS FIBER mark and the watermark,
           and runs the full width of the page, so it sits outside .sheet's
           padding. The negative top margin cancels the reserved top band, so
           page one still opens with the artwork flush to the paper edge. */
        .header-art { width: 100%; display: block; margin-top: -{{ $pageTopBand }}; }

        /* No artwork: the fallback wordmark is in normal flow, so it needs the
           reserved band back as padding rather than cancelling it. */
        .brand-fallback { padding-top: 30px; }
        .brand-fallback .name {
            color: #1a2e46;
            font-size: 25px;
            font-weight: bold;
            letter-spacing: -0.5px;
        }

        .banner {
            /* The gap to the header artwork, tightened from 38px. That 38 was
               the sample generator's 28pt, but it cost more height than the
               design needed and was part of why a ten-row invoice pushed its
               totals block onto a second sheet. */
            margin: 16px 0 8px 0;
            text-align: center;
            color: #1a2e46;
            font-family: {{ $fonts['title'] ? 'InvoiceTitle, ' : '' }}Helvetica, Arial, sans-serif;
            font-size: 52px;
            /* A display face already carries its weight; asking for bold on top
               would have Dompdf synthesise a smeared one. */
            font-weight: {{ $fonts['title'] ? 'normal' : 'bold' }};
            letter-spacing: -1px;
            line-height: 1;
        }

        /* The date sits hard left; the team or agent name is centred across the
           full width of the page, not merely against the date. */
        .meta { width: 100%; border-collapse: collapse; margin-bottom: 8px; position: relative; }
        .meta td {
            color: #d0202f;
            font-family: {{ $fonts['meta'] ? 'InvoiceMeta, ' : '' }}Helvetica, Arial, sans-serif;
            font-size: 14px;
            font-weight: {{ $fonts['meta'] ? 'normal' : 'bold' }};
            padding: 0;
            white-space: nowrap;
        }
        .meta .date { text-align: left; width: 33%; }
        .meta .billed { text-align: center; width: 34%; }
        .meta .spacer { width: 33%; }

        /* ── Itemised table ─────────────────────────────────────────────── */
        table.items { width: 100%; border-collapse: collapse; }

        /* However many referrals an agent has, the table carries on over as
           many pages as it needs. Three rules make that readable:
             • the column headings repeat at the top of each page, so a
               continued table is still legible on its own;
             • a row is never split down the middle by a page break — it moves
               whole to the next page;
             • and the totals, signature and sign-off travel together, so the
               subtotal is never orphaned from the block it belongs to. */
        table.items thead { display: table-header-group; }
        table.items tbody tr { page-break-inside: avoid; }

        table.items thead th {
            background: #1a2e46;
            color: #ffffff;
            font-family: {{ $fonts['head'] ? 'InvoiceHead, ' : '' }}Helvetica, Arial, sans-serif;
            font-size: 10px;
            font-weight: {{ $fonts['head'] ? 'normal' : 'bold' }};
            letter-spacing: 2px;
            padding: 7px 14px;
            text-align: center;
        }
        table.items thead th.desc { text-align: left; padding-left: 22px; }

        table.items tbody td {
            border: 1px solid #1a2e46;
            font-family: {{ $fonts['body'] ? 'InvoiceBody, ' : '' }}Helvetica, Arial, sans-serif;
            padding: 5px 14px;
            text-align: center;
            font-size: 11px;
        }
        table.items tbody td.desc { text-align: center; }
        /* Kept subtle: the reference shows only the customer's name. */
        table.items tbody td .by {
            display: block;
            color: #6b7280;
            font-size: 8px;
            margin-top: 1px;
        }

        /* Break between one page of rows and the next. An empty block with
           page-break-after, which is what Dompdf acts on reliably — it honours
           breaks on block boundaries far better than inside a table. */
        .page-break { page-break-after: always; }

        /* ── Totals ─────────────────────────────────────────────────────── */
        .totals-wrap { width: 100%; border-collapse: collapse; margin-top: -1px; page-break-inside: avoid; }
        .totals-wrap td { vertical-align: top; }
        /* Top-aligned so the two labels lead the row together; the rule to sign
           on then follows underneath SIGNATURE:. */
        .totals-wrap tr.sign-off td { vertical-align: top; }

        table.totals { width: 100%; border-collapse: collapse; background: #1a2e46; }
        table.totals td {
            color: #ffffff;
            font-family: {{ $fonts['totals'] ? 'InvoiceTotals, ' : '' }}Helvetica, Arial, sans-serif;
            font-size: 10.5px;
            /* The installed totals face is already the bold cut, so asking for
               bold again would have Dompdf synthesise a heavier one on top. */
            font-weight: {{ $fonts['totals'] ? 'normal' : 'bold' }};
            /* Likewise the slant: each slot is registered in one style only, so
               asking for italic finds no match and drops the whole block back
               to Helvetica-Oblique — the typeface lost to keep the slant. The
               face is what the block is for, so it is set upright, the same way
               the sign-off does it. */
            font-style: {{ $fonts['totals'] ? 'normal' : 'italic' }};
            padding: 3px 14px;
        }
        table.totals td.value { text-align: right; }
        /* On the subtotal row only the figure is picked out in red; the label
           stays white with the rest of the block. */
        table.totals tr.grand td.value { color: #ff5a5a; }

        .signature {
            color: #d0202f;
            font-size: 14px;
            font-weight: bold;
            font-style: italic;
            padding-top: 34px;
        }
        .signature-line {
            border-bottom: 3px solid #111827;
            width: 210px;
            margin-top: 58px;
        }

        .thanks {
            text-align: right;
            /* The same red as SIGNATURE:, which it now sits level with. */
            color: #d0202f;
            font-family: {{ $fonts['script'] ? 'InvoiceScript, ' : '' }}Helvetica, Arial, sans-serif;
            font-size: {{ $fonts['script'] ? '40px' : '30px' }};
            /* Italic only stands in for a script face; a real one is already
               slanted and would be double-slanted by this. */
            font-style: {{ $fonts['script'] ? 'normal' : 'italic' }};
            /* Set so this baseline lands on SIGNATURE:'s. Both cells start at
               the same top edge, but the script is far larger, so it needs the
               smaller inset to finish level: roughly padding + three quarters
               of the font size, matched against the label's 34px + 14px. */
            padding-top: 14px;
            padding-right: 30px;
        }

        /* ── Footer ─────────────────────────────────────────────────────── */
        /* The supplied artwork carries the angled bars and the contact strip.
           Repeated on every page by being fixed. The offset reaches back down
           through the reserved bottom band, but stops short of the paper edge
           so the artwork sits on a little white rather than looking trimmed;
           the band's only job is to keep the flow off it. */
        .footer {
            position: fixed;
            left: 0; right: 0; bottom: {{ $footerOffset }};
        }
        .footer-art { width: 100%; display: block; }

        .footer-fallback { border-top: 4px solid #d0202f; padding-top: 6px; }
        .footer-fallback .bar { height: 10px; background: #1a2e46; }

        /* Pre-installation reference, at the foot of the invoice.
           Deliberately quieter than the customer table: it is context for the
           document, not a line being charged, and it must not read as a second
           set of billable rows. */
        table.pre-install {
            width: 100%;
            border-collapse: collapse;
            margin-top: 14px;
        }
        table.pre-install th {
            background: #1a2e46;
            color: #ffffff;
            font-size: 8px;
            letter-spacing: 1px;
            text-align: left;
            padding: 5px 8px;
        }
        table.pre-install td {
            border: 1px solid #d5dbe3;
            font-size: 8px;
            color: #33415c;
            padding: 5px 8px;
            vertical-align: top;
        }
        table.pre-install td.who {
            width: 32%;
            font-weight: bold;
        }
        /* The stamp and the author, kept subordinate to the name above them. */
        table.pre-install span.when {
            display: block;
            font-weight: normal;
            color: #7b8794;
            font-size: 7px;
        }

        .page-note {
            text-align: center;
            color: #9ca3af;
            font-size: 8px;
            padding-top: 10px;
        }

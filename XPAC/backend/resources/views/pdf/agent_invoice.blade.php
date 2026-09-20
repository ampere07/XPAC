{{--
    Weekly agent referral invoice — one invoice, one document.

    Follows docs/ATSS-FIBER-INVOICE.pdf: the ATSS FIBER mark top left, the
    BOOTH - REFERRAL banner, the date and team/agent line in red, the navy
    table of referred customers, the navy totals block, the signature line and
    the footer bar with the company's contact details.

    The stylesheet, the invoice body and the page furniture are partials, shared
    with pdf/agent_invoices_bundle — so a bundled invoice and a single one can
    never drift apart.

    Rendered by Dompdf, so the layout is tables and inline styles rather than
    flexbox or grid — Dompdf supports very little of either.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <style>
@include('pdf._agent_invoice_styles')
    </style>
</head>
<body>
@include('pdf._agent_invoice_chrome')
@include('pdf._agent_invoice_body')
</body>
</html>

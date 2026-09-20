{{--
    Several agent invoices gathered into one document.

    What the Agent Invoices download produces: a single PDF rather than a folder
    of them, so it can be opened, read and printed in one go.

    Each invoice begins on a fresh page and is otherwise identical to its
    standalone PDF — same stylesheet, same body partial. The page number runs
    continuously across the document, which is what makes it one document rather
    than a stack of separate ones.

    Expects: $invoices — a list of the per-invoice view models, each carrying
    exactly what pdf/_agent_invoice_body needs.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <style>
@include('pdf._agent_invoice_styles')

        /* Every invoice after the first opens a new sheet. Set on the wrapper
           rather than between invoices, so no stray break is left at the end. */
        .invoice + .invoice { page-break-before: always; }
    </style>
</head>
<body>
@include('pdf._agent_invoice_chrome')

@foreach ($invoices as $entry)
    <div class="invoice">
        @include('pdf._agent_invoice_body', $entry)
    </div>
@endforeach
</body>
</html>

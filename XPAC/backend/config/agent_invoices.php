<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Weekly agent referral invoices
    |--------------------------------------------------------------------------
    */

    // Prefix for the invoice number: ATSS-AGT-000001.
    'number_prefix' => env('AGENT_INVOICE_PREFIX', 'ATSS-AGT'),

    // How many digits the running number is padded to.
    'number_padding' => 6,

    /*
    | NOT used by the invoice run any more.
    |
    | UNIT PRICE on an invoice is the referring agent's own commission rate,
    | read from `agent_balance.commission` — see the COMMISSION note below. Each
    | customer line carries the rate of the agent who brought that customer in,
    | so a mixed-rate team prices every line correctly rather than averaging.
    |
    | This key remains only because JobOrderAgentPaymentService still falls back
    | to it when an agent has no rate of their own. Changing it does not affect
    | any invoice.
    */
    'unit_price' => env('AGENT_INVOICE_UNIT_PRICE', 100),

    /*
    | The installation fee stated on the invoice. It is not derivable from a
    | referral count — the reference document states it rather than calculating
    | it — and it does not form part of what is owed.
    |
    | COMMISSION is NOT configured here. It is earned per referral at the rate
    | on the referring agent's own record (agent_balance.commission), so the
    | invoice total is the sum across its customers. A team on one rate bills
    | customers x rate; a team on mixed rates bills each customer at theirs.
    |
    | That same rate is what each customer line states as its UNIT PRICE, so the
    | line items add up to COMMISSION exactly.
    |
    | TOTAL AMOUNT is the incentive, and it is NOT configured or calculated
    | anywhere in the invoice run either. It is read from the completed quotas
    | the incentive cron awarded inside the invoice's own billing week
    | (agent_incentive_history), and each one is billed exactly once. Whether a
    | quota was reached is the cron's decision to make, because only it can see
    | progress accumulating across weeks.
    |
    | SUBTOTAL is TOTAL AMOUNT + COMMISSION.
    */
    'installation_fee' => env('AGENT_INVOICE_INSTALLATION_FEE', 500),

    // Where the generated PDFs live, under storage/app/public.
    'pdf_folder' => 'agent-invoices',

    /*
    | How many referred customers the first page of the PDF carries.
    |
    | Page one gives most of its height to the header artwork and the banner, so
    | it holds fewer rows than the pages after it. Left to itself Dompdf fills
    | page one to the paper's edge and then finds the totals block will not fit
    | — and that block cannot be split — so it moves the whole thing to page two
    | and leaves a hand's depth of white space behind.
    |
    | Capping page one is what avoids that: the rows that would have caused the
    | overflow start page two instead, and the totals follow them.
    |
    | A TEAM invoice fits fewer than a solo one. Its rows name who brought each
    | customer in, on a second line under the name, so every row is taller. A
    | solo invoice has no such line — the one agent is already in the heading —
    | and its rows are single-height. This value is the TEAM cap; the solo one
    | is below it.
    */
    'first_page_rows' => env('AGENT_INVOICE_FIRST_PAGE_ROWS', 10),

    // Page one of a SOLO invoice, whose rows are single-height.
    'first_page_rows_solo' => env('AGENT_INVOICE_FIRST_PAGE_ROWS_SOLO', 15),

    /*
    | How many rows each page after the first carries.
    |
    | Those pages have no header artwork, so they fit more.
    */
    'rows_per_page' => env('AGENT_INVOICE_ROWS_PER_PAGE', 18),

    /*
    | Only referrals installed on or after the agent programme start date are
    | ever billed. Shared with incentives and achievements so all three agree
    | about which referrals count — see config/agent.php.
    */

    // How many agents/teams to hold in memory at once during a run.
    'chunk_size' => 200,

];

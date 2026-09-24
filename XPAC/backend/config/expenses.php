<?php

return [

    /*
    |--------------------------------------------------------------------------
    | CapEx category patterns
    |--------------------------------------------------------------------------
    |
    | Fragments of an expense category name that mark the spending as capital
    | rather than operating. Matched case-insensitively as substrings, so
    | 'router' catches 'Router / Modem Stock'.
    |
    | These are the same fragments MONITOR's reporting.capex_patterns uses. The
    | two lists must stay in step: MONITOR classifies GOWISER's expense rows for
    | the executive dashboard, and if the lists diverge the Expenses page and the
    | dashboard will split the same peso differently.
    |
    | Only ever consulted for rows that carry no explicit expense_type — a type a
    | human chose is never overridden by a name match.
    |
    */

    'capex_patterns' => [
        'equipment', 'hardware', 'router', 'switch', 'onu', 'olt', 'server',
        'vehicle', 'motorcycle', 'truck', 'tower', 'construction', 'building',
        'fiber', 'fibre', 'cable roll', 'installation asset', 'capital',
        'furniture', 'computer', 'laptop', 'machinery', 'land', 'improvement',
    ],

];

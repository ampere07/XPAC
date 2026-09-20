<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Agent programme start date
    |--------------------------------------------------------------------------
    |
    | The day the agent programme begins counting, or null for no cut-off.
    |
    | Currently null: an agent's WHOLE history counts. Every referral they have
    | ever onboarded earns incentive progress and adds to weekly and monthly
    | achievement progress, however old it is.
    |
    | Setting a date restores the cut-off — referrals onboarded before it become
    | history that earns nothing. One value covers incentives and achievements
    | both, so the two can never disagree about which of an agent's referrals
    | count. The dashboards carry their own copy of the same setting — see
    | AGENT_JOB_ORDER_START_DATE in the frontends' agentReferral helpers, in
    | ATSS2_0/frontend and MOBILEAPP/frontend — and BOTH must be changed with
    | this one. A date here that the frontends do not have would hide referrals
    | from an agent's Job Order list while still paying them; a date there that
    | this file does not have would show referrals that earn nothing.
    |
    */

    'start_date' => env('AGENT_START_DATE', null),

];

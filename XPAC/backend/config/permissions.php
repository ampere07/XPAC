<?php

/*
|--------------------------------------------------------------------------
| API access control rollout mode
|--------------------------------------------------------------------------
|
| How App\Http\Middleware\ApiAccessControl treats a request that the table in
| App\Support\ApiPermissionMap would refuse.
|
|   off      The gate stands aside entirely. Requests are handled exactly as
|            they were before the Roles Module existed.
|
|   log      (default) The decision is computed for every request and a
|            would-be refusal is written to the log as "API access would be
|            denied" — but the request is let through untouched. The auth
|            guard and the request's user resolver are NOT changed, so every
|            controller behaves exactly as it did before. Use this to find
|            the callers the table has not accounted for before enforcing it.
|
|   enforce  Refusals are real: 401 for a caller who is not signed in, 403
|            for one who lacks the key.
|
| Controller-level checks (App\Support\AgentAccess, RoleController's rules,
| the `role:` and `permission:` route middleware) apply in every mode.
|
*/

return [
    'api_access_control' => env('API_ACCESS_CONTROL', 'log'),

    /*
    |--------------------------------------------------------------------------
    | Transaction approvers
    |--------------------------------------------------------------------------
    |
    | Approve and Batch Approve on the Transaction List belong to the SuperAdmin
    | and to the users listed here by email — not to every Administrator, though
    | that role holds the keys for its other screens. Comma-separated, compared
    | case-insensitively. See Permissions::canApproveTransactions().
    |
    */
    'transaction_approvers' => array_values(array_filter(array_map(
        static fn ($email) => strtolower(trim((string) $email)),
        explode(',', (string) env('TRANSACTION_APPROVER_EMAILS', 'cb@xpacsconnect.ph,dcopag@gmail.com'))
    ))),
];

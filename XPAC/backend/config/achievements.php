<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Agent onboarding achievements
    |--------------------------------------------------------------------------
    |
    | Each tier rewards an agent for onboarding a number of referrals within a
    | period. Both the target and the reward live here so they can be retuned
    | without touching the claim logic, and so the API can hand the same figures
    | to the web and mobile dashboards rather than each hardcoding its own.
    |
    |   target  completed (onboarded) referrals needed within the period
    |   reward  peso amount credited to the agent's balance when claimed
    |   period  'weekly'  — resets every ISO week (Monday to Sunday)
    |           'monthly' — resets every calendar month
    |
    | A tier can be claimed once per period: an agent who hits 25 onboards this
    | week claims the weekly reward now, and may claim it again next week.
    |
    */
    'tiers' => [
        'weekly' => [
            'label'  => 'Weekly Achievement',
            'target' => (int) env('ACHIEVEMENT_WEEKLY_TARGET', 25),
            'reward' => (float) env('ACHIEVEMENT_WEEKLY_REWARD', 1000),
            'period' => 'weekly',
        ],
        'monthly' => [
            'label'  => 'Monthly Achievement',
            'target' => (int) env('ACHIEVEMENT_MONTHLY_TARGET', 100),
            'reward' => (float) env('ACHIEVEMENT_MONTHLY_REWARD', 15000),
            'period' => 'monthly',
        ],
    ],

];

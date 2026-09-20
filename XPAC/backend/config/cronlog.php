<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cron log filtering
    |--------------------------------------------------------------------------
    |
    | The cron services keep their own log files, written with file_put_contents
    | rather than through a Laravel channel. That means LOG_LEVEL does not reach
    | them: this deployment runs at LOG_LEVEL=error, which trims the channels and
    | leaves those files recording every line the service produces.
    |
    | With `errors_only` on, a line is written when it reports a fault, and the
    | narration is dropped in favour of one summary per run listing the records
    | by outcome — see App\Support\CronLog.
    |
    */

    /*
    | Master switch. false restores the old behaviour of writing every line, which
    | is worth doing temporarily when a run needs to be traced step by step.
    */
    'errors_only' => (bool) env('CRON_LOG_ERRORS_ONLY', true),

    /*
    | Keep [WARNING]/[WARN] lines alongside errors.
    |
    | Off by default because the request was errors only. Turn it on when a run is
    | failing in a way the error lines alone do not explain — several of these
    | services report a recoverable problem as a warning and then carry on, and
    | that is often the first sign of the fault.
    */
    'include_warnings' => (bool) env('CRON_LOG_INCLUDE_WARNINGS', false),

];

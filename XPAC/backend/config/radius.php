<?php

return [

    /*
    |--------------------------------------------------------------------------
    | RADIUS estate topology
    |--------------------------------------------------------------------------
    |
    | Which of the configured radius_config records this deployment expects to be
    | answering.
    |
    |   'primary' - radius_config #1 carries the estate and the records after it
    |               are failover targets that are normally dark. They are still
    |               searched for an account and still merged into a session sweep
    |               when they answer, but one being unreachable is the steady
    |               state and is not reported as an outage.
    |   'all'     - every record is a live production server and silence from any
    |               of them is a real fault.
    |
    | Only the servers this names as live decide whether a session sweep
    | succeeded - see RadiusServerResolver::activeConfigs(). The class constant
    | DEFAULT_TOPOLOGY is the fallback when this key is absent.
    */
    'topology' => env('RADIUS_TOPOLOGY', 'primary'),

    /*
    |--------------------------------------------------------------------------
    | RADIUS operation queue
    |--------------------------------------------------------------------------
    |
    | Settings for the retry queue that re-applies RADIUS operations which could
    | not be completed at the time they were requested. Everything the retry
    | mechanism needs is declared here — nothing is hardcoded in the service —
    | so the schedule can be tuned without touching the processing logic.
    |
    */
    'queue' => [

        /*
        | How many times a single queued operation may be attempted in total,
        | counting the first attempt. Once this many attempts have failed the
        | job is marked permanently failed and is never retried automatically.
        */
        'max_attempts' => (int) env('RADIUS_QUEUE_MAX_ATTEMPTS', 10),

        /*
        | Progressive retry schedule, in MINUTES.
        |
        | Index 0 is the wait after the 1st attempt fails, index 1 the wait after
        | the 2nd, and so on. With the default 10 max attempts there are 9 waits,
        | the last one being before the 10th and final attempt:
        |
        |   attempt 1 fails -> wait 15m -> attempt 2
        |   attempt 2 fails -> wait 25m -> attempt 3
        |   attempt 3 fails -> wait 35m -> attempt 4   ... and so on
        |
        | To change the pacing, edit this list. It does not have to be the same
        | length as max_attempts: if it runs out, the last value is reused for
        | every remaining attempt.
        */
        'retry_delays' => [15, 25, 35, 45, 55, 65, 75, 85, 95],

        /*
        | Guard against the same operation being queued twice while an earlier
        | copy is still waiting. A retry never inserts a new row — it updates the
        | existing one — so this only affects callers queueing the same
        | source/operation again before the first copy has finished.
        */
        'prevent_duplicates' => (bool) env('RADIUS_QUEUE_PREVENT_DUPLICATES', true),

        /*
        | A worker that is killed mid-item leaves that row marked 'processing'.
        | Any row that has been 'processing' for longer than this many minutes is
        | assumed to belong to a dead worker and is returned to the queue, so a
        | restart cannot strand a job. Must comfortably exceed the longest time a
        | single operation can legitimately take.
        */
        'stale_processing_minutes' => (int) env('RADIUS_QUEUE_STALE_MINUTES', 15),

        /*
        | Default number of items processed per run of the queue command.
        */
        'batch_size' => (int) env('RADIUS_QUEUE_BATCH_SIZE', 20),
    ],

    /*
    |--------------------------------------------------------------------------
    | RADIUS status sync
    |--------------------------------------------------------------------------
    |
    | Settings for the status sync (RadiusStatusSyncService) that mirrors User
    | Manager users and sessions into the online_status table.
    |
    | The sync reads each RADIUS server in bulk — two requests per server, never
    | one per subscriber — and then applies the result to the local database
    | BATCH BY BATCH, so peak memory, transaction length and lock footprint stay
    | flat no matter how many accounts exist. Everything the batching needs is
    | declared here; nothing is hardcoded in the service.
    |
    */
    'status_sync' => [

        /*
        | Accounts applied to online_status per batch. A batch is read, compared
        | and written before the next one is read, so the whole account table is
        | never in memory at once and no single transaction spans the run.
        |
        | Larger  = fewer round trips, but more memory and longer row locks.
        | Smaller = gentler on the database, but more round trips.
        | 500 suits MySQL well; lower it if the sync competes with heavy
        | interactive traffic, raise it on a well-resourced server.
        */
        'batch_size' => (int) env('RADIUS_STATUS_SYNC_BATCH_SIZE', 500),

        /*
        | Rows per statement while seeding online_status with accounts that do
        | not have a row yet (the INSERT IGNORE step). Kept separate from
        | batch_size because that step is one set-based insert per window and
        | can afford a longer stride than the per-account comparison pass.
        */
        'seed_batch_size' => (int) env('RADIUS_STATUS_SYNC_SEED_BATCH_SIZE', 2000),

        /*
        | Optional breather between batches, in milliseconds. 0 = run flat out.
        | Set this when the sync should yield database headroom to interactive
        | traffic: it lengthens the run in exchange for a lighter footprint.
        */
        'batch_pause_ms' => (int) env('RADIUS_STATUS_SYNC_BATCH_PAUSE_MS', 0),

        /*
        | Skip the UPDATE when every synced column already holds the value the
        | sync is about to write. Most subscribers do not change state between
        | two-minute runs, so this removes the bulk of the write load, the row
        | locks and the replication traffic. The only visible difference is that
        | online_status.updated_at stops advancing on a run where nothing about
        | the account changed. Set to false to write on every pass.
        */
        'skip_unchanged' => (bool) env('RADIUS_STATUS_SYNC_SKIP_UNCHANGED', true),

        /*
        | How long the merged RADIUS user list may be reused before it is fetched
        | again, in MINUTES. 0 = fetch it every run.
        |
        | The sync makes two bulk requests per server: the SESSION list, which is
        | what changes from minute to minute, and the USER list, which only says
        | which group each subscriber is in. The user list is the big one, and on
        | a settled estate it is identical run after run — so re-pulling it every
        | few minutes makes RouterOS serialise its whole subscriber table for
        | nothing. This lets sessions stay live while the heavy list is fetched on
        | a slower beat.
        |
        | Defaults to 30 rather than 0. At a five-minute schedule that is the
        | difference between asking each server for its whole subscriber table
        | twelve times an hour and asking twice, and it is the request most likely
        | to leave a busy RouterOS box refusing new connections — the sync
        | competing with the subscribers it is reporting on. Sessions are still
        | read every run, so nothing about how quickly a login or logout shows up
        | changes.
        |
        | The trade is narrow: a group change made DIRECTLY on the router, outside
        | this app, can take up to this long to appear in online_status. A change
        | made through the app is unaffected — ManualRadiusOperations,
        | RadiusQueue, RadiusReconciliation and RadiusReconnection each drop this
        | cache as they write, so the next run re-reads immediately. Set this to 0
        | to go back to fetching every run, or run
        | `cron:sync-radius-status --refresh-users` for a one-off re-fetch.
        |
        | Only a COMPLETE snapshot is cached: if any server was unreachable, the
        | partial result is used for that run and thrown away, so one bad run
        | cannot leave stale "Not Found" statuses standing.
        */
        'user_cache_minutes' => (int) env('RADIUS_STATUS_SYNC_USER_CACHE_MINUTES', 30),
        /*
        | Per-request timeouts, in seconds, for the User Manager calls. The
        | request timeout has to cover RouterOS serialising an entire user or
        | session list, so the figure grows with the size of the estate — raise
        | it if the larger servers start timing out.
        */
        'connect_timeout' => (int) env('RADIUS_STATUS_SYNC_CONNECT_TIMEOUT', 3),
        'request_timeout' => (int) env('RADIUS_STATUS_SYNC_REQUEST_TIMEOUT', 15),
    ],

    /*
    |--------------------------------------------------------------------------
    | RADIUS connection fallback (circuit breaker)
    |--------------------------------------------------------------------------
    |
    | Decides which TRANSPORT a radius_config is reached over, and when to stop
    | using one that is not answering.
    |
    | Every radius_config has two ways in: the transport it was SAVED with
    | (ssl_type + port, e.g. tcp://host:8728) and the ALTERNATE one on the other
    | standard API port (ssl://host:8729). The saved transport is always tried
    | first while it is healthy. Once it has failed `failure_threshold` times in
    | a row, it is marked down and later calls go straight to the alternate — no
    | socket, no connect timeout — until the cool-off expires and one call is let
    | through to see whether it recovered.
    |
    | Without this, every operation independently rediscovers that a transport is
    | down and pays a full connect timeout to find out. One queue run of 20 items,
    | each trying two configs over two transports, spends minutes opening sockets
    | that were never going to connect — which is exactly what keeps a struggling
    | RouterOS too busy to accept the connections that would have worked.
    |
    | Tracking is per ENDPOINT (transport + host + port), so tcp://host:8728 and
    | ssl://host:8729 are judged separately, and so are two radius_config rows
    | that happen to share a host. A wrong ssl_type in radius_config therefore
    | costs a few failures once, instead of a wasted connect timeout on every
    | call for as long as it stays wrong.
    |
    | Config-level fallback (#1 -> #2) sits on top of this: a config is only
    | abandoned once BOTH of its transports have failed, and the next config then
    | runs the same logic over its own two transports.
    |
    */
    'circuit_breaker' => [

        /*
        | Master switch. Turn off to restore the old behaviour of always trying
        | every endpoint in its saved order, paying every timeout.
        */
        'enabled' => (bool) env('RADIUS_CIRCUIT_BREAKER_ENABLED', true),

        /*
        | CONSECUTIVE connection failures against one endpoint before calls stop
        | preferring it and switch to the other transport for that config.
        |
        | Only connection-level failures count: a refused or timed-out socket, a
        | TLS handshake that fails, or a rejected login. A device that answers the
        | API — even to refuse the command — has proved the endpoint is alive and
        | resets the count to zero.
        */
        'failure_threshold' => (int) env('RADIUS_CIRCUIT_BREAKER_THRESHOLD', 3),

        /*
        | How long failures are remembered while counting toward the threshold.
        | Failures spread wider apart than this never accumulate into a switch,
        | so an occasional blip cannot mark a healthy endpoint down.
        */
        'failure_window_seconds' => (int) env('RADIUS_CIRCUIT_BREAKER_WINDOW', 120),

        /*
        | How long an endpoint stays skipped once marked down. This is also how
        | long a recovered endpoint waits to be noticed, so keep it short: when it
        | expires the next call goes through as the half-open probe, and a success
        | there clears the count completely.
        */
        'cooldown_seconds' => (int) env('RADIUS_CIRCUIT_BREAKER_COOLDOWN', 60),
    ],

];

<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * The accounts whose RADIUS session actually changed during one sync run.
 *
 * Sent as ONE event carrying many accounts, not one event per account. A sync touches every
 * subscriber with a PPPoE username, and on a busy evening hundreds of them come and go in a single
 * run; a per-account event would put hundreds of frames through Soketi every minute and make each
 * open tab re-render on every one. The batch is applied to the client store in a single pass.
 *
 * Only genuine changes are carried. A subscriber whose status and IP are what they were last run
 * contributes nothing, so a settled estate broadcasts nothing at all.
 *
 * ShouldBroadcastNow rather than plain ShouldBroadcast — as every other event in this application
 * does. ShouldBroadcastNow extends ShouldBroadcast, so it satisfies the same contract, and it sends
 * inline instead of pushing onto the queue. That matters here: this deployment runs its background
 * work from cron, not a resident queue worker, so a queued broadcast would sit unsent and the
 * status would never reach the browser.
 */
class OnlineStatusBatchUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @var array<int, array{account_no: string, session_status: string, session_ip: ?string, active_sessions: int}>
     */
    public array $statuses;

    /**
     * @param  array<int, array>  $statuses  one entry per account whose status or IP changed
     */
    public function __construct(array $statuses)
    {
        // Re-indexed: the caller collects these keyed by account number, and a PHP array with
        // string keys serialises to a JSON object. The client iterates the payload, so it has to
        // arrive as an array.
        $this->statuses = array_values($statuses);
    }

    public function broadcastOn()
    {
        return new Channel('customers');
    }

    public function broadcastAs()
    {
        return 'online-status-updated';
    }

    public function broadcastWith()
    {
        return ['statuses' => $this->statuses];
    }
}

<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class JobOrderDone implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $jobOrderData;

    public function __construct(array $jobOrderData)
    {
        $this->jobOrderData = $jobOrderData;
    }

    public function broadcastOn()
    {
        return new Channel('job-orders');
    }

    public function broadcastAs()
    {
        return 'job-order-done';
    }

    public function broadcastWith()
    {
        return $this->jobOrderData;
    }
}

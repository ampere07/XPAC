<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BillingUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $billingData;

    public function __construct(array $billingData)
    {
        $this->billingData = $billingData;
    }

    public function broadcastOn()
    {
        return new Channel('billing');
    }

    public function broadcastAs()
    {
        return 'billing-updated';
    }

    public function broadcastWith()
    {
        return $this->billingData;
    }
}

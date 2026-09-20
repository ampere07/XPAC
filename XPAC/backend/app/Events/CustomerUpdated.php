<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class CustomerUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $customerData;

    public function __construct(array $customerData)
    {
        $this->customerData = $customerData;
    }

    public function broadcastOn()
    {
        return new Channel('customers');
    }

    public function broadcastAs()
    {
        return 'customer-updated';
    }

    public function broadcastWith()
    {
        return $this->customerData;
    }
}

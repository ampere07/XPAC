<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class SOAUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $data;

    public function __construct(array $data = [])
    {
        $this->data = $data;
    }

    public function broadcastOn()
    {
        return new Channel('soa');
    }

    public function broadcastAs()
    {
        return 'soa-updated';
    }

    public function broadcastWith()
    {
        return $this->data;
    }
}

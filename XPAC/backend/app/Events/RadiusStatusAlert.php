<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RadiusStatusAlert implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $alertData;

    public function __construct(array $alertData)
    {
        $this->alertData = $alertData;
    }

    public function broadcastOn()
    {
        return new Channel('system-alerts');
    }

    public function broadcastAs()
    {
        return 'radius-offline';
    }

    public function broadcastWith()
    {
        return $this->alertData;
    }
}

<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TechnicianLocationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $location;

    /**
     * @param array $location Flattened technician location payload (see controller::payload()).
     */
    public function __construct(array $location)
    {
        $this->location = $location;
    }

    public function broadcastOn()
    {
        return new Channel('technician-locations');
    }

    public function broadcastAs()
    {
        return 'location-updated';
    }

    public function broadcastWith()
    {
        return $this->location;
    }
}

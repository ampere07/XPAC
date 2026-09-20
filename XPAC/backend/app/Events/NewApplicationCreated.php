<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class NewApplicationCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $applicationData;

    public function __construct(array $applicationData)
    {
        $this->applicationData = $applicationData;
    }

    public function broadcastOn()
    {
        return new Channel('applications');
    }

    public function broadcastAs()
    {
        return 'new-application';
    }

    public function broadcastWith()
    {
        return $this->applicationData;
    }
}

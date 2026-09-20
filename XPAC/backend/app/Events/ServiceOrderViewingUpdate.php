<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ServiceOrderViewingUpdate implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $serviceOrderId;
    public $username;
    public $action;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($serviceOrderId, $username, $action)
    {
        $this->serviceOrderId = $serviceOrderId;
        $this->username = $username;
        $this->action = $action;
    }

    /**
     * Get the channels the event should broadcast on.
     *
     * @return \Illuminate\Broadcasting\Channel|array
     */
    public function broadcastOn()
    {
        return new PresenceChannel('service-orders-presence');
    }

    public function broadcastAs()
    {
        return 'viewing-update';
    }
}

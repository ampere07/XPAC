<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class CustomerViewingUpdate implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $customerId;
    public $username;
    public $action;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($customerId, $username, $action)
    {
        $this->customerId = $customerId;
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
        return new PresenceChannel('customers-presence');
    }

    public function broadcastAs()
    {
        return 'viewing-update';
    }

    public function broadcastWith()
    {
        return [
            'customer_id' => $this->customerId,
            'username' => $this->username,
            'action' => $this->action,
        ];
    }
}

<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TransactionRevertViewingUpdate implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $revertId;
    public $username;
    public $action;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($revertId, $username, $action)
    {
        $this->revertId = $revertId;
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
        return new PresenceChannel('transaction-reverts-presence');
    }

    public function broadcastAs()
    {
        return 'viewing-update';
    }

    public function broadcastWith()
    {
        return [
            'revert_id' => $this->revertId,
            'username' => $this->username,
            'action' => $this->action,
        ];
    }
}

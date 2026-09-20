<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TransactionViewingUpdate implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $transactionId;
    public $username;
    public $action;

    /**
     * Create a new event instance.
     *
     * @return void
     */
    public function __construct($transactionId, $username, $action)
    {
        $this->transactionId = $transactionId;
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
        return new PresenceChannel('transactions-presence');
    }

    public function broadcastAs()
    {
        return 'viewing-update';
    }

    public function broadcastWith()
    {
        return [
            'transaction_id' => $this->transactionId,
            'username' => $this->username,
            'action' => $this->action,
        ];
    }
}

<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ExpensesCategoryUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $data;

    public function __construct(array $data = [])
    {
        $this->data = $data;
    }

    public function broadcastOn()
    {
        return new Channel('expenses-categories');
    }

    public function broadcastAs()
    {
        return 'expenses-category-updated';
    }

    public function broadcastWith()
    {
        return $this->data;
    }
}

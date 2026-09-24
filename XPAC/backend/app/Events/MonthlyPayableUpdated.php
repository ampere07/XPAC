<?php

declare(strict_types=1);

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcast after any write to a payable or its payment ledger. Two listeners care: the
 * Monthly Payables page (refreshes the table and metric cards) and the sidebar (refreshes
 * the overdue / due-today badge, which is visible from every other page).
 */
class MonthlyPayableUpdated implements ShouldBroadcastNow
{
    use Dispatchable;
    use InteractsWithSockets;
    use SerializesModels;

    public $data;

    public function __construct(array $data = [])
    {
        $this->data = $data;
    }

    public function broadcastOn(): Channel
    {
        return new Channel('monthly-payables');
    }

    public function broadcastAs(): string
    {
        return 'monthly-payables-updated';
    }

    public function broadcastWith(): array
    {
        return $this->data;
    }
}

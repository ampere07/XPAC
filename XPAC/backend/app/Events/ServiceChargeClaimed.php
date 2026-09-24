<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A technician put a service charge on a completed visit.
 *
 * Broadcast so the charge reaches the dashboard the moment it is claimed rather
 * than on the notification feed's next poll — the same treatment JobOrderDone
 * gets, and for the same reason: money landing on a customer's balance is worth
 * seeing immediately.
 *
 * On its own 'service-charges' channel rather than the shared 'service-orders'
 * one: ServiceOrder, SOcharge and Support all call pusher.unsubscribe('service-orders')
 * when they unmount, which drops the channel for every other listener including the
 * header. A channel nobody else tears down keeps the header's binding alive for the
 * whole session.
 */
class ServiceChargeClaimed implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $serviceChargeData;

    public function __construct(array $serviceChargeData)
    {
        $this->serviceChargeData = $serviceChargeData;
    }

    public function broadcastOn()
    {
        return new Channel('service-charges');
    }

    public function broadcastAs()
    {
        return 'service-charge-claimed';
    }

    public function broadcastWith()
    {
        return $this->serviceChargeData;
    }
}

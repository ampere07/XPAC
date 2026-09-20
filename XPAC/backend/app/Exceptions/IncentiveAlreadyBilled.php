<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A completed quota incentive was claimed by another invoice first.
 *
 * Thrown by AgentInvoiceService when its conditional claim
 * (`... SET agent_invoice_id = ? WHERE agent_invoice_id IS NULL`) updates fewer
 * rows than it asked for. That can only mean another invoice run took one of
 * them between this run's read and its write.
 *
 * It is not an error condition so much as a race resolved in the safe
 * direction: it aborts the surrounding transaction, so the invoice that would
 * have paid an already-paid quota is never issued. A later run bills whatever
 * quotas genuinely remain unclaimed.
 *
 * Its own class rather than a bare RuntimeException so the invoice run can tell
 * this apart from a real failure and report it as a skip.
 */
class IncentiveAlreadyBilled extends RuntimeException
{
}

<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\PaymentMethod;
use App\Models\Transaction;
use Illuminate\Support\Facades\Log;

/**
 * Resolves a transaction into the flat, always-populated shape a receipt is printed from.
 *
 * Rows written by this system carry every field the slip needs and hydrate their
 * `account.customer` relation cleanly. Rows carried over from the old database do not, and
 * they are the reason this class exists:
 *
 *   - `or_no` is frequently NULL. The old system issued OR numbers out of band, so the column
 *     was never backfilled.
 *   - `payment_method` holds the payment_methods ROW ID on migrated rows and the method NAME
 *     on rows written since. The Eloquent relation joins on the name, so it simply comes back
 *     null for half the table and the slip prints a bare "3".
 *   - `date_processed` and `payment_date` are both NULL where the old export had only a
 *     created date.
 *   - The `account` relation misses whenever the account_no on the transaction no longer
 *     matches a billing_accounts row — closed accounts, and account numbers that picked up
 *     padding or whitespace in the export. That takes the customer name, contact and address
 *     with it, which is most of the slip.
 *
 * Every field therefore resolves through a chain that ends in a printable literal, never in
 * null: a receipt that is missing a line is a bad receipt, but a receipt that throws or
 * renders blank is a counter that cannot serve the customer in front of it.
 *
 * Read-only. Safe to call as often as a client asks — printing the same receipt twice must
 * produce the same slip and must not write anything.
 */
class TransactionReceiptFormatter
{
    /** Printed wherever a value cannot be resolved at all. */
    public const PLACEHOLDER = '-';

    /**
     * Statuses that mean the payment was never collected, so no receipt may be issued for it.
     *
     * An exclusion list rather than an allow-list of 'Done'. The current vocabulary is
     * Pending/Done/Processing/Cancelled/Failed, but migrated rows also carry 'Approved',
     * 'Completed', 'Paid' and NULL — all of them settled money that a customer can ask to have
     * reprinted. Listing what is NOT collectable keeps those printable without having to
     * enumerate every spelling the old system used.
     */
    private const UNSETTLED_STATUSES = [
        'pending',
        'processing',
        'cancelled',
        'canceled',
        'failed',
        'void',
        'voided',
        'reverted',
        'declined',
    ];

    /**
     * May a receipt be printed for this transaction?
     *
     * A blank or NULL status counts as settled: it only occurs on migrated history, where the
     * row exists precisely because the money was taken.
     */
    public function isPrintable(?string $status): bool
    {
        $normalised = strtolower(trim((string) $status));

        if ($normalised === '') {
            return true;
        }

        return !in_array($normalised, self::UNSETTLED_STATUSES, true);
    }

    /**
     * The print-ready projection of one transaction.
     *
     * Keys mirror the frontend's ReceiptData so the client can hand the block straight to the
     * template. Amounts are returned as a number, not a formatted string — currency formatting
     * is the template's job, and doing it here would hard-code a locale into the API.
     *
     * @return array<string,mixed>
     */
    public function format(Transaction $transaction): array
    {
        $customer = $this->resolveCustomer($transaction);
        $paidAt = $this->resolvePaidAt($transaction);

        return [
            'transaction_id' => $transaction->id,
            'receipt_no' => $this->firstFilled([
                $transaction->or_no,
                $transaction->reference_no,
                $transaction->id,
            ]),
            'or_no' => $this->firstFilled([$transaction->or_no], null),
            'reference_no' => $this->firstFilled([$transaction->reference_no], null),
            // ISO-8601 so the client formats it in the viewer's locale rather than parsing a
            // display string back into a date.
            'paid_at' => $paidAt ? $paidAt->toIso8601String() : null,
            'account_no' => $this->firstFilled([
                // The transaction's OWN column first. The relation is the richer source but the
                // one that goes missing, and the account number is printed on every slip.
                $transaction->account_no,
                $transaction->account->account_no ?? null,
            ]),
            'customer_name' => $this->firstFilled([$customer['name'] ?? null]),
            'contact' => $this->firstFilled([$customer['contact'] ?? null]),
            'address' => $this->firstFilled([$customer['address'] ?? null], ''),
            'plan' => $this->firstFilled([$customer['plan'] ?? null], null),
            'description' => $this->firstFilled([$transaction->transaction_type], 'Payment'),
            'amount' => $this->toAmount($transaction->received_payment),
            'payment_method' => $this->resolvePaymentMethod($transaction),
            'processed_by' => $this->firstFilled([
                $transaction->processor->full_name ?? null,
                $transaction->processed_by_user,
                $transaction->approved_by,
                $transaction->created_by_user,
            ], null),
            'remarks' => $this->firstFilled([$transaction->remarks], null),
            'status' => $this->firstFilled([$transaction->status], null),
            'is_printable' => $this->isPrintable($transaction->status),
        ];
    }

    /**
     * Customer details, through the relation when it hydrated and through account_no when it
     * did not.
     *
     * The direct lookup is only attempted when the relation came back empty, so a healthy row
     * costs no extra query. `customers.account_no` is denormalised alongside the billing
     * account, which is what makes the fallback possible for a transaction whose billing
     * account has since been closed or renumbered.
     *
     * @return array<string,string|null>
     */
    private function resolveCustomer(Transaction $transaction): array
    {
        $customer = $transaction->account->customer ?? null;

        if (!$customer && filled($transaction->account_no)) {
            try {
                $customer = Customer::where('account_no', trim((string) $transaction->account_no))->first();
            } catch (\Throwable $e) {
                // A receipt without an address still prints. Losing the whole slip because the
                // fallback lookup failed would not be an improvement.
                Log::warning('Receipt customer fallback lookup failed', [
                    'transaction_id' => $transaction->id,
                    'account_no' => $transaction->account_no,
                    'error' => $e->getMessage(),
                ]);
                $customer = null;
            }
        }

        if (!$customer) {
            return ['name' => null, 'contact' => null, 'address' => null, 'plan' => null];
        }

        $address = array_filter([
            $customer->address ?? null,
            $customer->barangay ?? null,
            $customer->city ?? null,
            $customer->region ?? null,
        ], fn ($part) => filled($part));

        return [
            'name' => $this->firstFilled([$customer->full_name ?? null], null),
            'contact' => $this->firstFilled([
                $customer->contact_number_primary ?? null,
                $customer->contact_number_secondary ?? null,
            ], null),
            'address' => implode(', ', $address),
            'plan' => $this->firstFilled([$customer->desired_plan ?? null], null),
        ];
    }

    /**
     * The moment the payment is dated, in preference order.
     *
     * created_at is the last resort and is always present, which is what stops a migrated row
     * with no payment dates printing "No date".
     */
    private function resolvePaidAt(Transaction $transaction)
    {
        foreach (['date_processed', 'payment_date', 'created_at', 'updated_at'] as $column) {
            $value = $transaction->{$column} ?? null;

            if (blank($value)) {
                continue;
            }

            try {
                return $value instanceof \DateTimeInterface
                    ? \Carbon\Carbon::instance($value)
                    : \Carbon\Carbon::parse($value);
            } catch (\Throwable $e) {
                // Unparseable date on a migrated row — try the next column rather than failing.
                continue;
            }
        }

        return null;
    }

    /**
     * The human-readable payment method name.
     *
     * Handles both storage shapes: rows written by this system hold the NAME (and hydrate
     * paymentMethodInfo), migrated rows hold the numeric row ID. A numeric value is looked up
     * by id; anything else is already the name and is returned as written, because a method
     * that has since been deleted from payment_methods must still print as what the customer
     * paid with.
     */
    private function resolvePaymentMethod(Transaction $transaction): string
    {
        $fromRelation = $transaction->paymentMethodInfo->payment_method ?? null;

        if (filled($fromRelation)) {
            return (string) $fromRelation;
        }

        $raw = $transaction->payment_method;

        if (blank($raw)) {
            return self::PLACEHOLDER;
        }

        if (is_numeric($raw)) {
            try {
                $name = PaymentMethod::where('id', (int) $raw)->value('payment_method');

                if (filled($name)) {
                    return (string) $name;
                }
            } catch (\Throwable $e) {
                Log::warning('Receipt payment method lookup failed', [
                    'transaction_id' => $transaction->id,
                    'payment_method' => $raw,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return (string) $raw;
    }

    /**
     * The paid amount as a float.
     *
     * `received_payment` arrives as a decimal-cast string, and on migrated rows it can be NULL
     * or carry thousands separators from the old export. Anything that is not a number becomes
     * 0.0 — the frontend formats with toFixed(), and a NaN there renders the literal "₱NaN".
     */
    private function toAmount($value): float
    {
        if (is_numeric($value)) {
            return (float) $value;
        }

        if (is_string($value)) {
            $stripped = preg_replace('/[^0-9.\-]/', '', $value) ?? '';

            if (is_numeric($stripped)) {
                return (float) $stripped;
            }
        }

        return 0.0;
    }

    /**
     * The first candidate that is not null/blank, or $fallback when there is none.
     */
    private function firstFilled(array $candidates, ?string $fallback = self::PLACEHOLDER): ?string
    {
        foreach ($candidates as $candidate) {
            if (filled($candidate)) {
                return trim((string) $candidate);
            }
        }

        return $fallback;
    }
}

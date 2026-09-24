<?php

declare(strict_types=1);

namespace App\Http\Requests;

/**
 * Logging one payment against a payable.
 *
 * Shape only. The overpayment check lives in the controller because it needs the
 * org-scoped payable that the controller has already fetched — resolving it a second time
 * here would both duplicate the query and re-implement the org rule in a place that has
 * no business knowing it.
 */
class RecordPaymentRequest extends PayableFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normalise();
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'amount'         => ['required', 'numeric', 'min:0.01', 'max:' . self::MAX_MONEY],
            'payment_date'   => ['required', 'date'],
            'payment_method' => ['nullable', 'string', 'max:100'],
            'reference_no'   => ['nullable', 'string', 'max:150'],
            'notes'          => ['nullable', 'string', 'max:5000'],
            'receipt'        => ['nullable', 'file', 'mimes:jpg,jpeg,png,gif,webp,pdf', 'max:10240'],
            'receipt_path'   => ['nullable', 'string', 'max:500'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'amount.min' => 'Payment amount must be greater than zero.',
        ];
    }
}

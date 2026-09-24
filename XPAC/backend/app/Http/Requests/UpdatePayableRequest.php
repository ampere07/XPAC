<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\MonthlyPayable;
use Illuminate\Validation\Rule;

/**
 * Editing an existing payable. Same shape as StorePayableRequest with every field
 * optional, so a partial PATCH-style body is legal — but a field that IS sent still has
 * to be valid rather than silently nulled.
 */
class UpdatePayableRequest extends PayableFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normalise(['is_recurring']);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'title'          => ['sometimes', 'required', 'string', 'max:200'],
            'category_id'    => ['sometimes', 'required', 'integer', 'exists:expenses_category,id'],
            'vendor_name'    => ['nullable', 'string', 'max:200'],
            'account_number' => ['nullable', 'string', 'max:100'],
            'amount_due'     => ['sometimes', 'required', 'numeric', 'min:0.01', 'max:' . self::MAX_MONEY],
            'due_date'       => ['sometimes', 'required', 'date'],
            'billing_month'  => ['sometimes', 'required', 'string', self::BILLING_MONTH_REGEX],
            'status'         => [
                'nullable',
                Rule::in([MonthlyPayable::STATUS_PENDING, MonthlyPayable::STATUS_CANCELLED]),
            ],
            'is_recurring'   => ['nullable', 'boolean'],
            'notes'          => ['nullable', 'string', 'max:5000'],
            'receipt'        => ['nullable', 'file', 'mimes:jpg,jpeg,png,gif,webp,pdf', 'max:10240'],
            'receipt_path'   => ['nullable', 'string', 'max:500'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'billing_month.regex' => 'Billing month must be in YYYY-MM format (e.g. 2026-08).',
            'amount_due.min'      => 'Amount due must be greater than zero.',
            'category_id.exists'  => 'Selected category does not exist.',
            'status.in'           => 'Only pending and cancelled can be set directly; the rest follow the payments.',
        ];
    }
}

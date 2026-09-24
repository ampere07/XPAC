<?php

declare(strict_types=1);

namespace App\Http\Requests;

/**
 * Rolling the recurring payables of one billing month forward into another.
 *
 * `source_month` defaults to the month before `billing_month` in the controller, which is
 * the normal case: on the 1st, generate this month from last month's templates.
 */
class GeneratePayableBatchRequest extends PayableFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normalise();
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'billing_month' => ['required', 'string', self::BILLING_MONTH_REGEX],
            'source_month'  => ['nullable', 'string', self::BILLING_MONTH_REGEX],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'billing_month.regex' => 'Billing month must be in YYYY-MM format (e.g. 2026-08).',
            'source_month.regex'  => 'Source month must be in YYYY-MM format (e.g. 2026-07).',
        ];
    }
}

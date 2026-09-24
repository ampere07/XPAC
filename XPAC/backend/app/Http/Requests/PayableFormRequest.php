<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * Shared base for the Monthly Payables form requests.
 *
 * Exists for one reason: Laravel's default 422 body is `{message, errors}`, but every
 * other endpoint in this app answers `{status, message, errors}` and the frontend service
 * layer keys off `status`. Overriding failedValidation here keeps the new module's error
 * shape identical to the sibling Expenses endpoints instead of a second dialect.
 *
 * Authorisation is route-level (`auth:sanctum`) and org-level (the controller's scoped
 * lookups), so authorize() is not a second gate.
 */
abstract class PayableFormRequest extends FormRequest
{
    /** 'YYYY-MM', months 01–12 only. */
    protected const BILLING_MONTH_REGEX = 'regex:/^\d{4}-(0[1-9]|1[0-2])$/';

    /** DECIMAL(12,2) ceiling — anything larger silently truncates on insert. */
    protected const MAX_MONEY = 9999999999.99;

    public function authorize(): bool
    {
        return true;
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json([
            'status'  => 'error',
            'message' => 'Validation failed',
            'errors'  => $validator->errors(),
        ], 422));
    }

    /**
     * Multipart bodies stringify everything, so a checkbox arrives as "1"/"0"/"true" and
     * an untouched optional field arrives as "". Normalise both before the rules run:
     * `boolean` would reject "true" from FormData, and `nullable|date` would reject "".
     *
     * @param string[] $booleans
     */
    protected function normalise(array $booleans = []): void
    {
        $input = $this->all();

        foreach ($booleans as $key) {
            if (array_key_exists($key, $input)) {
                $input[$key] = filter_var($input[$key], FILTER_VALIDATE_BOOLEAN);
            }
        }

        foreach ($input as $key => $value) {
            if ($value === '') {
                $input[$key] = null;
            }
        }

        $this->replace($input);
    }
}

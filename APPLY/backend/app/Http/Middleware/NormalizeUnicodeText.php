<?php

namespace App\Http\Middleware;

use App\Support\TextNormalizer;
use Illuminate\Foundation\Http\Middleware\TransformsRequest;

/**
 * Folds styled Unicode ("fancy font") input back to plain characters on the
 * way in, before validation and before anything is persisted.
 *
 * This sits in the global stack rather than in the application form's
 * controller so it cannot be sidestepped: a request built by hand against the
 * API is normalized on exactly the same terms as one the form sends.
 *
 * @see \App\Support\TextNormalizer for what is and is not rewritten.
 */
class NormalizeUnicodeText extends TransformsRequest
{
    /**
     * Fields whose bytes must survive verbatim. A password is compared as it
     * was typed, and a token is matched byte for byte; rewriting either would
     * lock someone out.
     *
     * @var array<int, string>
     */
    protected $except = [
        'password',
        'password_confirmation',
        'current_password',
        'new_password',
        'token',
        'api_token',
        '_token',
    ];

    /**
     * @param  string  $key
     * @param  mixed  $value
     * @return mixed
     */
    protected function transform($key, $value)
    {
        if (in_array($key, $this->except, true) || !is_string($value)) {
            return $value;
        }

        return TextNormalizer::normalize($value);
    }
}

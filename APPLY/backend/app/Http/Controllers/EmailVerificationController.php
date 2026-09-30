<?php

namespace App\Http\Controllers;

use App\Services\EmailVerificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * Public endpoints behind the application form's "Send" and "Verify" buttons.
 *
 * Neither response ever contains the code. The verify response carries an opaque
 * token instead, which the form sends with the application.
 */
class EmailVerificationController extends Controller
{
    public function __construct(private EmailVerificationService $verification)
    {
    }

    public function send(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email|max:255',
        ], [
            'email.required' => 'Please enter your email address first.',
            'email.email' => 'Please enter a valid email address.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first('email'),
            ], 422);
        }

        $result = $this->verification->sendCode($request->input('email'));

        return response()->json([
            'success' => $result['ok'],
            'message' => $result['message'],
            'retry_after' => $result['retry_after'] ?? null,
        ], $result['status']);
    }

    public function verify(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email|max:255',
            'code' => 'required|string|max:20',
        ], [
            'email.required' => 'Please enter your email address first.',
            'email.email' => 'Please enter a valid email address.',
            'code.required' => 'Please enter the 6-character code from the email.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first(),
            ], 422);
        }

        $result = $this->verification->verifyCode($request->input('email'), $request->input('code'));

        return response()->json(array_filter([
            'success' => $result['ok'],
            'message' => $result['message'],
            'verification_token' => $result['token'] ?? null,
        ], fn ($v) => $v !== null), $result['status']);
    }
}

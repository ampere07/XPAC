<?php

namespace App\Services;

use App\Models\BillingAccount;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The next billing account number.
 *
 * Moved here unchanged from JobOrderController so job order approval and the SuperAdmin direct
 * add hand out numbers from one sequence. (The AccountNumberGenerator trait is an older, unused
 * copy with different rules; it is not this.)
 *
 * The prefix is custom_account_number.starting_number; the number after it continues from the
 * highest existing account with that prefix, at least 4 digits wide. Locks billing_accounts, so
 * call it inside the transaction that creates the account.
 */
class AccountNumberService
{
    public function next(): string
    {
        DB::table('billing_accounts')->lockForUpdate()->get();

        $customAccountNumber = DB::table('custom_account_number')->first();

        if (!$customAccountNumber) {
            Log::info('No custom_account_number record found, using default generation');
            return $this->nextDefault();
        }

        $prefix = $customAccountNumber->starting_number;

        if ($prefix === null) {
            $prefix = '';
        } else {
            $prefix = (string)$prefix;
        }

        Log::info('Custom account number config', [
            'prefix' => $prefix,
            'prefix_length' => strlen($prefix)
        ]);

        $prefixLength = strlen($prefix);
        $minIncrementLength = 4;

        $pattern = '^' . preg_quote($prefix, '/') . '\d+$';

        $latestAccount = BillingAccount::where('account_no', 'REGEXP', $pattern)
            ->where('account_no', 'LIKE', $prefix . '%')
            ->orderByRaw('LENGTH(account_no) DESC, account_no DESC')
            ->lockForUpdate()
            ->first();

        Log::info('Latest account search', [
            'prefix' => $prefix,
            'pattern' => $pattern,
            'found' => $latestAccount ? $latestAccount->account_no : 'none'
        ]);

        if ($latestAccount) {
            $numericPart = substr($latestAccount->account_no, $prefixLength);
            $lastIncrement = (int)$numericPart;
            $lastIncrementLength = strlen($numericPart);
            $nextIncrement = $lastIncrement + 1;

            $nextIncrementLength = max($lastIncrementLength, strlen((string)$nextIncrement));

            Log::info('Incrementing from existing account', [
                'last_account' => $latestAccount->account_no,
                'last_increment' => $lastIncrement,
                'last_increment_length' => $lastIncrementLength,
                'next_increment' => $nextIncrement,
                'next_increment_length' => $nextIncrementLength
            ]);
        } else {
            $nextIncrement = 1;
            $nextIncrementLength = $minIncrementLength;

            Log::info('No existing account found, starting from 1', [
                'next_increment' => $nextIncrement,
                'next_increment_length' => $nextIncrementLength
            ]);
        }

        $newAccountNumber = $prefix . str_pad($nextIncrement, $nextIncrementLength, '0', STR_PAD_LEFT);

        Log::info('Generated account number', [
            'account_number' => $newAccountNumber,
            'prefix' => $prefix,
            'increment' => $nextIncrement,
            'increment_length' => $nextIncrementLength
        ]);

        return $newAccountNumber;
    }

    private function nextDefault(): string
    {
        $latestAccount = BillingAccount::orderBy('account_no', 'desc')
            ->lockForUpdate()
            ->first();

        if ($latestAccount && is_numeric($latestAccount->account_no)) {
            $nextNumber = (int) $latestAccount->account_no + 1;
            return str_pad($nextNumber, 4, '0', STR_PAD_LEFT);
        }

        return '0001';
    }
}

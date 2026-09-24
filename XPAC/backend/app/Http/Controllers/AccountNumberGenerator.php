<?php

namespace App\Http\Controllers;

use App\Models\BillingAccount;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

trait AccountNumberGenerator
{
    private function generateAccountNumber(): string
    {
        try {
            DB::table('billing_accounts')->lockForUpdate()->get();
            
            Log::info('=== ACCOUNT NUMBER GENERATION START ===');
            
            $customAccountNumber = DB::table('custom_account_number')->first();
            
            Log::info('Custom Account Number Table Query', [
                'table_exists' => DB::getSchemaBuilder()->hasTable('custom_account_number'),
                'record_exists' => $customAccountNumber ? true : false,
                'data' => $customAccountNumber,
                'starting_number_value' => $customAccountNumber ? $customAccountNumber->starting_number : 'N/A',
                'starting_number_is_null' => $customAccountNumber ? ($customAccountNumber->starting_number === null) : 'N/A',
                'starting_number_is_empty' => $customAccountNumber ? ($customAccountNumber->starting_number === '') : 'N/A'
            ]);
            
            if (!$customAccountNumber) {
                Log::warning('custom_account_number table is empty - falling back to default generation');
                return $this->generateDefaultAccountNumber();
            }
            
            if ($customAccountNumber->starting_number === null || $customAccountNumber->starting_number === '') {
                Log::warning('starting_number is null or empty - falling back to default generation', [
                    'starting_number' => $customAccountNumber->starting_number,
                    'is_null' => $customAccountNumber->starting_number === null,
                    'is_empty' => $customAccountNumber->starting_number === ''
                ]);
                return $this->generateDefaultAccountNumber();
            }
            
            $startingNumber = trim($customAccountNumber->starting_number);
            
            Log::info('Processing starting_number from database', [
                'raw_value' => $customAccountNumber->starting_number,
                'trimmed_value' => $startingNumber,
                'length' => strlen($startingNumber)
            ]);
            
            if (!preg_match('/^([A-Za-z]*)(\d+)$/', $startingNumber, $matches)) {
                Log::error('Invalid starting_number format - does not match pattern', [
                    'starting_number' => $startingNumber,
                    'expected_pattern' => '^([A-Za-z]*)(\d+)$',
                    'expected_examples' => ['ABC123', '0001', 'GOWISER100']
                ]);
                return $this->generateDefaultAccountNumber();
            }
            
            $prefix = $matches[1];
            $numericPart = $matches[2];
            $numLength = strlen($numericPart);
            
            Log::info('Parsed starting_number components successfully', [
                'prefix' => $prefix ? $prefix : '(none)',
                'numeric_part' => $numericPart,
                'numeric_length' => $numLength,
                'has_prefix' => !empty($prefix)
            ]);
            
            if (!empty($prefix)) {
                $latestAccount = BillingAccount::where('account_no', 'LIKE', $prefix . '%')
                    ->orderBy('account_no', 'desc')
                    ->lockForUpdate()
                    ->first();
                
                Log::info('Searching for latest account with prefix', [
                    'prefix' => $prefix,
                    'search_pattern' => $prefix . '%',
                    'found' => $latestAccount ? true : false,
                    'latest_account_no' => $latestAccount ? $latestAccount->account_no : 'none',
                    'latest_account_id' => $latestAccount ? $latestAccount->id : 'none'
                ]);
                
                if ($latestAccount && preg_match('/^' . preg_quote($prefix, '/') . '(\d+)$/', $latestAccount->account_no, $accountMatches)) {
                    $lastNumber = (int) $accountMatches[1];
                    $nextNumber = $lastNumber + 1;
                    
                    Log::info('Incrementing from existing prefixed account', [
                        'last_account_no' => $latestAccount->account_no,
                        'last_number_extracted' => $lastNumber,
                        'next_number' => $nextNumber
                    ]);
                } else {
                    $nextNumber = (int) $numericPart;
                    
                    Log::info('No existing prefixed accounts found - using starting number', [
                        'next_number' => $nextNumber,
                        'from_starting_number' => $numericPart
                    ]);
                }
                
                $generatedAccountNumber = $prefix . str_pad($nextNumber, $numLength, '0', STR_PAD_LEFT);
                
                Log::info('Generated prefixed account number', [
                    'prefix' => $prefix,
                    'next_number' => $nextNumber,
                    'padded_length' => $numLength,
                    'generated_account_number' => $generatedAccountNumber
                ]);
            } else {
                $latestAccount = BillingAccount::where('account_no', 'REGEXP', '^[0-9]+$')
                    ->orderBy(DB::raw('CAST(account_no AS UNSIGNED)'), 'desc')
                    ->lockForUpdate()
                    ->first();
                
                Log::info('Searching for latest numeric-only account', [
                    'search_pattern' => '^[0-9]+$',
                    'found' => $latestAccount ? true : false,
                    'latest_account_no' => $latestAccount ? $latestAccount->account_no : 'none',
                    'latest_account_id' => $latestAccount ? $latestAccount->id : 'none'
                ]);
                
                if ($latestAccount && is_numeric($latestAccount->account_no)) {
                    $nextNumber = (int) $latestAccount->account_no + 1;
                    
                    Log::info('Incrementing from existing numeric account', [
                        'last_account_no' => $latestAccount->account_no,
                        'next_number' => $nextNumber
                    ]);
                } else {
                    $nextNumber = (int) $numericPart;
                    
                    Log::info('No existing numeric accounts - using starting number', [
                        'next_number' => $nextNumber,
                        'from_starting_number' => $numericPart
                    ]);
                }
                
                $generatedAccountNumber = str_pad($nextNumber, $numLength, '0', STR_PAD_LEFT);
                
                Log::info('Generated numeric account number', [
                    'next_number' => $nextNumber,
                    'padded_length' => $numLength,
                    'generated_account_number' => $generatedAccountNumber
                ]);
            }
            
            Log::info('=== ACCOUNT NUMBER GENERATED SUCCESSFULLY ===', [
                'generated_account_number' => $generatedAccountNumber,
                'generation_method' => 'custom_account_number_table',
                'used_prefix' => !empty($prefix),
                'prefix_value' => $prefix ?? 'none'
            ]);
            
            return $generatedAccountNumber;
            
        } catch (\Exception $e) {
            Log::error('=== ACCOUNT NUMBER GENERATION ERROR ===', [
                'error_message' => $e->getMessage(),
                'error_file' => $e->getFile(),
                'error_line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]);
            
            Log::warning('Falling back to default account number generation due to error');
            return $this->generateDefaultAccountNumber();
        }
    }

    private function generateDefaultAccountNumber(): string
    {
        Log::info('=== USING DEFAULT ACCOUNT NUMBER GENERATION ===');
        
        $latestAccount = BillingAccount::orderBy('id', 'desc')
            ->lockForUpdate()
            ->first();
        
        Log::info('Searching for latest account by ID', [
            'found' => $latestAccount ? true : false,
            'latest_id' => $latestAccount ? $latestAccount->id : 'none',
            'latest_account_no' => $latestAccount ? $latestAccount->account_no : 'none',
            'is_numeric' => $latestAccount ? is_numeric($latestAccount->account_no) : false
        ]);
        
        if ($latestAccount && is_numeric($latestAccount->account_no)) {
            $nextNumber = (int) $latestAccount->account_no + 1;
            $generatedAccountNumber = str_pad($nextNumber, 4, '0', STR_PAD_LEFT);
            
            Log::info('Generated account number from latest record', [
                'last_account_no' => $latestAccount->account_no,
                'last_id' => $latestAccount->id,
                'next_number' => $nextNumber,
                'generated_account_number' => $generatedAccountNumber
            ]);
        } else {
            $generatedAccountNumber = '0001';
            
            Log::info('No numeric accounts found - using initial value', [
                'generated_account_number' => $generatedAccountNumber,
                'reason' => $latestAccount ? 'latest account is not numeric' : 'no accounts exist'
            ]);
        }
        
        Log::info('=== DEFAULT ACCOUNT NUMBER GENERATED ===', [
            'generated_account_number' => $generatedAccountNumber,
            'generation_method' => 'default_fallback'
        ]);
        
        return $generatedAccountNumber;
    }
}

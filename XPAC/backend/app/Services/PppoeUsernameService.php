<?php

namespace App\Services;

use App\Models\PPPoEUsernamePattern;
use Illuminate\Support\Facades\DB;

class PppoeUsernameService
{
    public function generateUsername(array $customerData): string
    {
        $pattern = PPPoEUsernamePattern::getUsernamePattern();
        
        if (!$pattern) {
            return $this->generateFallbackUsername($customerData);
        }

        $sequence = $pattern->sequence;
        
        if (!is_array($sequence)) {
            return $this->generateFallbackUsername($customerData);
        }

        $usernameParts = [];

        foreach ($sequence as $part) {
            $type = $part['type'] ?? '';
            
            if ($type === 'tech_input') {
                $value = $customerData['tech_input_username'] ?? '';
            } else {
                $value = $this->getValueForType($type, $customerData);
            }
            
            if ($value) {
                $usernameParts[] = $value;
            }
        }

        $username = implode('', $usernameParts);
        
        return $this->sanitizeUsername($username);
    }

    public function generatePassword(array $customerData): string
    {
        $pattern = PPPoEUsernamePattern::getPasswordPattern();
        
        if (!$pattern) {
            return $this->generateRandomPassword();
        }

        $sequence = $pattern->sequence;
        
        if (!is_array($sequence)) {
            return $this->generateRandomPassword();
        }

        $passwordParts = [];

        foreach ($sequence as $part) {
            $type = $part['type'] ?? '';
            
            if ($type === 'custom_password') {
                $value = $part['value'] ?? $customerData['custom_password'] ?? '';
            } else {
                $value = $this->getValueForType($type, $customerData);
            }
            
            if ($value) {
                $passwordParts[] = $value;
            }
        }

        $password = implode('', $passwordParts);
        
        if (empty($password) || strlen($password) < 6) {
            return $this->generateRandomPassword();
        }
        
        return $this->sanitizePassword($password);
    }

    private function getValueForType(string $type, array $customerData): string
    {
        $firstName = $customerData['first_name'] ?? '';
        $middleInitial = $customerData['middle_initial'] ?? '';
        $lastName = $customerData['last_name'] ?? '';
        $mobileNumber = $customerData['mobile_number'] ?? '';

        switch ($type) {
            case 'first_name':
                return strtolower($firstName);
            
            case 'first_name_capitalized':
                return ucfirst(strtolower($firstName));
            
            case 'first_name_initial':
                return strtolower(substr($firstName, 0, 1));
            
            case 'middle_name':
                return strtolower($middleInitial);
            
            case 'middle_name_capitalized':
                return ucfirst(strtolower($middleInitial));
            
            case 'middle_name_initial':
                return strtolower(substr($middleInitial, 0, 1));
            
            case 'last_name':
                return strtolower($lastName);
            
            case 'last_name_capitalized':
                return ucfirst(strtolower($lastName));
            
            case 'last_name_initial':
                return strtolower(substr($lastName, 0, 1));
            
            case 'mobile_number':
                return preg_replace('/[^0-9]/', '', $mobileNumber);
            
            case 'mobile_number_last_4':
                $cleaned = preg_replace('/[^0-9]/', '', $mobileNumber);
                return substr($cleaned, -4);
            
            case 'mobile_number_last_6':
                $cleaned = preg_replace('/[^0-9]/', '', $mobileNumber);
                return substr($cleaned, -6);
            
            case 'lcp':
                // Get LCP value directly from customerData (already has LP prefix in database)
                $lcpValue = $customerData['lcp'] ?? '';
                return strtoupper($lcpValue);
            
            case 'nap':
                // Get NAP value directly from customerData (already has NP prefix in database)
                $napValue = $customerData['nap'] ?? '';
                return strtoupper($napValue);

            case 'port':
                return strtoupper($customerData['port'] ?? '');

            case 'date_installed':
                // Installation date AND time as a digits-only string (YYYYMMDDHHMMSS),
                // e.g. "2026-07-10 14:30:45" => "20260710143045". All separators
                // (dashes, colons, spaces) are stripped so it is username-safe.
                $dateInstalled = $customerData['date_installed'] ?? null;
                if (empty($dateInstalled)) {
                    return '';
                }
                try {
                    return \Carbon\Carbon::parse($dateInstalled)->format('YmdHis');
                } catch (\Throwable $e) {
                    return '';
                }

            case 'random_4_digits':
                return str_pad(random_int(0, 9999), 4, '0', STR_PAD_LEFT);
            
            case 'random_6_digits':
                return str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            
            case 'random_letters_4':
                return $this->generateRandomString(4, 'letters');
            
            case 'random_letters_6':
                return $this->generateRandomString(6, 'letters');
            
            case 'random_alphanumeric_4':
                return $this->generateRandomString(4, 'alphanumeric');
            
            case 'random_alphanumeric_6':
                return $this->generateRandomString(6, 'alphanumeric');
            
            case 'custom_password':
                return $customerData['custom_password'] ?? '';
            
            default:
                return '';
        }
    }

    private function generateRandomString(int $length, string $type = 'alphanumeric'): string
    {
        $characters = match($type) {
            'letters' => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
            'digits' => '0123456789',
            'alphanumeric' => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
            default => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        };
        
        $result = '';
        $charactersLength = strlen($characters);
        
        for ($i = 0; $i < $length; $i++) {
            $result .= $characters[random_int(0, $charactersLength - 1)];
        }
        
        return $result;
    }

    private function generateRandomPassword(int $length = 12): string
    {
        $characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $password = '';
        $charactersLength = strlen($characters);
        
        for ($i = 0; $i < $length; $i++) {
            $password .= $characters[random_int(0, $charactersLength - 1)];
        }
        
        return $password;
    }

    private function generateFallbackUsername(array $customerData): string
    {
        $lastName = strtolower($customerData['last_name'] ?? '');
        $mobileNumber = preg_replace('/[^0-9]/', '', $customerData['mobile_number'] ?? '');
        
        $lastName = preg_replace('/\s+/', '', $lastName);
        
        return $lastName . $mobileNumber;
    }

    private function sanitizeUsername(string $username): string
    {
        // Remove special characters but keep alphanumeric (both upper and lowercase)
        $username = preg_replace('/[^a-zA-Z0-9]/', '', $username);
        $username = preg_replace('/\s+/', '', $username);
        
        return $username;
    }

    private function sanitizePassword(string $password): string
    {
        $password = preg_replace('/\s+/', '', $password);
        
        return $password;
    }

    /**
     * The PPPoE username after a customer's name is edited, or null when it cannot be worked out.
     *
     * Rewrites the OLD username in place rather than regenerating it from the pattern: a pattern
     * can include parts that only existed at install (random_* digits/letters, a technician's
     * tech_input, the install date, LCP/NAP/port at the time), and regenerating would change those
     * too. Instead, each name part of the pattern is located in the old username — in pattern
     * order, as the old name produced it — and only that slice is swapped for the new name's
     * value. Everything between the name parts is kept character for character.
     *
     * Returns null (caller leaves the username alone) when a name part cannot be found in the old
     * username, e.g. it was created under a different pattern or edited by hand. Returns the old
     * username unchanged when the edit does not touch any name part the pattern uses.
     *
     * @param array{first_name?:string, middle_initial?:string, last_name?:string} $oldNames
     * @param array{first_name?:string, middle_initial?:string, last_name?:string} $newNames
     */
    public function renameForNameChange(string $oldUsername, array $oldNames, array $newNames): ?string
    {
        $pattern = PPPoEUsernamePattern::getUsernamePattern();
        $sequence = $pattern && is_array($pattern->sequence)
            ? $pattern->sequence
            // generateFallbackUsername() starts with the last name.
            : [['type' => 'last_name']];

        $nameTypes = [
            'first_name', 'first_name_capitalized', 'first_name_initial',
            'middle_name', 'middle_name_capitalized', 'middle_name_initial',
            'last_name', 'last_name_capitalized', 'last_name_initial',
        ];

        // Parts whose length is fixed whatever they contain. While the cursor sits exactly at the
        // start of one (nothing of unknown length before it), it is stepped over, so a short name
        // token — an initial — cannot be "found" inside random letters or digits that precede it.
        $fixedLength = [
            'random_4_digits' => 4, 'random_6_digits' => 6,
            'random_letters_4' => 4, 'random_letters_6' => 6,
            'random_alphanumeric_4' => 4, 'random_alphanumeric_6' => 6,
            'mobile_number_last_4' => 4, 'mobile_number_last_6' => 6,
        ];

        $result = '';
        $cursor = 0;
        $cursorExact = true;

        foreach ($sequence as $part) {
            $type = $part['type'] ?? '';
            if (!in_array($type, $nameTypes, true)) {
                if ($cursorExact && isset($fixedLength[$type])) {
                    $result .= substr($oldUsername, $cursor, $fixedLength[$type]);
                    $cursor = min(strlen($oldUsername), $cursor + $fixedLength[$type]);
                } else {
                    // tech_input, LCP/NAP/port, the full mobile number, the install date: their
                    // length is not known here, so the next name token is searched for instead.
                    $cursorExact = false;
                }
                continue;
            }

            $oldToken = $this->sanitizeUsername($this->getValueForType($type, $oldNames));
            $newToken = $this->sanitizeUsername($this->getValueForType($type, $newNames));

            if ($oldToken === '') {
                // Nothing to locate. Only a problem if the new name now produces something here.
                if ($newToken !== '') {
                    return null;
                }
                continue;
            }

            // Where the position is known, the name must start exactly there; otherwise search on.
            $pos = $cursorExact
                ? (substr($oldUsername, $cursor, strlen($oldToken)) === $oldToken ? $cursor : false)
                : strpos($oldUsername, $oldToken, $cursor);
            if ($pos === false) {
                return null;
            }

            $result .= substr($oldUsername, $cursor, $pos - $cursor) . $newToken;
            $cursor = $pos + strlen($oldToken);
            $cursorExact = true;
        }

        $result .= substr($oldUsername, $cursor);

        return $result === '' ? null : $result;
    }

    public function isUsernameUnique(string $username, ?int $excludeJobOrderId = null): bool
    {
        $query = DB::table('job_orders')
            ->where('pppoe_username', $username);
        
        if ($excludeJobOrderId) {
            $query->where('id', '!=', $excludeJobOrderId);
        }
        
        return $query->count() === 0;
    }

    public function generateUniqueUsername(array $customerData, ?int $excludeJobOrderId = null): string
    {
        $baseUsername = $this->generateUsername($customerData);
        
        if ($this->isUsernameUnique($baseUsername, $excludeJobOrderId)) {
            return $baseUsername;
        }

        $counter = 1;
        while ($counter <= 999) {
            $username = $baseUsername . $counter;
            
            if ($this->isUsernameUnique($username, $excludeJobOrderId)) {
                return $username;
            }
            
            $counter++;
        }

        return $baseUsername . time();
    }
}


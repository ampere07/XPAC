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
                $lcpValue = trim((string) ($customerData['lcp'] ?? ''));
                if ($lcpValue === '' && !empty($customerData['lcpnap'])) {
                    if (preg_match('/(?:LP|LCP)?\s*([0-9]+)/i', (string) $customerData['lcpnap'], $m)) {
                        $lcpValue = $m[1];
                    }
                }
                $lcpDigits = preg_replace('/[^0-9]/', '', $lcpValue);
                if ($lcpDigits !== '') {
                    return 'LP' . str_pad($lcpDigits, 3, '0', STR_PAD_LEFT);
                }
                return strtoupper($lcpValue);
            
            case 'nap':
                $napValue = trim((string) ($customerData['nap'] ?? ''));
                if ($napValue === '' && !empty($customerData['lcpnap'])) {
                    if (preg_match('/(?:NP|NAP)\s*([0-9]+)/i', (string) $customerData['lcpnap'], $m)) {
                        $napValue = $m[1];
                    }
                }
                $napDigits = preg_replace('/[^0-9]/', '', $napValue);
                if ($napDigits !== '') {
                    return 'NP' . str_pad($napDigits, 2, '0', STR_PAD_LEFT);
                }
                return strtoupper($napValue);

            case 'port':
                $portValue = trim((string) ($customerData['port'] ?? ''));
                $portDigits = preg_replace('/[^0-9]/', '', $portValue);
                if ($portDigits !== '') {
                    return 'P' . str_pad($portDigits, 2, '0', STR_PAD_LEFT);
                }
                return strtoupper($portValue);

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

    /**
     * Check if a PPPoE username conforms to the format configured for Job Orders.
     *
     * Returns:
     *   - 'valid': bool
     *   - 'reason': ?string
     *   - 'suggested': ?string
     *
     * @param string $username
     * @param array<string, mixed>|null $customerData
     * @return array{valid: bool, reason: ?string, suggested: ?string}
     */
    public function validateUsernameFormat(string $username, ?array $customerData = null): array
    {
        $username = trim($username);
        if ($username === '') {
            return [
                'valid'     => false,
                'reason'    => 'Username is empty.',
                'suggested' => null,
            ];
        }

        // Try extracting LCP, NAP, Port, and Suffix from the username itself:
        // Matches non-standard variants like:
        //  - lp8np2p2AlmaRaging
        //  - LP008NP02P02AlmaRaging
        //  - 100np1p3AngeleneFrancisco
        //  - lcp8nap2p2Robert
        //  - lp137np05p03BabyMorana
        $parsedFromUsername = null;
        if (preg_match('/^(?:lp|lcp)?([0-9]+)(?:np|nap)?([0-9]+)p?([0-9]+)(.+)$/i', $username, $matches)) {
            $lcpNum    = (int) $matches[1];
            $napNum    = (int) $matches[2];
            $portNum   = (int) $matches[3];
            $rawSuffix = trim($matches[4]);

            $parsedFromUsername = sprintf('LP%03dNP%02dP%02d%s', $lcpNum, $napNum, $portNum, $rawSuffix);
        }

        // Generate suggested from customer data if available
        $suggestedFromData = null;
        if (!empty($customerData)) {
            $generated = $this->generateUsername($customerData);
            if ($generated !== '') {
                $suggestedFromData = $generated;
            }
        }

        // Determine best canonical suggestion:
        // parsedFromUsername preserves the exact subscriber name attached to the username,
        // while suggestedFromData provides the configured pattern from customer fields.
        $suggested = $parsedFromUsername ?? $suggestedFromData;

        // Strict canonical ATSS format check: LP{3 digits}NP{2 digits}P{2 digits}{Identifier}
        if (preg_match('/^LP[0-9]{3}NP[0-9]{2}P[0-9]{2}[A-Za-z0-9]+$/', $username)) {
            if ($parsedFromUsername !== null && $username === $parsedFromUsername) {
                return [
                    'valid'     => true,
                    'reason'    => null,
                    'suggested' => $username,
                ];
            }
        }

        // If parsed from username pattern but not in strict canonical format (e.g. lp8np2p2AlmaRaging):
        if ($parsedFromUsername !== null) {
            return [
                'valid'     => false,
                'reason'    => "Format drift from standard Job Order pattern (expected {$parsedFromUsername}).",
                'suggested' => $parsedFromUsername,
            ];
        }

        $pattern = PPPoEUsernamePattern::getUsernamePattern();
        $sequence = $pattern?->sequence;
        $hasLcpOrNap = false;
        if (is_array($sequence)) {
            foreach ($sequence as $item) {
                $type = $item['type'] ?? '';
                if ($type === 'lcp' || $type === 'nap' || $type === 'port') {
                    $hasLcpOrNap = true;
                    break;
                }
            }
        }

        if ($hasLcpOrNap) {
            if ($suggestedFromData !== null) {
                if ($username === $suggestedFromData) {
                    return [
                        'valid'     => true,
                        'reason'    => null,
                        'suggested' => $suggestedFromData,
                    ];
                }
                return [
                    'valid'     => false,
                    'reason'    => "Username format drifted from expected pattern (expected {$suggestedFromData}).",
                    'suggested' => $suggestedFromData,
                ];
            }

            return [
                'valid'     => false,
                'reason'    => 'Username does not conform to the Job Order format (expected LP000NP00P00... prefix).',
                'suggested' => null,
            ];
        }

        // Fallback validation if pattern doesn't specify LCP/NAP/Port
        if (!empty($suggestedFromData)) {
            $matches = preg_match('/^' . preg_quote($suggestedFromData, '/') . '\d*$/i', $username);
            return [
                'valid'     => (bool)$matches,
                'reason'    => $matches ? null : "Username differs from expected pattern ({$suggestedFromData}).",
                'suggested' => $suggestedFromData,
            ];
        }

        return [
            'valid'     => true,
            'reason'    => null,
            'suggested' => null,
        ];
    }
}


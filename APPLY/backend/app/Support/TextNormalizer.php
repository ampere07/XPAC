<?php

namespace App\Support;

/**
 * Turns the "fancy font" text that phone keyboards and text-styler apps
 * produce back into ordinary characters, so what lands in the database is
 * plain and searchable.
 *
 * An applicant typing their address with a styled keyboard sends us letters
 * that look like letters but are code points from the Mathematical
 * Alphanumeric Symbols block. Nothing downstream — search, exports, SMS, the
 * CRM this data is handed to — copes with those, so they are folded back to
 * ASCII here.
 *
 * The rule is conservative: only characters that are a *styled presentation*
 * of a plain character are rewritten. Accented letters, currency symbols,
 * emoji, curly quotes and dashes are ordinary text and are left exactly as
 * they were typed.
 */
class TextNormalizer
{
    /**
     * Code point => replacement, for the characters that cannot be worked out
     * arithmetically. Built once per process.
     *
     * @var array<int, string>|null
     */
    private static $map = null;

    /**
     * The 52-letter (A-Z then a-z) blocks of Mathematical Alphanumeric
     * Symbols: bold, italic, bold italic, script, bold script, fraktur,
     * double-struck, bold fraktur, and the six sans-serif/monospace variants.
     */
    private const LETTER_BLOCKS = [
        0x1D400, 0x1D434, 0x1D468, 0x1D49C, 0x1D4D0, 0x1D504, 0x1D538,
        0x1D56C, 0x1D5A0, 0x1D5D4, 0x1D608, 0x1D63C, 0x1D670,
    ];

    /** The matching 10-digit blocks: bold, double-struck, sans, sans bold, monospace. */
    private const DIGIT_BLOCKS = [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6];

    /**
     * Normalize a single value. Non-strings are handed back untouched so this
     * is safe to map blindly over request input.
     *
     * @param  mixed  $value
     * @return mixed
     */
    public static function normalize($value)
    {
        if (!is_string($value) || $value === '') {
            return $value;
        }

        // Broken UTF-8 would make the /u patterns below fail silently and
        // return null, so repair it first rather than losing the field.
        if (preg_match('//u', $value) !== 1) {
            $repaired = @mb_convert_encoding($value, 'UTF-8', 'UTF-8');
            $value = is_string($repaired) ? $repaired : '';
        }

        // The overwhelmingly common case: plain ASCII already.
        if (preg_match('/[^\x20-\x7E\t\r\n]/', $value) !== 1) {
            return self::tidy($value);
        }

        $mapped = preg_replace_callback(
            '/[^\x00-\x7F]/u',
            static function (array $match) {
                return self::replacementFor($match[0]);
            },
            $value
        );

        return self::tidy(is_string($mapped) ? $mapped : $value);
    }

    /**
     * Normalize every string in an array, recursing into nested arrays.
     *
     * @param  array<mixed>  $values
     * @param  array<int, string>  $except  keys to leave alone
     * @return array<mixed>
     */
    public static function normalizeArray(array $values, array $except = [])
    {
        foreach ($values as $key => $value) {
            if (in_array((string) $key, $except, true)) {
                continue;
            }

            $values[$key] = is_array($value)
                ? self::normalizeArray($value, $except)
                : self::normalize($value);
        }

        return $values;
    }

    /**
     * What a single non-ASCII character should become. Anything we have no
     * opinion about is returned as it arrived.
     */
    private static function replacementFor(string $character): string
    {
        $codePoint = mb_ord($character, 'UTF-8');

        if ($codePoint === false) {
            return '';
        }

        $map = self::map();

        if (array_key_exists($codePoint, $map)) {
            return $map[$codePoint];
        }

        $arithmetic = self::fromBlock($codePoint);

        return $arithmetic !== null ? $arithmetic : $character;
    }

    /**
     * The styled alphabets that sit in evenly spaced blocks, so they need no
     * lookup table.
     */
    private static function fromBlock(int $codePoint): ?string
    {
        foreach (self::LETTER_BLOCKS as $start) {
            if ($codePoint >= $start && $codePoint < $start + 52) {
                $offset = $codePoint - $start;

                return $offset < 26
                    ? chr(ord('A') + $offset)
                    : chr(ord('a') + $offset - 26);
            }
        }

        foreach (self::DIGIT_BLOCKS as $start) {
            if ($codePoint >= $start && $codePoint < $start + 10) {
                return chr(ord('0') + $codePoint - $start);
            }
        }

        // Fullwidth forms of the printable ASCII range.
        if ($codePoint >= 0xFF01 && $codePoint <= 0xFF5E) {
            return chr($codePoint - 0xFEE0);
        }

        // Circled, parenthesised and squared letters.
        if ($codePoint >= 0x24B6 && $codePoint <= 0x24CF) {
            return chr(ord('A') + $codePoint - 0x24B6);
        }

        if ($codePoint >= 0x24D0 && $codePoint <= 0x24E9) {
            return chr(ord('a') + $codePoint - 0x24D0);
        }

        if ($codePoint >= 0x249C && $codePoint <= 0x24B5) {
            return chr(ord('a') + $codePoint - 0x249C);
        }

        if ($codePoint >= 0x1F130 && $codePoint <= 0x1F149) {
            return chr(ord('A') + $codePoint - 0x1F130);
        }

        if ($codePoint >= 0x1F150 && $codePoint <= 0x1F169) {
            return chr(ord('A') + $codePoint - 0x1F150);
        }

        if ($codePoint >= 0x1F170 && $codePoint <= 0x1F189) {
            return chr(ord('A') + $codePoint - 0x1F170);
        }

        // Circled digits.
        if ($codePoint >= 0x2460 && $codePoint <= 0x2468) {
            return chr(ord('1') + $codePoint - 0x2460);
        }

        return null;
    }

    /**
     * @return array<int, string>
     */
    private static function map(): array
    {
        if (self::$map !== null) {
            return self::$map;
        }

        $map = [];

        // Invisible characters: soft hyphens, zero-width spaces, bidi and word
        // joiners. Copy-and-paste leaves these behind and they turn otherwise
        // identical names into values that never match each other. The
        // zero-width joiner (U+200D) is deliberately kept — it holds
        // multi-part emoji together.
        foreach ([
            0x00AD, 0x061C, 0x180E, 0x200B, 0x200C, 0x200E, 0x200F,
            0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2060, 0x2061,
            0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069,
            0xFEFF, 0xFFF9, 0xFFFA, 0xFFFB,
        ] as $codePoint) {
            $map[$codePoint] = '';
        }

        // C1 control block — never meaningful in submitted text.
        for ($codePoint = 0x80; $codePoint <= 0x9F; $codePoint++) {
            $map[$codePoint] = '';
        }

        // Every flavour of exotic space becomes an ordinary one.
        foreach ([
            0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
            0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000,
        ] as $codePoint) {
            $map[$codePoint] = ' ';
        }

        $map[0x2028] = "\n";
        $map[0x2029] = "\n";

        // The Mathematical Alphanumeric blocks have holes where a letterlike
        // symbol was already encoded elsewhere, so a styled string mixes the
        // two. These are those stand-ins.
        $map += [
            0x210E => 'h', 0x212C => 'B', 0x2130 => 'E', 0x2131 => 'F',
            0x210B => 'H', 0x2110 => 'I', 0x2112 => 'L', 0x2133 => 'M',
            0x211B => 'R', 0x212F => 'e', 0x210A => 'g', 0x2134 => 'o',
            0x212D => 'C', 0x210C => 'H', 0x2111 => 'I', 0x211C => 'R',
            0x2128 => 'Z', 0x2102 => 'C', 0x210D => 'H', 0x2115 => 'N',
            0x2119 => 'P', 0x211A => 'Q', 0x211D => 'R', 0x2124 => 'Z',
            0x2113 => 'l', 0x2118 => 'P', 0x2107 => 'E', 0x212A => 'K',
        ];

        // Small capitals, the "small caps" styler. They stand in for lower
        // case letters, which is how they read back.
        $map += [
            0x1D00 => 'a', 0x0299 => 'b', 0x1D04 => 'c', 0x1D05 => 'd',
            0x1D07 => 'e', 0xA730 => 'f', 0x0262 => 'g', 0x029C => 'h',
            0x026A => 'i', 0x1D0A => 'j', 0x1D0B => 'k', 0x029F => 'l',
            0x1D0D => 'm', 0x0274 => 'n', 0x1D0F => 'o', 0x1D18 => 'p',
            0xA7AF => 'q', 0x0280 => 'r', 0xA731 => 's', 0x1D1B => 't',
            0x1D1C => 'u', 0x1D20 => 'v', 0x1D21 => 'w', 0x028F => 'y',
            0x1D22 => 'z',
        ];

        // Modifier capitals and superscript/subscript letters and digits.
        $map += [
            0x1D2C => 'A', 0x1D2E => 'B', 0x1D30 => 'D', 0x1D31 => 'E',
            0x1D33 => 'G', 0x1D34 => 'H', 0x1D35 => 'I', 0x1D36 => 'J',
            0x1D37 => 'K', 0x1D38 => 'L', 0x1D39 => 'M', 0x1D3A => 'N',
            0x1D3C => 'O', 0x1D3E => 'P', 0x1D3F => 'R', 0x1D40 => 'T',
            0x1D41 => 'U', 0x1D42 => 'W', 0x2C7D => 'V',
            0x1D43 => 'a', 0x1D47 => 'b', 0x1D9C => 'c', 0x1D48 => 'd',
            0x1D49 => 'e', 0x1DA0 => 'f', 0x1D4D => 'g', 0x02B0 => 'h',
            0x2071 => 'i', 0x02B2 => 'j', 0x1D4F => 'k', 0x02E1 => 'l',
            0x1D50 => 'm', 0x207F => 'n', 0x1D52 => 'o', 0x1D56 => 'p',
            0x02B3 => 'r', 0x02E2 => 's', 0x1D57 => 't', 0x1D58 => 'u',
            0x1D5B => 'v', 0x02B7 => 'w', 0x02E3 => 'x', 0x02B8 => 'y',
            0x1DBB => 'z',
            0x2090 => 'a', 0x2091 => 'e', 0x2092 => 'o', 0x2093 => 'x',
            0x2095 => 'h', 0x2096 => 'k', 0x2097 => 'l', 0x2098 => 'm',
            0x2099 => 'n', 0x209A => 'p', 0x209B => 's', 0x209C => 't',
            0x2070 => '0', 0x00B9 => '1', 0x00B2 => '2', 0x00B3 => '3',
            0x2074 => '4', 0x2075 => '5', 0x2076 => '6', 0x2077 => '7',
            0x2078 => '8', 0x2079 => '9',
            0x2080 => '0', 0x2081 => '1', 0x2082 => '2', 0x2083 => '3',
            0x2084 => '4', 0x2085 => '5', 0x2086 => '6', 0x2087 => '7',
            0x2088 => '8', 0x2089 => '9',
        ];

        // Typographic ligatures.
        $map += [
            0xFB00 => 'ff', 0xFB01 => 'fi', 0xFB02 => 'fl',
            0xFB03 => 'ffi', 0xFB04 => 'ffl', 0xFB05 => 'st', 0xFB06 => 'st',
        ];

        // Circled zero has no neighbours to count from.
        $map[0x24EA] = '0';

        return self::$map = $map;
    }

    /**
     * Drop control characters and settle the whitespace that removing
     * invisible characters can leave behind.
     */
    private static function tidy(string $value): string
    {
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value);
        $value = preg_replace('/[ \t]+/', ' ', $value);

        return trim($value);
    }
}

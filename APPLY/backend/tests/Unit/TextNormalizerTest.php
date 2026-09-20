<?php

namespace Tests\Unit;

use App\Support\TextNormalizer;
use PHPUnit\Framework\TestCase;

class TextNormalizerTest extends TestCase
{
    /**
     * The styled alphabets a phone keyboard produces. Each of these is a
     * different Unicode block that renders as ordinary Latin letters.
     *
     * @dataProvider styledText
     */
    public function test_it_folds_styled_text_back_to_plain_characters(string $input, string $expected): void
    {
        $this->assertSame($expected, TextNormalizer::normalize($input));
    }

    public static function styledText(): array
    {
        return [
            'monospace' => [
                '𝙰𝚜𝚒𝚊 𝙱𝙻𝙳𝙶 #2 𝙱𝙾𝚂𝚂 𝙹𝙼 𝙲𝙴𝙻𝙻𝙿𝙷𝙾𝙽𝙴 𝚂𝙷𝙾𝙿',
                'Asia BLDG #2 BOSS JM CELLPHONE SHOP',
            ],
            'bold' => ['𝐉𝐨𝐡𝐧 𝐃𝐨𝐞', 'John Doe'],
            'bold italic' => ['𝑱𝒖𝒂𝒏 𝒅𝒆 𝑳𝒂 𝑪𝒓𝒖𝒛', 'Juan de La Cruz'],
            'bold script' => ['𝓜𝓪𝓻𝓲𝓪 𝓒𝓵𝓪𝓻𝓪', 'Maria Clara'],
            'fraktur' => ['𝔍𝔬𝔰𝔢', 'Jose'],
            // Both of these mix in letterlike symbols, because the styled
            // blocks have holes where those characters were already encoded.
            'double-struck' => ['𝕁𝕠𝕤𝕖 ℝ𝕚𝕫𝕒𝕝', 'Jose Rizal'],
            'script' => ['ℐ𝓈𝒶𝒷𝑒𝓁', 'Isabel'],
            'fullwidth' => ['Ｂｌｋ ７ Ｌｏｔ １２', 'Blk 7 Lot 12'],
            'small capitals' => ['sᴍᴀʟʟ ᴄᴀᴘs', 'small caps'],
            'circled' => ['Ⓐⓟⓣ ③', 'Apt 3'],
            'styled digits' => ['𝟬𝟵𝟭𝟳𝟭𝟮𝟯𝟰𝟱𝟲𝟳', '09171234567'],
        ];
    }

    /**
     * Anything that is ordinary text, rather than a styled presentation of
     * ordinary text, has to survive untouched.
     *
     * @dataProvider ordinaryText
     */
    public function test_it_leaves_ordinary_text_alone(string $input): void
    {
        $this->assertSame($input, TextNormalizer::normalize($input));
    }

    public static function ordinaryText(): array
    {
        return [
            'plain' => ['Asia BLDG #2 BOSS JM CELLPHONE SHOP'],
            'accents' => ['Peñafrancia St., Ñuñoa'],
            'punctuation' => ['Unit 5, 2nd Flr. — "the corner house"'],
            'curly quotes and dashes' => ['“smart quotes” – en dash'],
            'email' => ['sample.applicant@email.com'],
            'mobile' => ['09171234567'],
            'coordinates' => ['14.5995, 120.9842'],
            'symbols' => ['Php 1,499.00 & up (100% fibre)'],
        ];
    }

    public function test_it_removes_invisible_characters_and_settles_whitespace(): void
    {
        $this->assertSame(
            'Juan Cruz',
            TextNormalizer::normalize("Juan\u{200B}\u{00A0} \u{FEFF}Cruz  ")
        );
    }

    public function test_it_passes_non_strings_through_unchanged(): void
    {
        $this->assertNull(TextNormalizer::normalize(null));
        $this->assertSame(42, TextNormalizer::normalize(42));
        $this->assertTrue(TextNormalizer::normalize(true));
        $this->assertSame('', TextNormalizer::normalize(''));
    }

    public function test_it_normalizes_nested_arrays_and_honours_exceptions(): void
    {
        $normalized = TextNormalizer::normalizeArray([
            'firstName' => '𝙹𝚞𝚊𝚗',
            'password' => '𝚙𝚊𝚜𝚜𝚠𝚘𝚛𝚍',
            'address' => ['landmark' => '𝙽𝚎𝚊𝚛 𝟽-𝟷𝟷'],
        ], ['password']);

        $this->assertSame('Juan', $normalized['firstName']);
        $this->assertSame('𝚙𝚊𝚜𝚜𝚠𝚘𝚛𝚍', $normalized['password']);
        $this->assertSame('Near 7-11', $normalized['address']['landmark']);
    }

    public function test_it_survives_invalid_utf8_rather_than_dropping_the_field(): void
    {
        $result = TextNormalizer::normalize("Juan\xB1Cruz");

        $this->assertIsString($result);
        $this->assertNotSame('', $result);
        $this->assertStringContainsString('Juan', $result);
    }
}

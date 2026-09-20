<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Resolves the active colour palette into the concrete colours a report PDF
 * needs, so generated documents match the palette the UI is running.
 *
 * The palette table only stores three colours (primary / secondary / accent) but
 * a document needs a whole ramp: a pale table-header fill, a dark heading text
 * that stays legible on that fill, rules, and a grand-total band. Those are
 * DERIVED here rather than stored, which means any palette the user picks works
 * without anyone hand-authoring extra shades.
 *
 * Derivation rules:
 *   fills  are tints  (mix toward white) so text can sit on them
 *   text   is a shade (mix toward black) darkened until it clears the WCAG AA
 *          4.5:1 contrast ratio against the fill it sits on
 *
 * Neutral chrome (greys) and semantic colours (red alerts, amber warnings) are
 * deliberately NOT themed — a warning must stay recognisably a warning whatever
 * the brand colour is.
 */
class ReportTheme
{
    /** Indigo, matching the previous hard-coded look, when no palette is set. */
    private const FALLBACK = [
        'primary'   => '#4f46e5',
        'secondary' => '#1f2937',
        'accent'    => '#6366f1',
    ];

    private static ?array $cached = null;

    /** Forget the memoised palette (tests, or after a palette change). */
    public static function flush(): void
    {
        self::$cached = null;
    }

    /**
     * The active palette expanded into named document roles.
     *
     * @return array<string, string> hex colours, keyed by role
     */
    public static function resolve(): array
    {
        return self::$cached ??= self::build(self::activePalette());
    }

    /** Read the active palette, degrading to the fallback on any problem. */
    private static function activePalette(): array
    {
        try {
            if (!Schema::hasTable('settings_color_palette')) {
                return self::FALLBACK;
            }

            $row = DB::table('settings_color_palette')
                ->where('status', 'active')
                ->orderByDesc('id')
                ->first();

            if (!$row) {
                return self::FALLBACK;
            }

            return [
                'primary'   => self::normalize($row->primary ?? null)   ?? self::FALLBACK['primary'],
                'secondary' => self::normalize($row->secondary ?? null) ?? self::FALLBACK['secondary'],
                'accent'    => self::normalize($row->accent ?? null)    ?? self::FALLBACK['accent'],
            ];
        } catch (\Throwable $e) {
            // A report must never fail to render because of a theming lookup.
            return self::FALLBACK;
        }
    }

    private static function build(array $palette): array
    {
        $primary = $palette['primary'];
        $accent  = $palette['accent'];

        $headFill  = self::tint($primary, 0.88);
        $totalFill = self::tint($primary, 0.92);

        return [
            'primary'   => $primary,
            'secondary' => $palette['secondary'],
            'accent'    => $accent,

            // Masthead and rules
            'brand'      => self::readableOn('#ffffff', $primary),
            'rule'       => $primary,
            'rule_soft'  => self::tint($primary, 0.55),

            // Data-table head
            'head_bg'          => $headFill,
            'head_text'        => self::readableOn($headFill, $primary),
            'head_border'      => self::tint($primary, 0.45),
            'head_border_soft' => self::tint($primary, 0.78),

            // Grand-total band
            'total_bg'     => $totalFill,
            'total_text'   => self::readableOn($totalFill, $primary),
            'total_border' => self::shade($primary, 0.12),

            // Badges / callouts
            'badge_bg'   => self::tint($accent, 0.88),
            'badge_text' => self::readableOn(self::tint($accent, 0.88), $accent),

            // Tinted panel backgrounds
            'kpi_bg'  => self::tint($primary, 0.965),
            'note_bg' => self::tint($primary, 0.95),
        ];
    }

    // ── Colour maths ─────────────────────────────────────────────────────────

    /** Accept #RGB / #RRGGBB / RRGGBB; return #rrggbb, or null if unusable. */
    public static function normalize(?string $hex): ?string
    {
        $hex = strtolower(trim((string) $hex));
        $hex = ltrim($hex, '#');

        if (preg_match('/^[0-9a-f]{3}$/', $hex)) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }

        return preg_match('/^[0-9a-f]{6}$/', $hex) ? '#' . $hex : null;
    }

    /** Mix toward white. $weight 0 = unchanged, 1 = white. */
    public static function tint(string $hex, float $weight): string
    {
        return self::mix($hex, [255, 255, 255], $weight);
    }

    /** Mix toward black. $weight 0 = unchanged, 1 = black. */
    public static function shade(string $hex, float $weight): string
    {
        return self::mix($hex, [0, 0, 0], $weight);
    }

    private static function mix(string $hex, array $target, float $weight): string
    {
        $weight = max(0.0, min(1.0, $weight));
        [$r, $g, $b] = self::rgb($hex);

        return sprintf(
            '#%02x%02x%02x',
            (int) round($r + ($target[0] - $r) * $weight),
            (int) round($g + ($target[1] - $g) * $weight),
            (int) round($b + ($target[2] - $b) * $weight)
        );
    }

    /**
     * Darken (or lighten) $colour until it reaches WCAG AA 4.5:1 against $bg.
     *
     * Without this a pale brand colour — a yellow or mint primary — would render
     * table headings as near-invisible text on their own tint. Falls back to the
     * best available option rather than giving up.
     */
    public static function readableOn(string $bg, string $colour): string
    {
        if (self::contrast($bg, $colour) >= 4.5) {
            return $colour;
        }

        $bgIsLight = self::luminance($bg) > 0.5;
        $best      = $colour;
        $bestRatio = self::contrast($bg, $colour);

        for ($step = 1; $step <= 20; $step++) {
            $weight    = $step / 20;
            $candidate = $bgIsLight
                ? self::shade($colour, $weight)
                : self::tint($colour, $weight);

            $ratio = self::contrast($bg, $candidate);

            if ($ratio > $bestRatio) {
                $bestRatio = $ratio;
                $best      = $candidate;
            }

            if ($ratio >= 4.5) {
                return $candidate;
            }
        }

        return $best;
    }

    private static function contrast(string $a, string $b): float
    {
        $la = self::luminance($a);
        $lb = self::luminance($b);

        return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
    }

    /** WCAG relative luminance. */
    private static function luminance(string $hex): float
    {
        $channels = array_map(function ($value) {
            $value /= 255;

            return $value <= 0.03928
                ? $value / 12.92
                : (($value + 0.055) / 1.055) ** 2.4;
        }, self::rgb($hex));

        return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
    }

    /** @return array{0:int,1:int,2:int} */
    private static function rgb(string $hex): array
    {
        $hex = self::normalize($hex) ?? self::FALLBACK['primary'];
        $hex = ltrim($hex, '#');

        return [
            (int) hexdec(substr($hex, 0, 2)),
            (int) hexdec(substr($hex, 2, 2)),
            (int) hexdec(substr($hex, 4, 2)),
        ];
    }
}

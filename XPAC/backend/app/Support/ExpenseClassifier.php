<?php

namespace App\Support;

/**
 * Whether a piece of spending is capital or operating.
 *
 *   OpEx   consumed in the period it is booked. Netting it against that
 *          period's income is correct.
 *   CapEx  buys an asset that outlives the period. Netting it against one
 *          month's income is not correct, which is why the two are reported
 *          apart rather than as a single "expenses" figure.
 *
 * This mirrors MONITOR's App\Services\Reports\ExpenseClassifier deliberately.
 * That service classifies GOWISER's expense rows by name because GOWISER never
 * recorded the fact; now that expenses_logs carries `expense_type` explicitly,
 * the two must agree on what a given category means or the Expenses page and the
 * executive dashboard will disagree about the same peso. The pattern lists are
 * the same lists, and both read config first so a finance team can correct a
 * misclassification without a deploy.
 *
 * Used for two things and only two:
 *   - backfilling historical rows, which have no recorded type (see the
 *     2026_08_03 alignment migration);
 *   - suggesting a default in the UI when someone picks a category.
 *
 * It never overrides a type a human chose. Once a row carries an explicit
 * expense_type, that is the answer — name matching is the fallback for rows
 * nobody has classified, not a rule that keeps re-deciding.
 */
class ExpenseClassifier
{
    public const OPEX = 'OPEX';
    public const CAPEX = 'CAPEX';

    public const TYPES = [self::OPEX, self::CAPEX];

    /**
     * Category-name fragments that mark spending as capital.
     *
     * @return string[]
     */
    public static function capexPatterns(): array
    {
        $configured = config('expenses.capex_patterns');

        return is_array($configured) && $configured !== [] ? $configured : [
            'equipment', 'hardware', 'router', 'switch', 'onu', 'olt', 'server',
            'vehicle', 'motorcycle', 'truck', 'tower', 'construction', 'building',
            'fiber', 'fibre', 'cable roll', 'installation asset', 'capital',
            'furniture', 'computer', 'laptop', 'machinery', 'land', 'improvement',
        ];
    }

    /**
     * The type to assume for a category nobody has classified.
     *
     * Defaults to OpEx, which is what the large majority of an ISP's expense
     * ledger actually is — guessing CapEx would understate the cost of running
     * the business every month.
     */
    public static function nature(?string $categoryName): string
    {
        return self::matches($categoryName, self::capexPatterns()) ? self::CAPEX : self::OPEX;
    }

    /**
     * Normalises whatever a caller supplied to one of the two canonical values.
     *
     * Case-insensitive and tolerant of the spellings the UI and CSV imports
     * produce ('capex', 'CapEx', 'Capital Expenditure'). Anything unrecognised
     * falls back to OpEx rather than being stored verbatim, so the column can be
     * grouped on without a UNION of near-identical strings.
     */
    public static function normalise($value): string
    {
        $clean = strtoupper(trim((string) $value));

        if ($clean === '') {
            return self::OPEX;
        }

        return str_starts_with($clean, 'CAP') ? self::CAPEX : self::OPEX;
    }

    private static function matches(?string $value, array $patterns): bool
    {
        $needle = strtolower(trim((string) $value));

        if ($needle === '') {
            return false;
        }

        foreach ($patterns as $pattern) {
            if (str_contains($needle, strtolower((string) $pattern))) {
                return true;
            }
        }

        return false;
    }
}

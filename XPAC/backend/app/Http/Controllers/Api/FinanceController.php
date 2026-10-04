<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Services\FinanceSummaryService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Finance (Billing): money collected from recorded transactions and the payment portal, for a
 * chosen period. See App\Services\FinanceSummaryService for what is counted and how.
 */
class FinanceController extends Controller
{
    public function __construct(private FinanceSummaryService $service)
    {
    }

    /**
     * GET /finance/summary?mode=…
     *
     *   mode=range   from=Y-m-d&to=Y-m-d
     *   mode=month   month=Y-m
     *   mode=months  months[]=Y-m&months[]=Y-m…
     *   mode=year    year=YYYY
     *   mode=years   year_from=YYYY&year_to=YYYY
     */
    public function summary(Request $request): JsonResponse
    {
        if ($denied = $this->denyWithoutPermission()) {
            return $denied;
        }

        // Outside the try: a ValidationException must reach the client as the usual 422.
        $filters = $this->validatedFilters($request);

        try {
            return response()->json([
                'success' => true,
                'data' => $this->service->summarize($filters, $this->organizationId()),
            ]);
        } catch (\Throwable $e) {
            Log::error('[FINANCE] Summary failed: ' . $e->getMessage(), ['filters' => $filters]);
            return response()->json(['success' => false, 'message' => 'Failed to load the finance summary.'], 500);
        }
    }

    private function validatedFilters(Request $request): array
    {
        $filters = $request->validate([
            'mode'      => ['required', 'in:' . implode(',', FinanceSummaryService::MODES)],
            'from'      => ['nullable', 'required_if:mode,range', 'date_format:Y-m-d'],
            'to'        => ['nullable', 'required_if:mode,range', 'date_format:Y-m-d', 'after_or_equal:from'],
            'month'     => ['nullable', 'required_if:mode,month', 'date_format:Y-m'],
            'months'    => ['nullable', 'required_if:mode,months', 'array', 'min:1', 'max:' . FinanceSummaryService::MAX_MONTHS],
            'months.*'  => ['date_format:Y-m'],
            'year'      => ['nullable', 'required_if:mode,year', 'integer', 'between:2000,2100'],
            'year_from' => ['nullable', 'required_if:mode,years', 'integer', 'between:2000,2100'],
            'year_to'   => ['nullable', 'required_if:mode,years', 'integer', 'between:2000,2100', 'gte:year_from'],
        ]);

        // One request never covers more than MAX_SPAN_YEARS, however the period is written.
        $maxYears = FinanceSummaryService::MAX_SPAN_YEARS;

        if ($filters['mode'] === 'range') {
            $from = CarbonImmutable::createFromFormat('!Y-m-d', $filters['from']);
            $to = CarbonImmutable::createFromFormat('!Y-m-d', $filters['to']);

            if ($from->addYears($maxYears)->lessThan($to)) {
                throw ValidationException::withMessages(['to' => "The date range may cover at most {$maxYears} years."]);
            }
        }

        if ($filters['mode'] === 'years' && $filters['year_to'] - $filters['year_from'] >= $maxYears) {
            throw ValidationException::withMessages(['year_to' => "The year range may cover at most {$maxYears} years."]);
        }

        return $filters;
    }

    /**
     * Checked here, not left to ApiAccessControl, which only logs on this deployment: the page
     * totals every payment the business has taken, so it must never answer a user without the
     * page key.
     */
    private function denyWithoutPermission(): ?JsonResponse
    {
        return \App\Support\Permissions::allows(auth()->user(), 'finance')
            ? null
            : response()->json(['success' => false, 'message' => 'You do not have permission to view the finance summary.'], 403);
    }

    /** SuperAdmin (or a user with no organisation) sees every organisation. */
    private function organizationId(): ?int
    {
        $user = auth()->user();
        if (!$user || (int) ($user->role_id ?? 0) === Role::SUPER_ADMIN || empty($user->organization_id)) {
            return null;
        }

        return (int) $user->organization_id;
    }
}

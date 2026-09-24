<?php

namespace App\Http\Controllers\Api;

use App\Events\ExpensesUpdated;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\ExpensesCategory;
use App\Models\ExpensesLog;
use App\Services\GoogleDriveService;
use App\Support\ExpenseClassifier;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExpensesLogController extends Controller
{
    private const RECEIPT_FOLDER = 'Expense Receipts';

    /**
     * Resolved on demand rather than constructor-injected. GoogleDriveService builds a
     * Google client in its constructor, so injecting it here would make every request
     * to this controller — including the read-only index the legacy ExpensesLog page
     * calls — depend on Drive credentials being present. Only uploads need it.
     */
    private function drive(): GoogleDriveService
    {
        return app(GoogleDriveService::class);
    }

    /**
     * Org rule used across this app: a user scoped to an organization sees that
     * organization's rows; a user with no organization sees the unscoped ones.
     */
    private function scopeToOrganization($query, $currentUser)
    {
        if (!$currentUser) {
            return $query;
        }

        return $currentUser->organization_id
            ? $query->where('organization_id', $currentUser->organization_id)
            : $query->whereNull('organization_id');
    }

    private function applyFilters($query, Request $request)
    {
        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('payee', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('category', 'like', "%{$search}%")
                    ->orWhere('invoice_no', 'like', "%{$search}%");
            });
        }

        // Normalised rather than matched verbatim: the column is canonical
        // OPEX/CAPEX, and a filter arriving as 'opex' from a link or a saved view
        // should still find its rows.
        if ($request->filled('expense_type')) {
            $query->where('expense_type', ExpenseClassifier::normalise($request->expense_type));
        }

        if ($request->filled('frequency')) {
            $query->where('frequency', $this->normaliseFrequency($request->frequency));
        }

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->category_id);
        }

        if ($request->filled('date_from')) {
            $query->whereDate('date', '>=', $request->date_from);
        }

        if ($request->filled('date_to')) {
            $query->whereDate('date', '<=', $request->date_to);
        }

        return $query;
    }

    /**
     * Resolves the [expense_type, frequency] pair a write should store.
     *
     * Three shapes reach this, and all three have to produce a sensible row:
     *
     *  1. A current client sends both — 'CAPEX' and 'Monthly'. Taken as given.
     *
     *  2. A client that predates the split sends expense_type: 'monthly' and no
     *     frequency. That value was always a frequency, so it is read as one, and
     *     the nature is derived from the category the same way the alignment
     *     migration derived it for historical rows. The row lands in the same
     *     bucket it would have under the old code, plus a nature it never had.
     *
     *  3. A current client sends the nature but omits the frequency. Defaults to
     *     Daily, matching the column default.
     *
     * $fallback carries the row's existing values on update, so a PATCH-style
     * write that touches neither field leaves both alone rather than resetting
     * them to defaults.
     *
     * @return array{0:string,1:string}
     */
    private function resolveClassification(Request $request, ?ExpensesLog $existing = null): array
    {
        $posted = trim((string) $request->input('expense_type', ''));
        $isLegacy = in_array(strtolower($posted), ['daily', 'monthly'], true);

        $frequency = $request->filled('frequency')
            ? $this->normaliseFrequency($request->input('frequency'))
            : ($isLegacy
                ? $this->normaliseFrequency($posted)
                : ($existing->frequency ?? ExpensesLog::FREQUENCY_DAILY));

        if ($posted === '') {
            // Neither field posted: an update that is only changing an amount.
            return [
                $existing->expense_type ?? ExpensesLog::TYPE_OPEX,
                $frequency,
            ];
        }

        $type = $isLegacy
            // The legacy value said nothing about nature, so it is inferred from
            // the category — the same call, against the same config, that MONITOR
            // makes when it classifies these rows for the dashboard.
            ? ExpenseClassifier::nature($request->input('category'))
            : ExpenseClassifier::normalise($posted);

        return [$type, $frequency];
    }

    /**
     * Canonicalises a frequency to 'Daily' or 'Monthly'.
     *
     * Case-insensitive because the value arrives from a form, a query string and
     * a CSV import, and 'monthly' from a saved filter must still match the
     * 'Monthly' in the column. Anything unrecognised falls back to Daily, which
     * is the column's default.
     */
    private function normaliseFrequency($value): string
    {
        return strtolower(trim((string) $value)) === 'monthly'
            ? ExpensesLog::FREQUENCY_MONTHLY
            : ExpensesLog::FREQUENCY_DAILY;
    }

    /**
     * Kept byte-for-byte compatible with what the legacy ExpensesLog page already
     * consumes — new keys are added alongside, never in place of, the old ones.
     */
    private function format($record)
    {
        return [
            'id' => (string) $record->id,
            'expensesId' => (string) $record->id,
            'date' => $record->date ? Carbon::parse($record->date)->format('n/j/Y') : '',
            'dateRaw' => $record->date ? Carbon::parse($record->date)->format('Y-m-d') : '',
            'amount' => (float) $record->amount,
            'payee' => $record->payee ?? '',
            'category' => $record->category ?? '',
            'categoryId' => $record->category_id ? (int) $record->category_id : null,
            // expenseType now carries the OpEx/CapEx nature; the daily/monthly
            // meaning it used to carry moved to `frequency` beside it. Both are
            // emitted so a table can show the two facts independently, which is
            // the whole point of having split them.
            'expenseType' => $record->expense_type ?? ExpensesLog::TYPE_OPEX,
            'frequency' => $record->frequency ?? ExpensesLog::FREQUENCY_DAILY,
            'description' => $record->description ?? '',
            'invoiceNo' => $record->invoice_no ?? '',
            'referenceNo' => $record->reference_no ?? '',
            'provider' => $record->provider ?? '',
            'photo' => $record->photo,
            'processedBy' => $record->processed_by ?? '',
            'modifiedBy' => $record->modified_by ?? '',
            'modifiedDate' => $record->modified_date
                ? Carbon::parse($record->modified_date)->format('n/j/Y g:i:s A')
                : '',
            'userEmail' => $record->user_email ?? '',
            'receivedDate' => $record->received_date
                ? Carbon::parse($record->received_date)->format('n/j/Y')
                : '',
            'receivedDateRaw' => $record->received_date
                ? Carbon::parse($record->received_date)->format('Y-m-d')
                : '',
            'supplier' => $record->supplier ?? '',
            'location' => $record->location ?? '',
            'barangay' => $record->barangay ?? '',
            'city' => $record->city ?? 'All',
            'organization_id' => $record->organization_id ?? null,
        ];
    }

    /**
     * Dispatches the realtime notification without letting it fail the request.
     *
     * The expense row is already committed by the time this runs, so anything thrown here
     * would turn a save that succeeded into a 500 that says it did not. App\Events\
     * ExpensesUpdated is a separate file that has to be deployed alongside this controller;
     * when it is missing, the dispatch raises "Class not found" and the caller sees a bare
     * "Server Error" for an expense that was in fact recorded.
     *
     * Throwable, not Exception: a missing class raises Error, which sails straight past the
     * catch(\Exception) blocks in the actions below.
     */
    private function broadcast(array $payload): void
    {
        try {
            event(new ExpensesUpdated($payload));
        } catch (\Throwable $e) {
            // Realtime is a nicety; the write already landed. Other clients pick the change
            // up on their next fetch.
            Log::warning('Expenses broadcast failed (write was committed)', [
                'action' => $payload['action'] ?? 'unknown',
                'error'  => $e->getMessage(),
            ]);
        }
    }

    private function currentUserEmail(Request $request)
    {
        if (auth()->check()) {
            return auth()->user()->email_address;
        }

        return $request->user_email
            ?? $request->modified_by
            ?? $request->modifiedBy
            ?? 'System';
    }

    private function uploadReceipt($file)
    {
        try {
            $drive = $this->drive();

            $folderId = $drive->findFolder(self::RECEIPT_FOLDER)
                ?? $drive->createFolder(self::RECEIPT_FOLDER);

            $extension = $file->getClientOriginalExtension();
            $fileName = 'receipt_' . time() . '_' . Str::random(6) . '.' . $extension;

            return $drive->uploadFile(
                $file,
                $folderId,
                $fileName,
                $file->getMimeType()
            );
        } catch (\Exception $e) {
            Log::error('Failed to upload expense receipt to Google Drive', [
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Resolves the category to store. expenses_logs keeps BOTH category_id and the
     * legacy free-text `category` string, because the old read-only page renders the
     * string and has no join. Writing both keeps the two views consistent.
     */
    private function resolveCategory(Request $request, $currentUser)
    {
        if (!$request->filled('category_id')) {
            return [null, $request->input('category')];
        }

        $category = ExpensesCategory::find($request->category_id);
        if (!$category) {
            throw new \Exception('Selected category does not exist.');
        }

        if ($currentUser && $currentUser->organization_id
            && $category->organization_id
            && $category->organization_id !== $currentUser->organization_id) {
            throw new \Exception('Selected category belongs to another organization.');
        }

        return [$category->id, $category->category_name];
    }

    private function validationRules($required = true)
    {
        $req = $required ? 'required' : 'sometimes|required';

        return [
            'date' => "{$req}|date",
            'amount' => "{$req}|numeric|min:0",
            // The two facts MONITOR reports on, kept independent: what kind of
            // spending it is (expense_type), and how often it recurs (frequency).
            //
            // expense_type still accepts the legacy 'daily'/'monthly' vocabulary
            // it held before the split. A mobile build or a saved integration that
            // has not been updated posts those, and 422-ing it would break
            // recording an expense outright; resolveClassification() below reads a
            // legacy value as the frequency it always meant and derives the
            // OpEx/CapEx nature from the category. Nothing is rejected that used
            // to be accepted.
            //
            // frequency is optional for the same reason — an old client cannot
            // send a field it does not know about.
            'expense_type' => "{$req}|string|in:"
                . implode(',', array_merge(ExpensesLog::TYPES, ['daily', 'monthly'])),
            'frequency' => 'nullable|string|in:' . implode(',', ExpensesLog::FREQUENCIES),
            'category_id' => 'nullable|integer|exists:expenses_category,id',
            'category' => 'nullable|string|max:150',
            'payee' => 'nullable|string|max:300',
            'description' => 'nullable|string',
            'invoice_no' => 'nullable|string|max:300',
            'reference_no' => 'nullable|string|max:300',
            'provider' => 'nullable|string|max:150',
            'supplier' => 'nullable|string|max:150',
            'location' => 'nullable|string|max:150',
            'barangay' => 'nullable|string|max:150',
            'city' => 'nullable|string|max:300',
            'received_date' => 'nullable|date',
            // pdf stays in the list: a receipt is not always a photo, and dropping it
            // would 422 uploads that work today.
            'receipt' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,heic,heif,bmp,svg,tiff,pdf|max:10240',
        ];
    }

    public function index(Request $request)
    {
        try {
            $currentUser = auth()->user();

            $query = ExpensesLog::query();
            $this->scopeToOrganization($query, $currentUser);
            $this->applyFilters($query, $request);

            $query->orderBy('date', 'desc')->orderBy('modified_date', 'desc');

            $data = $query->get()->map(fn ($record) => $this->format($record));

            return response()->json(['status' => 'success', 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    public function show(Request $request, $id)
    {
        try {
            $currentUser = auth()->user();

            $query = ExpensesLog::query()->where('id', $id);
            $this->scopeToOrganization($query, $currentUser);

            $record = $query->firstOrFail();

            return response()->json(['status' => 'success', 'data' => $this->format($record)]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => 'Expense not found'], 404);
        }
    }

    /**
     * Daily and monthly totals for the Expenses page summary cards. The type is a
     * bucket tag: a 'daily' expense counts toward today's card on the day it is
     * dated, a 'monthly' one counts toward the month it falls in. Nothing accrues
     * and nothing is generated.
     */
    public function summary(Request $request)
    {
        try {
            $currentUser = auth()->user();

            $today = Carbon::today();
            $monthStart = $today->copy()->startOfMonth();
            $monthEnd = $today->copy()->endOfMonth();

            $base = function () use ($currentUser, $request) {
                $query = ExpensesLog::query();
                $this->scopeToOrganization($query, $currentUser);
                if ($request->filled('category_id')) {
                    $query->where('category_id', $request->category_id);
                }
                return $query;
            };

            $dailyToday = (clone $base())->daily()->whereDate('date', $today)->sum('amount');
            $dailyThisMonth = (clone $base())->daily()
                ->whereBetween('date', [$monthStart, $monthEnd])->sum('amount');
            $monthlyThisMonth = (clone $base())->monthly()
                ->whereBetween('date', [$monthStart, $monthEnd])->sum('amount');

            $byCategory = (clone $base())
                ->whereBetween('date', [$monthStart, $monthEnd])
                ->select(
                    DB::raw("COALESCE(NULLIF(category, ''), 'Uncategorized') as label"),
                    DB::raw('SUM(COALESCE(amount, 0)) as value')
                )
                ->groupBy('label')
                ->orderByDesc('value')
                ->get();

            // The OpEx/CapEx split, aggregated in one grouped query rather than as
            // two SUMs: the same scan answers both, and the pair is guaranteed to
            // come from one snapshot of the table. A second query for CapEx could
            // land after a write that the OpEx query missed and the two would not
            // add up to the total beside them.
            $byNature = (clone $base())
                ->whereBetween('date', [$monthStart, $monthEnd])
                ->select(
                    'expense_type',
                    DB::raw('SUM(COALESCE(amount, 0)) as value'),
                    DB::raw('COUNT(*) as entries')
                )
                ->groupBy('expense_type')
                ->get()
                ->keyBy('expense_type');

            $opex = (float) ($byNature[ExpensesLog::TYPE_OPEX]->value ?? 0);
            $capex = (float) ($byNature[ExpensesLog::TYPE_CAPEX]->value ?? 0);

            return response()->json([
                'status' => 'success',
                'data' => [
                    'daily_today' => (float) $dailyToday,
                    'daily_this_month' => (float) $dailyThisMonth,
                    'monthly_this_month' => (float) $monthlyThisMonth,
                    'total_this_month' => (float) ($dailyThisMonth + $monthlyThisMonth),
                    'count_today' => (clone $base())->whereDate('date', $today)->count(),
                    'count_this_month' => (clone $base())
                        ->whereBetween('date', [$monthStart, $monthEnd])->count(),
                    'by_category' => $byCategory,

                    // Reported apart because they mean different things to the
                    // month's result: OpEx is consumed in it, CapEx buys something
                    // that outlives it. This is the same split MONITOR's executive
                    // dashboard shows, now from a recorded column rather than from
                    // guessing at category names.
                    'opex_this_month' => $opex,
                    'capex_this_month' => $capex,
                    'opex_count' => (int) ($byNature[ExpensesLog::TYPE_OPEX]->entries ?? 0),
                    'capex_count' => (int) ($byNature[ExpensesLog::TYPE_CAPEX]->entries ?? 0),

                    'scope' => [
                        'today' => $today->format('Y-m-d'),
                        'month_start' => $monthStart->format('Y-m-d'),
                        'month_end' => $monthEnd->format('Y-m-d'),
                    ],
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), $this->validationRules(true));

        if ($validator->fails()) {
            return response()->json([
                'status' => 'error',
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        try {
            $currentUser = auth()->user();
            $userEmail = $this->currentUserEmail($request);
            [$categoryId, $categoryName] = $this->resolveCategory($request, $currentUser);

            $photo = null;
            if ($request->hasFile('receipt')) {
                $photo = $this->uploadReceipt($request->file('receipt'));
            }

            $now = Carbon::now();

            // Resolved rather than taken verbatim: a client that predates the
            // OpEx/CapEx split posts a frequency in expense_type, and this reads
            // it as the frequency it always meant. The category is passed through
            // the request, so resolve after resolveCategory() has run.
            $request->merge(['category' => $categoryName]);
            [$expenseType, $frequency] = $this->resolveClassification($request);

            $expense = new ExpensesLog();
            // varchar(50) PK — same UUID strategy InventoryLog uses.
            $expense->id = (string) Str::uuid();
            $expense->organization_id = $currentUser->organization_id ?? null;
            $expense->date = $request->date;
            $expense->amount = $request->amount;
            $expense->expense_type = $expenseType;
            $expense->frequency = $frequency;
            $expense->category_id = $categoryId;
            $expense->category = $categoryName;
            $expense->payee = $request->payee;
            $expense->description = $request->description;
            $expense->invoice_no = $request->invoice_no;
            $expense->reference_no = $request->reference_no;
            $expense->provider = $request->provider;
            $expense->supplier = $request->supplier;
            $expense->location = $request->location;
            $expense->barangay = $request->barangay;
            $expense->city = $request->city;
            $expense->received_date = $request->received_date;
            $expense->photo = $photo;
            $expense->processed_by = $userEmail;
            $expense->modified_by = $userEmail;
            $expense->modified_date = $now;
            $expense->user_email = $userEmail;
            $expense->created_at = $now;
            $expense->save();

            ActivityLog::log(
                'Expense Created',
                "New {$expense->frequency} {$expense->expense_type} expense recorded: {$expense->category} — {$expense->amount}",
                'info',
                [
                    'resource_type' => 'ExpensesLog',
                    'resource_id' => $expense->id,
                    'additional_data' => $expense->toArray(),
                    'organization_id' => $expense->organization_id,
                ]
            );

            $this->broadcast([
                'action' => 'created',
                'expense_id' => $expense->id,
                'expense_type' => $expense->expense_type,
            ]);

            return response()->json([
                'status' => 'success',
                'message' => 'Expense recorded successfully',
                'data' => $this->format($expense),
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'status' => 'error',
                'message' => 'Error recording expense: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        $validator = Validator::make($request->all(), $this->validationRules(false));

        if ($validator->fails()) {
            return response()->json([
                'status' => 'error',
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        try {
            $currentUser = auth()->user();

            $query = ExpensesLog::query()->where('id', $id);
            $this->scopeToOrganization($query, $currentUser);
            $expense = $query->first();

            if (!$expense) {
                return response()->json(['status' => 'error', 'message' => 'Expense not found'], 404);
            }

            $userEmail = $this->currentUserEmail($request);

            if ($request->has('category_id') || $request->has('category')) {
                [$categoryId, $categoryName] = $this->resolveCategory($request, $currentUser);
                $expense->category_id = $categoryId;
                $expense->category = $categoryName;
            }

            if ($request->hasFile('receipt')) {
                $expense->photo = $this->uploadReceipt($request->file('receipt'));
            }

            // expense_type and frequency are set through the resolver rather than
            // copied straight across: the pair has to be decided together, and a
            // legacy client posting expense_type: 'monthly' must land in frequency
            // instead of writing 'monthly' into the nature column.
            //
            // Passed the current row so a write touching neither field leaves both
            // as they are — an update that only changes an amount must not reset a
            // classification someone chose.
            if ($request->has('expense_type') || $request->has('frequency')) {
                $request->merge(['category' => $expense->category]);
                [$expense->expense_type, $expense->frequency] =
                    $this->resolveClassification($request, $expense);
            }

            foreach ([
                'date', 'amount', 'payee', 'description', 'invoice_no',
                'reference_no', 'provider', 'supplier', 'location', 'barangay', 'city',
                'received_date',
            ] as $field) {
                if ($request->has($field)) {
                    $expense->{$field} = $request->input($field);
                }
            }

            $expense->modified_by = $userEmail;
            $expense->modified_date = Carbon::now();
            $expense->save();

            ActivityLog::log(
                'Expense Updated',
                "Expense updated: {$expense->category} — {$expense->amount} (ID: {$id})",
                'info',
                [
                    'resource_type' => 'ExpensesLog',
                    'resource_id' => $expense->id,
                    'additional_data' => $expense->toArray(),
                    'organization_id' => $expense->organization_id,
                ]
            );

            $this->broadcast([
                'action' => 'updated',
                'expense_id' => $expense->id,
                'expense_type' => $expense->expense_type,
            ]);

            return response()->json([
                'status' => 'success',
                'message' => 'Expense updated successfully',
                'data' => $this->format($expense),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'status' => 'error',
                'message' => 'Error updating expense: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function destroy(Request $request, $id)
    {
        try {
            $currentUser = auth()->user();

            $query = ExpensesLog::query()->where('id', $id);
            $this->scopeToOrganization($query, $currentUser);
            $expense = $query->first();

            if (!$expense) {
                return response()->json(['status' => 'error', 'message' => 'Expense not found'], 404);
            }

            $expenseData = $expense->toArray();
            $label = $expense->category . ' — ' . $expense->amount;
            $organizationId = $expense->organization_id;

            // Soft delete: the row stays recoverable.
            $expense->delete();

            ActivityLog::log(
                'Expense Deleted',
                "Expense deleted: {$label} (ID: {$id})",
                'warning',
                [
                    'resource_type' => 'ExpensesLog',
                    'resource_id' => $id,
                    'additional_data' => $expenseData,
                    'organization_id' => $organizationId,
                ]
            );

            $this->broadcast(['action' => 'deleted', 'expense_id' => $id]);

            return response()->json([
                'status' => 'success',
                'message' => 'Expense deleted successfully',
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'status' => 'error',
                'message' => 'Error deleting expense: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Streams the filtered list as CSV. Streamed rather than built in memory so a
     * large date range does not have to fit in a single string.
     */
    public function export(Request $request)
    {
        $currentUser = auth()->user();

        $query = ExpensesLog::query();
        $this->scopeToOrganization($query, $currentUser);
        $this->applyFilters($query, $request);
        $query->orderBy('date', 'desc')->orderBy('modified_date', 'desc');

        $filename = 'expenses_' . Carbon::now()->format('Y-m-d') . '.csv';

        return new StreamedResponse(function () use ($query) {
            $handle = fopen('php://output', 'w');

            fputcsv($handle, [
                'ID', 'Date', 'Type', 'Frequency', 'Category', 'Payee', 'Amount', 'Description',
                'Invoice No', 'Reference No', 'Provider', 'Supplier', 'Received Date',
                'Location', 'Barangay', 'City', 'Processed By', 'Modified By', 'Modified Date',
            ]);

            // lazy(), not chunkById(): chunkById paginates on `id > lastId` but leaves the
            // date ordering above as the primary sort, so rows with a lower UUID than the
            // last row of a page get skipped. lazy() uses offset paging and honours the
            // declared order, which is what a date-sorted export needs.
            foreach ($query->lazy(500) as $r) {
                fputcsv($handle, [
                    $r->id,
                    $r->date ? Carbon::parse($r->date)->format('Y-m-d') : '',
                    strtoupper($r->expense_type ?? ''),
                    $r->frequency ?? '',
                    $r->category,
                    $r->payee,
                    $r->amount,
                    $r->description,
                    $r->invoice_no,
                    $r->reference_no,
                    $r->provider,
                    $r->supplier,
                    $r->received_date ? Carbon::parse($r->received_date)->format('Y-m-d') : '',
                    $r->location,
                    $r->barangay,
                    $r->city,
                    $r->processed_by,
                    $r->modified_by,
                    $r->modified_date ? Carbon::parse($r->modified_date)->format('Y-m-d H:i:s') : '',
                ]);
            }

            fclose($handle);
        }, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename={$filename}",
        ]);
    }
}

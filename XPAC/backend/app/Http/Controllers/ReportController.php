<?php

namespace App\Http\Controllers;

use App\Models\EmailQueue;
use App\Models\Report;
use App\Models\ReportDispatch;
use App\Services\GoogleDriveService;
use App\Services\ReportDataset;
use App\Services\ReportDispatchService;
use App\Services\ReportPdfService;
use App\Support\ReportSettings;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ReportController extends Controller
{
    public function index()
    {
        $reports = Report::orderBy('created_at', 'desc')->get();

        return response()->json([
            'success' => true,
            'data'    => $reports,
        ]);
    }

    /**
     * Schedule metadata for the front-end form, so the UI never has to hard-code
     * which fields a given schedule requires.
     */
    public function options()
    {
        return response()->json([
            'success' => true,
            'data'    => [
                'report_types' => ReportDataset::reportTypes(),
                'schedules'    => array_map(fn ($schedule) => [
                    'value'    => $schedule,
                    'requires' => Report::SCHEDULE_REQUIREMENTS[$schedule],
                ], Report::schedules()),
                'weekdays' => Report::WEEKDAYS,
            ],
        ]);
    }

    public function store(Request $request)
    {
        try {
            $validated = $this->validatePayload($request);
        } catch (ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Please correct the highlighted fields.',
                'errors'  => $e->errors(),
            ], 422);
        }

        $report = new Report($validated);
        $report->created_at = now();
        $report->save();

        // The report definition is saved at this point. PDF rendering and the
        // Drive upload are best-effort follow-ups: the previous version returned
        // HTTP 500 when either failed, so the UI showed "failed to create" for a
        // report that had in fact been created, and users created duplicates.
        $artifact = $this->buildArtifact($report);

        return response()->json([
            'success'  => true,
            'message'  => $artifact['ok']
                ? 'Report created and PDF generated successfully.'
                : 'Report created, but the PDF could not be generated: ' . $artifact['message'],
            'warning'  => $artifact['ok'] ? null : $artifact['message'],
            'data'     => $report->fresh(),
            'artifact' => $artifact,
        ]);
    }

    public function update(Request $request, int $id)
    {
        $report = Report::find($id);
        if (!$report) {
            return response()->json(['success' => false, 'message' => 'Report not found.'], 404);
        }

        try {
            $validated = $this->validatePayload($request);
        } catch (ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Please correct the highlighted fields.',
                'errors'  => $e->errors(),
            ], 422);
        }

        // A new date_range redefines the automatic cron's rolling baseline —
        // without this, the checkpoint left over from the old period could
        // land the next scheduled window on the wrong dates (e.g. a shorter
        // period would compute a start date already past its own end).
        if ($validated['date_range'] !== $report->date_range
            && Schema::hasColumn('reports', 'last_period_end')) {
            $report->last_period_end = null;
        }

        $report->fill($validated)->save();

        return response()->json([
            'success' => true,
            'message' => 'Report updated successfully.',
            'data'    => $report->fresh(),
        ]);
    }

    /**
     * Global reporting switches. Readable by anyone who can reach the reports
     * page; only writable by an administrator (see routes/api.php).
     */
    public function settings()
    {
        return response()->json([
            'success' => true,
            'data'    => [
                'auto_send_enabled' => ReportSettings::autoSendEnabled(),
            ],
        ]);
    }

    public function updateSettings(Request $request)
    {
        try {
            $validated = $request->validate([
                'auto_send_enabled' => ['required', 'boolean'],
            ]);
        } catch (ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Please supply auto_send_enabled as a boolean.',
                'errors'  => $e->errors(),
            ], 422);
        }

        $enabled = (bool) $validated['auto_send_enabled'];

        ReportSettings::setAutoSendEnabled($enabled, $this->actorName($request));

        return response()->json([
            'success' => true,
            'message' => $enabled
                ? 'Automatic report sending is now enabled.'
                : 'Automatic report sending is now disabled. Scheduled reports will not be sent.',
            'data'    => ['auto_send_enabled' => $enabled],
        ]);
    }

    /**
     * Delete a report and everything scheduled off the back of it.
     *
     * Restricted to Super Admin by the `role` middleware on the route — the
     * check is not repeated here because the route is the single entry point,
     * but note that removing that middleware silently un-protects this method.
     */
    public function destroy(int $id)
    {
        $report = Report::find($id);
        if (!$report) {
            return response()->json(['success' => false, 'message' => 'Report not found.'], 404);
        }

        $name = $report->report_name;

        try {
            DB::transaction(function () use ($report) {
                // Both of these are keyed to this report alone — dispatches by
                // report_id, queued emails by the "REPORT-{id}" account
                // reference ReportDispatchService stamps on them — so no other
                // report's history or pending delivery is touched.
                ReportDispatch::where('report_id', $report->id)->delete();

                EmailQueue::where('account_no', 'REPORT-' . $report->id)
                    ->whereIn('status', ['pending', 'failed'])
                    ->delete();

                $report->delete();
            });
        } catch (\Throwable $e) {
            // Detail goes to the log, not to the response: the raw driver
            // message can carry table and column names.
            Log::error('Failed to delete report', [
                'report_id' => $id,
                'error'     => $e->getMessage(),
                'file'      => $e->getFile() . ':' . $e->getLine(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Could not delete the report. Please try again, or contact your administrator if it keeps failing.',
            ], 500);
        }

        // Attachment files for the deleted emails are left to the
        // reports:queue stale-attachment sweep: unlinking here would not roll
        // back with the transaction above.

        return response()->json([
            'success' => true,
            'message' => "\"{$name}\" and its scheduled delivery history have been deleted.",
        ]);
    }

    /** Re-render the PDF for an existing report and refresh its Drive link. */
    public function regenerate(int $id)
    {
        $report = Report::find($id);
        if (!$report) {
            return response()->json(['success' => false, 'message' => 'Report not found.'], 404);
        }

        $artifact = $this->buildArtifact($report);

        return response()->json([
            'success'  => $artifact['ok'],
            'message'  => $artifact['ok']
                ? 'PDF regenerated successfully.'
                : 'PDF generation failed: ' . $artifact['message'],
            'data'     => $report->fresh(),
            'artifact' => $artifact,
        ], $artifact['ok'] ? 200 : 500);
    }

    /**
     * Generate and email the report immediately.
     *
     * Recorded as a 'manual' occurrence so it neither consumes nor collides with
     * the report's next scheduled send.
     */
    public function sendNow(int $id, ReportDispatchService $dispatcher)
    {
        $report = Report::find($id);
        if (!$report) {
            return response()->json(['success' => false, 'message' => 'Report not found.'], 404);
        }

        if ($report->recipients() === []) {
            return response()->json([
                'success' => false,
                'message' => 'This report has no valid recipient email address.',
            ], 422);
        }

        $result = $dispatcher->dispatch(
            $report,
            Carbon::now(config('reports.timezone', 'Asia/Manila')),
            'manual'
        );

        $ok = in_array($result['status'], ['queued', 'partial'], true);

        return response()->json([
            'success'   => $ok,
            'message'   => $result['message'],
            'queued'    => $result['queued'],
            'status'    => $result['status'],
            'data'      => $report->fresh(),
        ], $ok ? 200 : 500);
    }

    /** Recent dispatch history, for auditing scheduled delivery. */
    public function dispatches(Request $request, int $id)
    {
        if (!Report::whereKey($id)->exists()) {
            return response()->json(['success' => false, 'message' => 'Report not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'data'    => ReportDispatch::where('report_id', $id)
                ->orderByDesc('id')
                ->limit(min(100, max(1, (int) $request->query('limit', 25))))
                ->get(),
        ]);
    }

    /** Stream the PDF inline without touching Drive — used for previewing. */
    public function preview(int $id)
    {
        $report = Report::find($id);
        if (!$report) {
            return response()->json(['success' => false, 'message' => 'Report not found.'], 404);
        }

        try {
            $path = (new ReportPdfService())->generate($report);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'PDF generation failed: ' . $e->getMessage(),
            ], 500);
        }

        return response()->file($path, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . basename($path) . '"',
        ])->deleteFileAfterSend(true);
    }

    /**
     * POST /api/reports/preview
     *
     * Render a PDF for a report that does not exist yet.
     *
     * The operator decides whether a schedule is right at the moment they are creating
     * it, not afterwards, so the preview has to work on the form's current values. The
     * draft is a transient Report - built, rendered and discarded - so nothing reaches
     * the `reports` table, no schedule is created, and no recipient is ever mailed by
     * looking at a layout.
     *
     * It deliberately shares ReportPdfService::generate() with the saved-report path
     * rather than reimplementing a lighter preview: a preview that renders through
     * different code is a preview of something the operator will not receive.
     */
    public function previewDraft(Request $request)
    {
        $validated = $request->validate([
            'report_name' => ['nullable', 'string', 'max:255'],
            'report_type' => ['required', 'string', Rule::in(ReportDataset::reportTypes())],
            'date_range'  => ['required', 'string', 'max:64'],
        ]);

        [$start, $end] = ReportDataset::parseDateRange($validated['date_range']);

        if ($start === null || $end === null) {
            return response()->json([
                'success' => false,
                'message' => 'Give the reporting period as "YYYY-MM-DD to YYYY-MM-DD".',
            ], 422);
        }

        // Never saved. Attributes are assigned directly rather than mass-assigned so
        // this cannot be widened by whatever happens to be in $fillable later.
        $draft = new Report();
        $draft->report_name = $validated['report_name'] ?: 'Untitled report (preview)';
        $draft->report_type = $validated['report_type'];
        $draft->date_range  = $start . ' to ' . $end;
        $draft->created_by  = (string) (optional($request->user())->username
            ?? optional($request->user())->email_address
            ?? 'preview');

        try {
            $path = (new ReportPdfService())->generate($draft);
        } catch (\Throwable $e) {
            Log::error('Report draft preview failed', [
                'report_type' => $validated['report_type'],
                'date_range'  => $draft->date_range,
                'error'       => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'PDF generation failed: ' . $e->getMessage(),
            ], 500);
        }

        return response()->file($path, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="preview.pdf"',
        ])->deleteFileAfterSend(true);
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /** Who to attribute a settings change to. */
    private function actorName(Request $request): string
    {
        $user = $request->user();

        return (string) ($user->email_address ?? $user->username ?? 'system');
    }

    /**
     * Validation that mirrors the form's dynamic rules.
     *
     * `day`, `report_weekday` and `report_month` are required only when the
     * chosen schedule actually uses them — the old rules demanded a day-of-month
     * for every schedule, including "Every Day".
     */
    private function validatePayload(Request $request): array
    {
        $schedule = Report::normalizeSchedule($request->input('report_schedule'));

        $needsDay     = $schedule !== null && Report::requiresField($schedule, 'day');
        $needsWeekday = $schedule !== null && Report::requiresField($schedule, 'weekday');
        $needsMonth   = $schedule !== null && Report::requiresField($schedule, 'month');

        $validated = $request->validate([
            'report_name'     => ['required', 'string', 'max:255'],
            'report_type'     => ['required', 'string', 'max:100', Rule::in(ReportDataset::reportTypes())],
            'report_schedule' => ['required', 'string', 'max:100', Rule::in(Report::schedules())],
            'report_time'     => ['required', 'date_format:H:i,H:i:s'],
            'day'             => [$needsDay ? 'required' : 'nullable', 'integer', 'min:1', 'max:31'],
            'report_weekday'  => [$needsWeekday ? 'required' : 'nullable', 'string', Rule::in(Report::WEEKDAYS)],
            'report_month'    => [$needsMonth ? 'required' : 'nullable', 'integer', 'min:1', 'max:12'],
            'send_to'         => ['required', 'string', 'max:255'],
            'date_range'      => ['required', 'string', 'max:100'],
            'created_by'      => ['nullable', 'string', 'max:255'],
            'is_active'       => ['nullable', 'boolean'],
        ], [
            'day.required'            => 'Day of the month is required for this schedule.',
            'report_weekday.required' => 'Please choose which weekday this report should run on.',
            'report_month.required'   => 'Please choose which month this report should run in.',
            'report_type.in'          => 'That report type is not supported.',
            'report_schedule.in'      => 'That schedule is not supported.',
            'report_time.date_format' => 'Report time must be a valid time (HH:MM).',
        ]);

        // Recipients: at least one address must be usable.
        $probe = new Report(['send_to' => $validated['send_to']]);
        if ($probe->recipients() === []) {
            throw ValidationException::withMessages([
                'send_to' => ['Enter at least one valid email address.'],
            ]);
        }
        if ($invalid = $probe->invalidRecipients()) {
            throw ValidationException::withMessages([
                'send_to' => ['These addresses are not valid: ' . implode(', ', $invalid)],
            ]);
        }

        // Date range must parse into a real ordered range, or every generated
        // report silently falls back to "all time".
        [$from, $to] = ReportDataset::parseDateRange($validated['date_range']);
        if ($from === null || $to === null) {
            throw ValidationException::withMessages([
                'date_range' => ['Date range must look like "YYYY-MM-DD to YYYY-MM-DD".'],
            ]);
        }
        $validated['date_range'] = "{$from} to {$to}";

        // Null out fields the chosen schedule does not use, so a stale value left
        // over from another schedule cannot influence when the report fires.
        if (!$needsDay) {
            $validated['day'] = null;
        }
        if (!$needsWeekday) {
            $validated['report_weekday'] = null;
        }
        if (!$needsMonth) {
            $validated['report_month'] = null;
        }

        $validated['report_schedule'] = $schedule;
        $validated['report_time']     = Carbon::parse($validated['report_time'])->format('H:i:s');

        return $validated;
    }

    /**
     * Render the PDF and push it to Drive.
     *
     * Never throws: the caller has already persisted the report and reports the
     * outcome as a warning rather than a failure.
     *
     * @return array{ok: bool, message: string, file_url: ?string, bytes: ?int}
     */
    private function buildArtifact(Report $report): array
    {
        $tempPath = null;

        try {
            $tempPath = (new ReportPdfService())->generate($report);
            $bytes    = @filesize($tempPath) ?: null;

            $fileUrl = null;
            try {
                $drive    = resolve(GoogleDriveService::class);
                $folderId = $drive->findFolder('Reports') ?? $drive->createFolder('Reports');
                $fileUrl  = $drive->uploadFile($tempPath, $folderId, basename($tempPath), 'application/pdf');
            } catch (\Throwable $e) {
                Log::warning('Report PDF generated but the Drive upload failed', [
                    'report_id' => $report->id,
                    'error'     => $e->getMessage(),
                ]);

                return [
                    'ok'       => false,
                    'message'  => 'the PDF was generated but could not be uploaded to Google Drive ('
                                . $e->getMessage() . ')',
                    'file_url' => null,
                    'bytes'    => $bytes,
                ];
            }

            if ($fileUrl) {
                $report->forceFill(['file_url' => $fileUrl])->save();
            }

            return [
                'ok'       => true,
                'message'  => 'PDF generated and uploaded.',
                'file_url' => $fileUrl,
                'bytes'    => $bytes,
            ];
        } catch (\Throwable $e) {
            Log::error('Report PDF generation failed', [
                'report_id'   => $report->id,
                'report_type' => $report->report_type,
                'error'       => $e->getMessage(),
                'file'        => $e->getFile() . ':' . $e->getLine(),
            ]);

            return [
                'ok'       => false,
                'message'  => $e->getMessage(),
                'file_url' => null,
                'bytes'    => null,
            ];
        } finally {
            if ($tempPath && is_file($tempPath)) {
                @unlink($tempPath);
            }
        }
    }
}

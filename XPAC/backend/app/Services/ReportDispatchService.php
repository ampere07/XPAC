<?php

namespace App\Services;

use App\Models\EmailQueue;
use App\Models\Report;
use App\Models\ReportDispatch;
use Carbon\Carbon;
use App\Support\ChannelLogger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Schema;
use Psr\Log\LoggerInterface;

/**
 * Turns a due scheduled report into queued, PDF-carrying emails.
 *
 * Four defects in the previous inline implementation are addressed here:
 *
 *  1. DUPLICATE EMAILS. reports:queue runs every minute and only compared
 *     H:i === H:i, with no record of what had already been sent. Any second run
 *     inside the same minute — an overlapping cron, a manual invocation, a
 *     retry — mailed the report again. Every send now first CLAIMS the
 *     occurrence by INSERTing into report_dispatches, whose UNIQUE
 *     (report_id, occurrence_key) index makes the claim atomic.
 *
 *  2. MISSING account_no. email_queue.account_no is NOT NULL but was never
 *     populated, so on a strict MySQL every scheduled-report insert failed.
 *
 *  3. SHARED ATTACHMENT PATH. All recipients were given the same file path, and
 *     EmailQueueService unlinks the attachment after a successful send — so
 *     recipient #1 got the PDF and everyone after them got an email with no
 *     attachment. Each recipient now gets a private copy.
 *
 *  4. CSV INSTEAD OF PDF. Non-summary reports attached a CSV even though the
 *     stored report artifact is a PDF. The PDF is now attached for every type.
 *
 *  5. STATIC REPORTING WINDOW. Every scheduled occurrence re-read the report's
 *     stored date_range verbatim, so a report created for "Jan 1-30" mailed
 *     that same fixed month forever instead of advancing. Schedule-triggered
 *     dispatches now roll the window forward by its original length via
 *     Report::nextAutomaticWindow(); manual sends are unaffected.
 */
class ReportDispatchService
{
    private ?LoggerInterface $logger = null;
    private ReportPdfService $pdfService;

    public function __construct(?ReportPdfService $pdfService = null)
    {
        $this->pdfService = $pdfService ?: new ReportPdfService();
    }

    /**
     * Dedicated storage/logs/reports/reports.log channel, built on first use.
     *
     * The channel is NOT a constructor dependency on purpose. Psr\Log\LoggerInterface
     * is bound in Laravel's container, so a type-hinted `?LoggerInterface $logger = null`
     * parameter gets auto-filled with the default application logger whenever this
     * service is resolved from the container (as it is in the reports:queue command).
     * The `?: $this->buildLogger()` fallback then never ran and every report log line
     * silently went to laravel.log instead of the reports channel.
     */
    public function logger(): LoggerInterface
    {
        return $this->logger ??= $this->buildLogger();
    }

    /** Override the channel, for tests or callers that want their own sink. */
    public function setLogger(LoggerInterface $logger): self
    {
        $this->logger = $logger;

        return $this;
    }

    // ── Finding due reports ───────────────────────────────────────────────────

    /**
     * Reports whose scheduled moment has arrived and not yet passed the catch-up
     * window.
     *
     * The window exists because the previous exact H:i === H:i comparison meant
     * a single missed cron tick (deploy, overlapping run, host stall) silently
     * skipped that report for a whole day, month or year. Firing late is safe
     * precisely because the ledger prevents a repeat.
     *
     * @return array<int, array{report: Report, occurrence: Carbon, minutes_late: int}>
     */
    public function dueReports(Carbon $now, ?int $catchUpMinutes = null): array
    {
        $catchUp = $catchUpMinutes ?? (int) config('reports.catch_up_minutes', 30);

        $query = Report::query();
        if (Schema::hasColumn('reports', 'is_active')) {
            $query->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            });
        }

        $due = [];

        foreach ($query->get() as $report) {
            $time = $report->scheduledTime();
            if ($time === null) {
                continue;
            }

            $occurrence = $this->occurrenceFor($report, $now, $time, $catchUp);
            if ($occurrence === null) {
                continue;
            }

            $due[] = [
                'report'       => $report,
                'occurrence'   => $occurrence,
                'minutes_late' => (int) $occurrence->diffInMinutes($now),
            ];
        }

        return $due;
    }

    /**
     * The occurrence to fire for this report right now, or null if none is due.
     *
     * Checks today first, then yesterday — a report scheduled at 23:50 with a
     * catch-up window that spills past midnight still belongs to yesterday's
     * occurrence.
     */
    private function occurrenceFor(Report $report, Carbon $now, string $time, int $catchUp): ?Carbon
    {
        [$hour, $minute] = array_map('intval', explode(':', $time));

        foreach ([0, 1] as $daysBack) {
            $date = $now->copy()->subDays($daysBack)->startOfDay();

            if (!$report->firesOn($date)) {
                continue;
            }

            $scheduled = $date->copy()->setTime($hour, $minute);

            if ($now->greaterThanOrEqualTo($scheduled)
                && $now->lessThanOrEqualTo($scheduled->copy()->addMinutes($catchUp))) {
                return $scheduled;
            }
        }

        return null;
    }

    // ── Dispatching ───────────────────────────────────────────────────────────

    /**
     * Generate the report and queue it to every recipient, exactly once per
     * scheduled occurrence.
     *
     * @param  string  $trigger  'schedule' | 'manual'
     * @return array{status: string, message: string, dispatch_id: ?int, queued: int, attachment: ?string}
     */
    public function dispatch(Report $report, Carbon $occurrence, string $trigger = 'schedule'): array
    {
        $occurrenceKey = $trigger === 'manual'
            // A manual "send now" is its own occurrence, so it never consumes or
            // collides with the scheduled one.
            ? 'manual_' . $occurrence->format('Y-m-d_H:i:s')
            : $report->occurrenceKey($occurrence);

        $claim = $this->claimOccurrence($report, $occurrenceKey, $occurrence);

        if ($claim === null) {
            $this->logger()->info('Skipped: occurrence already dispatched', [
                'report_id'      => $report->id,
                'report_name'    => $report->report_name,
                'occurrence_key' => $occurrenceKey,
            ]);

            return [
                'status'      => 'duplicate',
                'message'     => 'This occurrence has already been dispatched.',
                'dispatch_id' => null,
                'queued'      => 0,
                'attachment'  => null,
            ];
        }

        // ── Rolling window (schedule-triggered dispatches only) ──────────────
        //
        // A manual send (sendNow / --force) mails exactly the stored
        // date_range, unchanged. A scheduled occurrence instead advances
        // through consecutive periods of the same length so it never resends
        // data already mailed. $reportForPdf carries the recomputed window
        // in memory only — $report itself, and its stored date_range, are
        // never overwritten, so the next occurrence still has the original
        // period length to work from.
        $reportForPdf = $report;
        $periodEnd    = null;

        if ($trigger === 'schedule') {
            $window = $report->nextAutomaticWindow($occurrence);

            if ($window === null) {
                $message = 'No new reporting period is due yet for this occurrence; skipped.';

                $this->skip($claim, $message);
                $this->logger()->info('Skipped: rolling window not yet due', [
                    'report_id'   => $report->id,
                    'report_name' => $report->report_name,
                ]);

                return [
                    'status'      => 'skipped',
                    'message'     => $message,
                    'dispatch_id' => $claim->id,
                    'queued'      => 0,
                    'attachment'  => null,
                ];
            }

            [$windowStart, $windowEnd] = $window;
            $periodEnd = $windowEnd;

            $reportForPdf = (clone $report)->forceFill([
                'date_range' => "{$windowStart} to {$windowEnd}",
            ]);
        }

        $recipients = $report->recipients();
        $invalid    = $report->invalidRecipients();

        if ($invalid !== []) {
            $this->logger()->warning('Ignoring invalid recipient addresses', [
                'report_id' => $report->id,
                'invalid'   => $invalid,
            ]);
        }

        if ($recipients === []) {
            $message = 'No valid recipient email address on this report'
                . ($invalid !== [] ? ' (rejected: ' . implode(', ', $invalid) . ')' : '') . '.';

            $this->fail($claim, $message);

            return [
                'status'      => 'failed',
                'message'     => $message,
                'dispatch_id' => $claim->id,
                'queued'      => 0,
                'attachment'  => null,
            ];
        }

        // ── Generate the attachment ──────────────────────────────────────────
        try {
            $attachmentPath = $this->pdfService->generate($reportForPdf);
        } catch (\Throwable $e) {
            $message = 'PDF generation failed: ' . $e->getMessage();

            $this->fail($claim, $message);
            $this->logger()->error('PDF generation failed', [
                'report_id' => $report->id,
                'error'     => $e->getMessage(),
                'file'      => $e->getFile() . ':' . $e->getLine(),
            ]);

            return [
                'status'      => 'failed',
                'message'     => $message,
                'dispatch_id' => $claim->id,
                'queued'      => 0,
                'attachment'  => null,
            ];
        }

        $bytes = @filesize($attachmentPath) ?: 0;

        $this->logger()->info('Attachment generated', [
            'report_id'   => $report->id,
            'report_name' => $report->report_name,
            'path'        => $attachmentPath,
            'bytes'       => $bytes,
        ]);

        // ── Queue one email per recipient ────────────────────────────────────
        $queuedIds = [];
        $errors    = [];

        foreach ($recipients as $recipient) {
            try {
                // A private copy per recipient: EmailQueueService deletes the
                // attachment after a successful send.
                $recipientPath = $this->copyForRecipient($attachmentPath, $recipient);

                $email = EmailQueue::create([
                    'account_no'      => $this->accountReference($report),
                    'recipient_email' => $recipient,
                    'subject'         => $this->subject($reportForPdf, $occurrence),
                    'body_html'       => $this->body($reportForPdf, $occurrence, basename($attachmentPath)),
                    'attachment_path' => $recipientPath,
                    'email_sender'    => config('reports.mail.from', 'billing@atssfiber.ph'),
                    'reply_to'        => config('reports.mail.reply_to', 'billing@atssfiber.ph'),
                    'sender_name'     => config('reports.mail.from_name', 'ATSS Fiber Reports'),
                    'status'          => 'pending',
                    'attempts'        => 0,
                ]);

                $queuedIds[] = $email->id;

                $this->logger()->info('Queued report email', [
                    'report_id'      => $report->id,
                    'recipient'      => $recipient,
                    'email_queue_id' => $email->id,
                ]);
            } catch (\Throwable $e) {
                $errors[] = "{$recipient}: {$e->getMessage()}";

                $this->logger()->error('Failed to queue report email', [
                    'report_id' => $report->id,
                    'recipient' => $recipient,
                    'error'     => $e->getMessage(),
                ]);
            }
        }

        // The master copy is only a template for the per-recipient copies.
        @unlink($attachmentPath);

        $allFailed = $queuedIds === [];

        $claim->fill([
            'status'           => $allFailed ? ReportDispatch::STATUS_FAILED : ReportDispatch::STATUS_QUEUED,
            'dispatched_at'    => now(),
            'recipient_count'  => count($queuedIds),
            'recipients'       => implode(', ', $recipients),
            'attachment_path'  => $attachmentPath,
            'attachment_type'  => 'pdf',
            'attachment_bytes' => $bytes,
            'email_queue_ids'  => implode(',', $queuedIds),
            'error_message'    => $errors === [] ? null : implode(' | ', $errors),
        ])->save();

        if (!$allFailed) {
            $updates = [];
            if (Schema::hasColumn('reports', 'last_dispatched_at')) {
                $updates['last_dispatched_at'] = now();
            }
            // Only advance the checkpoint once the period's emails are actually
            // queued — a failed dispatch must retry the same window, not skip it.
            if ($periodEnd !== null && Schema::hasColumn('reports', 'last_period_end')) {
                $updates['last_period_end'] = $periodEnd;
            }
            if ($updates !== []) {
                $report->forceFill($updates)->saveQuietly();
            }
        }

        return [
            'status'      => $allFailed ? 'failed' : ($errors === [] ? 'queued' : 'partial'),
            'message'     => $allFailed
                ? 'Failed to queue any email: ' . implode(' | ', $errors)
                : sprintf(
                    'Queued %d of %d recipient(s).%s',
                    count($queuedIds),
                    count($recipients),
                    $errors === [] ? '' : ' Errors: ' . implode(' | ', $errors)
                ),
            'dispatch_id' => $claim->id,
            'queued'      => count($queuedIds),
            'attachment'  => $attachmentPath,
        ];
    }

    /**
     * Atomically reserve an occurrence.
     *
     * Returns null when another run already holds it. This relies on the UNIQUE
     * index rather than a SELECT-then-INSERT, which would still race.
     */
    private function claimOccurrence(Report $report, string $occurrenceKey, Carbon $occurrence): ?ReportDispatch
    {
        try {
            return ReportDispatch::create([
                'report_id'      => $report->id,
                'occurrence_key' => $occurrenceKey,
                'scheduled_for'  => $occurrence,
                'status'         => ReportDispatch::STATUS_QUEUED,
            ]);
        } catch (QueryException $e) {
            // 23000 / 1062 — duplicate key: somebody else claimed it first.
            if ($this->isDuplicateKey($e)) {
                return null;
            }

            throw $e;
        }
    }

    private function isDuplicateKey(QueryException $e): bool
    {
        return $e->getCode() === '23000'
            || (int) ($e->errorInfo[1] ?? 0) === 1062
            || str_contains(strtolower($e->getMessage()), 'duplicate entry');
    }

    private function fail(ReportDispatch $dispatch, string $message): void
    {
        $dispatch->fill([
            'status'        => ReportDispatch::STATUS_FAILED,
            'dispatched_at' => now(),
            'error_message' => $message,
        ])->save();

        $this->logger()->error('Report dispatch failed', [
            'report_id'   => $dispatch->report_id,
            'dispatch_id' => $dispatch->id,
            'error'       => $message,
        ]);
    }

    /**
     * Records that an occurrence was evaluated but had nothing new to send —
     * distinct from `fail()`, which means sending was attempted and failed.
     */
    private function skip(ReportDispatch $dispatch, string $message): void
    {
        $dispatch->fill([
            'status'        => ReportDispatch::STATUS_SKIPPED,
            'dispatched_at' => now(),
            'error_message' => $message,
        ])->save();
    }

    /**
     * Duplicate the attachment for one recipient.
     *
     * Falls back to the shared path if the copy fails, so a filesystem hiccup
     * degrades to "one recipient may lose the attachment" instead of "nobody
     * receives the email".
     */
    private function copyForRecipient(string $sourcePath, string $recipient): string
    {
        $directory = dirname($sourcePath);
        $extension = pathinfo($sourcePath, PATHINFO_EXTENSION) ?: 'pdf';
        $base      = pathinfo($sourcePath, PATHINFO_FILENAME);
        $suffix    = substr(md5($recipient . '|' . $sourcePath), 0, 8);

        $target = $directory . DIRECTORY_SEPARATOR . $base . '_' . $suffix . '.' . $extension;

        if (@copy($sourcePath, $target)) {
            return $target;
        }

        $this->logger()->warning('Could not create a per-recipient attachment copy', [
            'recipient' => $recipient,
            'source'    => $sourcePath,
            'target'    => $target,
        ]);

        return $sourcePath;
    }

    /** email_queue.account_no is NOT NULL; reports are not account-scoped. */
    private function accountReference(Report $report): string
    {
        return substr('REPORT-' . ($report->id ?? '0'), 0, 50);
    }

    private function subject(Report $report, Carbon $occurrence): string
    {
        return sprintf(
            '%s — %s (%s)',
            $report->report_name,
            $report->report_type,
            $occurrence->format('M d, Y')
        );
    }

    private function body(Report $report, Carbon $occurrence, string $fileName): string
    {
        $brand    = e((string) config('reports.brand', 'ATSS FIBER'));
        // Same palette the attached PDF uses, so the email and the document it
        // carries are not two different brand colours.
        $theme    = \App\Support\ReportTheme::resolve();
        $barBg    = $theme['primary'];
        $barText  = \App\Support\ReportTheme::readableOn($barBg, '#ffffff');
        $schedule = trim($report->canonicalSchedule() . ' ' . $report->scheduleDetail());

        $rows = [
            'Report Name'      => $report->report_name,
            'Report Type'      => $report->report_type,
            'Reporting Period' => $report->date_range ?: 'All time',
            'Schedule'         => $schedule ?: 'Manual',
            'Generated'        => $occurrence->format('F d, Y \a\t g:i A')
                                  . ' (' . ReportPdfService::timezoneLabel() . ')',
            'Attachment'       => $fileName,
        ];

        $rowHtml = '';
        foreach ($rows as $label => $value) {
            $rowHtml .= '<tr>'
                . '<td style="padding:7px 12px;color:#6b7280;font-size:12px;white-space:nowrap;">'
                . e($label) . '</td>'
                . '<td style="padding:7px 12px;color:#111827;font-size:12px;font-weight:600;">'
                . e((string) $value) . '</td>'
                . '</tr>';
        }

        return <<<HTML
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background-color:{$barBg};padding:18px 24px;color:{$barText};font-size:17px;font-weight:bold;letter-spacing:0.5px;">
            {$brand}
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 6px 0;font-size:16px;font-weight:bold;color:#111827;">Your scheduled report is ready</p>
            <p style="margin:0 0 18px 0;font-size:13px;color:#4b5563;line-height:1.55;">
              The report below was generated automatically and is attached to this email as a PDF.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;background-color:#f9fafb;">
              {$rowHtml}
            </table>
            <p style="margin:18px 0 0 0;font-size:11px;color:#9ca3af;line-height:1.55;">
              This is an automated message from the {$brand} reporting system. If you believe you
              received it in error, please contact your system administrator.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>
HTML;
    }

    // ── Housekeeping ──────────────────────────────────────────────────────────

    /**
     * Delete attachments left behind by emails that never sent successfully.
     *
     * Without this the attachment directory grows without bound: successful
     * sends clean up after themselves, failures do not.
     */
    public function cleanupStaleAttachments(?int $ttlHours = null): int
    {
        $ttl = $ttlHours ?? (int) config('reports.attachment_ttl_hours', 48);
        $directory = storage_path(ReportPdfService::ATTACHMENT_DIR);

        if (!is_dir($directory)) {
            return 0;
        }

        $cutoff  = time() - ($ttl * 3600);
        $removed = 0;

        foreach ((glob($directory . DIRECTORY_SEPARATOR . '*') ?: []) as $file) {
            if (!is_file($file) || filemtime($file) > $cutoff) {
                continue;
            }

            // Never delete a file a pending email still expects to attach.
            $stillQueued = EmailQueue::where('attachment_path', $file)
                ->whereIn('status', ['pending', 'failed'])
                ->exists();

            if ($stillQueued) {
                continue;
            }

            if (@unlink($file)) {
                $removed++;
            }
        }

        if ($removed > 0) {
            $this->logger()->info("Cleaned up {$removed} stale report attachment(s).");
        }

        return $removed;
    }

    private function buildLogger(): LoggerInterface
    {
        return ChannelLogger::for('reports');
    }
}

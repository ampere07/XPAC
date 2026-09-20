<?php

namespace App\Http\Controllers;

use App\Models\AgentInvoice;
use App\Models\User;
use App\Services\AgentInvoicePdfService;
use App\Services\AgentInvoiceService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Throwable;

/**
 * Reads and serves the weekly agent referral invoices.
 *
 * Every query is scoped before it runs, never filtered afterwards:
 *
 *   • an agent in a team sees that team's invoices;
 *   • an agent with no team sees only their own;
 *   • an administrator sees their organisation's;
 *   • a superadmin (role 7) sees everything.
 *
 * The scope is applied inside a single method used by every endpoint, so a new
 * endpoint cannot forget it.
 */
class AgentInvoiceController extends Controller
{
    private const ADMIN_ROLES = ['admin', 'administrator', 'billing', 'superadmin'];

    /** GET /api/agent-invoices */
    public function index(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            // ── Filters, mirroring the billing invoice page ──────────────────
            //
            // Held in a closure because the by-period mode below needs the same
            // filters on a second query. Applying them twice from one definition
            // is what stops a page of periods being chosen by different rules
            // from the invoices that fill it.
            $applyFilters = function ($q) use ($request) {
                if ($search = trim((string) $request->input('search', ''))) {
                    $q->where(function ($w) use ($search) {
                        $w->where('invoice_number', 'like', "%{$search}%")
                          ->orWhere('team_name', 'like', "%{$search}%")
                          ->orWhere('agent_name', 'like', "%{$search}%");
                    });
                }

                if ($status = trim((string) $request->input('status', ''))) {
                    $q->where('status', $status);
                }

                if ($type = trim((string) $request->input('type', ''))) {
                    $q->where('invoice_type', $type);
                }

                if ($from = $request->input('date_from')) {
                    $q->whereDate('invoice_date', '>=', Carbon::parse($from)->format('Y-m-d'));
                }

                if ($to = $request->input('date_to')) {
                    $q->whereDate('invoice_date', '<=', Carbon::parse($to)->format('Y-m-d'));
                }

                return $q;
            };

            $query = $applyFilters(
                $this->scopedQuery($user)->with(['customers' => fn ($q) => $q->orderBy('id')])
            );

            // ── Paginating by billing period ─────────────────────────────────
            //
            // The invoice list is read as a list of weeks, each collapsible. A
            // page of N invoices cuts across those weeks — a week's invoices can
            // straddle a page boundary and its header then appears twice, once
            // per page — so this mode pages the WEEKS and sends every invoice
            // belonging to the weeks on that page. `total` then counts weeks,
            // not invoices, which is what the page's counter reports.
            if ($request->boolean('group_by_period')) {
                $perPage = min(max((int) $request->input('per_page', 5), 1), 50);
                $page    = max((int) $request->input('page', 1), 1);

                $periods = $applyFilters($this->scopedQuery($user))
                    ->getQuery()
                    ->select('period_start', 'period_end')
                    ->distinct()
                    ->orderByDesc('period_start')
                    ->orderByDesc('period_end')
                    ->get();

                $total    = $periods->count();
                $lastPage = max((int) ceil($total / $perPage), 1);
                $slice    = $periods->forPage($page, $perPage)->values();

                $records = collect();

                if ($slice->isNotEmpty()) {
                    $query->where(function ($q) use ($slice) {
                        foreach ($slice as $period) {
                            $q->orWhere(function ($w) use ($period) {
                                $w->where('period_start', $period->period_start)
                                  ->where('period_end', $period->period_end);
                            });
                        }
                    });

                    // Ordered by period first so the groups arrive in the order
                    // the page renders them; the existing invoice ordering then
                    // decides the rows inside each one.
                    $records = $query->orderByDesc('period_start')
                                     ->orderByDesc('invoice_date')
                                     ->orderByDesc('id')
                                     ->get();
                }

                return response()->json([
                    'success' => true,
                    'data'    => $records->map(fn ($i) => $this->present($i))->all(),
                    'meta'    => [
                        'current_page'  => min($page, $lastPage),
                        'last_page'     => $lastPage,
                        'per_page'      => $perPage,
                        'total'         => $total,
                        // Named so the client can label its counter honestly:
                        // this page holds `total` weeks, and `invoice_count`
                        // invoices within the ones on it.
                        'unit'          => 'period',
                        'invoice_count' => $records->count(),
                    ],
                ]);
            }

            $perPage = min(max((int) $request->input('per_page', 25), 1), 200);

            $invoices = $query->orderByDesc('invoice_date')
                              ->orderByDesc('id')
                              ->paginate($perPage);

            return response()->json([
                'success' => true,
                'data'    => $invoices->getCollection()->map(fn ($i) => $this->present($i))->all(),
                'meta'    => [
                    'current_page' => $invoices->currentPage(),
                    'last_page'    => $invoices->lastPage(),
                    'per_page'     => $invoices->perPage(),
                    'total'        => $invoices->total(),
                    'unit'         => 'invoice',
                ],
            ]);
        } catch (Throwable $e) {
            Log::error('[AGENT INVOICES] index failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch agent invoices',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /** GET /api/agent-invoices/{id} — the invoice with every customer on it. */
    public function show(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $invoice = $this->scopedQuery($user)
                ->with(['customers' => fn ($q) => $q->orderBy('id')])
                ->find($id);

            if (!$invoice) {
                // Deliberately the same answer whether it does not exist or is
                // not theirs, so the endpoint cannot be used to discover which
                // invoice numbers are real.
                return response()->json(['success' => false, 'message' => 'Invoice not found'], 404);
            }

            return response()->json([
                'success' => true,
                'data'    => $this->present($invoice, true),
            ]);
        } catch (Throwable $e) {
            Log::error('[AGENT INVOICES] show failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch the invoice',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/agent-invoices/{id}/pdf — stream the stored PDF.
     *
     * Serves the file already on disk. It is only rendered here if the stored
     * file has gone missing, so opening the page does not re-render every time.
     */
    public function pdf(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $invoice = $this->scopedQuery($user)->find($id);
            if (!$invoice) {
                return response()->json(['success' => false, 'message' => 'Invoice not found'], 404);
            }

            $pdfService = app(AgentInvoicePdfService::class);

            // Where this invoice's PDF belongs under the current layout. A file
            // stored under an older one no longer matches, which is how a
            // template change reaches invoices already issued: the rendering is
            // stale, so it is made again. Without this the file written at
            // generation was served unchanged forever.
            $expected = $pdfService->pathFor($invoice);
            $isCurrent = $invoice->pdf_path === $expected;

            // Drive is where the PDF lives. A link that was produced by the
            // current layout is the answer; the reader is sent straight to it
            // and this server never touches the file.
            if ($isCurrent && $invoice->pdf_drive_url) {
                return response()->json([
                    'success' => true,
                    'url'     => $invoice->pdf_drive_url,
                    'storage' => 'drive',
                ]);
            }

            // No stored link, or one produced by an older layout: render it and
            // upload. An invoice issued before Drive existed is migrated the
            // first time somebody opens it. Nothing is written to this server.
            $invoice->load(['customers' => fn ($q) => $q->orderBy('id')]);
            $url = $pdfService->render($invoice, true);

            return response()->json([
                'success' => true,
                'url'     => $url,
                'storage' => 'drive',
            ]);
        } catch (Throwable $e) {
            // Enough to identify the fault from the log alone. The message on
            // its own was not: a Dompdf failure, a missing storage directory and
            // an unreadable file all read the same way once the class and the
            // line are dropped.
            Log::error('[AGENT INVOICES] pdf failed: ' . $e->getMessage(), [
                'invoice_id'     => $id,
                'invoice_number' => $invoice->invoice_number ?? null,
                'stored_path'    => $invoice->pdf_path ?? null,
                'resolved_path'  => $path ?? null,
                'exception'      => get_class($e),
                'at'             => $e->getFile() . ':' . $e->getLine(),
                'gd_loaded'      => extension_loaded('gd'),
                'trace'          => $e->getTraceAsString(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to open the invoice PDF',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/agent-invoices/periods — the billing weeks that have invoices.
     *
     * Scoped like everything else, so an agent is offered only the weeks they
     * have invoices for. Feeds the download dialog's period picker; drawn from
     * every invoice rather than the page on screen, which is the point of
     * asking the server rather than deriving it from the list.
     */
    public function periods(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $rows = $this->scopedQuery($user)
                ->select('period_start', 'period_end')
                ->selectRaw('COUNT(*) as invoice_count')
                ->selectRaw('SUM(subtotal) as subtotal')
                ->groupBy('period_start', 'period_end')
                ->orderByDesc('period_start')
                ->get();

            return response()->json([
                'success' => true,
                'data'    => $rows->map(fn ($row) => [
                    'period_start'  => optional($row->period_start)->format('Y-m-d')
                        ?? (string) $row->period_start,
                    'period_end'    => optional($row->period_end)->format('Y-m-d')
                        ?? (string) $row->period_end,
                    'invoice_count' => (int) $row->invoice_count,
                    'subtotal'      => (float) $row->subtotal,
                ])->all(),
            ]);
        } catch (Throwable $e) {
            Log::error('[AGENT INVOICES] periods failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch the billing periods',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/agent-invoices/archive — the invoices as one PDF.
     *
     * With `period_start` it covers that billing week; without, every invoice
     * the caller may see. Scoped by the same query as the list, so an agent's
     * download can only ever contain their own team's invoices.
     *
     * One document rather than a folder of them: each invoice opens on a fresh
     * page and the whole thing can be read, printed or filed in one go. It is
     * rendered fresh rather than assembled from the stored files, so it can
     * never contain a page written by an older layout.
     */
    public function archive(Request $request)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            $query = $this->scopedQuery($user)->with(['customers' => fn ($q) => $q->orderBy('id')]);

            $periodStart = trim((string) $request->input('period_start', ''));

            if ($periodStart !== '') {
                $query->whereDate('period_start', Carbon::parse($periodStart)->format('Y-m-d'));
            }

            $invoices = $query->orderBy('invoice_number')->get();

            if ($invoices->isEmpty()) {
                return response()->json([
                    'success' => false,
                    'message' => 'There are no invoices to download for that selection.',
                ], 404);
            }

            $bytes = app(AgentInvoicePdfService::class)->renderBundle($invoices);

            $filename = $periodStart !== ''
                ? 'agent-invoices-' . Carbon::parse($periodStart)->format('Y-m-d') . '.pdf'
                : 'agent-invoices-all.pdf';

            return response($bytes, 200, [
                'Content-Type'        => 'application/pdf',
                'Content-Length'      => (string) strlen($bytes),
                'Content-Disposition' => (new ResponseHeaderBag())->makeDisposition(
                    ResponseHeaderBag::DISPOSITION_ATTACHMENT,
                    $filename
                ),
                // How many invoices the document holds, for anything that wants
                // to confirm the download matched the selection.
                'X-Invoices-Included' => (string) $invoices->count(),
            ]);
        } catch (Throwable $e) {
            Log::error('[AGENT INVOICES] archive failed: ' . $e->getMessage(), [
                'exception' => get_class($e),
                'at'        => $e->getFile() . ':' . $e->getLine(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to build the invoice document',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/agent-invoices/generate — run the weekly generation by hand.
     *
     * Administrators only. Idempotent: an owner already invoiced for the week
     * is skipped, so this is safe to press twice.
     */
    public function generate(Request $request, AgentInvoiceService $service)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            if (!$this->isAdminUser($user)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Only an administrator can generate agent invoices.',
                ], 403);
            }

            // Treated as the generation date: the seven days BEFORE it are
            // billed, matching what the Monday cron would have produced that
            // day. `week` is kept as the field name for the existing callers;
            // `as_of` is the clearer name and wins when both are sent.
            $asOfInput = $request->input('as_of') ?: $request->input('week');
            $asOf = $asOfInput ? Carbon::parse($asOfInput) : null;

            // Same log as the scheduled run, minus the console echo — there is
            // no console on a web request. The person who pressed Generate is
            // named in it, which a cron run has no equivalent of and which is
            // the first thing anyone asks about an unexpected invoice.
            $service
                ->setVerbose(true, false)
                ->setTriggeredBy(sprintf(
                    'Generate button — %s (user #%s)',
                    $user->email_address ?? $user->username ?? 'unknown',
                    $user->id ?? '?'
                ));

            $summary = $service->generateForWeek($asOf);

            return response()->json([
                'success' => true,
                'message' => "{$summary['invoices_created']} invoice(s) generated for "
                    . "{$summary['period_start']} to {$summary['period_end']}.",
                'data'    => $summary,
            ]);
        } catch (Throwable $e) {
            Log::error('[AGENT INVOICES] manual generate failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to generate agent invoices',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /** PATCH /api/agent-invoices/{id}/status — administrators only. */
    public function updateStatus(Request $request, $id)
    {
        try {
            $user = auth()->user();
            if (!$user) {
                return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
            }

            if (!$this->isAdminUser($user)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Only an administrator can change an invoice status.',
                ], 403);
            }

            // Built from the model's own list rather than spelled out again, so
            // adding a status in one place cannot leave the other refusing it.
            // Sent and Cancelled stay accepted even though the list no longer
            // offers them, so an invoice already carrying one can still be
            // saved without being forced onto a different status first.
            $validated = $request->validate([
                'status' => ['required', 'string', Rule::in(AgentInvoice::STATUSES)],
            ]);

            $invoice = $this->scopedQuery($user)->find($id);
            if (!$invoice) {
                return response()->json(['success' => false, 'message' => 'Invoice not found'], 404);
            }

            $invoice->forceFill([
                'status'     => $validated['status'],
                'updated_by' => $user->email_address ?? $user->email ?? 'unknown',
            ])->save();

            return response()->json([
                'success' => true,
                'message' => 'Invoice status updated',
                'data'    => $this->present($invoice),
            ]);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors'  => $e->errors(),
            ], 422);
        } catch (Throwable $e) {
            Log::error('[AGENT INVOICES] status update failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to update the invoice status',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    // ── Scoping ─────────────────────────────────────────────────────────────

    /**
     * The invoices this user is allowed to see, as a query.
     *
     * Applied before anything else on every endpoint, so an agent cannot reach
     * another team's invoice by guessing an id.
     */
    private function scopedQuery($user)
    {
        $query = AgentInvoice::query();

        if ($this->isAdminUser($user)) {
            // A superadmin sees everything; an organisation admin sees theirs.
            $roleId = $user->role_id ?? null;
            $orgId  = $user->organization_id ?? null;

            if ($roleId != 7 && $orgId) {
                $query->where(function ($q) use ($orgId) {
                    $q->where('organization_id', $orgId)->orWhereNull('organization_id');
                });
            }

            return $query;
        }

        // An agent: their team's invoices, or their own if they have no team.
        $teamId = $user->agent_id ?? null;

        if ($teamId !== null && $teamId !== '') {
            return $query->where('owner_key', AgentInvoice::ownerKeyForTeam($teamId));
        }

        return $query->where('owner_key', AgentInvoice::ownerKeyForAgent($user->id));
    }

    private function isAdminUser($user): bool
    {
        if (($user->role_id ?? null) == 7) {
            return true;
        }

        return in_array(strtolower($user->role->role_name ?? ''), self::ADMIN_ROLES, true);
    }

    /** One invoice as the page renders it. */
    private function present(AgentInvoice $invoice, bool $withCustomers = false): array
    {
        $payload = [
            'id'              => $invoice->id,
            'invoice_number'  => $invoice->invoice_number,
            'invoice_type'    => $invoice->invoice_type,
            'team_id'         => $invoice->team_id,
            'team_name'       => $invoice->team_name,
            'agent_id'        => $invoice->agent_id,
            'agent_name'      => $invoice->agent_name,
            'billed_to'       => $invoice->billed_to,
            'invoice_date'    => optional($invoice->invoice_date)->format('Y-m-d'),
            'period_start'    => optional($invoice->period_start)->format('Y-m-d'),
            'period_end'      => optional($invoice->period_end)->format('Y-m-d'),
            'total_customers' => (int) $invoice->total_customers,
            'unit_price'      => (float) $invoice->unit_price,
            'installation_fee'=> (float) $invoice->installation_fee,
            'total_amount'    => (float) $invoice->total_amount,
            'commission'      => (float) $invoice->commission,
            'subtotal'        => (float) $invoice->subtotal,
            'status'          => $invoice->status,
            // A rendering exists somewhere — on Drive, or locally when an upload
            // could not be made. Not a precondition for opening one: the PDF is
            // rendered on demand when there is none, so this is a hint about
            // whether that will happen, never a gate on the button.
            'has_pdf'         => (bool) ($invoice->pdf_drive_url ?: $invoice->pdf_path),
            'pdf_drive_url'   => $invoice->pdf_drive_url,
            'created_at'      => optional($invoice->created_at)->toIso8601String(),
        ];

        if ($withCustomers || $invoice->relationLoaded('customers')) {
            $payload['customers'] = $invoice->customers->map(fn ($c) => [
                'id'                   => $c->id,
                'application_id'       => $c->application_id,
                'job_order_id'         => $c->job_order_id,
                'customer_name'        => $c->customer_name,
                'referred_by_agent_id' => $c->referred_by_agent_id,
                'referred_by_name'     => $c->referred_by_name,
                'installed_date'       => optional($c->installed_date)->format('Y-m-d'),
                'unit_price'           => (float) $c->unit_price,
                'quantity'             => (int) $c->quantity,
                'total'                => (float) $c->total,
            ])->all();
        }

        return $payload;
    }
}

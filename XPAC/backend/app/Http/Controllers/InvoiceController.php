<?php

namespace App\Http\Controllers;

use App\Events\InvoiceUpdated;
use App\Models\ActivityLog;
use App\Models\Invoice;
use App\Support\AgentAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class InvoiceController extends Controller
{
    public function destroy(string $id): JsonResponse
    {
        if (!AgentAccess::isSuperAdmin(auth()->user())) {
            return response()->json([
                'success' => false,
                'message' => 'Only a Super Admin can delete an invoice.'
            ], 403);
        }

        $invoice = Invoice::find($id);
        if (!$invoice) {
            return response()->json([
                'success' => false,
                'message' => 'Invoice not found. It may have been deleted already.'
            ], 404);
        }

        try {
            $snapshot = $invoice->toArray();
            $invoice->delete();

            ActivityLog::log(
                'Invoice Deleted',
                "Invoice {$id} deleted for Account: {$invoice->account_no}",
                'warning',
                [
                    'resource_type' => 'Invoice',
                    'resource_id' => $id,
                    'additional_data' => $snapshot
                ]
            );

            event(new InvoiceUpdated(['action' => 'deleted', 'invoice_id' => $id, 'account_no' => $invoice->account_no]));

            return response()->json([
                'success' => true,
                'message' => 'Invoice deleted successfully'
            ]);
        } catch (\Throwable $e) {
            Log::error('Error deleting invoice', ['invoice_id' => $id, 'error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to delete invoice'
            ], 500);
        }
    }
}

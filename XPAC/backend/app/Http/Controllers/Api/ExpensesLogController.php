<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class ExpensesLogController extends Controller
{
    public function index(Request $request)
    {
        try {
            $currentUser = auth()->user();
            $query = DB::table('expenses_logs');

            // Apply organization filter
            if ($currentUser) {
                if ($currentUser->organization_id) {
                    $query->where('organization_id', $currentUser->organization_id);
                } else {
                    $query->whereNull('organization_id');
                }
            }

            // Apply search filter if provided
            if ($request->has('search') && !empty($request->search)) {
                $search = $request->search;
                $query->where(function($q) use ($search) {
                    $q->where('payee', 'like', "%{$search}%")
                      ->orWhere('description', 'like', "%{$search}%")
                      ->orWhere('category', 'like', "%{$search}%")
                      ->orWhere('invoice_no', 'like', "%{$search}%");
                });
            }

            // Order by date descending by default
            $query->orderBy('date', 'desc')->orderBy('modified_date', 'desc');

            $records = $query->get();

            // Format data for frontend
            $data = $records->map(function ($record) {
                return [
                    'id' => (string)$record->id,
                    'expensesId' => (string)$record->id,
                    'date' => $record->date ? Carbon::parse($record->date)->format('n/j/Y') : '',
                    'amount' => (float)$record->amount,
                    'payee' => $record->payee ?? '',
                    'category' => $record->category ?? '',
                    'description' => $record->description ?? '',
                    'invoiceNo' => $record->invoice_no ?? '',
                    'provider' => $record->provider ?? '',
                    'photo' => $record->photo,
                    'processedBy' => $record->processed_by ?? '',
                    'modifiedBy' => $record->modified_by ?? '',
                    'modifiedDate' => $record->modified_date ? Carbon::parse($record->modified_date)->format('n/j/Y g:i:s A') : '',
                    'userEmail' => $record->user_email ?? '',
                    'receivedDate' => $record->received_date ? Carbon::parse($record->received_date)->format('n/j/Y') : '',
                    'supplier' => $record->supplier ?? '',
                    'city' => $record->city ?? 'All',
                    'organization_id' => $record->organization_id ?? null,
                ];
            });

            return response()->json(['status' => 'success', 'data' => $data]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 500);
        }
    }
}


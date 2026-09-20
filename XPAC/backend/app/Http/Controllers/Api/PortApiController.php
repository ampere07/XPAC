<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Port;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\ActivityLog;

class PortApiController extends Controller
{
    private function getCurrentUser()
    {
        return 'ravenampere0123@gmail.com';
    }

    public function index(Request $request)
    {
        try {
            $page = (int) $request->get('page', 1);
            $limit = min((int) $request->get('limit', 10), 100);
            $search = $request->get('search', '');
            $excludeUsed = $request->get('exclude_used', false);
            $currentJobOrderId = $request->get('current_job_order_id', null);
            $lcpnap = $request->get('lcpnap', '');

            $query = Port::query();

            if (!empty($search)) {
                $query->where('PORT_ID', 'like', '%' . $search . '%');
            }

            if ($excludeUsed && !empty($lcpnap)) {
                $usedPortsQuery = \DB::table('job_orders')
                    ->whereNotNull('port')
                    ->whereNotNull('lcpnap')
                    ->where('port', '!=', '')
                    ->where('lcpnap', '=', $lcpnap);

                if ($currentJobOrderId) {
                    $usedPortsQuery->where('id', '!=', $currentJobOrderId);
                }

                $usedPorts = $usedPortsQuery->pluck('port')->toArray();

                if (!empty($usedPorts)) {
                    $query->whereNotIn('Label', $usedPorts);
                }
            }

            $totalItems = $query->count();
            $totalPages = ceil($totalItems / $limit);

            $portItems = $query->orderBy('Label')
                ->skip(($page - 1) * $limit)
                ->take($limit)
                ->get();

            return response()->json([
                'success' => true,
                'data' => $portItems,
                'pagination' => [
                    'current_page' => $page,
                    'total_pages' => $totalPages,
                    'total_items' => $totalItems,
                    'items_per_page' => $limit,
                    'has_next' => $page < $totalPages,
                    'has_prev' => $page > 1
                ],
                'filters' => [
                    'lcpnap' => $lcpnap,
                    'exclude_used' => $excludeUsed,
                    'current_job_order_id' => $currentJobOrderId
                ]
            ]);

        } catch (\Exception $e) {
            \Log::error('Port API Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error fetching Port items: ' . $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'label' => 'required|string|max:255',
                'port_id' => 'required|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $label = $request->input('label');
            $portId = $request->input('port_id');

            $existing = Port::where('PORT_ID', $portId)->first();
            if ($existing) {
                return response()->json([
                    'success' => false,
                    'message' => 'A Port with this PORT_ID already exists'
                ], 422);
            }

            $port = new Port();
            $port->PORT_ID = $portId;
            $port->Label = $label;
            $port->save();

            // Create Activity Log
            ActivityLog::log(
                'Port Created',
                "New Port created: {$port->Label} (ID: {$port->PORT_ID})",
                'info',
                [
                    'resource_type' => 'Port',
                    'resource_id' => $port->id,
                    'additional_data' => $port->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Port added successfully',
                'data' => $port
            ], 201);

        } catch (\Exception $e) {
            \Log::error('Port Store Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error adding Port: ' . $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $port = Port::find($id);

            if (!$port) {
                return response()->json([
                    'success' => false,
                    'message' => 'Port not found'
                ], 404);
            }

            return response()->json([
                'success' => true,
                'data' => $port
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching Port: ' . $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'label' => 'required|string|max:255',
                'port_id' => 'required|string|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $port = Port::find($id);
            if (!$port) {
                return response()->json([
                    'success' => false,
                    'message' => 'Port not found'
                ], 404);
            }

            $label = $request->input('label');
            $portId = $request->input('port_id');

            $duplicate = Port::where('PORT_ID', $portId)->where('id', '!=', $id)->first();
            if ($duplicate) {
                return response()->json([
                    'success' => false,
                    'message' => 'A Port with this PORT_ID already exists'
                ], 422);
            }

            $port->PORT_ID = $portId;
            $port->Label = $label;
            $port->save();

            // Create Activity Log
            ActivityLog::log(
                'Port Updated',
                "Port updated: {$port->Label} (ID: {$port->PORT_ID})",
                'info',
                [
                    'resource_type' => 'Port',
                    'resource_id' => $port->id,
                    'additional_data' => $port->toArray()
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Port updated successfully',
                'data' => $port
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating Port: ' . $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $port = Port::find($id);
            if (!$port) {
                return response()->json([
                    'success' => false,
                    'message' => 'Port not found'
                ], 404);
            }

            $portData = $port->toArray();
            $port->delete();

            // Create Activity Log
            ActivityLog::log(
                'Port Deleted',
                "Port deleted: {$portData['Label']} (ID: {$portData['PORT_ID']})",
                'warning',
                [
                    'resource_type' => 'Port',
                    'resource_id' => $id,
                    'additional_data' => $portData
                ]
            );

            return response()->json([
                'success' => true,
                'message' => 'Port permanently deleted from database'
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting Port: ' . $e->getMessage()
            ], 500);
        }
    }

    public function getStatistics()
    {
        try {
            $totalPort = Port::count();

            return response()->json([
                'success' => true,
                'data' => [
                    'total_port' => $totalPort
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }
    public function getUsedPorts(Request $request)
    {
        try {
            $lcpnap = $request->get('lcpnap');
            $currentJobOrderId = $request->get('current_job_order_id');
            $currentAccountNo = $request->get('current_account_no');

            if (empty($lcpnap)) {
                return response()->json([
                    'success' => true,
                    'data' => [],
                    'port_accounts' => [],
                    'total_ports' => 32
                ]);
            }

            // Function to normalize port labels (e.g., "P 01" or "1" -> "P01")
            $normalizePort = function($port) {
                if (empty($port)) return null;
                $num = preg_replace('/[^\d]/', '', $port);
                if ($num === '') return null;
                return 'P' . str_pad($num, 2, '0', STR_PAD_LEFT);
            };

            // Query job_orders - join directly with billing_accounts to get account_no
            $joQuery = \DB::table('job_orders')
                ->leftJoin('billing_accounts', 'job_orders.account_id', '=', 'billing_accounts.id')
                ->where('job_orders.lcpnap', $lcpnap)
                ->whereNotNull('job_orders.port')
                ->where('job_orders.port', '!=', '');

            if ($currentJobOrderId) {
                $joQuery->where('job_orders.id', '!=', $currentJobOrderId);
            }
            if ($currentAccountNo) {
                $joQuery->where('billing_accounts.account_no', '!=', $currentAccountNo);
            }

            $joResults = $joQuery->select('job_orders.port', 'billing_accounts.account_no', 'job_orders.username')->get();

            // Query technical_details - has account_no directly
            $tdQuery = \DB::table('technical_details')
                ->where('lcpnap', $lcpnap)
                ->whereNotNull('port')
                ->where('port', '!=', '');

            if ($currentAccountNo) {
                $tdQuery->where('account_no', '!=', $currentAccountNo);
            } elseif ($currentJobOrderId) {
                $tdQuery->where('account_id', '!=', $currentJobOrderId);
            }

            $tdResults = $tdQuery->select('port', 'account_no', 'username')->get();

            // Build port => account_no mapping (technical_details takes precedence)
            $portAccountMap = [];
            foreach ($joResults as $row) {
                $p = $normalizePort($row->port);
                if ($p) {
                    $u = trim($row->username ?? '');
                    $a = trim($row->account_no ?? '');
                    $portAccountMap[$p] = $u ? "$u | $a" : $a;
                }
            }
            foreach ($tdResults as $row) {
                $p = $normalizePort($row->port);
                if ($p) {
                    $u = trim($row->username ?? '');
                    $a = trim($row->account_no ?? '');
                    $portAccountMap[$p] = $u ? "$u | $a" : $a;
                }
            }

            $usedPorts = array_values(array_unique(array_keys($portAccountMap)));

            // Robust LCPNAP lookup - try exact match then flexible match
            $lcpnapInfo = \DB::table('lcpnap')->where('lcpnap_name', $lcpnap)->first();
            if (!$lcpnapInfo) {
                // Try normalizing the lookup name if exact match fails
                $searchName = str_replace(['-', '_', '.'], ' ', $lcpnap);
                $lcpnapInfo = \DB::table('lcpnap')
                    ->where('lcpnap_name', 'like', '%' . $searchName . '%')
                    ->first();
            }

            $totalPorts = $lcpnapInfo ? (int) $lcpnapInfo->port_total : 32;

            return response()->json([
                'success' => true,
                'data' => $usedPorts,
                'port_accounts' => $portAccountMap,
                'total_ports' => $totalPorts
            ]);
        } catch (\Exception $e) {
            \Log::error('Error fetching used ports: ' . $e->getMessage() . ' | Trace: ' . $e->getTraceAsString());

            return response()->json([
                'success' => false,
                'message' => 'Error fetching used ports: ' . $e->getMessage()
            ], 500);
        }
    }
}


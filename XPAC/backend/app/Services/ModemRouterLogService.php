<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class ModemRouterLogService
{
    /**
     * Retrieve paginated modem/router SN movements across Job Orders and Service Orders.
     *
     * Pushes down search, SN, date and organization filters into both union branches
     * so MySQL never scans unneeded rows.
     *
     * @param array<string, mixed> $filters
     * @param int $perPage
     * @param int $page
     * @param int|null $organizationId
     * @return array{
     *     data: array<int, array<string, mixed>>,
     *     current_page: int,
     *     per_page: int,
     *     total: int,
     *     last_page: int
     * }
     */
    public function getLogs(array $filters = [], int $perPage = 50, int $page = 1, ?int $organizationId = null): array
    {
        $perPage = max(1, min(100, $perPage));
        $page    = max(1, $page);
        $offset  = ($page - 1) * $perPage;

        $search    = isset($filters['search']) ? trim((string) $filters['search']) : '';
        $sn        = isset($filters['sn']) ? trim((string) $filters['sn']) : '';
        $eventType = isset($filters['event_type']) ? trim((string) $filters['event_type']) : '';
        $dateFrom  = isset($filters['date_from']) ? trim((string) $filters['date_from']) : '';
        $dateTo    = isset($filters['date_to']) ? trim((string) $filters['date_to']) : '';

        // Build query conditions with bound parameters
        $joBindings = [];
        $joWheres   = ["jo.modem_router_sn IS NOT NULL AND jo.modem_router_sn != ''"];

        $soOldBindings = [];
        $soOldWheres   = ["so.old_router_modem_sn IS NOT NULL AND so.old_router_modem_sn != ''"];

        $soNewBindings = [];
        $soNewWheres   = [
            "so.new_router_modem_sn IS NOT NULL AND so.new_router_modem_sn != ''",
            "(so.old_router_modem_sn != so.new_router_modem_sn OR so.old_router_modem_sn IS NULL)"
        ];

        // Organization filter
        if ($organizationId !== null) {
            $joWheres[] = "(jo.organization_id = :jo_org OR jo.organization_id IS NULL)";
            $joBindings['jo_org'] = $organizationId;

            $soOldWheres[] = "(so.organization_id = :so_old_org OR so.organization_id IS NULL)";
            $soOldBindings['so_old_org'] = $organizationId;

            $soNewWheres[] = "(so.organization_id = :so_new_org OR so.organization_id IS NULL)";
            $soNewBindings['so_new_org'] = $organizationId;
        }

        // Direct SN filter
        if ($sn !== '') {
            $joWheres[] = "jo.modem_router_sn LIKE :jo_sn";
            $joBindings['jo_sn'] = "%{$sn}%";

            $soOldWheres[] = "so.old_router_modem_sn LIKE :so_old_sn";
            $soOldBindings['so_old_sn'] = "%{$sn}%";

            $soNewWheres[] = "so.new_router_modem_sn LIKE :so_new_sn";
            $soNewBindings['so_new_sn'] = "%{$sn}%";
        }

        // Universal search filter
        if ($search !== '') {
            $joWheres[] = "(jo.modem_router_sn LIKE :jo_s1 
                OR ba.account_no LIKE :jo_s2 
                OR c.first_name LIKE :jo_s3 
                OR c.last_name LIKE :jo_s4 
                OR c.address LIKE :jo_s5 
                OR jo.visit_by LIKE :jo_s6 
                OR jo.assigned_email LIKE :jo_s7 
                OR jo.lcpnap LIKE :jo_s8 
                OR jo.port LIKE :jo_s9 
                OR jo.onsite_remarks LIKE :jo_s10)";
            for ($i = 1; $i <= 10; $i++) {
                $joBindings["jo_s{$i}"] = "%{$search}%";
            }

            $soOldWheres[] = "(so.old_router_modem_sn LIKE :so_o_s1 
                OR so.account_no LIKE :so_o_s2 
                OR c.first_name LIKE :so_o_s3 
                OR c.last_name LIKE :so_o_s4 
                OR c.address LIKE :so_o_s5 
                OR so.visit_by_user LIKE :so_o_s6 
                OR so.assigned_email LIKE :so_o_s7 
                OR so.new_lcpnap LIKE :so_o_s8 
                OR so.old_lcpnap LIKE :so_o_s9 
                OR so.visit_remarks LIKE :so_o_s10)";
            for ($i = 1; $i <= 10; $i++) {
                $soOldBindings["so_o_s{$i}"] = "%{$search}%";
            }

            $soNewWheres[] = "(so.new_router_modem_sn LIKE :so_n_s1 
                OR so.account_no LIKE :so_n_s2 
                OR c.first_name LIKE :so_n_s3 
                OR c.last_name LIKE :so_n_s4 
                OR c.address LIKE :so_n_s5 
                OR so.visit_by_user LIKE :so_n_s6 
                OR so.assigned_email LIKE :so_n_s7 
                OR so.new_lcpnap LIKE :so_n_s8 
                OR so.old_lcpnap LIKE :so_n_s9 
                OR so.visit_remarks LIKE :so_n_s10)";
            for ($i = 1; $i <= 10; $i++) {
                $soNewBindings["so_n_s{$i}"] = "%{$search}%";
            }
        }

        // Date range filter
        if ($dateFrom !== '') {
            $joWheres[] = "COALESCE(jo.date_installed, jo.updated_at, jo.created_at) >= :jo_df";
            $joBindings['jo_df'] = "{$dateFrom} 00:00:00";

            $soOldWheres[] = "COALESCE(so.visit_status_date, so.updated_at, so.created_at) >= :so_o_df";
            $soOldBindings['so_o_df'] = "{$dateFrom} 00:00:00";

            $soNewWheres[] = "COALESCE(so.visit_status_date, so.updated_at, so.created_at) >= :so_n_df";
            $soNewBindings['so_n_df'] = "{$dateFrom} 00:00:00";
        }

        if ($dateTo !== '') {
            $joWheres[] = "COALESCE(jo.date_installed, jo.updated_at, jo.created_at) <= :jo_dt";
            $joBindings['jo_dt'] = "{$dateTo} 23:59:59";

            $soOldWheres[] = "COALESCE(so.visit_status_date, so.updated_at, so.created_at) <= :so_o_dt";
            $soOldBindings['so_o_dt'] = "{$dateTo} 23:59:59";

            $soNewWheres[] = "COALESCE(so.visit_status_date, so.updated_at, so.created_at) <= :so_n_dt";
            $soNewBindings['so_n_dt'] = "{$dateTo} 23:59:59";
        }

        // Event type filter (exclude branches if specific event requested)
        $includeJo = true;
        $includeSoOld = true;
        $includeSoNew = true;

        if ($eventType !== '' && strtolower($eventType) !== 'all') {
            $et = strtolower($eventType);
            if ($et === 'installation') {
                $includeSoOld = false;
                $includeSoNew = false;
            } elseif ($et === 'pullout') {
                $includeJo = false;
                $includeSoNew = false;
                $soOldWheres[] = "(so.repair_category LIKE '%pullout%' OR so.concern LIKE '%pullout%')";
            } elseif ($et === 'replacement') {
                $includeJo = false;
                $soOldWheres[] = "(so.repair_category LIKE '%replace%' OR so.concern LIKE '%replace%')";
                $soNewWheres[] = "(so.repair_category LIKE '%replace%' OR so.concern LIKE '%replace%')";
            } elseif ($et === 'transfer') {
                $includeJo = false;
                $includeSoNew = false;
                $soOldWheres[] = "(so.repair_category LIKE '%relocation%' OR so.concern LIKE '%relocation%' OR so.concern LIKE '%transfer%')";
            }
        }

        $branches = [];
        $allBindings = [];

        if ($includeJo) {
            $joWhereSql = implode(' AND ', $joWheres);
            $branches[] = "
                SELECT 
                    'job_order' as source_type,
                    jo.id as reference_id,
                    jo.modem_router_sn as sn,
                    jo.router_model as model,
                    'Installation' as event_type,
                    'New Installation' as description,
                    COALESCE(jo.date_installed, jo.updated_at, jo.created_at) as event_date,
                    ba.account_no,
                    CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) as customer_name,
                    c.address,
                    jo.lcpnap,
                    jo.port,
                    COALESCE(jo.visit_by, jo.assigned_email) as technician,
                    COALESCE(jo.onsite_status, jo.status) as status,
                    jo.onsite_remarks as remarks
                FROM job_orders jo
                LEFT JOIN billing_accounts ba ON ba.id = jo.account_id
                LEFT JOIN customers c ON c.id = ba.customer_id
                WHERE {$joWhereSql}
            ";
            $allBindings = array_merge($allBindings, $joBindings);
        }

        if ($includeSoOld) {
            $soOldWhereSql = implode(' AND ', $soOldWheres);
            $branches[] = "
                SELECT 
                    'service_order' as source_type,
                    so.id as reference_id,
                    so.old_router_modem_sn as sn,
                    so.router_model as model,
                    CASE 
                        WHEN so.repair_category LIKE '%pullout%' OR so.concern LIKE '%pullout%' THEN 'Pullout'
                        WHEN so.repair_category LIKE '%replace%' OR so.concern LIKE '%replace%' THEN 'Router Replacement (Removed)'
                        WHEN so.repair_category LIKE '%relocation%' OR so.concern LIKE '%relocation%' OR so.concern LIKE '%transfer%' THEN 'Transfer / Relocation'
                        ELSE 'Service Order'
                    END as event_type,
                    CONCAT(COALESCE(so.concern, ''), ' - ', COALESCE(so.repair_category, '')) as description,
                    COALESCE(so.visit_status_date, so.updated_at, so.created_at) as event_date,
                    so.account_no,
                    CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) as customer_name,
                    c.address,
                    COALESCE(so.new_lcpnap, so.old_lcpnap) as lcpnap,
                    COALESCE(so.new_port, so.old_port) as port,
                    COALESCE(so.visit_by_user, so.assigned_email) as technician,
                    so.visit_status as status,
                    so.visit_remarks as remarks
                FROM service_orders so
                LEFT JOIN billing_accounts ba ON ba.account_no = so.account_no
                LEFT JOIN customers c ON c.id = ba.customer_id
                WHERE {$soOldWhereSql}
            ";
            $allBindings = array_merge($allBindings, $soOldBindings);
        }

        if ($includeSoNew) {
            $soNewWhereSql = implode(' AND ', $soNewWheres);
            $branches[] = "
                SELECT 
                    'service_order' as source_type,
                    so.id as reference_id,
                    so.new_router_modem_sn as sn,
                    so.router_model as model,
                    CASE 
                        WHEN so.repair_category LIKE '%replace%' OR so.concern LIKE '%replace%' THEN 'Router Replacement (Installed)'
                        ELSE 'Service Order (New Device)'
                    END as event_type,
                    CONCAT('Installed new router. Replaced old SN: ', COALESCE(so.old_router_modem_sn, 'N/A'), ' | ', COALESCE(so.concern, '')) as description,
                    COALESCE(so.visit_status_date, so.updated_at, so.created_at) as event_date,
                    so.account_no,
                    CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) as customer_name,
                    c.address,
                    COALESCE(so.new_lcpnap, so.old_lcpnap) as lcpnap,
                    COALESCE(so.new_port, so.old_port) as port,
                    COALESCE(so.visit_by_user, so.assigned_email) as technician,
                    so.visit_status as status,
                    so.visit_remarks as remarks
                FROM service_orders so
                LEFT JOIN billing_accounts ba ON ba.account_no = so.account_no
                LEFT JOIN customers c ON c.id = ba.customer_id
                WHERE {$soNewWhereSql}
            ";
            $allBindings = array_merge($allBindings, $soNewBindings);
        }

        if (empty($branches)) {
            return [
                'data'         => [],
                'current_page' => $page,
                'per_page'     => $perPage,
                'total'        => 0,
                'last_page'    => 1,
            ];
        }

        $unionSql = implode(' UNION ALL ', $branches);

        // Count total
        $countSql = "SELECT COUNT(*) as agg_count FROM ({$unionSql}) as counted_logs";
        $totalRow = DB::selectOne($countSql, $allBindings);
        $total    = (int) ($totalRow->agg_count ?? 0);

        // Fetch page
        $dataSql = "SELECT * FROM ({$unionSql}) as paged_logs ORDER BY event_date DESC LIMIT {$perPage} OFFSET {$offset}";
        $rawRows = DB::select($dataSql, $allBindings);

        $data = array_map(function ($row) {
            return [
                'id'            => $row->source_type . '_' . $row->reference_id . '_' . $row->sn,
                'source_type'   => $row->source_type,
                'reference_id'  => (int) $row->reference_id,
                'sn'            => (string) $row->sn,
                'model'         => $row->model ?: null,
                'event_type'    => (string) $row->event_type,
                'description'   => (string) $row->description,
                'event_date'    => (string) $row->event_date,
                'account_no'    => $row->account_no ?: null,
                'customer_name' => trim((string) $row->customer_name) ?: null,
                'address'       => $row->address ?: null,
                'lcpnap'        => $row->lcpnap ?: null,
                'port'          => $row->port ?: null,
                'technician'    => $row->technician ?: null,
                'status'        => $row->status ?: null,
                'remarks'       => $row->remarks ?: null,
            ];
        }, $rawRows);

        return [
            'data'         => $data,
            'current_page' => $page,
            'per_page'     => $perPage,
            'total'        => $total,
            'last_page'    => (int) ceil($total / $perPage),
        ];
    }

    /**
     * Get the complete chronological lifecycle movements for one specific serial number.
     *
     * @param string $sn
     * @param int|null $organizationId
     * @return array<int, array<string, mixed>>
     */
    public function getTimelineBySn(string $sn, ?int $organizationId = null): array
    {
        $sn = trim($sn);
        if ($sn === '') {
            return [];
        }

        $result = $this->getLogs([
            'sn' => $sn,
        ], 100, 1, $organizationId);

        return $result['data'];
    }

    /**
     * Get high-level summary counters for modem/router movements.
     *
     * @param int|null $organizationId
     * @return array{
     *     total_movements: int,
     *     total_installations: int,
     *     total_pullouts: int,
     *     total_replacements: int,
     *     unique_serials: int
     * }
     */
    public function getSummary(?int $organizationId = null): array
    {
        try {
            $joQuery = DB::table('job_orders')
                ->whereNotNull('modem_router_sn')
                ->where('modem_router_sn', '!=', '');

            $soPullQuery = DB::table('service_orders')
                ->whereNotNull('old_router_modem_sn')
                ->where('old_router_modem_sn', '!=', '')
                ->where(function ($q) {
                    $q->where('repair_category', 'LIKE', '%pullout%')
                      ->orWhere('concern', 'LIKE', '%pullout%');
                });

            $soReplaceQuery = DB::table('service_orders')
                ->where(function ($q) {
                    $q->where('repair_category', 'LIKE', '%replace%')
                      ->orWhere('concern', 'LIKE', '%replace%')
                      ->orWhere(function ($q2) {
                          $q2->whereNotNull('new_router_modem_sn')
                             ->where('new_router_modem_sn', '!=', '');
                      });
                });

            if ($organizationId !== null) {
                $joQuery->where(function ($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
                });
                $soPullQuery->where(function ($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
                });
                $soReplaceQuery->where(function ($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
                });
            }

            $installations = $joQuery->count();
            $pullouts      = $soPullQuery->count();
            $replacements  = $soReplaceQuery->count();

            // Count distinct serials across active technical_details
            $uniqueSerialsQuery = DB::table('technical_details')
                ->whereNotNull('router_modem_sn')
                ->where('router_modem_sn', '!=', '');
            if ($organizationId !== null) {
                $uniqueSerialsQuery->where(function ($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)->orWhereNull('organization_id');
                });
            }
            $uniqueSerials = $uniqueSerialsQuery->distinct('router_modem_sn')->count('router_modem_sn');

            return [
                'total_movements'     => $installations + $pullouts + $replacements,
                'total_installations' => $installations,
                'total_pullouts'      => $pullouts,
                'total_replacements'  => $replacements,
                'unique_serials'      => $uniqueSerials,
            ];
        } catch (Throwable $e) {
            Log::error('Failed to get modem router summary', ['error' => $e->getMessage()]);
            return [
                'total_movements'     => 0,
                'total_installations' => 0,
                'total_pullouts'      => 0,
                'total_replacements'  => 0,
                'unique_serials'      => 0,
            ];
        }
    }
}

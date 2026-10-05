<?php

namespace App\Services;

use App\Support\CustomerImageSources;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Collects customer images from every source in CustomerImageSources for the Customer Images page.
 *
 * Query budget, whatever the number of customers:
 *   - the customer list: one count + one page query (the "has images" filter is a single UNION
 *     subquery across the sources), then one query per source for that page's accounts;
 *   - one customer's images: one query per source.
 * Column listings are cached, so checking which columns a database has costs nothing per request.
 */
class CustomerImageService
{
    /** Joins on account numbers compare across tables with mixed collations. */
    private const COLLATE = 'utf8mb4_unicode_ci';

    /**
     * One page of customers, each with its image count and a cover thumbnail.
     *
     * @return array{data: array<int, array>, total: int, page: int, per_page: int, last_page: int}
     */
    public function listCustomers(?string $search, int $page, int $perPage, ?int $organizationId, bool $onlyWithImages = true): array
    {
        $query = DB::table('billing_accounts as ba')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->whereNotNull('ba.account_no')
            ->where('ba.account_no', '!=', '');

        $this->scopeOrganization($query, $organizationId);

        if ($onlyWithImages) {
            $withImages = $this->accountsWithImages($organizationId);
            if ($withImages === null) {
                return ['data' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage, 'last_page' => 1];
            }
            $query->whereIn('ba.account_no', $withImages);
        }

        $search = trim((string) $search);
        if ($search !== '') {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';
            $query->where(function (Builder $q) use ($like) {
                $q->where('ba.account_no', 'like', $like)
                    ->orWhereRaw("CONCAT_WS(' ', c.first_name, c.middle_initial, c.last_name) LIKE ?", [$like])
                    ->orWhereRaw("CONCAT_WS(' ', c.first_name, c.last_name) LIKE ?", [$like]);
            });
        }

        $total = (clone $query)->count('ba.id');
        $lastPage = max(1, (int) ceil($total / $perPage));
        $page = min(max(1, $page), $lastPage);

        $rows = $query
            ->orderBy('c.last_name')
            ->orderBy('c.first_name')
            ->orderBy('ba.account_no')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get([
                'ba.account_no',
                DB::raw("TRIM(CONCAT_WS(' ', c.first_name, c.middle_initial, c.last_name)) as full_name"),
            ]);

        $images = $this->imagesFor($rows->pluck('account_no')->all(), $organizationId);

        $data = $rows->map(function ($row) use ($images) {
            $own = $images[$row->account_no] ?? [];
            return [
                'account_no' => $row->account_no,
                'full_name' => $row->full_name ?: null,
                'image_count' => count($own),
                'cover' => $own[0]['thumbnail_url'] ?? null,
                'sources' => array_values(array_unique(array_column($own, 'source'))),
            ];
        })->all();

        return ['data' => $data, 'total' => $total, 'page' => $page, 'per_page' => $perPage, 'last_page' => $lastPage];
    }

    /**
     * Every image of one account, newest first.
     *
     * @return array{account_no: string, full_name: ?string, images: array<int, array>}|null
     */
    public function customerImages(string $accountNo, ?int $organizationId): ?array
    {
        $query = DB::table('billing_accounts as ba')
            ->leftJoin('customers as c', 'c.id', '=', 'ba.customer_id')
            ->where('ba.account_no', $accountNo);
        $this->scopeOrganization($query, $organizationId);

        $account = $query->first([
            'ba.account_no',
            DB::raw("TRIM(CONCAT_WS(' ', c.first_name, c.middle_initial, c.last_name)) as full_name"),
        ]);

        if (!$account) {
            return null;
        }

        return [
            'account_no' => $account->account_no,
            'full_name' => $account->full_name ?: null,
            'images' => $this->imagesFor([$account->account_no], $organizationId)[$account->account_no] ?? [],
        ];
    }

    /**
     * Images for these accounts, grouped by account number. One query per source.
     *
     * @param list<string> $accountNos
     * @return array<string, list<array>>
     */
    public function imagesFor(array $accountNos, ?int $organizationId): array
    {
        $accountNos = array_values(array_unique(array_filter(array_map('strval', $accountNos))));
        if ($accountNos === []) {
            return [];
        }

        $byAccount = [];
        foreach ($this->sources() as $source) {
            $query = $this->sourceQuery($source, $organizationId);
            $query->whereIn('ba.account_no', $accountNos);

            foreach ($query->get() as $row) {
                foreach ($source['present_columns'] as $column => $label) {
                    foreach ($this->urlsIn($row->{'img__' . $column} ?? null) as $index => $url) {
                        $typeLabel = !empty($source['type_column']) && !empty($row->img_type) ? (string) $row->img_type : $label;
                        $byAccount[$row->account_no][] = $this->describe($url) + [
                            'id' => "{$source['key']}-{$row->record_id}-{$column}-{$index}",
                            'source' => $source['label'],
                            'source_key' => $source['key'],
                            'table' => $source['table'],
                            'record_id' => $row->record_id,
                            'field' => $column,
                            'field_label' => $typeLabel,
                            'date' => $row->img_date,
                        ];
                    }
                }
            }
        }

        foreach ($byAccount as &$images) {
            usort($images, fn ($a, $b) => strcmp((string) $b['date'], (string) $a['date']));
        }

        return $byAccount;
    }

    /** The sources this database can serve, with only the columns it actually has. */
    public function sources(): array
    {
        $available = [];
        foreach (CustomerImageSources::SOURCES as $source) {
            $columns = $this->columnsOf($source['table']);
            if ($columns === []) {
                continue;
            }

            $linkColumn = $source['link']['column'] ?? $source['id'];
            if (!in_array($source['id'], $columns, true) || !in_array($linkColumn, $columns, true)) {
                continue;
            }

            $present = array_filter($source['columns'], fn ($column) => in_array($column, $columns, true), ARRAY_FILTER_USE_KEY);
            if ($present === []) {
                continue;
            }

            $source['present_columns'] = $present;
            $source['present_dates'] = array_values(array_filter($source['date'], fn ($c) => in_array($c, $columns, true)));
            if (!empty($source['type_column']) && !in_array($source['type_column'], $columns, true)) {
                $source['type_column'] = null;
            }
            $available[] = $source;
        }

        return $available;
    }

    /** Source keys and labels, for the page's filter. */
    public function sourceLabels(): array
    {
        return array_map(fn ($s) => ['key' => $s['key'], 'label' => $s['label']], $this->sources());
    }

    /**
     * Rows of one source that hold at least one image, joined to their billing account and
     * selecting: account_no, record_id, img_date, img_type and img__<column> per image column.
     */
    private function sourceQuery(array $source, ?int $organizationId): Builder
    {
        $table = $source['table'];
        $query = DB::table("{$table} as t");
        $link = $source['link'];
        $c = self::COLLATE;

        switch ($link['type']) {
            case 'account_no':
                $query->join('billing_accounts as ba', DB::raw("ba.account_no COLLATE {$c}"), '=', DB::raw("t.{$link['column']} COLLATE {$c}"));
                break;
            case 'account_id':
                $query->join('billing_accounts as ba', 'ba.id', '=', "t.{$link['column']}");
                break;
            case 'customer':
                $query->join('billing_accounts as ba', 'ba.customer_id', '=', 't.id');
                break;
            case 'job_order':
                $query->join('job_orders as jo', 'jo.application_id', '=', "t.{$link['column']}")
                    ->join('billing_accounts as ba', 'ba.id', '=', 'jo.account_id');
                break;
            case 'lcpnap':
                $query->join('technical_details as td', DB::raw("td.lcpnap COLLATE {$c}"), '=', DB::raw("t.{$link['column']} COLLATE {$c}"))
                    ->join('billing_accounts as ba', 'ba.id', '=', 'td.account_id');
                break;
            default:
                throw new \InvalidArgumentException("Unknown customer image link type '{$link['type']}' on {$table}");
        }

        $this->scopeOrganization($query, $organizationId);

        $select = ['ba.account_no', "t.{$source['id']} as record_id"];
        $select[] = $source['present_dates'] !== []
            ? DB::raw('COALESCE(' . implode(', ', array_map(fn ($d) => "t.{$d}", $source['present_dates'])) . ') as img_date')
            : DB::raw('NULL as img_date');
        $select[] = !empty($source['type_column']) ? "t.{$source['type_column']} as img_type" : DB::raw('NULL as img_type');
        foreach (array_keys($source['present_columns']) as $column) {
            $select[] = "t.{$column} as img__{$column}";
        }

        $query->select($select)->distinct();
        $query->where(function (Builder $q) use ($source) {
            foreach (array_keys($source['present_columns']) as $column) {
                $q->orWhere(function (Builder $w) use ($column) {
                    $w->whereNotNull("t.{$column}")->where("t.{$column}", '!=', '');
                });
            }
        });

        return $query;
    }

    /** UNION of account numbers that have at least one image, or null when no source exists. */
    private function accountsWithImages(?int $organizationId): ?Builder
    {
        $union = null;
        foreach ($this->sources() as $source) {
            $q = $this->sourceQuery($source, $organizationId);
            $q->columns = null;
            $q->distinct = false;
            $q->select('ba.account_no');
            $union = $union ? $union->union($q) : $q;
        }

        return $union ? DB::query()->fromSub($union, 'with_images')->select('account_no') : null;
    }

    /** Organisation scoping as the list screens do it: own rows plus pre-tenancy NULL rows. */
    private function scopeOrganization(Builder $query, ?int $organizationId): void
    {
        if ($organizationId !== null) {
            $query->where(function (Builder $q) use ($organizationId) {
                $q->where('ba.organization_id', $organizationId)->orWhereNull('ba.organization_id');
            });
        }
    }

    /** @return list<string> */
    private function columnsOf(string $table): array
    {
        return Cache::remember("customer-images:columns:{$table}", 3600, function () use ($table) {
            return Schema::hasTable($table) ? Schema::getColumnListing($table) : [];
        });
    }

    /**
     * The URLs in one stored value: a plain URL, several separated by commas / spaces / new
     * lines, or the legacy {"Url": "..."} JSON the old PowerApps import left behind.
     *
     * @return list<string>
     */
    private function urlsIn($value): array
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            return [];
        }

        if ($value[0] === '{' || $value[0] === '[') {
            $decoded = json_decode($value, true);
            if (is_array($decoded)) {
                $items = isset($decoded['Url']) || isset($decoded['url']) ? [$decoded] : $decoded;
                $urls = [];
                foreach ($items as $item) {
                    $url = is_array($item) ? ($item['Url'] ?? $item['url'] ?? null) : $item;
                    if (is_string($url) && trim($url) !== '') {
                        $urls[] = trim($url);
                    }
                }
                return $urls;
            }
        }

        preg_match_all('#https?://[^\s,;"\']+#i', $value, $matches);
        if (!empty($matches[0])) {
            return array_values(array_unique($matches[0]));
        }

        // A stored path rather than a URL (local uploads).
        return [str_starts_with($value, '/') ? url($value) : url('storage/' . ltrim($value, '/'))];
    }

    /** Preview links for one URL. Google Drive files get Drive's own thumbnails. */
    private function describe(string $url): array
    {
        $driveId = null;
        if (preg_match('#drive\.google\.com/.*?/d/([a-zA-Z0-9_-]+)#', $url, $m)
            || preg_match('#[?&]id=([a-zA-Z0-9_-]+)#', $url, $m)) {
            $driveId = $m[1];
        }

        if ($driveId && str_contains($url, 'google.com')) {
            return [
                'url' => $url,
                'thumbnail_url' => "https://drive.google.com/thumbnail?id={$driveId}&sz=w400",
                'full_url' => "https://drive.google.com/thumbnail?id={$driveId}&sz=w2000",
                'fallback_url' => url('/api/proxy/image') . '?url=' . rawurlencode($url),
                'open_url' => "https://drive.google.com/file/d/{$driveId}/view",
            ];
        }

        return ['url' => $url, 'thumbnail_url' => $url, 'full_url' => $url, 'fallback_url' => null, 'open_url' => $url];
    }
}

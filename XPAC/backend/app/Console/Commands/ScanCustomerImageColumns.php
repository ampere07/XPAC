<?php

namespace App\Console\Commands;

use App\Support\CustomerImageSources;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Lists image-like columns in the database that the Customer Images page does not read yet,
 * so a new upload field is not silently missing from it. Add the ones that belong to a customer
 * to App\Support\CustomerImageSources.
 */
class ScanCustomerImageColumns extends Command
{
    protected $signature = 'customer-images:scan';

    protected $description = 'List image-like columns not yet covered by the Customer Images page';

    public function handle(): int
    {
        $covered = [];
        foreach (CustomerImageSources::SOURCES as $source) {
            foreach (array_keys($source['columns']) as $column) {
                $covered["{$source['table']}.{$column}"] = true;
            }
        }

        $rows = DB::select(
            'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN (\'varchar\', \'text\', \'mediumtext\', \'longtext\')
             ORDER BY TABLE_NAME, COLUMN_NAME'
        );

        $missing = [];
        foreach ($rows as $row) {
            if (preg_match(CustomerImageSources::IMAGE_COLUMN_PATTERN, $row->c) && !isset($covered["{$row->t}.{$row->c}"])) {
                $missing[] = [$row->t, $row->c];
            }
        }

        if ($missing === []) {
            $this->info('Every image-like column is covered.');
            return self::SUCCESS;
        }

        $this->warn(count($missing) . ' image-like column(s) not on the Customer Images page (not all belong to a customer):');
        $this->table(['table', 'column'], $missing);

        return self::SUCCESS;
    }
}

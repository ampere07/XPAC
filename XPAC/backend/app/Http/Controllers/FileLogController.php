<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;

class FileLogController extends Controller
{
    /**
     * Read and return parsed log entries from a .log file.
     * Supports: smartoltrelated.log, radiusrelated.log
     */
    public function getLogFile(Request $request, string $type)
    {
        $allowedTypes = [
            'smartolt' => 'smartoltrelated.log',
            'radius'   => 'radiusrelated.log',
        ];

        if (!array_key_exists($type, $allowedTypes)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid log type. Allowed: ' . implode(', ', array_keys($allowedTypes)),
            ], 400);
        }

        $filename = $allowedTypes[$type];
        $logPath = storage_path('logs/' . $filename);

        if (!File::exists($logPath)) {
            return response()->json([
                'success' => true,
                'data'    => [],
                'meta'    => [
                    'type'     => $type,
                    'filename' => $filename,
                    'message'  => 'Log file does not exist yet.',
                    'total'    => 0,
                ],
            ]);
        }

        try {
            $search    = $request->get('search', '');
            $level     = $request->get('level', '');
            $page      = max(1, (int) $request->get('page', 1));
            $perPage   = min(100, max(10, (int) $request->get('per_page', 50)));

            $content = File::get($logPath);
            $entries = $this->parseLogContent($content);

            // Apply level filter
            if ($level && $level !== 'all') {
                $entries = array_filter($entries, function ($entry) use ($level) {
                    return strtolower($entry['level']) === strtolower($level);
                });
            }

            // Apply search filter
            if ($search) {
                $searchLower = strtolower($search);
                $entries = array_filter($entries, function ($entry) use ($searchLower) {
                    return str_contains(strtolower($entry['message']), $searchLower)
                        || str_contains(strtolower($entry['context'] ?? ''), $searchLower)
                        || str_contains(strtolower($entry['datetime'] ?? ''), $searchLower);
                });
            }

            // Re-index after filtering
            $entries = array_values($entries);
            $total   = count($entries);

            // Sort newest first
            usort($entries, function ($a, $b) {
                return strcmp($b['datetime'] ?? '', $a['datetime'] ?? '');
            });

            // Paginate
            $lastPage = max(1, (int) ceil($total / $perPage));
            $page     = min($page, $lastPage);
            $offset   = ($page - 1) * $perPage;
            $items    = array_slice($entries, $offset, $perPage);

            return response()->json([
                'success'    => true,
                'data'       => $items,
                'pagination' => [
                    'current_page' => $page,
                    'last_page'    => $lastPage,
                    'per_page'     => $perPage,
                    'total'        => $total,
                    'from'         => $total > 0 ? $offset + 1 : null,
                    'to'           => $total > 0 ? min($offset + $perPage, $total) : null,
                ],
                'meta' => [
                    'type'     => $type,
                    'filename' => $filename,
                    'filesize' => File::size($logPath),
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to read log file',
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Parse Laravel-style log content into structured entries.
     * Handles multi-line entries by looking for the standard timestamp prefix.
     */
    private function parseLogContent(string $content): array
    {
        $entries = [];
        $lines   = explode("\n", $content);

        // Pattern: [2026-05-13 10:30:45] local.ERROR: Message text
        $pattern = '/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s+\w+\.(\w+):\s*(.*)$/';

        foreach ($lines as $line) {
            $line = rtrim($line, "\r");

            if (preg_match($pattern, $line, $matches)) {
                $entries[] = [
                    'datetime' => $matches[1],
                    'level'    => strtolower($matches[2]),
                    'message'  => $matches[3],
                ];
            }
        }

        return $entries;
    }
}

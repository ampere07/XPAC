<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class RouterModelApiController extends Controller
{
    /**
     * Get current user email from session/auth and validate it exists
     */
    private function getCurrentUser()
    {
        $defaultUser = 'ravenampere0123@gmail.com';

        // Check if the email exists in Employee_Email table
        $validUser = DB::select('SELECT Email FROM Employee_Email WHERE Email = ?', [$defaultUser]);

        if (!empty($validUser)) {
            return $defaultUser;
        }

        // If default user doesn't exist, try to find any valid email
        $anyValidUser = DB::select('SELECT Email FROM Employee_Email LIMIT 1');

        if (!empty($anyValidUser)) {
            return $anyValidUser[0]->Email;
        }

        // If no valid users exist, return null
        return null;
    }

    /**
     * Get all router models from Router_Models table
     */
    public function index()
    {
        try {
            // Check if table exists
            $tableExists = DB::select("SHOW TABLES LIKE 'Router_Models'");
            if (empty($tableExists)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router_Models table does not exist'
                ], 500);
            }

            // Get table structure to verify required columns exist
            $columns = DB::select("SHOW COLUMNS FROM Router_Models");
            $columnNames = array_column($columns, 'Field');

            // Build SELECT statement based on available columns
            $selectFields = ['Model as model'];
            if (in_array('Brand', $columnNames))
                $selectFields[] = 'Brand as brand';
            if (in_array('Description', $columnNames))
                $selectFields[] = 'Description as description';
            if (in_array('Modified_By', $columnNames))
                $selectFields[] = 'Modified_By as modified_by';
            if (in_array('Modified_Date', $columnNames))
                $selectFields[] = 'Modified_Date as modified_date';

            $selectQuery = 'SELECT ' . implode(', ', $selectFields) . ' FROM Router_Models ORDER BY Model';

            $routers = DB::select($selectQuery);

            return response()->json([
                'success' => true,
                'data' => $routers,
                'columns_available' => $columnNames
            ]);

        } catch (\Exception $e) {
            \Log::error('Router Model API Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error fetching router models: ' . $e->getMessage(),
                'error_details' => [
                    'file' => $e->getFile(),
                    'line' => $e->getLine()
                ]
            ], 500);
        }
    }

    /**
     * Store a new router model in Router_Models table
     */
    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'model' => 'required|string|max:255',
                'brand' => 'nullable|string|max:255',
                'description' => 'nullable|string'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $model = $request->input('model');
            $brand = $request->input('brand', '');
            $description = $request->input('description', '');

            // Get current user - handle case where no valid user exists
            $currentUser = $this->getCurrentUser();
            if ($currentUser === null) {
                return response()->json([
                    'success' => false,
                    'message' => 'No valid employee email found. Please ensure Employee_Email table is populated.'
                ], 500);
            }

            $now = now();

            // Check for duplicate model name
            $existing = DB::select('SELECT Model FROM Router_Models WHERE LOWER(Model) = LOWER(?)', [$model]);
            if (!empty($existing)) {
                return response()->json([
                    'success' => false,
                    'message' => 'A router model with this name already exists'
                ], 422);
            }

            // Get available columns
            $columns = DB::select("SHOW COLUMNS FROM Router_Models");
            $columnNames = array_column($columns, 'Field');

            // Build insert data based on available columns
            $insertData = [
                'Model' => $model
            ];

            if (in_array('Brand', $columnNames))
                $insertData['Brand'] = $brand;
            if (in_array('Description', $columnNames))
                $insertData['Description'] = $description;
            if (in_array('Modified_Date', $columnNames))
                $insertData['Modified_Date'] = $now;
            if (in_array('Modified_By', $columnNames))
                $insertData['Modified_By'] = $currentUser;

            DB::table('Router_Models')->insert($insertData);

            // Get the inserted record
            $selectFields = ['Model as model'];
            if (in_array('Brand', $columnNames))
                $selectFields[] = 'Brand as brand';
            if (in_array('Description', $columnNames))
                $selectFields[] = 'Description as description';
            if (in_array('Modified_Date', $columnNames))
                $selectFields[] = 'Modified_Date as modified_date';
            if (in_array('Modified_By', $columnNames))
                $selectFields[] = 'Modified_By as modified_by';

            $selectQuery = 'SELECT ' . implode(', ', $selectFields) . ' FROM Router_Models WHERE Model = ?';
            $router = DB::select($selectQuery, [$model])[0];

            return response()->json([
                'success' => true,
                'message' => 'Router model added successfully',
                'data' => $router
            ], 201);

        } catch (\Exception $e) {
            \Log::error('Router Model Store Error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'Error adding router model: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Display the specified router model
     */
    public function show($model)
    {
        try {
            $columns = DB::select("SHOW COLUMNS FROM Router_Models");
            $columnNames = array_column($columns, 'Field');

            $selectFields = ['Model as model'];
            if (in_array('Brand', $columnNames))
                $selectFields[] = 'Brand as brand';
            if (in_array('Description', $columnNames))
                $selectFields[] = 'Description as description';
            if (in_array('Modified_Date', $columnNames))
                $selectFields[] = 'Modified_Date as modified_date';
            if (in_array('Modified_By', $columnNames))
                $selectFields[] = 'Modified_By as modified_by';

            $selectQuery = 'SELECT ' . implode(', ', $selectFields) . ' FROM Router_Models WHERE Model = ?';

            $router = DB::select($selectQuery, [$model]);

            if (empty($router)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router model not found'
                ], 404);
            }

            return response()->json([
                'success' => true,
                'data' => $router[0]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error fetching router model: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Update the specified router model
     */
    public function update(Request $request, $model)
    {
        try {
            $validator = Validator::make($request->all(), [
                'model' => 'required|string|max:255',
                'brand' => 'nullable|string|max:255',
                'description' => 'nullable|string'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            // Check if router model exists
            $existing = DB::select('SELECT Model FROM Router_Models WHERE Model = ?', [$model]);
            if (empty($existing)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router model not found'
                ], 404);
            }

            $newModel = $request->input('model');
            $brand = $request->input('brand', '');
            $description = $request->input('description', '');

            // Get current user - handle case where no valid user exists
            $currentUser = $this->getCurrentUser();
            if ($currentUser === null) {
                return response()->json([
                    'success' => false,
                    'message' => 'No valid employee email found. Please ensure Employee_Email table is populated.'
                ], 500);
            }

            $now = now();

            // Check for duplicate name (excluding current model)
            if ($newModel !== $model) {
                $duplicates = DB::select('SELECT Model FROM Router_Models WHERE LOWER(Model) = LOWER(?) AND Model != ?', [$newModel, $model]);
                if (!empty($duplicates)) {
                    return response()->json([
                        'success' => false,
                        'message' => 'A router model with this name already exists'
                    ], 422);
                }
            }

            // Get available columns
            $columns = DB::select("SHOW COLUMNS FROM Router_Models");
            $columnNames = array_column($columns, 'Field');

            // Build update data based on available columns
            $updateData = [
                'Model' => $newModel
            ];

            if (in_array('Brand', $columnNames))
                $updateData['Brand'] = $brand;
            if (in_array('Description', $columnNames))
                $updateData['Description'] = $description;
            if (in_array('Modified_Date', $columnNames))
                $updateData['Modified_Date'] = $now;
            if (in_array('Modified_By', $columnNames))
                $updateData['Modified_By'] = $currentUser;

            DB::table('Router_Models')->where('Model', $model)->update($updateData);

            // Get updated record
            $selectFields = ['Model as model'];
            if (in_array('Brand', $columnNames))
                $selectFields[] = 'Brand as brand';
            if (in_array('Description', $columnNames))
                $selectFields[] = 'Description as description';
            if (in_array('Modified_Date', $columnNames))
                $selectFields[] = 'Modified_Date as modified_date';
            if (in_array('Modified_By', $columnNames))
                $selectFields[] = 'Modified_By as modified_by';

            $selectQuery = 'SELECT ' . implode(', ', $selectFields) . ' FROM Router_Models WHERE Model = ?';
            $router = DB::select($selectQuery, [$newModel])[0];

            return response()->json([
                'success' => true,
                'message' => 'Router model updated successfully',
                'data' => $router
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error updating router model: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * HARD DELETE - Permanently remove the specified router model
     */
    public function destroy($model)
    {
        try {
            // Check if router model exists
            $existing = DB::select('SELECT Model FROM Router_Models WHERE Model = ?', [$model]);
            if (empty($existing)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Router model not found'
                ], 404);
            }

            // HARD DELETE - permanently remove from database
            $deleted = DB::table('Router_Models')->where('Model', $model)->delete();

            if ($deleted) {
                return response()->json([
                    'success' => true,
                    'message' => 'Router model permanently deleted from database'
                ]);
            } else {
                return response()->json([
                    'success' => false,
                    'message' => 'Failed to delete router model from database'
                ], 500);
            }

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error deleting router model: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get router model statistics
     */
    public function getStatistics()
    {
        try {
            $columns = DB::select("SHOW COLUMNS FROM Router_Models");
            $columnNames = array_column($columns, 'Field');

            $totalRouters = DB::select("SELECT COUNT(*) as count FROM Router_Models")[0]->count ?? 0;

            // Get brand statistics if Brand column exists
            $brandStats = [];
            if (in_array('Brand', $columnNames)) {
                $brands = DB::select("SELECT Brand, COUNT(*) as count FROM Router_Models WHERE Brand IS NOT NULL AND Brand != '' GROUP BY Brand ORDER BY count DESC");
                $brandStats = array_map(function ($brand) {
                    return ['name' => $brand->Brand ?? 'Unknown', 'count' => $brand->count];
                }, $brands);
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'total_router_models' => (int) $totalRouters,
                    'brand_breakdown' => $brandStats
                ]
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error getting statistics: ' . $e->getMessage()
            ], 500);
        }
    }
}

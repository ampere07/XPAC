<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DashboardTemplate;
use Illuminate\Http\Request;

class DashboardTemplateController extends Controller
{
    /**
     * Display a listing of the templates.
     */
    public function index()
    {
        $templates = DashboardTemplate::select('id', 'template_name', 'created_at')
            ->orderBy('created_at', 'desc')
            ->get();
            
        return response()->json(['status' => 'success', 'data' => $templates]);
    }

    /**
     * Store a newly created template in storage.
     */
    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            // layout/styles can be string (JSON) or array
            'layout' => 'nullable',
            'styles' => 'nullable',
        ]);

        // If inputs are JSON strings, decode them so Eloquent 'array' casting handles serialization
        $layoutData = $request->input('layout');
        if (is_string($layoutData)) {
            $decoded = json_decode($layoutData, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $layoutData = $decoded;
            }
        }

        $styleData = $request->input('styles');
        if (is_string($styleData)) {
            $decoded = json_decode($styleData, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $styleData = $decoded;
            }
        }

        $template = DashboardTemplate::create([
            'template_name' => $request->name,
            'layout_data' => $layoutData ?: [],
            'style_data' => $styleData ?: [],
        ]);

        return response()->json([
            'status' => 'success',
            'message' => 'Template saved successfully',
            'data' => $template
        ]);
    }

    /**
     * Display the specified template.
     */
    public function show($id)
    {
        $template = DashboardTemplate::find($id);
        
        if (!$template) {
            return response()->json(['status' => 'error', 'message' => 'Template not found'], 404);
        }

        return response()->json(['status' => 'success', 'data' => $template]);
    }

    /**
     * Update the specified template in storage.
     */
    public function update(Request $request, $id)
    {
        $template = DashboardTemplate::find($id);

        if (!$template) {
            return response()->json(['status' => 'error', 'message' => 'Template not found'], 404);
        }

        // Process inputs similarly to store logic
        $dataToUpdate = [];
        
        if ($request->has('name')) {
            $dataToUpdate['template_name'] = $request->name;
        }

        if ($request->has('layout')) {
            $layoutData = $request->input('layout');
            if (is_string($layoutData)) {
                $decoded = json_decode($layoutData, true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $layoutData = $decoded;
                }
            }
            $dataToUpdate['layout_data'] = $layoutData;
        }

        if ($request->has('styles')) {
            $styleData = $request->input('styles');
            if (is_string($styleData)) {
                $decoded = json_decode($styleData, true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $styleData = $decoded;
                }
            }
            $dataToUpdate['style_data'] = $styleData;
        }

        $template->update($dataToUpdate);

        return response()->json([
            'status' => 'success',
            'message' => 'Template updated successfully',
            'data' => $template
        ]);
    }

    /**
     * Remove the specified template from storage.
     */
    public function destroy($id)
    {
        $template = DashboardTemplate::find($id);
        
        if (!$template) {
            return response()->json(['status' => 'error', 'message' => 'Template not found'], 404);
        }

        $template->delete();

        return response()->json([
            'status' => 'success', 
            'message' => 'Template deleted successfully'
        ]);
    }
}


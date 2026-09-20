<?php

namespace App\Http\Controllers;

use App\Models\SettingsColorPalette;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SettingsColorPaletteController extends Controller
{
    public function index()
    {
        $palettes = SettingsColorPalette::orderBy('id')->get();
        return response()->json($palettes);
    }

    public function store(Request $request)
    {
        $request->validate([
            'palette_name' => 'required|string|max:255',
            'primary' => 'required|string|max:7',
            'secondary' => 'required|string|max:7',
            'accent' => 'required|string|max:7'
        ]);

        try {
            $palette = SettingsColorPalette::create([
                'palette_name' => $request->palette_name,
                'primary' => $request->primary,
                'secondary' => $request->secondary,
                'accent' => $request->accent,
                'status' => 'inactive',
                'updated_by' => $request->updated_by ?? 'system'
            ]);

            return response()->json([
                'message' => 'Color palette created successfully',
                'data' => $palette
            ], 201);

        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to create color palette',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function update(Request $request, $id)
    {
        $request->validate([
            'palette_name' => 'required|string|max:255',
            'primary' => 'required|string|max:7',
            'secondary' => 'required|string|max:7',
            'accent' => 'required|string|max:7'
        ]);

        try {
            $palette = SettingsColorPalette::findOrFail($id);
            $palette->update([
                'palette_name' => $request->palette_name,
                'primary' => $request->primary,
                'secondary' => $request->secondary,
                'accent' => $request->accent,
                'updated_by' => $request->updated_by ?? 'system'
            ]);

            return response()->json([
                'message' => 'Color palette updated successfully',
                'data' => $palette
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to update color palette',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function updateStatus(Request $request, $id)
    {
        $request->validate([
            'status' => 'required|in:active,inactive'
        ]);

        try {
            DB::beginTransaction();

            if ($request->status === 'active') {
                SettingsColorPalette::where('id', '!=', $id)->update(['status' => 'inactive']);
            }

            $palette = SettingsColorPalette::findOrFail($id);
            $palette->status = $request->status;
            $palette->updated_by = $request->updated_by ?? 'system';
            $palette->save();

            DB::commit();

            return response()->json([
                'message' => 'Color palette status updated successfully',
                'data' => $palette
            ]);

        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'message' => 'Failed to update color palette status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        try {
            $palette = SettingsColorPalette::findOrFail($id);
            
            if (strtolower($palette->palette_name) === 'default') {
                return response()->json([
                    'message' => 'Cannot delete the default palette'
                ], 403);
            }
            
            $palette->delete();

            return response()->json([
                'message' => 'Color palette deleted successfully'
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to delete color palette',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getActive()
    {
        $activePalette = SettingsColorPalette::where('status', 'active')->first();
        return response()->json($activePalette);
    }
}

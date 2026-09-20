<?php

namespace App\Http\Controllers;

use App\Models\SettingsImageSize;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SettingsImageSizeController extends Controller
{
    public function index()
    {
        $sizes = SettingsImageSize::orderBy('id')->get();
        return response()->json($sizes);
    }

    public function updateStatus(Request $request, $id)
    {
        $request->validate([
            'status' => 'required|in:active,inactive'
        ]);

        try {
            DB::beginTransaction();

            if ($request->status === 'active') {
                SettingsImageSize::where('id', '!=', $id)->update(['status' => 'inactive']);
            }

            $imageSize = SettingsImageSize::findOrFail($id);
            $imageSize->status = $request->status;
            $imageSize->save();

            DB::commit();

            return response()->json([
                'message' => 'Image size status updated successfully',
                'data' => $imageSize
            ]);

        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'message' => 'Failed to update image size status',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function getActive()
    {
        $activeSize = SettingsImageSize::where('status', 'active')->first();
        return response()->json($activeSize);
    }
}

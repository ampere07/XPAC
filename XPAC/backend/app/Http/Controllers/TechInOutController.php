<?php

namespace App\Http\Controllers;

use App\Models\TechInOut;
use Illuminate\Http\Request;
use Carbon\Carbon;

class TechInOutController extends Controller
{
    public function getStatus(Request $request)
    {
        $techId = $request->query('tech_id');
        if (!$techId) {
            return response()->json(['success' => false, 'message' => 'Tech ID is required'], 400);
        }

        $record = TechInOut::where('tech_id', $techId)->first();

        return response()->json([
            'success' => true,
            'data' => $record
        ]);
    }

    public function timeIn(Request $request)
    {
        $request->validate([
            'tech_id' => 'required',
        ]);

        $techId = $request->tech_id;
        
        $record = TechInOut::where('tech_id', $techId)->first();

        if ($record) {
            $record->update([
                'time_in' => Carbon::now(),
                'time_out' => null, // Reset time out on new time in
                'status' => 'online',
                'last_updated' => Carbon::now()
            ]);
        } else {
            $record = TechInOut::create([
                'tech_id' => $techId,
                'time_in' => Carbon::now(),
                'status' => 'online',
                'last_updated' => Carbon::now()
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Timed in successfully',
            'data' => $record
        ]);
    }

    public function timeOut(Request $request)
    {
        $request->validate([
            'tech_id' => 'required',
        ]);

        $techId = $request->tech_id;
        
        $record = TechInOut::where('tech_id', $techId)->first();

        if (!$record || !$record->time_in) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot time out without timing in first'
            ], 400);
        }

        $record->update([
            'time_out' => Carbon::now(),
            'status' => 'offline',
            'last_updated' => Carbon::now()
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Timed out successfully',
            'data' => $record
        ]);
    }
}

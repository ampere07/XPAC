<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BillingDetails;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class BillingDetailsApiController extends Controller
{
    /**
     * Display a listing of all billing details records.
     *
     * @return \Illuminate\Http\Response
     */
    public function index()
    {
        $billingDetails = BillingDetails::all();

        return response()->json([
            'status' => 'success',
            'message' => 'Billing details retrieved successfully',
            'data' => $billingDetails
        ]);
    }

    /**
     * Store a newly created billing details record.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'Account_No' => 'required|string|unique:Billing_Details,Account_No',
            'Full_Name' => 'nullable|string',
            'Contact_Number' => 'nullable|string',
            'Email_Address' => 'nullable|email',
            'Account_Balance' => 'nullable|numeric',
            // Add other validation rules as needed
        ]);

        if ($validator->fails()) {
            return response()->json([
                'status' => 'error',
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        $billingDetail = BillingDetails::create($request->all());

        return response()->json([
            'status' => 'success',
            'message' => 'Billing detail created successfully',
            'data' => $billingDetail
        ], 201);
    }

    /**
     * Display the specified billing detail.
     *
     * @param  string  $id
     * @return \Illuminate\Http\Response
     */
    public function show($id)
    {
        $billingDetail = BillingDetails::find($id);

        if (!$billingDetail) {
            return response()->json([
                'status' => 'error',
                'message' => 'Billing detail not found'
            ], 404);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Billing detail retrieved successfully',
            'data' => $billingDetail
        ]);
    }

    /**
     * Update the specified billing detail.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  string  $id
     * @return \Illuminate\Http\Response
     */
    public function update(Request $request, $id)
    {
        $billingDetail = BillingDetails::find($id);

        if (!$billingDetail) {
            return response()->json([
                'status' => 'error',
                'message' => 'Billing detail not found'
            ], 404);
        }

        $validator = Validator::make($request->all(), [
            'Full_Name' => 'nullable|string',
            'Contact_Number' => 'nullable|string',
            'Email_Address' => 'nullable|email',
            'Account_Balance' => 'nullable|numeric',
            // Add other validation rules as needed
        ]);

        if ($validator->fails()) {
            return response()->json([
                'status' => 'error',
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        $billingDetail->update($request->all());

        return response()->json([
            'status' => 'success',
            'message' => 'Billing detail updated successfully',
            'data' => $billingDetail
        ]);
    }

    /**
     * Remove the specified billing detail from storage.
     *
     * @param  string  $id
     * @return \Illuminate\Http\Response
     */
    public function destroy($id)
    {
        $billingDetail = BillingDetails::find($id);

        if (!$billingDetail) {
            return response()->json([
                'status' => 'error',
                'message' => 'Billing detail not found'
            ], 404);
        }

        $billingDetail->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Billing detail deleted successfully'
        ]);
    }
}

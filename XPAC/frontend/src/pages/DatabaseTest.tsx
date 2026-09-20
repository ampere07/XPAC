import React, { useState } from 'react';
import apiClient from '../config/api';

const DatabaseTest: React.FC = () => {
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runTest = async () => {
    setLoading(true);
    try {
      console.log('Testing database connection...');
      const response = await apiClient.get('/debug/organizations');
      console.log('Test response:', response.data);
      setTestResult(response.data);
    } catch (error: any) {
      console.error('Test failed:', error);
      setTestResult({
        success: false,
        error: error.message,
        details: error.response?.data
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="bg-gray-800 rounded-lg border border-gray-600 p-6 text-white">
        <h2 className="text-2xl font-semibold mb-4">Database Connection Test</h2>
        
        <button
          onClick={runTest}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Run Database Test'}
        </button>

        {testResult && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-2">Test Results:</h3>
            <pre className="bg-gray-900 p-4 rounded overflow-auto max-h-96">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseTest;

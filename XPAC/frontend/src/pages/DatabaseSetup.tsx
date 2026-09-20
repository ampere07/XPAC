import React, { useState, useEffect } from 'react';
import { setupService } from '../services/userService';

interface DatabaseStatus {
  tables: Record<string, boolean>;
  all_tables_exist: boolean;
  timestamp: string;
}

const DatabaseSetup: React.FC = () => {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await setupService.checkDatabaseStatus();
      if (response.success && response.data) {
        setStatus(response.data);
        if (!response.data.all_tables_exist) {
          setMessage('Some database tables are missing. Click "Initialize Database" to create them.');
        } else {
          setMessage('All database tables exist and are ready.');
        }
      } else {
        setMessage('Failed to check database status: ' + response.message);
      }
    } catch (error: any) {
      setMessage('Error checking database status: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const initializeDatabase = async () => {
    setInitializing(true);
    setMessage('');
    try {
      const response = await setupService.initializeDatabase();
      if (response.success) {
        setMessage('Database initialized successfully!');
        // Refresh status
        setTimeout(() => {
          checkStatus();
        }, 1000);
      } else {
        setMessage('Failed to initialize database: ' + response.message);
      }
    } catch (error: any) {
      setMessage('Error initializing database: ' + (error.response?.data?.message || error.message));
    } finally {
      setInitializing(false);
    }
  };

  const getTableStatusIcon = (exists: boolean) => {
    return exists ? (
      <span className="text-green-400">✓</span>
    ) : (
      <span className="text-red-400">✗</span>
    );
  };

  return (
    <div className="bg-gray-950 text-white">
      <div className="p-6">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-white mb-2">
            Database Setup & Status
          </h2>
          <p className="text-gray-400 text-sm">
            Monitor and initialize database tables
          </p>
        </div>

        <div className="mb-8">
          <div className="flex gap-4 mb-4">
            <button
              onClick={checkStatus}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Checking...' : 'Check Status'}
            </button>
            
            <button
              onClick={initializeDatabase}
              disabled={initializing || loading}
              className="px-6 py-3 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {initializing ? 'Initializing...' : 'Initialize Database'}
            </button>
          </div>

          {message && (
            <div className={`p-4 rounded border ${
              message.includes('Failed') || message.includes('Error') 
                ? 'bg-red-900 border-red-600 text-red-200'
                : message.includes('successfully') || message.includes('ready')
                ? 'bg-green-900 border-green-600 text-green-200'
                : 'bg-yellow-900 border-yellow-600 text-yellow-200'
            }`}>
              {message}
            </div>
          )}
        </div>

        {status && (
          <div className="bg-gray-900 rounded border border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-2">Table Status</h3>
              <p className="text-sm text-gray-400">
                Last checked: {new Date(status.timestamp).toLocaleString()}
              </p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Table Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-700">
                    <td className="px-4 py-3 text-sm text-white">organizations</td>
                    <td className="px-4 py-3 text-sm">
                      {getTableStatusIcon(status.tables.organizations)}
                      <span className="ml-2">
                        {status.tables.organizations ? 'Exists' : 'Missing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">Stores organization data</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="px-4 py-3 text-sm text-white">roles</td>
                    <td className="px-4 py-3 text-sm">
                      {getTableStatusIcon(status.tables.roles)}
                      <span className="ml-2">
                        {status.tables.roles ? 'Exists' : 'Missing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">Stores user roles</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="px-4 py-3 text-sm text-white">users</td>
                    <td className="px-4 py-3 text-sm">
                      {getTableStatusIcon(status.tables.users)}
                      <span className="ml-2">
                        {status.tables.users ? 'Exists' : 'Missing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">Stores user accounts</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="px-4 py-3 text-sm text-white">groups</td>
                    <td className="px-4 py-3 text-sm">
                      {getTableStatusIcon(status.tables.groups)}
                      <span className="ml-2">
                        {status.tables.groups ? 'Exists' : 'Missing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">Stores user groups</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="px-4 py-3 text-sm text-white">user_roles</td>
                    <td className="px-4 py-3 text-sm">
                      {getTableStatusIcon(status.tables.user_roles)}
                      <span className="ml-2">
                        {status.tables.user_roles ? 'Exists' : 'Missing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">Links users to roles</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm text-white">user_groups</td>
                    <td className="px-4 py-3 text-sm">
                      {getTableStatusIcon(status.tables.user_groups)}
                      <span className="ml-2">
                        {status.tables.user_groups ? 'Exists' : 'Missing'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">Links users to groups</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-300">
                  Overall Status:
                </span>
                <span className={`px-3 py-1 rounded text-sm font-medium ${
                  status.all_tables_exist
                    ? 'bg-green-900 text-green-300'
                    : 'bg-red-900 text-red-300'
                }`}>
                  {status.all_tables_exist ? 'All Tables Ready' : 'Tables Missing'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseSetup;

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { setupService } from '../services/userService';

interface DatabaseStatus {
  tables: Record<string, boolean>;
  all_tables_exist: boolean;
  timestamp: string;
}

const TABLE_ROWS: { key: string; description: string }[] = [
  { key: 'organizations', description: 'Stores organization data' },
  { key: 'roles', description: 'Stores user roles' },
  { key: 'users', description: 'Stores user accounts' },
  { key: 'groups', description: 'Stores user groups' },
  { key: 'user_roles', description: 'Links users to roles' },
  { key: 'user_groups', description: 'Links users to groups' },
];

const DatabaseSetup: React.FC = () => {
  const isDarkMode = false;
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [message, setMessage] = useState<string>('');

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

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
          setMessage('Some database tables are missing. Tap "Initialize Database" to create them.');
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

  const getMessageStyle = () => {
    if (message.includes('Failed') || message.includes('Error')) {
      return { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' };
    }
    if (message.includes('successfully') || message.includes('ready')) {
      return { bg: '#f0fdf4', border: '#86efac', text: '#166534' };
    }
    return { bg: '#fefce8', border: '#fde047', text: '#854d0e' };
  };

  const msgStyle = getMessageStyle();

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: isTablet ? 16 : 60,
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#ffffff',
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
          Database Setup & Status
        </Text>
        <Text style={{ fontSize: 13, color: '#6b7280' }}>
          Monitor and initialize database tables
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <TouchableOpacity
            onPress={checkStatus}
            disabled={loading}
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: loading ? '#93c5fd' : '#2563eb',
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
            }}
          >
            {loading && <ActivityIndicator size="small" color="#ffffff" />}
            <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>
              {loading ? 'Checking...' : 'Check Status'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={initializeDatabase}
            disabled={initializing || loading}
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: initializing || loading ? '#86efac' : '#16a34a',
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
            }}
          >
            {initializing && <ActivityIndicator size="small" color="#ffffff" />}
            <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>
              {initializing ? 'Initializing...' : 'Initialize Database'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Message banner */}
        {!!message && (
          <View
            style={{
              backgroundColor: msgStyle.bg,
              borderWidth: 1,
              borderColor: msgStyle.border,
              borderRadius: 8,
              padding: 14,
              marginBottom: 20,
            }}
          >
            <Text style={{ fontSize: 13, color: msgStyle.text, lineHeight: 20 }}>
              {message}
            </Text>
          </View>
        )}

        {/* Table status card */}
        {status && (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              overflow: 'hidden',
            }}
          >
            {/* Card header */}
            <View
              style={{
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: '#e5e7eb',
                backgroundColor: '#f8fafc',
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
                Table Status
              </Text>
              <Text style={{ fontSize: 12, color: '#6b7280' }}>
                Last checked: {new Date(status.timestamp).toLocaleString()}
              </Text>
            </View>

            {/* Column headers */}
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: '#f3f4f6',
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: '#e5e7eb',
              }}
            >
              <Text style={{ flex: 2, fontSize: 12, fontWeight: '600', color: '#374151' }}>
                Table Name
              </Text>
              <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: '#374151' }}>
                Status
              </Text>
              <Text style={{ flex: 2, fontSize: 12, fontWeight: '600', color: '#374151' }}>
                Description
              </Text>
            </View>

            {/* Rows */}
            {TABLE_ROWS.map((row, index) => {
              const exists = status.tables[row.key];
              return (
                <View
                  key={row.key}
                  style={{
                    flexDirection: 'row',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderBottomWidth: index < TABLE_ROWS.length - 1 ? 1 : 0,
                    borderBottomColor: '#f1f5f9',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ flex: 2, fontSize: 13, color: '#111827', fontWeight: '500' }}>
                    {row.key}
                  </Text>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: exists ? '#dcfce7' : '#fee2e2',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 11, color: exists ? '#16a34a' : '#dc2626', fontWeight: '700' }}>
                        {exists ? '✓' : '✗'}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, color: exists ? '#16a34a' : '#dc2626', fontWeight: '500' }}>
                      {exists ? 'Exists' : 'Missing'}
                    </Text>
                  </View>
                  <Text style={{ flex: 2, fontSize: 12, color: '#6b7280' }}>
                    {row.description}
                  </Text>
                </View>
              );
            })}

            {/* Overall status footer */}
            <View
              style={{
                padding: 14,
                backgroundColor: '#f8fafc',
                borderTopWidth: 1,
                borderTopColor: '#e5e7eb',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>
                Overall Status:
              </Text>
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: status.all_tables_exist ? '#dcfce7' : '#fee2e2',
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: status.all_tables_exist ? '#16a34a' : '#dc2626',
                  }}
                >
                  {status.all_tables_exist ? 'All Tables Ready' : 'Tables Missing'}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default DatabaseSetup;

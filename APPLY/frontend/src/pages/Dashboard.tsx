import React, { useState, useEffect, useRef } from 'react';
import Form, { FormRef } from './Form';
import MultiStepForm, { MultiStepFormRef } from '../components/MultiStepForm';
import LoadingScreen from '../components/Loading/LoadingScreen';

interface User {
  id: number;
  username: string;
  email?: string;
  name?: string;
  role?: string;
}

interface Application {
  id: number;
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  region: string;
  city: string;
  plan: string;
  status: string;
  created_at: string;
}

interface DashboardStats {
  total_applications: number;
  pending_applications: number;
  approved_applications: number;
  rejected_applications: number;
}

interface FormUISettings {
  brand_name?: string;
}

const Dashboard: React.FC = () => {
  const apiBaseUrl = process.env.REACT_APP_API_URL || "https://backend1.atssfiber.ph";
  const formRef = useRef<FormRef>(null);
  const multiStepFormRef = useRef<MultiStepFormRef>(null);
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    total_applications: 0,
    pending_applications: 0,
    approved_applications: 0,
    rejected_applications: 0
  });
  const [recentApplications, setRecentApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formLayout, setFormLayout] = useState<'original' | 'multistep'>('original');
  const [isEditMode, setIsEditMode] = useState(false);
  const [brandName, setBrandName] = useState<string>('Ampere CBMS');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user_data');
    if (userData) {
      setUser(JSON.parse(userData));
    }

    const savedLayout = localStorage.getItem('form_layout') as 'original' | 'multistep';
    if (savedLayout) {
      setFormLayout(savedLayout);
    }

    fetchDashboardData();
    fetchBrandName();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('auth_token');

      const statsResponse = await fetch(`${apiBaseUrl}/api/dashboard/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData);
      }

      const applicationsResponse = await fetch(`${apiBaseUrl}/api/dashboard/recent-applications`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (applicationsResponse.ok) {
        const applicationsData = await applicationsResponse.json();
        setRecentApplications(applicationsData.data || []);
      }

    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBrandName = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/form-ui/settings`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data && result.data.brand_name) {
          setBrandName(result.data.brand_name);
        }
      }
    } catch (error) {
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    window.location.href = '/login';
  };

  const confirmLogout = () => {
    setShowLogoutModal(false);
    handleLogout();
  };

  const handleLayoutChange = (layout: 'original' | 'multistep') => {
    setFormLayout(layout);
    localStorage.setItem('form_layout', layout);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f3f4f6' }}>
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">{brandName}</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                Welcome, <span className="font-medium">{user?.name || user?.username}</span>
              </span>
              <button
                onClick={() => setShowLogoutModal(true)}
                className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-red-500"
                title="Logout"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main>
        {formLayout === 'original' ? (
          <Form
            ref={formRef}
            showEditButton={true}
            onLayoutChange={handleLayoutChange}
            currentLayout={formLayout}
            isEditMode={isEditMode}
            onEditModeChange={setIsEditMode}
            requireFields={false}
          />
        ) : (
          <MultiStepForm
            ref={multiStepFormRef}
            showEditButton={true}
            onLayoutChange={handleLayoutChange}
            currentLayout={formLayout}
            isEditMode={isEditMode}
            onEditModeChange={setIsEditMode}
            requireFields={false}
          />
        )}
      </main>

      {showLogoutModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-red-100 rounded-full p-3">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-semibold text-center text-gray-900 mb-2">Confirm Logout</h3>
            <p className="text-center text-gray-600 mb-6">Are you sure you want to logout?</p>
            <div className="flex justify-center space-x-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="px-6 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

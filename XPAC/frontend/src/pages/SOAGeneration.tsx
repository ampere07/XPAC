import React, { useState, useEffect } from 'react';
import { Plus, FileText, Calendar, DollarSign, User, Mail, Phone, MapPin, Download, Eye, Trash2 } from 'lucide-react';

interface SOARecord {
  id: string;
  accountNo: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  billingPeriod: string;
  totalAmount: number;
  status: 'Generated' | 'Sent' | 'Pending';
  generatedDate: string;
}

const SOAGeneration: React.FC = () => {
  const [soaRecords, setSOARecords] = useState<SOARecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSOARecords();
  }, []);

  const fetchSOARecords = async () => {
    setIsLoading(true);
    try {
      // TODO: Replace with actual API call
      // const response = await getSOARecords();
      // setSOARecords(response);
      setSOARecords([]);
    } catch (error) {
      console.error('Error fetching SOA records:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSOA = () => {
    // TODO: Implement add SOA modal or navigation
  };

  const handleViewSOA = (id: string) => {
    // TODO: Implement view SOA details
  };

  const handleDownloadSOA = (id: string) => {
    // TODO: Implement download SOA
  };

  const handleDeleteSOA = (id: string) => {
    // TODO: Implement delete SOA with confirmation
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Generated':
        return 'bg-blue-500 bg-opacity-20 text-blue-400';
      case 'Sent':
        return 'bg-green-500 bg-opacity-20 text-green-400';
      case 'Pending':
        return 'bg-yellow-500 bg-opacity-20 text-yellow-400';
      default:
        return 'bg-gray-500 bg-opacity-20 text-gray-400';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 px-6 py-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-semibold">SOA Generation</h1>
          </div>
          {soaRecords.length > 0 && (
            <button
              onClick={handleAddSOA}
              className="flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded transition-colors"
            >
              <Plus size={18} />
              <span>Generate SOA</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`p-6 ${soaRecords.length === 0 ? 'flex items-center justify-center' : 'overflow-y-auto'}`} style={{ height: 'calc(100vh - 80px)' }}>
        {soaRecords.length === 0 ? (
          // Empty State
          <div className="text-center">
              <div className="mb-6">
                <FileText className="h-24 w-24 text-gray-600 mx-auto" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-300 mb-2">No SOA Records</h2>
              <p className="text-gray-500 mb-8">Get started by generating your first Statement of Account</p>
              <button
                onClick={handleAddSOA}
                className="flex items-center space-x-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 rounded transition-colors mx-auto"
              >
                <Plus size={20} />
                <span>Generate SOA</span>
              </button>
            </div>
        ) : (
          // Card Grid View
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {soaRecords.map((record) => (
              <div
                key={record.id}
                className="bg-gray-800 rounded-lg border border-gray-700 hover:border-orange-500 transition-colors overflow-hidden"
              >
                {/* Card Header */}
                <div className="bg-gray-750 px-4 py-3 border-b border-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-400">Account No.</span>
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(record.status)}`}>
                      {record.status}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-white mt-1">{record.accountNo}</div>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-3">
                  <div className="flex items-start space-x-2">
                    <User className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-400">Customer</div>
                      <div className="text-sm font-medium text-white truncate">{record.customerName}</div>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <Mail className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-400">Email</div>
                      <div className="text-sm font-medium text-white truncate">{record.email}</div>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <Phone className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-400">Phone</div>
                      <div className="text-sm font-medium text-white truncate">{record.phone}</div>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <MapPin className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-400">Address</div>
                      <div className="text-sm font-medium text-white truncate">{record.address}</div>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <Calendar className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-400">Billing Period</div>
                      <div className="text-sm font-medium text-white">{record.billingPeriod}</div>
                    </div>
                  </div>

                  <div className="flex items-start space-x-2">
                    <DollarSign className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-400">Total Amount</div>
                      <div className="text-lg font-semibold text-orange-500">₱{record.totalAmount.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
                    Generated: {record.generatedDate}
                  </div>
                </div>

                {/* Card Footer */}
                <div className="bg-gray-750 px-4 py-3 border-t border-gray-700 flex items-center justify-between">
                  <button
                    onClick={() => handleViewSOA(record.id)}
                    className="p-2 text-blue-400 hover:text-blue-300 hover:bg-gray-700 rounded transition-colors"
                    title="View"
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    onClick={() => handleDownloadSOA(record.id)}
                    className="p-2 text-green-400 hover:text-green-300 hover:bg-gray-700 rounded transition-colors"
                    title="Download"
                  >
                    <Download size={18} />
                  </button>
                  <button
                    onClick={() => handleDeleteSOA(record.id)}
                    className="p-2 text-red-400 hover:text-red-300 hover:bg-gray-700 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SOAGeneration;

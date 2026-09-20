import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CheckCircle, XCircle, X } from 'lucide-react-native';

interface PaymentResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  success: boolean;
  referenceNo: string;
  isDarkMode?: boolean;
}

const PaymentResultModal: React.FC<PaymentResultModalProps> = ({
  isOpen,
  onClose,
  success,
  referenceNo,
  isDarkMode = true
}) => {
  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={isOpen}
      onRequestClose={onClose}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}>
        <View style={{
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderRadius: 12,
          shadowColor: "#000",
          shadowOffset: {
            width: 0,
            height: 2,
          },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
          maxWidth: 400,
          width: '100%',
          padding: 24,
          position: 'relative'
        }}>
          {/* Close button */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 10
            }}
          >
            <X
              size={20}
              color={isDarkMode ? '#9ca3af' : '#6b7280'}
            />
          </TouchableOpacity>

          {/* Icon and Title */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            {success ? (
              <View style={{ marginBottom: 16 }}>
                <CheckCircle size={64} color="#22c55e" />
              </View>
            ) : (
              <View style={{ marginBottom: 16 }}>
                <XCircle size={64} color="#ef4444" />
              </View>
            )}

            <Text style={{
              fontSize: 24,
              fontWeight: '700',
              marginBottom: 8,
              color: isDarkMode ? '#f3f4f6' : '#111827',
              textAlign: 'center'
            }}>
              {success ? 'Payment Successful!' : 'Payment Failed'}
            </Text>

            <Text style={{
              fontSize: 14,
              color: isDarkMode ? '#9ca3af' : '#4b5563',
              textAlign: 'center'
            }}>
              {success
                ? 'Your payment has been received and is being processed.'
                : 'We were unable to process your payment. Please try again.'
              }
            </Text>
          </View>

          {/* Reference Number */}
          <View style={{
            backgroundColor: isDarkMode ? '#374151' : '#f3f4f6',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24
          }}>
            <Text style={{
              fontSize: 12,
              color: isDarkMode ? '#9ca3af' : '#4b5563',
              marginBottom: 4
            }}>
              Reference Number
            </Text>
            <Text style={{
              // monospace font family support varies by platform, but 'monospace' is a good web safe fallback and works on some android
              // For better cross platform monospace: Platform.OS === 'ios' ? 'Courier' : 'monospace' 
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: '500',
              color: isDarkMode ? '#f3f4f6' : '#111827'
            }}>
              {referenceNo}
            </Text>
          </View>

          {/* Message */}
          <View style={{ marginBottom: 24 }}>
            {success ? (
              <View>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#d1d5db' : '#374151',
                  marginBottom: 8
                }}>
                  ✓ Payment confirmation sent
                </Text>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#d1d5db' : '#374151',
                  marginBottom: 8
                }}>
                  ✓ Account balance will be updated shortly
                </Text>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}>
                  ✓ You can check your transaction history for details
                </Text>
              </View>
            ) : (
              <Text style={{
                fontSize: 14,
                color: isDarkMode ? '#d1d5db' : '#374151',
                marginBottom: 8
              }}>
                If you encountered any issues, please contact support or try again.
              </Text>
            )}
          </View>

          {/* Close Button */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              width: '100%',
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 8,
              alignItems: 'center',
              backgroundColor: success ? '#16a34a' : '#dc2626'
            }}
          >
            <Text style={{
              color: '#ffffff',
              fontSize: 16,
              fontWeight: '500'
            }}>
              Close
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default PaymentResultModal;

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Dimensions } from 'react-native';
import { TrendingUp, Users, Globe, Wifi, Ticket, Receipt } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Defs, LinearGradient, Stop, Polyline, Circle } from 'react-native-svg';

const DashboardContent: React.FC = () => {
  const isDarkMode = false; // Forced light mode as per user request



  const statsCards = [
    {
      title: "TODAY'S SALES",
      value: "₱0",
      subtitle: "0%",
      icon: TrendingUp
    },
    {
      title: "SUBSCRIPTIONS",
      value: "0",
      subtitle: "",
      icon: Users
    },
    {
      title: "IP ADDRESSES",
      value: "0",
      subtitle: "0 used IPs",
      icon: Globe
    },
    {
      title: "HOTSPOT USERS",
      value: "0",
      subtitle: "0 online",
      icon: Wifi
    },
    {
      title: "TOTAL TICKETS",
      value: "0",
      subtitle: "0 Open",
      icon: Ticket
    },
    {
      title: "INVOICES",
      value: "0",
      subtitle: "0 Unpaid",
      icon: Receipt
    }
  ];

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const isLargeTablet = width >= 1024;
  const isDesktop = width >= 1280;

  return (
    <ScrollView style={{
      minHeight: '100%',
      backgroundColor: isDarkMode ? '#030712' : '#f9fafb'
    }}>
      <View style={{ padding: 24 }}>
        <View style={{ marginBottom: 32 }}>
          <Text style={{
            fontSize: 24,
            fontWeight: '600',
            marginBottom: 8,
            color: isDarkMode ? '#ffffff' : '#111827'
          }}>
            Dashboard Overview
          </Text>
          <Text style={{
            fontSize: 14,
            color: isDarkMode ? '#9ca3af' : '#4b5563'
          }}>
            Your business management system overview and key metrics
          </Text>
        </View>

        {/* Statistics Cards */}
        <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 32
        }}>
          {statsCards.map((card, index) => {
            const IconComponent = card.icon;
            const cardWidth = isDesktop ? `${100 / 6 - 2.67}%` : isLargeTablet ? `${100 / 3 - 2.67}%` : isTablet ? `${100 / 2 - 2}%` : '100%';
            return (
              <View key={index} style={{
                width: cardWidth,
                padding: 16,
                borderRadius: 4,
                borderWidth: 1,
                backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
                borderColor: isDarkMode ? '#374151' : '#d1d5db'
              }}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8
                }}>
                  <IconComponent
                    size={20}
                    color={isDarkMode ? '#9ca3af' : '#4b5563'}
                  />
                </View>
                <Text style={{
                  fontSize: 12,
                  fontWeight: '500',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>
                  {card.title}
                </Text>
                <Text style={{
                  fontSize: 24,
                  fontWeight: 'bold',
                  marginBottom: 4,
                  color: isDarkMode ? '#ffffff' : '#111827'
                }}>
                  {card.value}
                </Text>
                {card.subtitle && (
                  <Text style={{
                    fontSize: 14,
                    color: isDarkMode ? '#9ca3af' : '#4b5563'
                  }}>
                    {card.subtitle}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* System Statistics */}
        <View style={{ marginBottom: 32 }}>
          <Text style={{
            fontSize: 18,
            fontWeight: '600',
            marginBottom: 16,
            color: isDarkMode ? '#ffffff' : '#111827'
          }}>
            SYSTEM STATISTICS
          </Text>
          <View style={{
            flexDirection: isTablet ? 'row' : 'column',
            gap: 24
          }}>
            <View style={{ flex: 1 }}>
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8
              }}>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}>Memory</Text>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#ffffff' : '#111827'
                }}>0%</Text>
              </View>
              <View style={{
                width: '100%',
                borderRadius: 9999,
                height: 12,
                backgroundColor: isDarkMode ? '#374151' : '#d1d5db'
              }}>
                <View style={{
                  backgroundColor: '#3b82f6',
                  height: 12,
                  borderRadius: 9999,
                  width: '0%'
                }} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8
              }}>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}>Hard Disk Space</Text>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#ffffff' : '#111827'
                }}>0%</Text>
              </View>
              <View style={{
                width: '100%',
                borderRadius: 9999,
                height: 12,
                backgroundColor: isDarkMode ? '#374151' : '#d1d5db'
              }}>
                <View style={{
                  backgroundColor: '#3b82f6',
                  height: 12,
                  borderRadius: 9999,
                  width: '0%'
                }} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 8
              }}>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#d1d5db' : '#374151'
                }}>CPU</Text>
                <Text style={{
                  fontSize: 14,
                  color: isDarkMode ? '#ffffff' : '#111827'
                }}>0%</Text>
              </View>
              <View style={{
                width: '100%',
                borderRadius: 9999,
                height: 12,
                backgroundColor: isDarkMode ? '#374151' : '#d1d5db'
              }}>
                <View style={{
                  backgroundColor: '#3b82f6',
                  height: 12,
                  borderRadius: 9999,
                  width: '0%'
                }} />
              </View>
            </View>
          </View>
        </View>

        {/* Charts Section */}
        <View style={{
          flexDirection: isLargeTablet ? 'row' : 'column',
          gap: 24,
          marginBottom: 32
        }}>
          <View style={{
            flex: 1,
            padding: 24,
            borderRadius: 4,
            borderWidth: 1,
            backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
            borderColor: isDarkMode ? '#374151' : '#d1d5db'
          }}>
            <Text style={{
              fontSize: 18,
              fontWeight: '600',
              marginBottom: 16,
              color: isDarkMode ? '#ffffff' : '#111827'
            }}>
              INVOICE SUMMARY
            </Text>
            <View style={{
              height: 192,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <View style={{
                position: 'relative',
                width: '100%',
                height: 128
              }}>
                <Svg width="100%" height="100%" viewBox="0 0 400 128">
                  <Defs>
                    <LinearGradient id="invoiceGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <Stop offset="0%" stopColor="#06b6d4" />
                      <Stop offset="100%" stopColor="#3b82f6" />
                    </LinearGradient>
                  </Defs>
                  <Polyline
                    fill="none"
                    stroke="url(#invoiceGradient)"
                    strokeWidth="2"
                    points="0,64 50,64 100,64 150,64 200,64 250,64 300,64 350,64 400,64"
                  />
                  {[0, 50, 100, 150, 200, 250, 300, 350, 400].map((x, i) => (
                    <Circle key={i} cx={x} cy={64} r="3" fill="#06b6d4" />
                  ))}
                </Svg>
              </View>
            </View>
            <View style={{ marginTop: 16 }}>
              <Text style={{
                fontSize: 14,
                color: isDarkMode ? '#9ca3af' : '#4b5563'
              }}>2025-09-17</Text>
              <Text style={{
                fontSize: 14,
                color: '#4ade80'
              }}>Grand Total: 0</Text>
            </View>
          </View>

          <View style={{
            flex: 1,
            padding: 24,
            borderRadius: 4,
            borderWidth: 1,
            backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
            borderColor: isDarkMode ? '#374151' : '#d1d5db'
          }}>
            <Text style={{
              fontSize: 18,
              fontWeight: '600',
              marginBottom: 16,
              color: isDarkMode ? '#ffffff' : '#111827'
            }}>
              TRANSACTION SUMMARY
            </Text>
            <View style={{
              height: 192,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <View style={{
                position: 'relative',
                width: '100%',
                height: 128
              }}>
                <Svg width="100%" height="100%" viewBox="0 0 400 128">
                  <Defs>
                    <LinearGradient id="transactionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <Stop offset="0%" stopColor="#10b981" />
                      <Stop offset="100%" stopColor="#059669" />
                    </LinearGradient>
                  </Defs>
                  <Polyline
                    fill="none"
                    stroke="url(#transactionGradient)"
                    strokeWidth="2"
                    points="0,64 50,64 100,64 150,64 200,64 250,64 300,64 350,64 400,64"
                  />
                  {[0, 50, 100, 150, 200, 250, 300, 350, 400].map((x, i) => (
                    <Circle key={i} cx={x} cy={64} r="3" fill="#10b981" />
                  ))}
                </Svg>
              </View>
            </View>
            <View style={{ marginTop: 16 }}>
              <Text style={{
                fontSize: 14,
                color: isDarkMode ? '#9ca3af' : '#4b5563'
              }}>2025-09-17</Text>
              <Text style={{
                fontSize: 14,
                color: '#4ade80'
              }}>Grand Total: 0</Text>
            </View>
          </View>
        </View>

        {/* Recent Tickets */}
        <View style={{
          borderRadius: 4,
          borderWidth: 1,
          backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
          borderColor: isDarkMode ? '#374151' : '#d1d5db'
        }}>
          <View style={{
            padding: 24,
            borderBottomWidth: 1,
            borderColor: isDarkMode ? '#374151' : '#d1d5db'
          }}>
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <Text style={{
                fontSize: 18,
                fontWeight: '600',
                color: isDarkMode ? '#ffffff' : '#111827'
              }}>
                RECENT TICKETS
              </Text>
            </View>
          </View>
          <ScrollView horizontal style={{ overflow: 'scroll' }}>
            <View style={{ minWidth: '100%' }}>
              {/* Table Header */}
              <View style={{
                flexDirection: 'row',
                borderBottomWidth: 1,
                backgroundColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                borderColor: isDarkMode ? '#374151' : '#d1d5db'
              }}>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>SUBJECT</Text>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>CUSTOMER</Text>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>CONTACT NUMBER</Text>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>STATUS</Text>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>LAST UPDATED</Text>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>PRIORITY</Text>
                <Text style={{
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                  flex: 1,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: '500',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: isDarkMode ? '#9ca3af' : '#4b5563'
                }}>CATEGORY</Text>
              </View>
              {/* Table Body */}
              <View>
                <View style={{
                  paddingHorizontal: 24,
                  paddingVertical: 48,
                  alignItems: 'center'
                }}>
                  <Text style={{
                    color: isDarkMode ? '#9ca3af' : '#4b5563'
                  }}>
                    You don't have any open tickets assigned to you.
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </ScrollView>
  );
};

export default DashboardContent;

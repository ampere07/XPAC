import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Alert, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Plus, Trash2, Edit, Users, Banknote } from 'lucide-react-native';
import { Agent } from '../types/api';
import { StandardPage, RecordCard } from '../components/common';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AgentModal from '../modals/AgentModal';
import CommissionPayoutModal from '../modals/CommissionPayoutModal';
import { useAgentStore } from '../store/agentStore';
import { agentService } from '../services/agentService';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

const TeamAgent: React.FC = () => {
  // FORCED LIGHT MODE
  const isDarkMode = false;

  const [searchQuery, setSearchQuery] = useState('');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const {
    agents,
    isLoading,
    error,
    fetchAgents,
    refreshAgents,
    addAgent,
    updateAgent,
    removeAgent,
  } = useAgentStore();

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAgent, setPayoutAgent] = useState<Agent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [userOrgId, setUserOrgId] = useState<number | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const palette = await settingsColorPaletteService.getActive();
        setColorPalette(palette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
      try {
        const raw = await AsyncStorage.getItem('authData');
        const authData = raw ? JSON.parse(raw) : {};
        const orgId =
          authData.organization_id ||
          authData.user?.organization_id ||
          authData.organization?.id ||
          authData.user?.organization?.id ||
          null;
        setUserOrgId(orgId);
      } catch {
        setUserOrgId(null);
      }
    };
    init();
  }, []);

  useEffect(() => {
    fetchAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto silent-refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(() => {
      refreshAgents().catch((e) => console.error('Idle refresh failed:', e));
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshAgents]);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAgents();
    setRefreshing(false);
  };

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      // Organization filter — mirrors web logic exactly
      if (userOrgId) {
        if (agent.organization_id !== userOrgId) return false;
      } else {
        if (agent.organization_id) return false;
      }

      const teamName = (agent.team_name || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();
      return teamName.includes(query);
    });
  }, [agents, searchQuery, userOrgId]);

  const handleSaveAgent = (savedAgent: Agent) => {
    const exists = agents.find((a) => a.id === savedAgent.id);
    if (exists) {
      updateAgent(savedAgent);
    } else {
      addAgent(savedAgent);
    }
  };

  const handleDeleteAgent = (id: number) => {
    Alert.alert('Delete Agent', 'Are you sure you want to delete this agent?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await agentService.deleteAgent(id);
            if (res.success) {
              removeAgent(id);
            } else {
              Alert.alert('Error', res.message || 'Failed to delete agent');
            }
          } catch (err: any) {
            Alert.alert('Error', err.message || 'An error occurred');
          }
        },
      },
    ]);
  };

  const rowActions = (agent: Agent) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <TouchableOpacity
        onPress={() => { setPayoutAgent(agent); setShowPayoutModal(true); }}
        style={{ padding: 8, borderRadius: 8, backgroundColor: '#f0fdf4' }}
      >
        <Banknote size={16} color="#16a34a" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => { setSelectedAgent(agent); setShowModal(true); }}
        style={{ padding: 8, borderRadius: 8, backgroundColor: '#eff6ff' }}
      >
        <Edit size={16} color="#2563eb" />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleDeleteAgent(agent.id)}
        style={{ padding: 8, borderRadius: 8, backgroundColor: '#fef2f2' }}
      >
        <Trash2 size={16} color="#dc2626" />
      </TouchableOpacity>
    </View>
  );

  return (
    <StandardPage<Agent>
      data={filteredAgents}
      keyExtractor={(item) => String(item.id)}
      renderItem={(agent) => (
        <RecordCard
          title={agent.team_name}
          normalizeTitle={false}
          subtitle={[
            agent.created_at ? new Date(agent.created_at).toLocaleDateString() : 'N/A',
            agent.created_by || null,
          ].filter(Boolean).join('  •  ')}
          showStatus={false}
          leading={
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#f3f4f6',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Users size={18} color="#6b7280" />
            </View>
          }
          right={rowActions(agent)}
        />
      )}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search team name..."
      onRefresh={() => refreshAgents()}
      isRefreshing={isLoading}
      onPullRefresh={handleRefresh}
      pullRefreshing={refreshing}
      isLoading={isLoading && agents.length === 0}
      loadingText="Loading agents..."
      error={error}
      onRetry={() => refreshAgents()}
      emptyText="No agents found"
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      itemsPerPage={itemsPerPage}
      onItemsPerPageChange={(n) => { setItemsPerPage(n); setCurrentPage(1); }}
      colorPalette={colorPalette}
      isDarkMode={isDarkMode}
      toolbarActions={
        <TouchableOpacity
          onPress={() => { setSelectedAgent(null); setShowModal(true); }}
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: primaryColor,
          }}
        >
          <Plus size={20} color="#ffffff" />
        </TouchableOpacity>
      }
    >
      <AgentModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveAgent}
        agent={selectedAgent}
      />

      {payoutAgent && (
        <CommissionPayoutModal
          isOpen={showPayoutModal}
          onClose={() => { setShowPayoutModal(false); setPayoutAgent(null); }}
          onSuccess={() => {
            Alert.alert('Success', 'Commission payout recorded successfully!');
          }}
          agentId={payoutAgent.id}
          agentName={payoutAgent.team_name}
        />
      )}
    </StandardPage>
  );
};

export default TeamAgent;

import React, { useState, useEffect } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { X, Check } from 'lucide-react-native';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';
import { technicianService, Technician } from '../services/technicianService';

interface StartTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (technicians: string[]) => void;
  loading?: boolean;
  colorPalette?: any;
}

const StartTimerModal: React.FC<StartTimerModalProps> = ({ isOpen, onClose, onConfirm, loading, colorPalette }) => {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechs, setSelectedTechs] = useState<string[]>(['', '', '']);
  const [searchValues, setSearchValues] = useState<string[]>(['', '', '']);
  const [isPickerOpen, setIsPickerOpen] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    if (isOpen) {
      const fetchTechs = async () => {
        setIsFetching(true);
        try {
          const response = await technicianService.getAllTechnicians();
          if (response.success && response.data) {
            setTechnicians(response.data);
          }
        } catch (error) {
          console.error('Error fetching technicians:', error);
        } finally {
          setIsFetching(false);
        }
      };
      fetchTechs();
      setSelectedTechs(['', '', '']);
      setSearchValues(['', '', '']);
    }
  }, [isOpen]);

  const handleSelect = (index: number, techValue: string) => {
    const newSelected = [...selectedTechs];
    newSelected[index] = techValue;
    setSelectedTechs(newSelected);
    setIsPickerOpen(null);
  };

  const handleConfirm = () => {
    onConfirm(selectedTechs);
  };

  const baseTechs = technicians.map(t => ({
    label: `${t.first_name} ${t.last_name}`,
    value: `${t.first_name} ${t.last_name}`,
    id: t.id.toString()
  }));

  const getPickerData = (index: number) => {
    const otherSelected = selectedTechs.filter((_, i) => i !== index && _ !== '' && _ !== 'None');
    const availableTechs = baseTechs.filter(t => !otherSelected.includes(t.value));

    if (index === 0) return availableTechs;
    return [{ label: 'None', value: 'None', id: 'none' }, ...availableTechs];
  };

  const filteredData = (index: number) => {
    const search = searchValues[index].toLowerCase();
    return getPickerData(index).filter(t => t.label.toLowerCase().includes(search));
  };

  const isFormValid = selectedTechs[0] !== '' && selectedTechs[1] !== '' && selectedTechs[2] !== '';

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Technicians</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={24} color="#4b5563" />
            </Pressable>
          </View>

          <ScrollView style={styles.body}>
            {isFetching ? (
              <ActivityIndicator size="large" color={primaryColor} style={{ marginVertical: 20 }} />
            ) : (
              <>
                <SearchablePickerTrigger
                  label="Technician 1"
                  value={selectedTechs[0]}
                  onPress={() => setIsPickerOpen(0)}
                  placeholder="Select First Technician"
                  required={true}
                />
                <SearchablePickerTrigger
                  label="Technician 2"
                  value={selectedTechs[1]}
                  onPress={() => setIsPickerOpen(1)}
                  placeholder="Select Second Technician"
                  required={true}
                />
                <SearchablePickerTrigger
                  label="Technician 3"
                  value={selectedTechs[2]}
                  onPress={() => setIsPickerOpen(2)}
                  placeholder="Select Third Technician"
                  required={true}
                />
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={[styles.btn, styles.cancelBtn]}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={[styles.btn, styles.confirmBtn, { backgroundColor: isFormValid ? primaryColor : '#9ca3af' }]}
              disabled={loading || !isFormValid}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>Start Timer</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      {[0, 1, 2].map(index => (
        <SearchablePicker
          key={index}
          isOpen={isPickerOpen === index}
          onClose={() => setIsPickerOpen(null)}
          title={`Select Technician ${index + 1}`}
          data={filteredData(index)}
          onSelect={(item) => handleSelect(index, item.value)}
          keyExtractor={(item) => item.id}
          searchValue={searchValues[index]}
          onSearchChange={(text) => {
            const newSearch = [...searchValues];
            newSearch[index] = text;
            setSearchValues(newSearch);
          }}
          itemTextKey="label"
          itemValueKey="value"
          selectedItemValue={selectedTechs[index]}
          activeColor={primaryColor}
        />
      ))}
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 16,
    maxHeight: 400,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 12,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#f3f4f6',
  },
  cancelBtnText: {
    color: '#374151',
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: '#7c3aed',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default StartTimerModal;

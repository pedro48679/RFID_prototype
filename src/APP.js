import React, { useState, useRef, useEffect } from 'react';
import {
  Text,
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  StatusBar,
  Modal,
  LayoutAnimation,
  UIManager,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CONFIG_KEY = '@rfid_config';

const saveConfigToStorage = async (config) => {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save config", e);
  }
};

const loadConfigFromStorage = async () => {
  try {
    const jsonValue = await AsyncStorage.getItem(CONFIG_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : { ip: '192.168.1.10', port: '5000' };
  } catch (e) {
    console.error("Failed to load config", e);
    return { ip: '192.168.1.10', port: '5000' };
  }
};

// COMPONENTE 1: Opções
const SettingsScreen = ({ initialConfig, onSave, onCancel }) => {
  const [ip, setIp] = useState(initialConfig.ip);
  const [port, setPort] = useState(initialConfig.port);

  const handleSave = async () => {
    if (!ip || !port) {
      Alert.alert('Error', 'Please fill in both fields');
      return;
    }
    const newConfig = { ip, port };
    await saveConfigToStorage(newConfig);

    Alert.alert('Success', 'Configuration saved', [
      { text: 'OK', onPress: () => onSave(newConfig) }
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1E1E1E" />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.label}>Raspberry Pi IP Address:</Text>
        <TextInput
          style={styles.input}
          value={ip}
          onChangeText={setIp}
          placeholder="192.168.1.10"
          placeholderTextColor="#666"
          keyboardType="numeric"
        />

        <Text style={styles.label}>Port:</Text>
        <TextInput
          style={styles.input}
          value={port}
          onChangeText={setPort}
          placeholder="5000"
          placeholderTextColor="#666"
          keyboardType="numeric"
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>SAVE CONFIGURATION</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// COMPONENTE 2: Dashboard
const DashboardScreen = ({ config, onOpenSettings }) => {
  const API_URL = `http://${config.ip}:${config.port}`;

  const [logs, setLogs] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [tables, setTables] = useState({ accepted: [], blocked: [] });

  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [zoomedTable, setZoomedTable] = useState(null);
  const [collapsed, setCollapsed] = useState({ accepted: false, blocked: false });

  const scrollViewRef = useRef(null);

  // Fetch com Timeout
  const fetchWithTimeout = async (resource, options = {}) => {
    const { timeout = 5000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(resource, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  };

  // Fetch data
  const fetchLogs = async () => {
    try {
      const response = await fetchWithTimeout(`${API_URL}/get_log`, { timeout: 3000 });
      const rawText = await response.text();

      const lines = rawText
        .replace(/\\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          return trimmed !== '' && trimmed !== '}';
        })
        .slice(-50);

      const formattedLogs = lines.map((line, index) => {
        let type = 'normal';
        if (line.includes('BLOCKED') || line.includes('Access Denied')) type = 'error';
        if (line.includes('PERMITTED') || line.includes('Welcome')) type = 'success';
        if (line.includes('OVERRIDE') || line.includes('Commanded')) type = 'warning';
        return { id: index, text: line, type };
      });
      setLogs(formattedLogs);

      const today = new Date().toISOString().split('T')[0];
      const parsedOverrides = lines
        .filter(line => line.includes('MANUAL OVERRIDE'))
        .map(line => {
          const timeMatch = line.match(/(\d{2}:\d{2}:\d{2})/);
          const time = timeMatch ? timeMatch[0] : '00:00:00';
          return { timestamp: `${today} ${time}`, ID: 'OVERRIDE' };
        });
      setOverrides(parsedOverrides);
      setIsConnected(true);
    } catch (error) {
      setIsConnected(false);
    }
  };

  const fetchTables = async () => {
    try {
      const response = await fetchWithTimeout(`${API_URL}/get_table_data`, { timeout: 3000 });
      const data = await response.json();
      setTables({
        accepted: (data.accepted || []),
        blocked: (data.blocked || [])
      });
      setLoading(false);
      setIsConnected(true);
    } catch (error) {
      setIsConnected(false);
      setLoading(false);
    }
  };

  // Override
  const triggerForceOpen = async () => {
    try {
      const response = await fetchWithTimeout(`${API_URL}/force_open`, {
        method: 'POST',
        timeout: 5000
      });
      const result = await response.json();
      if (result.status === 'success') {
        Alert.alert("Override Activated", result.message);
        fetchLogs();
      } else {
        Alert.alert("Notice", result.message);
      }
    } catch (error) {
      Alert.alert("Connection Error", "Could not reach Raspberry Pi.");
    }
  };

  const testConnection = async () => {
    try {
      const start = Date.now();
      await fetchWithTimeout(`${API_URL}/get_log`, { timeout: 5000 });
      const duration = Date.now() - start;
      setIsConnected(true);
      fetchLogs();
      fetchTables();
      Alert.alert("Success", `Connected in ${duration}ms`);
    } catch (error) {
      setIsConnected(false);
      Alert.alert("Connection Failed", `Could not connect to ${API_URL}`);
    }
  };

  // Atualiza o IP
  useEffect(() => {
    // Limpa as tabelas e o console log de dados anteriormente existentes
    setTables({ accepted: [], blocked: [] });
    // Mostra a mudança do IP
    setIsConnected(false);
    setLoading(true);
    setLogs([{ id: 0, text: `Connecting to ${config.ip}...`, type: 'warning' }]);

    fetchLogs();
    fetchTables();

    const interval = setInterval(() => {
      fetchLogs();
      fetchTables();
    }, 2000);

    return () => clearInterval(interval);
  }, [config]); // garante a mudança do IP com o guardar da config

  // Renders
  const handleHeaderClick = (type) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (collapsed[type]) {
      setCollapsed({ ...collapsed, [type]: false });
    } else {
      setZoomedTable(type);
    }
  };

  const permittedData = [...tables.accepted, ...overrides].sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return b.timestamp.localeCompare(a.timestamp);
  });

  const renderColumnHeaders = () => (
    <View style={styles.columnHeaderRow}>
      <Text style={[styles.columnHeader, { width: '40%' }]}>Timestamp</Text>
      <Text style={[styles.columnHeader, { width: '60%' }]}>ID</Text>
    </View>
  );

  const renderTableRows = (data, isZoomed = false) => (
    data.map((row, i) => {
      const parts = row.timestamp ? row.timestamp.split(' ') : ['-', '-'];
      let formattedDate = parts[0];
      if (parts[0] && parts[0].includes('-')) {
        const [y, m, d] = parts[0].split('-');
        formattedDate = `${d}/${m}/${y}`;
      }
      return (
        <View key={i} style={styles.tableRow}>
          {isZoomed ? (
            <>
              <Text style={[styles.cell, { width: '30%', color: '#888' }]}>{formattedDate}</Text>
              <Text style={[styles.cell, { width: '30%', color: '#aaa' }]}>{parts[1]}</Text>
              <Text style={[styles.cell, { width: '40%', color: 'white', fontWeight: 'bold' }]}>{row.ID}</Text>
            </>
          ) : (
            <>
              <Text style={[styles.cell, { width: '40%', color: '#888' }]}>{parts[1]}</Text>
              <Text style={[styles.cell, { width: '60%', color: 'white', fontWeight: 'bold' }]}>{row.ID}</Text>
            </>
          )}
        </View>
      );
    })
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1E1E1E" />

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>RFID Access Control</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: isConnected ? '#00FF00' : 'red' }]} />
            {isConnected ? (
              <Text style={styles.subtitle}>Connected: {config.ip}</Text>
            ) : (
              <TouchableOpacity onPress={() => { setLoading(true); fetchLogs(); }} style={styles.retryButton}>
                <Text style={styles.retryText}>⟳ Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <TouchableOpacity onPress={onOpenSettings} style={styles.settingsIcon}>
          <Text style={{ fontSize: 22 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* CONSOLE */}
      <Text style={styles.sectionTitle}>Live Console Feed:</Text>
      <View style={styles.consoleBox}>
        <ScrollView
          ref={scrollViewRef}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {logs.map((log) => (
            <Text key={log.id} style={[
              styles.logText,
              log.type === 'error' && styles.logError,
              log.type === 'success' && styles.logSuccess,
              log.type === 'warning' && styles.logWarning,
            ]}>{log.text}</Text>
          ))}
        </ScrollView>
      </View>

      {/* BUTTONS */}
      <View style={{ marginBottom: 20 }}>
        <TouchableOpacity style={styles.button} onPress={triggerForceOpen} activeOpacity={0.7}>
          <Text style={styles.buttonText}>FORCE ACTUATOR ON (10s)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.testButton]} onPress={testConnection} activeOpacity={0.7}>
          <Text style={styles.buttonText}>TEST CONNECTION</Text>
        </TouchableOpacity>
      </View>

      {/* TABLES */}
      <View style={styles.tablesContainer}>
        {/* Permitted */}
        <View style={[styles.tableWrapper, collapsed.accepted && styles.tableWrapperCollapsed]}>
          <TouchableOpacity
            style={[styles.tableHeaderBox, { borderBottomColor: '#4ade80' }]}
            onPress={() => handleHeaderClick('accepted')}
          >
            <Text style={[styles.tableTitle, { color: '#4ade80' }]}>Permitted</Text>
          </TouchableOpacity>
          {!collapsed.accepted && (
            <>
              {renderColumnHeaders()}
              <ScrollView style={styles.tableScroll}>{renderTableRows(permittedData)}</ScrollView>
            </>
          )}
        </View>
        <View style={styles.spacer} />
        {/* Blocked */}
        <View style={[styles.tableWrapper, collapsed.blocked && styles.tableWrapperCollapsed]}>
          <TouchableOpacity
            style={[styles.tableHeaderBox, { borderBottomColor: '#f87171' }]}
            onPress={() => handleHeaderClick('blocked')}
          >
            <Text style={[styles.tableTitle, { color: '#f87171' }]}>Blocked</Text>
          </TouchableOpacity>
          {!collapsed.blocked && (
            <>
              {renderColumnHeaders()}
              <ScrollView style={styles.tableScroll}>{renderTableRows(tables.blocked)}</ScrollView>
            </>
          )}
        </View>
      </View>

      {/* ZOOM MODAL */}
      <Modal animationType="fade" transparent={true} visible={zoomedTable !== null} onRequestClose={() => setZoomedTable(null)}>
        <View style={styles.modalBackground}>
          <View style={[styles.modalContainer, { borderColor: zoomedTable === 'accepted' ? '#4ade80' : '#f87171' }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setZoomedTable(null)} style={styles.iconButton}><Text style={styles.iconText}>←</Text></TouchableOpacity>
              <Text style={[styles.modalTitle, { color: zoomedTable === 'accepted' ? '#4ade80' : '#f87171' }]}>
                {zoomedTable === 'accepted' ? 'PERMITTED LOGS' : 'BLOCKED LOGS'}
              </Text>
              <TouchableOpacity onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setCollapsed(prev => ({ ...prev, [zoomedTable]: true }));
                setZoomedTable(null);
              }} style={styles.iconButton}><Text style={[styles.iconText, { color: '#ff4444' }]}>✕</Text></TouchableOpacity>
            </View>
            <View style={[styles.columnHeaderRow, { backgroundColor: '#333', paddingHorizontal: 20 }]}>
              <Text style={[styles.columnHeader, { width: '30%' }]}>Date</Text>
              <Text style={[styles.columnHeader, { width: '30%' }]}>Time</Text>
              <Text style={[styles.columnHeader, { width: '40%' }]}>ID</Text>
            </View>
            <ScrollView style={styles.modalScroll}>
              {zoomedTable === 'accepted' ? renderTableRows(permittedData, true) : renderTableRows(tables.blocked, true)}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// COMPONENT 3: Ponto de entrada na APP
export default function App() {
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [config, setConfig] = useState({ ip: '192.168.1.10', port: '5000' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const init = async () => {
      const savedConfig = await loadConfigFromStorage();
      setConfig(savedConfig);
      setLoaded(true);
    };
    init();
  }, []);

  const handleSaveSettings = (newConfig) => {
    setConfig(newConfig);
    setCurrentScreen('dashboard');
  };

  if (!loaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#17a2b8" />
        <Text style={{ color: 'white', marginTop: 10 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <>
      {currentScreen === 'dashboard' ? (
        <DashboardScreen
          config={config}
          onOpenSettings={() => setCurrentScreen('settings')}
        />
      ) : (
        <SettingsScreen
          initialConfig={config}
          onSave={handleSaveSettings}
          onCancel={() => setCurrentScreen('dashboard')}
        />
      )}
    </>
  );
}

// Estilos
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    paddingTop: Platform.OS === 'android' ? 30 : 50,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold'
  },
  subtitle: {
    color: '#aaa',
    fontSize: 12
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6
  },
  backButton: { padding: 10 },
  backText: {
    color: '#17a2b8',
    fontSize: 16
  },
  settingsIcon: {
    padding: 10,
    backgroundColor: '#2D2D2D',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444'
  },
  retryButton: {
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#555'
  },
  retryText: {
    color: '#ff6666',
    fontSize: 12,
    fontWeight: 'bold'
  },

  // Data
  content: { padding: 20 },
  label: {
    color: '#aaa',
    marginBottom: 8,
    marginTop: 16
  },
  input: {
    backgroundColor: '#2D2D2D',
    color: 'white',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    fontSize: 16
  },
  saveButton: {
    backgroundColor: '#17a2b8',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32
  },
  saveButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16
  },

  // Componentes
  sectionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 10,
    marginTop: 10
  },
  consoleBox: {
    height: 150,
    backgroundColor: 'black',
    marginHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    padding: 10,
    marginBottom: 16
  },
  logText: {
    color: '#cccccc',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginBottom: 4
  },
  logSuccess: { color: '#00ff00' },
  logError: {
    color: '#ff4444',
    fontWeight: 'bold'
  },
  logWarning: {
    color: '#ffa500',
    fontWeight: 'bold'
  },

  button: {
    backgroundColor: '#17a2b8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
    marginHorizontal: 6,
    elevation: 3
  },
  testButton: {
    backgroundColor: '#4a5568',
    marginBottom: 10
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16
  },

  // Tabelas
  tablesContainer: {
    flex: 1,
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-start',
    paddingHorizontal: 6
  },
  tableWrapper: {
    flex: 1,
    backgroundColor: '#252525',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
    height: '100%'
  },
  tableWrapperCollapsed: {
    height: 'auto',
    minHeight: 45
  },
  tableHeaderBox: {
    padding: 10,
    backgroundColor: '#333',
    alignItems: 'center'
  },
  tableTitle: {
    fontSize: 14,
    fontWeight: 'bold'
  },
  columnHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 5,
    paddingVertical: 6,
    backgroundColor: '#2a2a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#444'
  },
  columnHeader: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase'
  },
  tableScroll: { padding: 5 },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingHorizontal: 5
  },
  cell: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'left',
    paddingRight: 4
  },
  spacer: { width: 8 },

  // Estrutura
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center', padding: 20
  },
  modalContainer: {
    width: '100%',
    height: '80%',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden'
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#2D2D2D',
    borderBottomWidth: 1,
    borderBottomColor: '#444'
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1
  },
  iconButton: {
    padding: 5,
    width: 40,
    alignItems: 'center'
  },
  iconText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold'
  },
  modalScroll: { padding: 15 }
});
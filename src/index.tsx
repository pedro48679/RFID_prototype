import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View
} from 'react-native';

import { router, useFocusEffect } from 'expo-router';
// IMPORTAÇÃO CORRIGIDA: Agora aponta para o ficheiro 'config.ts' na raiz
import { loadConfigFromStorage } from '../config';

// --- DEFINIÇÃO DE TIPOS ---
interface Config {
  ip: string;
  port: string;
}

interface LogEntry {
  id: number;
  text: string;
  type: 'normal' | 'error' | 'success' | 'warning';
}

interface TableEntry {
  timestamp: string;
  ID: string;
}

interface TableState {
  accepted: TableEntry[];
  blocked: TableEntry[];
}

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DashboardScreen = () => {
  // Inicialização com tipo explícito
  const [config, setConfig] = useState<Config>({ ip: '192.168.1.10', port: '5000' });
  const [loaded, setLoaded] = useState(false);

  // URL base
  const API_URL = `http://${config.ip}:${config.port}`;

  // Inicialização com tipo explícito para resolver 'never[]' (erro 2345)
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [overrides, setOverrides] = useState<TableEntry[]>([]);
  const [tables, setTables] = useState<TableState>({ accepted: [], blocked: [] });

  // Connection States
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("Never");

  // View States
  const [zoomedTable, setZoomedTable] = useState<'accepted' | 'blocked' | null>(null);
  const [collapsed, setCollapsed] = useState({ accepted: false, blocked: false });

  // Tipo de referência corrigido para ScrollView (erro 2769)
  const scrollViewRef = useRef<ScrollView | null>(null);

  // --- LOAD CONFIGURATION AND POLLING ---
  useFocusEffect(
    useCallback(() => {
      const loadConfig = async () => {
        const savedConfig = await loadConfigFromStorage();
        // Check if config actually changed to avoid unnecessary re-renders (optional but good practice)
        setConfig(prev => {
          if (prev.ip !== savedConfig.ip || prev.port !== savedConfig.port) {
            // Reset connection state when IP changes
            setIsConnected(false); 
            return { ip: savedConfig.ip, port: savedConfig.port };
          }
          return prev;
        });
        setLoaded(true);
      };
      
      loadConfig();
    }, [])
  );

  useEffect(() => {
    if (!loaded) return;
    
    // Limpa as tabelas e reconecta ao PI
    setTables({ accepted: [], blocked: [] }); 
    setIsConnected(false);
    setLoading(true);

    // Limpa a consola e os logs
    setLogs([{ id: 0, text: `Attempting connection to ${config.ip}...`, type: 'warning' }]);

    fetchLogs();
    fetchTables();

    const interval = setInterval(() => {
      fetchLogs();
      fetchTables();
    }, 2000);

    return () => clearInterval(interval);
  }, [loaded, config]);

  // --- HELPER: Fetch with Timeout ---
  // Tipagem adicionada para 'resource' e 'options' (erros 7006, 2339)
  const fetchWithTimeout = async (resource: RequestInfo, options: RequestInit & { timeout?: number } = {}) => {
    const { timeout = 5000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(resource, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  };

  // --- 1. Fetch Console Logs ---
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

      const formattedLogs: LogEntry[] = lines.map((line, index) => {
        let type: LogEntry['type'] = 'normal';
        if (line.includes('BLOCKED') || line.includes('Access Denied')) type = 'error';
        if (line.includes('PERMITTED') || line.includes('Welcome')) type = 'success';
        if (line.includes('OVERRIDE') || line.includes('Commanded')) type = 'warning';
        return { id: index, text: line, type };
      });
      setLogs(formattedLogs);

      const today = new Date().toISOString().split('T')[0];
      // Tipagem explícita aqui resolve o erro 2345
      const parsedOverrides: TableEntry[] = lines
        .filter(line => line.includes('MANUAL OVERRIDE'))
        .map(line => {
          const timeMatch = line.match(/(\d{2}:\d{2}:\d{2})/);
          const time = timeMatch ? timeMatch[0] : '00:00:00';
          return {
            timestamp: `${today} ${time}`,
            ID: 'OVERRIDE'
          };
        });
      setOverrides(parsedOverrides);

      setIsConnected(true);

    } catch (error) {
      setIsConnected(false);
    }
  };

  // --- 2. Fetch Table Data ---
  const fetchTables = async () => {
    try {
      const response = await fetchWithTimeout(`${API_URL}/get_table_data`, { timeout: 3000 });
      const data = await response.json();
      setTables({
        accepted: (data.accepted || []) as TableEntry[],
        blocked: (data.blocked || []) as TableEntry[]
      });
      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
      setIsConnected(true);
    } catch (error) {
      setIsConnected(false);
      setLoading(false);
    }
  };

  // --- 3. Trigger Force Open ---
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
      Alert.alert("Connection Error", "Could not reach Raspberry Pi to trigger lock.");
    }
  };

  // --- 4. Manual Connection Test ---
  const testConnection = async () => {
    try {
      const start = Date.now();
      await fetchWithTimeout(`${API_URL}/get_log`, { timeout: 5000 });
      const duration = Date.now() - start;

      setIsConnected(true);
      fetchLogs();
      fetchTables();

      Alert.alert("Success", `Connection established in ${duration}ms`);
    } catch (error: any) { // Usar 'any' para o erro para resolver 18046 temporariamente
      setIsConnected(false);
      let msg = "Unknown error";
      if (error.name === 'AbortError') msg = "Request Timed Out (5s)";
      else msg = error.message;

      Alert.alert("Connection Failed", `Could not connect to ${API_URL}.\nReason: ${msg}`);
    }
  };

  const handleRetry = () => {
    setLoading(true);
    fetchLogs();
    fetchTables();
  };

  // --- INTERACTION LOGIC ---
  // Tipagem adicionada (erro 7006)
  const handleHeaderClick = (type: 'accepted' | 'blocked') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // Erros 7053 e 2464 resolvidos pela tipagem de 'type' e uso seguro
    if (collapsed[type]) {
      setCollapsed({ ...collapsed, [type]: false });
    } else {
      setZoomedTable(type);
    }
  };

  const handleZoomBack = () => {
    setZoomedTable(null);
  };

  const handleZoomClose = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const typeToCollapse = zoomedTable;
    setZoomedTable(null);
    if (typeToCollapse) { // Garantir que não é null antes de definir
      setCollapsed({ ...collapsed, [typeToCollapse]: true });
    }
  };


  // --- DATA PREPARATION ---
  // Tipagem explícita para resolver erros de Propriedade 'timestamp' em 'never' (erro 2339)
  const permittedData: TableEntry[] = [...tables.accepted, ...overrides].sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return b.timestamp.localeCompare(a.timestamp);
  });

  // Helper: Render Column Headers (Mantido)
  const renderColumnHeaders = () => (
    <View style={styles.columnHeaderRow}>
      <Text style={[styles.columnHeader, { width: '40%' }]}>Timestamp</Text>
      <Text style={[styles.columnHeader, { width: '60%' }]}>ID</Text>
    </View>
  );

  // Helper: Render Table Rows (Tipagem adicionada - erro 7006)
  const renderTableRows = (data: TableEntry[], isZoomed = false) => (
    data.map((row, i) => {
      const parts = row.timestamp ? row.timestamp.split(' ') : ['-', '-'];
      const datePart = parts[0];
      const timePart = parts[1];

      let formattedDate = datePart;
      if (datePart && datePart.includes('-')) {
        const [y, m, d] = datePart.split('-');
        formattedDate = `${d}/${m}/${y}`;
      }

      return (
        <View key={i} style={styles.tableRow}>
          {isZoomed ? (
            // ZOOMED: 30% | 30% | 40%
            <>
              <Text style={[styles.cell, { width: '30%', color: '#888' }]}>{formattedDate}</Text>
              <Text style={[styles.cell, { width: '30%', color: '#aaa' }]}>{timePart}</Text>
              <Text style={[styles.cell, { width: '40%', color: 'white', fontWeight: 'bold' }]}>{row.ID}</Text>
            </>
          ) : (
            // NORMAL: 40% | 60%
            <>
              <Text style={[styles.cell, { width: '40%', color: '#888' }]}>{timePart}</Text>
              <Text style={[styles.cell, { width: '60%', color: 'white', fontWeight: 'bold' }]}>{row.ID}</Text>
            </>
          )}
        </View>
      );
    })
  );

  // Se ainda não carregou a config
  if (!loaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#17a2b8" />
        <Text style={{ color: 'white', marginTop: 10 }}>Carregando Configuração...</Text>
      </View>
    );
  }

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
              <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
                <Text style={styles.retryText}>⟳ Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Settings Button - Usa router.push para navegar para app/settings.tsx */}
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsIcon}>
          <Text style={{ fontSize: 22 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* CONSOLE FEED */}
      <Text style={styles.sectionTitle}>Live Console Feed:</Text>
      <View style={styles.consoleBox}>
        <ScrollView
          ref={scrollViewRef}
          onContentSizeChange={(w, h) => scrollViewRef.current?.scrollToEnd({ animated: true })}
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

      {/* BUTTONS CONTAINER */}
      <View style={{ marginBottom: 20 }}>
        <TouchableOpacity style={styles.button} onPress={triggerForceOpen} activeOpacity={0.7}>
          <Text style={styles.buttonText}>FORCE ACTUATOR ON (10s)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.testButton]}
          onPress={testConnection}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>TEST CONNECTION</Text>
        </TouchableOpacity>
      </View>

      {/* TABLES CONTAINER */}
      <View style={styles.tablesContainer}>

        {/* PERMITTED TABLE */}
        <View style={[styles.tableWrapper, collapsed.accepted && styles.tableWrapperCollapsed]}>
          <TouchableOpacity
            style={[styles.tableHeaderBox, { borderBottomColor: '#4ade80' }]}
            onPress={() => handleHeaderClick('accepted')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tableTitle, { color: '#4ade80' }]}>
              Permitted
            </Text>
          </TouchableOpacity>

          {!collapsed.accepted && (
            <>
              {renderColumnHeaders()}
              <ScrollView style={styles.tableScroll} nestedScrollEnabled={true}>
                {renderTableRows(permittedData, false)}
              </ScrollView>
            </>
          )}
        </View>

        <View style={styles.spacer} />

        {/* BLOCKED TABLE */}
        <View style={[styles.tableWrapper, collapsed.blocked && styles.tableWrapperCollapsed]}>
          <TouchableOpacity
            style={[styles.tableHeaderBox, { borderBottomColor: '#f87171' }]}
            onPress={() => handleHeaderClick('blocked')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tableTitle, { color: '#f87171' }]}>
              Blocked
            </Text>
          </TouchableOpacity>

          {!collapsed.blocked && (
            <>
              {renderColumnHeaders()}
              <ScrollView style={styles.tableScroll} nestedScrollEnabled={true}>
                {renderTableRows(tables.blocked, false)}
              </ScrollView>
            </>
          )}
        </View>
      </View>

      {/* --- FULL SCREEN ZOOM MODAL --- */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={zoomedTable !== null}
        onRequestClose={handleZoomBack}
      >
        <View style={styles.modalBackground}>
          <View style={[
            styles.modalContainer,
            { borderColor: zoomedTable === 'accepted' ? '#4ade80' : '#f87171' }
          ]}>

            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={handleZoomBack} style={styles.iconButton}>
                <Text style={styles.iconText}>←</Text>
              </TouchableOpacity>

              <Text style={[
                styles.modalTitle,
                { color: zoomedTable === 'accepted' ? '#4ade80' : '#f87171' }
              ]}>
                {zoomedTable === 'accepted' ? 'PERMITTED LOGS' : 'BLOCKED LOGS'}
              </Text>

              <TouchableOpacity onPress={handleZoomClose} style={styles.iconButton}>
                <Text style={[styles.iconText, { color: '#ff4444' }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.columnHeaderRow, { backgroundColor: '#333', paddingHorizontal: 20 }]}>
              <Text style={[styles.columnHeader, { width: '30%' }]}>Date</Text>
              <Text style={[styles.columnHeader, { width: '30%' }]}>Time</Text>
              <Text style={[styles.columnHeader, { width: '40%' }]}>ID</Text>
            </View>

            <ScrollView style={styles.modalScroll}>
              {zoomedTable === 'accepted'
                ? renderTableRows(permittedData, true)
                : renderTableRows(tables.blocked, true)
              }
            </ScrollView>

          </View>
        </View>
      </Modal>

    </View>
  );
};

export default DashboardScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 6,
    paddingTop: Platform.OS === 'android' ? 40 : 50,
  },
  // ... (Estilos omitidos por brevidade - mantidos inalterados)
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 10,
    paddingHorizontal: 10,
  },
  title: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  subtitle: { color: '#aaa', fontSize: 12 },
  retryButton: {
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#555'
  },
  retryText: { color: '#ff6666', fontSize: 12, fontWeight: 'bold' },
  timestamp: { color: '#666', fontSize: 10 },
  settingsIcon: {
    padding: 10,
    backgroundColor: '#2D2D2D',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  sectionTitle: { color: 'white', fontSize: 16, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 },

  // CONSOLE STYLES
  consoleBox: {
    height: 150,
    backgroundColor: 'black',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    padding: 10,
    marginBottom: 16,
  },
  logText: {
    color: '#cccccc',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginBottom: 4,
  },
  logSuccess: { color: '#00ff00' },
  logError: { color: '#ff4444', fontWeight: 'bold' },
  logWarning: { color: '#ffa500', fontWeight: 'bold' },

  // BUTTONS
  button: {
    backgroundColor: '#17a2b8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
    elevation: 3,
  },
  testButton: {
    backgroundColor: '#4a5568',
    marginBottom: 10,
  },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  // TABLES
  tablesContainer: {
    flex: 1,
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  tableWrapper: {
    flex: 1,
    backgroundColor: '#252525',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
    height: '100%',
  },
  tableWrapperCollapsed: {
    height: 'auto',
    minHeight: 45,
  },
  tableHeaderBox: {
    padding: 10,
    backgroundColor: '#333',
    borderBottomWidth: 0,
    alignItems: 'center',
  },
  tableTitle: { fontSize: 14, fontWeight: 'bold' },

  // COLUMN HEADERS
  columnHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 5,
    paddingVertical: 6,
    backgroundColor: '#2a2a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  columnHeader: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
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
    paddingRight: 4,
  },

  spacer: { width: 8 },

  // MODAL STYLES
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
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
  modalScroll: {
    padding: 15
  }
});

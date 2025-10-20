import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { initDevLogger, DevLogEntry } from '../services/DevLogger';

const MAX_ENTRIES = 20;

const DevLogOverlay: React.FC<{ enabled?: boolean }> = ({ enabled }) => {
  const [logs, setLogs] = useState<DevLogEntry[]>([]);
  const [visible, setVisible] = useState(true);

  const isEnabled = (enabled ?? __DEV__);

  useEffect(() => {
    if (!isEnabled) return;
    initDevLogger((entry) => {
      setLogs((prev) => {
        const next = [entry, ...prev];
        if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
        return next;
      });
    });
  }, [isEnabled]);

  const latestLevel = useMemo(() => logs[0]?.level, [logs]);

  if (!isEnabled || !visible) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={[styles.panel, getLevelStyle(latestLevel)]}>
        <View style={styles.header}>
          <Text style={styles.title}>Live Dev Logs</Text>
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => setVisible(false)}>
              <Text style={styles.action}>Hide</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView style={styles.body}>
          {logs.map((l, idx) => (
            <Text key={idx} style={styles.line}>
              {[new Date(l.timestamp).toLocaleTimeString(), l.level.toUpperCase()].join(' ')}: {l.message}
              {l.stack ? `\n${l.stack}` : ''}
              {l.fatal ? ' (fatal)' : ''}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

function getLevelStyle(level?: 'log' | 'warn' | 'error' | 'debug') {
  switch (level) {
    case 'error':
      return { borderColor: '#ff4d4f' };
    case 'warn':
      return { borderColor: '#faad14' };
    case 'debug':
      return { borderColor: '#8cc6ff' };
    default:
      return { borderColor: '#40a9ff' };
  }
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  panel: {
    margin: 8,
    padding: 8,
    borderWidth: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(20,20,20,0.92)',
    maxHeight: 200,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: { color: '#fff', fontWeight: 'bold' },
  actions: { flexDirection: 'row' },
  action: { color: '#8cc6ff', marginLeft: 12 },
  body: { maxHeight: 160 },
  line: { color: '#eee', marginBottom: 4, fontSize: 12 },
});

export default DevLogOverlay;
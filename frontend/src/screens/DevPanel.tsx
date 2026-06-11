import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
} from "react-native";
import { loadState } from "../storage/db";
import { getDeviceId } from "../storage/deviceId";
import {
  sync,
  setOnlineStatus,
  getOnlineStatus,
  getSyncLogs,
  getNotificationLogs,
  setApiUrl,
  getApiUrl,
  SyncLog,
} from "../sync/syncEngine";

interface Props {
  refreshKey?: number;
  onStateChange?: () => void;
}

export default function DevPanel({ refreshKey, onStateChange }: Props) {
  const [online, setOnline] = useState(getOnlineStatus());
  const [deviceId, setDeviceIdState] = useState("");
  const [apiUrl, setApiUrlState] = useState(getApiUrl());
  const [pendingCount, setPendingCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [coins, setCoins] = useState(0);
  const [focusMin, setFocusMin] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [notifLogs, setNotifLogs] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const state = await loadState();
    const did = await getDeviceId();
    setDeviceIdState(did);
    setPendingCount(state.pendingEvents.length);
    setStreak(state.streak);
    setCoins(state.coins);
    setFocusMin(state.focusMinutesToday);
    setTaskCount(Object.keys(state.tasks).length);
    setSessionCount(Object.keys(state.sessions).length);
    setLogs([...getSyncLogs()].reverse().slice(0, 50));
    setNotifLogs([...getNotificationLogs()].reverse().slice(0, 20));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const toggleOnline = useCallback(() => {
    const next = !online;
    setOnline(next);
    setOnlineStatus(next);
    // if going online, let sync happen then refresh
    if (next) {
      setTimeout(() => {
        refresh();
        onStateChange?.();
      }, 1500);
    }
  }, [online, refresh, onStateChange]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      await sync();
    } catch {
      // logged inside sync
    }
    setSyncing(false);
    await refresh();
    onStateChange?.();
  }, [refresh, onStateChange]);

  const replayIdempotency = useCallback(async () => {
    setSyncing(true);
    for (let i = 0; i < 3; i++) {
      try {
        await sync();
      } catch {
        // ignore
      }
    }
    setSyncing(false);
    await refresh();
    onStateChange?.();
  }, [refresh, onStateChange]);

  const handleApiUrlChange = useCallback(
    (url: string) => {
      setApiUrlState(url);
      setApiUrl(url);
    },
    []
  );

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Dev Panel</Text>

      {/* Online toggle */}
      <View style={styles.row}>
        <Text style={styles.label}>Online:</Text>
        <TouchableOpacity
          style={[styles.badge, online ? styles.badgeOnline : styles.badgeOffline]}
          onPress={toggleOnline}
        >
          <Text style={styles.badgeText}>
            {online ? "ONLINE" : "OFFLINE"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sync buttons */}
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          onPress={triggerSync}
          disabled={syncing}
        >
          <Text style={styles.syncBtnText}>
            {syncing ? "Syncing..." : "Manual Sync"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.syncBtn, styles.replayBtn, syncing && styles.syncBtnDisabled]}
          onPress={replayIdempotency}
          disabled={syncing}
        >
          <Text style={styles.syncBtnText}>Replay x3 (Idempotency)</Text>
        </TouchableOpacity>
      </View>

      {/* Device info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Device</Text>
        <Text style={styles.mono}>ID: {deviceId}</Text>
        <View style={styles.row}>
          <Text style={styles.mono}>API: </Text>
          <TextInput
            style={styles.apiInput}
            value={apiUrl}
            onChangeText={handleApiUrlChange}
            selectTextOnFocus
          />
        </View>
      </View>

      {/* Local state */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Local State</Text>
        <Text style={styles.statText}>Coins: {coins}</Text>
        <Text style={styles.statText}>Streak: {streak}</Text>
        <Text style={styles.statText}>Focus min today: {focusMin}</Text>
        <Text style={styles.statText}>Tasks tracked: {taskCount}</Text>
        <Text style={styles.statText}>Sessions: {sessionCount}</Text>
      </View>

      {/* Event queue */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Event Queue ({pendingCount})</Text>
        {pendingCount === 0 && (
          <Text style={styles.emptyText}>Queue empty</Text>
        )}
      </View>

      {/* Sync log */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sync Log</Text>
        {logs.length === 0 && (
          <Text style={styles.emptyText}>No sync logs yet</Text>
        )}
        {logs.map((l, i) => (
          <Text key={i} style={styles.logEntry}>
            {l.msg}
          </Text>
        ))}
      </View>

      {/* Notification log */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notification Log</Text>
        {notifLogs.length === 0 && (
          <Text style={styles.emptyText}>No notifications yet</Text>
        )}
        {notifLogs.map((l, i) => (
          <Text key={i} style={styles.logEntry}>
            {l}
          </Text>
        ))}
      </View>

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#0f0f23" },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#e0e0ff",
    marginBottom: 16,
    textAlign: "center",
  },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  btnRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  label: { color: "#aaa", fontSize: 14, marginRight: 8 },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeOnline: { backgroundColor: "#1a5c2a" },
  badgeOffline: { backgroundColor: "#5c1a1a" },
  badgeText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  syncBtn: {
    backgroundColor: "#4a4ae0",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  replayBtn: { backgroundColor: "#6a3ae0" },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  section: {
    backgroundColor: "#1a1a3e",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#e0e0ff",
    marginBottom: 6,
  },
  mono: { color: "#aaa", fontFamily: "monospace", fontSize: 12 },
  statText: { color: "#ccc", fontSize: 14, marginBottom: 2 },
  emptyText: { color: "#555", fontStyle: "italic", fontSize: 13 },
  logEntry: {
    color: "#8f8",
    fontFamily: "monospace",
    fontSize: 11,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
  },
  apiInput: {
    color: "#aaa",
    fontFamily: "monospace",
    fontSize: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#444",
    flex: 1,
    paddingVertical: 2,
  },
});

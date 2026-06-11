import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import FocusScreen from "./src/screens/FocusScreen";
import SyllabusScreen from "./src/screens/SyllabusScreen";
import DevPanel from "./src/screens/DevPanel";
import { getOnlineStatus } from "./src/sync/syncEngine";
import { loadState } from "./src/storage/db";

type Tab = "focus" | "syllabus" | "dev";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("focus");
  const [refreshKey, setRefreshKey] = useState(0);
  const [headerStats, setHeaderStats] = useState({
    coins: 0,
    streak: 0,
    focusMin: 0,
  });

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadState().then((state) => {
      setHeaderStats({
        coins: state.coins,
        streak: state.streak,
        focusMin: state.focusMinutesToday,
      });
    });
  }, []);

  // Load stats on mount
  React.useEffect(() => {
    loadState().then((state) => {
      setHeaderStats({
        coins: state.coins,
        streak: state.streak,
        focusMin: state.focusMinutesToday,
      });
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appName}>Study Sync</Text>
        <Text style={styles.subtitle}>
          Offline-first &middot; Event sync &middot;{" "}
          {getOnlineStatus() ? "Online" : "Offline"}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{headerStats.coins}</Text>
            <Text style={styles.statLabel}>Coins</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{headerStats.streak}</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{headerStats.focusMin}</Text>
            <Text style={styles.statLabel}>Focus min</Text>
          </View>
        </View>
      </View>

      {/* Tab content */}
      <View style={styles.content}>
        {activeTab === "focus" && (
          <FocusScreen onStateChange={triggerRefresh} />
        )}
        {activeTab === "syllabus" && (
          <SyllabusScreen
            refreshKey={refreshKey}
            onStateChange={triggerRefresh}
          />
        )}
        {activeTab === "dev" && (
          <DevPanel refreshKey={refreshKey} onStateChange={triggerRefresh} />
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(["focus", "syllabus", "dev"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => {
              setActiveTab(tab);
              triggerRefresh();
            }}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.tabTextActive,
              ]}
            >
              {tab === "focus"
                ? "Focus"
                : tab === "syllabus"
                ? "Syllabus"
                : "Dev"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  header: {
    padding: 16,
    paddingTop: 8,
    backgroundColor: "#12122e",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  appName: { fontSize: 22, fontWeight: "bold", color: "#e0e0ff" },
  subtitle: { fontSize: 12, color: "#666", marginTop: 2 },
  statsRow: {
    flexDirection: "row",
    marginTop: 10,
    gap: 20,
  },
  stat: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "bold", color: "#4a4ae0" },
  statLabel: { fontSize: 11, color: "#888" },
  content: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#12122e",
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderTopWidth: 2,
    borderTopColor: "#4a4ae0",
  },
  tabText: { fontSize: 14, color: "#666" },
  tabTextActive: { color: "#4a4ae0", fontWeight: "bold" },
});

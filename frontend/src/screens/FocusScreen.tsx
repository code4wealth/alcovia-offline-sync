import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AppState,
  AppStateStatus,
} from "react-native";
import { v4 as uuid } from "uuid";
import {
  EventType,
  SessionStatus,
  FailReason,
  SyncEvent,
  REWARD_COINS,
  STREAK_DELTA,
} from "../../../shared/types";
import { loadState, saveState } from "../storage/db";
import { getDeviceId } from "../storage/deviceId";
import { enqueueEvent } from "../storage/eventQueue";
import { applySessionEvent, applyReward } from "../storage/localMutations";

const DURATIONS = [25, 45, 60, 90, 120];

interface Props {
  onStateChange?: () => void;
}

export default function FocusScreen({ onStateChange }: Props) {
  const [selectedDuration, setSelectedDuration] = useState(25);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [completed, setCompleted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgTimeRef = useRef<number>(0);
  const sessionRef = useRef<{
    id: string;
    duration: number;
    startedAt: number;
  } | null>(null);

  // Restore active session from durable storage on mount
  useEffect(() => {
    (async () => {
      const state = await loadState();
      for (const sess of Object.values(state.sessions)) {
        if (sess.status === SessionStatus.ACTIVE) {
          const elapsed = Math.floor((Date.now() - sess.startedAt) / 1000);
          const totalSec = sess.targetDuration * 60;
          const rem = totalSec - elapsed;
          if (rem > 0) {
            sessionRef.current = {
              id: sess.sessionId,
              duration: sess.targetDuration,
              startedAt: sess.startedAt,
            };
            setActiveSessionId(sess.sessionId);
            setRemainingSeconds(rem);
          }
        }
      }
    })();
  }, []);

  // Timer countdown
  useEffect(() => {
    if (!activeSessionId) return;
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          completeSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // AppState listener for background detection
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "background" || nextState === "inactive") {
        bgTimeRef.current = Date.now();
      } else if (nextState === "active" && bgTimeRef.current > 0) {
        const elapsed = Date.now() - bgTimeRef.current;
        bgTimeRef.current = 0;
        if (elapsed > 5000 && activeSessionId) {
          failSession(FailReason.APP_SWITCH);
        }
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  const startSession = useCallback(async () => {
    const deviceId = await getDeviceId();
    const sessionId = `session-${Date.now()}-${uuid().slice(0, 6)}`;
    const startedAt = Date.now();

    sessionRef.current = {
      id: sessionId,
      duration: selectedDuration,
      startedAt,
    };

    await applySessionEvent({
      sessionId,
      deviceId,
      targetDuration: selectedDuration,
      status: SessionStatus.ACTIVE,
      startedAt,
      rewardProcessed: false,
    });

    const event: SyncEvent = {
      eventId: uuid(),
      entityId: sessionId,
      deviceId,
      type: EventType.SESSION_STARTED,
      version: 1,
      payload: { targetDuration: selectedDuration, startedAt },
      createdAt: Date.now(),
    };
    await enqueueEvent(event);

    setActiveSessionId(sessionId);
    setRemainingSeconds(selectedDuration * 60);
    setCompleted(false);
    onStateChange?.();
  }, [selectedDuration, onStateChange]);

  const completeSession = useCallback(async () => {
    if (!sessionRef.current) return;
    const { id, duration, startedAt } = sessionRef.current;
    const deviceId = await getDeviceId();
    const completedAt = Date.now();

    await applySessionEvent({
      sessionId: id,
      deviceId,
      targetDuration: duration,
      status: SessionStatus.COMPLETED,
      startedAt,
      completedAt,
      rewardProcessed: false,
    });

    await applyReward(id, REWARD_COINS, STREAK_DELTA, duration);

    const event: SyncEvent = {
      eventId: uuid(),
      entityId: id,
      deviceId,
      type: EventType.SESSION_COMPLETED,
      version: 2,
      payload: { targetDuration: duration, startedAt, completedAt },
      createdAt: Date.now(),
    };
    await enqueueEvent(event);

    setActiveSessionId(null);
    setCompleted(true);
    sessionRef.current = null;
    if (intervalRef.current) clearInterval(intervalRef.current);
    onStateChange?.();
  }, [onStateChange]);

  const failSession = useCallback(
    async (reason: FailReason) => {
      if (!sessionRef.current) return;
      const { id, duration, startedAt } = sessionRef.current;
      const deviceId = await getDeviceId();

      await applySessionEvent({
        sessionId: id,
        deviceId,
        targetDuration: duration,
        status: SessionStatus.FAILED,
        startedAt,
        failReason: reason,
      });

      const event: SyncEvent = {
        eventId: uuid(),
        entityId: id,
        deviceId,
        type: EventType.SESSION_FAILED,
        version: 2,
        payload: { targetDuration: duration, startedAt, failReason: reason },
        createdAt: Date.now(),
      };
      await enqueueEvent(event);

      setActiveSessionId(null);
      sessionRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      onStateChange?.();
    },
    [onStateChange]
  );

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Focus Session</Text>

      {!activeSessionId && !completed && (
        <>
          <Text style={styles.label}>Select Duration</Text>
          <View style={styles.durations}>
            {DURATIONS.map((d) => (
              <TouchableOpacity
                key={d}
                style={[
                  styles.durBtn,
                  d === selectedDuration && styles.durBtnActive,
                ]}
                onPress={() => setSelectedDuration(d)}
              >
                <Text
                  style={[
                    styles.durText,
                    d === selectedDuration && styles.durTextActive,
                  ]}
                >
                  {d}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.startBtn} onPress={startSession}>
            <Text style={styles.startBtnText}>Start Session</Text>
          </TouchableOpacity>
        </>
      )}

      {activeSessionId && (
        <View style={styles.timerContainer}>
          <Text style={styles.timer}>{formatTime(remainingSeconds)}</Text>
          <Text style={styles.subLabel}>Stay focused!</Text>
          <TouchableOpacity
            style={styles.giveUpBtn}
            onPress={() => failSession(FailReason.GIVE_UP)}
          >
            <Text style={styles.giveUpText}>Give Up</Text>
          </TouchableOpacity>
        </View>
      )}

      {completed && (
        <View style={styles.completeBox}>
          <Text style={styles.completeText}>Session Complete!</Text>
          <Text style={styles.rewardText}>+{REWARD_COINS} coins earned</Text>
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => setCompleted(false)}
          >
            <Text style={styles.startBtnText}>New Session</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#0f0f23" },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#e0e0ff",
    marginBottom: 20,
    textAlign: "center",
  },
  label: { fontSize: 16, color: "#aaa", marginBottom: 10, textAlign: "center" },
  durations: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  durBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#1a1a3e",
    borderWidth: 1,
    borderColor: "#333",
  },
  durBtnActive: {
    backgroundColor: "#4a4ae0",
    borderColor: "#6a6aff",
  },
  durText: { color: "#888", fontSize: 16 },
  durTextActive: { color: "#fff" },
  startBtn: {
    backgroundColor: "#4a4ae0",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  startBtnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  timerContainer: { alignItems: "center", marginTop: 40 },
  timer: { fontSize: 72, fontWeight: "bold", color: "#e0e0ff" },
  subLabel: { fontSize: 16, color: "#888", marginTop: 10 },
  giveUpBtn: {
    marginTop: 30,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#a03030",
    paddingHorizontal: 30,
  },
  giveUpText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  completeBox: { alignItems: "center", marginTop: 40 },
  completeText: { fontSize: 28, fontWeight: "bold", color: "#4a4ae0" },
  rewardText: { fontSize: 18, color: "#aaa", marginTop: 10, marginBottom: 20 },
});

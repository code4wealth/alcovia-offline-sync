import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { v4 as uuid } from "uuid";
import {
  TaskStatus,
  EventType,
  SyncEvent,
  Task,
} from "../../../shared/types";
import { loadState, saveState, SEED_SUBJECTS } from "../storage/db";
import { getDeviceId } from "../storage/deviceId";
import { enqueueEvent } from "../storage/eventQueue";

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  [TaskStatus.NOT_STARTED]: TaskStatus.IN_PROGRESS,
  [TaskStatus.IN_PROGRESS]: TaskStatus.DONE,
  [TaskStatus.DONE]: TaskStatus.NOT_STARTED,
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.NOT_STARTED]: "#666",
  [TaskStatus.IN_PROGRESS]: "#e0a030",
  [TaskStatus.DONE]: "#30c060",
};

interface Props {
  refreshKey?: number;
  onStateChange?: () => void;
}

export default function SyllabusScreen({ refreshKey, onStateChange }: Props) {
  const [tasks, setTasks] = useState<Record<string, Task>>({});

  const refresh = useCallback(async () => {
    const state = await loadState();
    setTasks({ ...state.tasks });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const cycleStatus = useCallback(
    async (taskId: string) => {
      const state = await loadState();
      const task = state.tasks[taskId];
      if (!task) return;

      const deviceId = await getDeviceId();
      const newStatus = STATUS_CYCLE[task.status];
      const newVersion = task.version + 1;

      task.status = newStatus;
      task.version = newVersion;
      task.updatedByDevice = deviceId;
      await saveState(state);

      const event: SyncEvent = {
        eventId: uuid(),
        entityId: taskId,
        deviceId,
        type: EventType.TASK_STATUS_CHANGED,
        version: newVersion,
        payload: {
          status: newStatus,
          chapterId: task.chapterId,
          subjectId: task.subjectId,
          title: task.title,
        },
        createdAt: Date.now(),
      };
      await enqueueEvent(event);
      setTasks({ ...state.tasks });
      onStateChange?.();
    },
    [onStateChange]
  );

  const getChapterProgress = (chapterId: string): number => {
    const chapterTasks = Object.values(tasks).filter(
      (t) => t.chapterId === chapterId
    );
    if (chapterTasks.length === 0) return 0;
    const done = chapterTasks.filter(
      (t) => t.status === TaskStatus.DONE
    ).length;
    return Math.round((done / chapterTasks.length) * 100);
  };

  const getSubjectProgress = (subjectId: string): number => {
    const subj = SEED_SUBJECTS.find((s) => s.subjectId === subjectId);
    if (!subj) return 0;
    const chapterProgresses = subj.chapters.map((ch) =>
      getChapterProgress(ch.chapterId)
    );
    return Math.round(
      chapterProgresses.reduce((a, b) => a + b, 0) / chapterProgresses.length
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Syllabus Progress</Text>

      {SEED_SUBJECTS.map((subj) => (
        <View key={subj.subjectId} style={styles.subjectCard}>
          <View style={styles.subjectHeader}>
            <Text style={styles.subjectName}>{subj.name}</Text>
            <Text style={styles.progressText}>
              {getSubjectProgress(subj.subjectId)}%
            </Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${getSubjectProgress(subj.subjectId)}%`,
                },
              ]}
            />
          </View>

          {subj.chapters.map((ch) => (
            <View key={ch.chapterId} style={styles.chapterSection}>
              <Text style={styles.chapterName}>
                {ch.name} ({getChapterProgress(ch.chapterId)}%)
              </Text>
              <View style={styles.chapterBar}>
                <View
                  style={[
                    styles.chapterFill,
                    {
                      width: `${getChapterProgress(ch.chapterId)}%`,
                    },
                  ]}
                />
              </View>

              {ch.tasks.map((t) => {
                const task = tasks[t.taskId];
                if (!task) return null;
                return (
                  <TouchableOpacity
                    key={t.taskId}
                    style={styles.taskRow}
                    onPress={() => cycleStatus(t.taskId)}
                  >
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    <View style={styles.taskMeta}>
                      <Text
                        style={[
                          styles.statusBadge,
                          { color: STATUS_COLORS[task.status] },
                        ]}
                      >
                        {task.status}
                      </Text>
                      <Text style={styles.versionText}>v{task.version}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      ))}
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
  subjectCard: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  subjectHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  subjectName: { fontSize: 20, fontWeight: "bold", color: "#e0e0ff" },
  progressText: { fontSize: 16, color: "#4a4ae0", fontWeight: "bold" },
  progressBar: {
    height: 6,
    backgroundColor: "#333",
    borderRadius: 3,
    marginBottom: 12,
  },
  progressFill: {
    height: 6,
    backgroundColor: "#4a4ae0",
    borderRadius: 3,
  },
  chapterSection: { marginTop: 8 },
  chapterName: { fontSize: 16, color: "#aaa", marginBottom: 4 },
  chapterBar: {
    height: 4,
    backgroundColor: "#333",
    borderRadius: 2,
    marginBottom: 8,
  },
  chapterFill: { height: 4, backgroundColor: "#6a6aff", borderRadius: 2 },
  taskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  taskTitle: { fontSize: 14, color: "#ccc", flex: 1 },
  taskMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: { fontSize: 12, fontWeight: "bold" },
  versionText: { fontSize: 11, color: "#555" },
});

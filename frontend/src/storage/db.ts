import AsyncStorage from "@react-native-async-storage/async-storage";
import { LocalState, TaskStatus } from "../../../shared/types";

const STATE_KEY = "alcovia_state";

export function defaultState(): LocalState {
  return {
    tasks: {},
    sessions: {},
    streak: 0,
    coins: 0,
    focusMinutesToday: 0,
    pendingEvents: [],
    lastSyncedSeq: 0,
  };
}

const SEED_SUBJECTS: Array<{
  subjectId: string;
  name: string;
  chapters: Array<{
    chapterId: string;
    name: string;
    tasks: Array<{ taskId: string; title: string }>;
  }>;
}> = [
  {
    subjectId: "subj-math",
    name: "Mathematics",
    chapters: [
      {
        chapterId: "ch-algebra",
        name: "Algebra",
        tasks: [
          { taskId: "task-linear-eq", title: "Linear Equations" },
          { taskId: "task-quad-fn", title: "Quadratic Functions" },
          { taskId: "task-poly", title: "Polynomials" },
        ],
      },
      {
        chapterId: "ch-calculus",
        name: "Calculus",
        tasks: [
          { taskId: "task-derivatives", title: "Derivatives" },
          { taskId: "task-integrals", title: "Integrals" },
          { taskId: "task-limits", title: "Limits" },
        ],
      },
    ],
  },
  {
    subjectId: "subj-physics",
    name: "Physics",
    chapters: [
      {
        chapterId: "ch-mechanics",
        name: "Mechanics",
        tasks: [
          { taskId: "task-kinematics", title: "Kinematics" },
          { taskId: "task-forces", title: "Forces & Motion" },
          { taskId: "task-energy", title: "Energy Conservation" },
        ],
      },
      {
        chapterId: "ch-thermo",
        name: "Thermodynamics",
        tasks: [
          { taskId: "task-heat", title: "Heat Transfer" },
          { taskId: "task-laws-thermo", title: "Laws of Thermodynamics" },
          { taskId: "task-entropy", title: "Entropy" },
        ],
      },
    ],
  },
];

export function seedTasks(state: LocalState): LocalState {
  let changed = false;
  for (const subj of SEED_SUBJECTS) {
    for (const ch of subj.chapters) {
      for (const t of ch.tasks) {
        if (!state.tasks[t.taskId]) {
          state.tasks[t.taskId] = {
            taskId: t.taskId,
            chapterId: ch.chapterId,
            subjectId: subj.subjectId,
            title: t.title,
            status: TaskStatus.NOT_STARTED,
            version: 0,
            updatedByDevice: "",
          };
          changed = true;
        }
      }
    }
  }
  if (changed) return { ...state };
  return state;
}

export { SEED_SUBJECTS };

export async function loadState(): Promise<LocalState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalState;
      return seedTasks(parsed);
    }
  } catch {
    // corrupted storage — start fresh
  }
  const fresh = defaultState();
  return seedTasks(fresh);
}

export async function saveState(state: LocalState): Promise<void> {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export async function clearState(): Promise<void> {
  await AsyncStorage.removeItem(STATE_KEY);
}

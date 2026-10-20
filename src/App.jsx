import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, BookOpen, Check, ChevronDown, CircleHelp, Code2, ExternalLink,
  Flame, LayoutDashboard, ListChecks, LoaderCircle, LogOut, Pause, Play, Search,
  Settings2, Sparkles, Square, Target, TrendingUp, X
} from "lucide-react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import AuthScreen from "./AuthScreen";
import { auth, db } from "./firebase";
import AnalyticsDashboard from "./AnalyticsDashboard";
import { addTimerIntervalToDailyTotals, calculateAnalytics } from "./analytics";
import {
  createProgressSnapshot, hasLocalProgress, LOCAL_CONFLICT_BACKUP_PREFIX,
  LOCAL_MIGRATION_OWNER_KEY, mergeProgress, progressFingerprint
} from "./progressSync";
import { initialProblems } from "./problems";

const STORAGE_KEY = "dsa-tracker-progress-v1";
const PRACTICE_DATES_STORAGE_KEY = "dsa-tracker-practice-dates-v1";
const COMPLETION_DATES_STORAGE_KEY = "dsa-tracker-completion-dates-v1";
const COMPLETION_EVENTS_STORAGE_KEY = "dsa-tracker-completion-events-v1";
const DAILY_TARGET_STORAGE_KEY = "dsa-tracker-daily-target-v1";
const STUDY_TIME_STORAGE_KEY = "dsa-tracker-study-time-v1";
const PROGRESS_COLLECTION = "users";
const PROBLEMS_PER_BATCH = 20;
const topics = ["All topics", ...new Set(initialProblems.map((p) => p.topic))];
const learningGoals = [
  { title: "Master core patterns", detail: "Build strong foundations in arrays, strings, and hashmaps.", icon: Target },
  { title: "Grow problem-solving confidence", detail: "Take on medium problems and learn to recognize patterns.", icon: TrendingUp },
  { title: "Make steady progress", detail: "Practice one problem at a time and revisit what you learn.", icon: Flame }
];

function getProgressDocument(uid) {
  return doc(db, PROGRESS_COLLECTION, uid, "tracker", "progress");
}

function logSyncError(operation, uid, error) {
  console.error("[Firestore sync] Operation failed.", {
    operation,
    documentPath: `${PROGRESS_COLLECTION}/${uid}/tracker/progress`,
    firebaseProjectId: db.app.options.projectId,
    authenticatedUid: auth.currentUser?.uid ?? null,
    targetUid: uid,
    errorCode: error?.code ?? "unknown",
    errorMessage: error?.message ?? String(error)
  });
}

function getFirestoreSyncErrorMessage(operation, uid, error) {
  if (error?.code === "permission-denied") {
    return `Firestore denied the ${operation} at ${PROGRESS_COLLECTION}/${uid}/tracker/progress. Signed-in UID: ${auth.currentUser?.uid ?? "none"}; Firebase project: ${db.app.options.projectId}. Check that this project's published rules allow request.auth.uid == userId at /users/{userId}/tracker/progress.`;
  }
  return `Firestore ${operation} failed (${error?.code ?? "unknown"}): ${error?.message ?? String(error)}`;
}

function readProgress() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readPracticeDates() {
  try {
    const saved = localStorage.getItem(PRACTICE_DATES_STORAGE_KEY);
    const dates = saved ? JSON.parse(saved) : [];
    return Array.isArray(dates) ? [...new Set(dates.filter(isDateKey))] : [];
  } catch {
    return [];
  }
}

function readCompletionDates() {
  try {
    const saved = localStorage.getItem(COMPLETION_DATES_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    const problemIds = new Set(initialProblems.map((problem) => String(problem.id)));
    const datesByProblem = {};

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, dates] of Object.entries(parsed)) {
        if (problemIds.has(id) && Array.isArray(dates)) {
          datesByProblem[id] = [...new Set(dates.filter(isDateKey))];
        }
      }
    }

    return datesByProblem;
  } catch {
    return {};
  }
}

function readCompletionEvents() {
  try {
    const saved = localStorage.getItem(COMPLETION_EVENTS_STORAGE_KEY);
    const events = saved ? JSON.parse(saved) : [];
    const problemIds = new Set(initialProblems.map((problem) => problem.id));
    const seenEventIds = new Set();
    return Array.isArray(events) ? events.filter((event) => {
      if (
        !event
        || typeof event.id !== "string"
        || seenEventIds.has(event.id)
        || !problemIds.has(Number(event.problemId))
        || typeof event.completedAt !== "string"
        || !Number.isFinite(Date.parse(event.completedAt))
        || !isDateKey(event.date)
      ) return false;
      seenEventIds.add(event.id);
      return true;
    }) : [];
  } catch {
    return [];
  }
}

function readDailyTarget() {
  try {
    const saved = Number(localStorage.getItem(DAILY_TARGET_STORAGE_KEY));
    return Number.isSafeInteger(saved) && saved > 0 ? saved : 5;
  } catch {
    return 5;
  }
}

function getSessionElapsed(session, now = Date.now()) {
  if (!session) return 0;
  return session.elapsedMs + (session.startedAt === null ? 0 : Math.max(0, now - session.startedAt));
}

function readStudyTime() {
  try {
    const saved = localStorage.getItem(STUDY_TIME_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    const problemIds = new Set(initialProblems.map((problem) => problem.id));
    const totals = {};

    if (parsed.totals && typeof parsed.totals === "object" && !Array.isArray(parsed.totals)) {
      for (const [id, value] of Object.entries(parsed.totals)) {
        const problemId = Number(id);
        if (problemIds.has(problemId) && Number.isFinite(value) && value >= 0) {
          totals[problemId] = value;
        }
      }
    }

    const dailyTotals = {};
    if (parsed.dailyTotals && typeof parsed.dailyTotals === "object" && !Array.isArray(parsed.dailyTotals)) {
      for (const [date, milliseconds] of Object.entries(parsed.dailyTotals)) {
        if (isDateKey(date) && Number.isFinite(milliseconds) && milliseconds >= 0) {
          dailyTotals[date] = milliseconds;
        }
      }
    }

    const savedSession = parsed.session;
    const session = savedSession
      && problemIds.has(savedSession.problemId)
      && Number.isFinite(savedSession.elapsedMs)
      && savedSession.elapsedMs >= 0
      ? { problemId: savedSession.problemId, elapsedMs: savedSession.elapsedMs, startedAt: null }
      : null;

    return { totals, dailyTotals, session };
  } catch {
    return { totals: {}, dailyTotals: {}, session: null };
  }
}

function formatStudyTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${String(totalMinutes).padStart(2, "0")}:${seconds}`;
}

function getStreakStats(practiceDates, today) {
  const practiceDays = [...new Set(practiceDates.filter(isDateKey))]
    .map((date) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000)
    .sort((a, b) => a - b);
  const practiceDaySet = new Set(practiceDays);
  const todayNumber = Date.parse(`${today}T00:00:00.000Z`) / 86_400_000;

  let currentDay = practiceDaySet.has(todayNumber) ? todayNumber : todayNumber - 1;
  let current = 0;
  while (practiceDaySet.has(currentDay)) {
    current += 1;
    currentDay -= 1;
  }

  let best = 0;
  let run = 0;
  let previousDay = null;
  for (const day of practiceDays) {
    run = previousDay !== null && day === previousDay + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previousDay = day;
  }

  return { current, best };
}

function normalizeCloudProgress(value) {
  const problemIds = new Set(initialProblems.map((problem) => problem.id));
  const completed = {};
  if (value.completed && typeof value.completed === "object" && !Array.isArray(value.completed)) {
    for (const [id, status] of Object.entries(value.completed)) {
      if (problemIds.has(Number(id)) && typeof status === "boolean") completed[id] = status;
    }
  }

  const completionDates = {};
  if (value.completionDates && typeof value.completionDates === "object" && !Array.isArray(value.completionDates)) {
    for (const [id, dates] of Object.entries(value.completionDates)) {
      if (problemIds.has(Number(id)) && Array.isArray(dates)) {
        completionDates[id] = [...new Set(dates.filter(isDateKey))];
      }
    }
  }

  const completionEvents = [];
  const seenEventIds = new Set();
  if (Array.isArray(value.completionEvents)) {
    for (const event of value.completionEvents) {
      if (
        event
        && typeof event.id === "string"
        && !seenEventIds.has(event.id)
        && problemIds.has(Number(event.problemId))
        && typeof event.completedAt === "string"
        && Number.isFinite(Date.parse(event.completedAt))
        && isDateKey(event.date)
      ) {
        seenEventIds.add(event.id);
        completionEvents.push({
          id: event.id,
          problemId: Number(event.problemId),
          completedAt: event.completedAt,
          date: event.date
        });
      }
    }
  }

  const totals = {};
  const rawTotals = value.studyData?.totals;
  if (rawTotals && typeof rawTotals === "object" && !Array.isArray(rawTotals)) {
    for (const [id, milliseconds] of Object.entries(rawTotals)) {
      if (problemIds.has(Number(id)) && Number.isFinite(milliseconds) && milliseconds >= 0) {
        totals[id] = milliseconds;
      }
    }
  }

  const dailyTotals = {};
  const rawDailyTotals = value.studyData?.dailyTotals;
  if (rawDailyTotals && typeof rawDailyTotals === "object" && !Array.isArray(rawDailyTotals)) {
    for (const [date, milliseconds] of Object.entries(rawDailyTotals)) {
      if (isDateKey(date) && Number.isFinite(milliseconds) && milliseconds >= 0) {
        dailyTotals[date] = milliseconds;
      }
    }
  }

  const savedSession = value.studyData?.session;
  const session = savedSession
    && problemIds.has(savedSession.problemId)
    && Number.isFinite(savedSession.elapsedMs)
    && savedSession.elapsedMs >= 0
    ? { problemId: savedSession.problemId, elapsedMs: savedSession.elapsedMs, startedAt: null }
    : null;

  return {
    schemaVersion: 1,
    completed,
    practiceDates: Array.isArray(value.practiceDates)
      ? [...new Set(value.practiceDates.filter(isDateKey))]
      : [],
    completionDates,
    completionEvents,
    dailyTarget: Number.isSafeInteger(value.dailyTarget) && value.dailyTarget > 0 ? value.dailyTarget : 5,
    studyData: { totals, dailyTotals, session }
  };
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [progressLoadedUid, setProgressLoadedUid] = useState(null);
  const [syncReadyUid, setSyncReadyUid] = useState(null);
  const [syncStatus, setSyncStatus] = useState("Synced");
  const [syncError, setSyncError] = useState("");
  const [syncConflict, setSyncConflict] = useState(false);
  const [syncHeartbeat, setSyncHeartbeat] = useState(0);
  const [networkRevision, setNetworkRevision] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [completed, setCompleted] = useState(readProgress);
  const [practiceDates, setPracticeDates] = useState(readPracticeDates);
  const [completionDates, setCompletionDates] = useState(readCompletionDates);
  const [completionEvents, setCompletionEvents] = useState(readCompletionEvents);
  const [dailyTarget, setDailyTarget] = useState(readDailyTarget);
  const [dailyTargetDraft, setDailyTargetDraft] = useState(() => String(readDailyTarget()));
  const [studyData, setStudyData] = useState(readStudyTime);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [today, setToday] = useState(() => getLocalDateKey());
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("All topics");
  const [difficulty, setDifficulty] = useState("All levels");
  const [activeView, setActiveView] = useState("Dashboard");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [visibleProblemCount, setVisibleProblemCount] = useState(PROBLEMS_PER_BATCH);
  const profileName = authUser?.displayName || authUser?.email?.split("@")[0] || "DSA learner";
  const profileInitials = profileName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const currentProgress = {
    completed,
    practiceDates,
    completionDates,
    completionEvents,
    dailyTarget,
    studyData
  };
  const progressRef = useRef(currentProgress);
  progressRef.current = currentProgress;
  const syncedFingerprintRef = useRef(null);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setAuthUser(user);
    setAuthLoading(false);
    setProgressLoadedUid(null);
    setSyncReadyUid(null);
    setSyncError("");
    setSyncConflict(false);
    setSyncStatus(user ? "Saving…" : "Synced");
  }, (error) => {
    setAuthLoading(false);
    console.error("[Firebase auth] Authentication state listener failed.", error);
    setSyncError(`Firebase Authentication error (${error.code ?? "unknown"}): ${error.message}`);
    setSyncStatus("Sync failed");
  }), []);

  useEffect(() => {
    if (!authUser) return undefined;
    const progressRefForUser = getProgressDocument(authUser.uid);
    let initialized = false;
    let active = true;
    const localFallback = window.setTimeout(() => {
      if (!active || initialized) return;
      setProgressLoadedUid(authUser.uid);
      setSyncStatus((status) => status === "Sync failed" ? status : navigator.onLine ? "Saving…" : "Offline");
    }, 5000);
    setSyncStatus(navigator.onLine ? "Saving…" : "Offline");

    function applyProgress(progress) {
      setCompleted(progress.completed);
      setPracticeDates(progress.practiceDates);
      setCompletionDates(progress.completionDates);
      setCompletionEvents(progress.completionEvents);
      setDailyTarget(progress.dailyTarget);
      setDailyTargetDraft(String(progress.dailyTarget));
      setStudyData({
        totals: progress.studyData.totals,
        dailyTotals: progress.studyData.dailyTotals || {},
        session: progress.studyData.session
          ? { ...progress.studyData.session, startedAt: null }
          : null
      });
    }

    const unsubscribe = onSnapshot(progressRefForUser, { includeMetadataChanges: true }, async (snapshot) => {
      if (!active) return;
      if (snapshot.metadata.fromCache) {
        setSyncStatus(navigator.onLine ? "Saving…" : "Offline");
        return;
      }

      const owner = (() => {
        try {
          return localStorage.getItem(LOCAL_MIGRATION_OWNER_KEY);
        } catch {
          return null;
        }
      })();
      const canMigrateLocal = !owner || owner === authUser.uid;
      const localProgress = createProgressSnapshot(progressRef.current);
      const cloudProgress = snapshot.exists() ? normalizeCloudProgress(snapshot.data()) : null;
      const emptyProgress = normalizeCloudProgress({});
      let selectedProgress = cloudProgress
        ? canMigrateLocal
          ? mergeProgress(cloudProgress, localProgress).progress
          : cloudProgress
        : canMigrateLocal ? localProgress : emptyProgress;
      const fingerprint = progressFingerprint(selectedProgress);
      const cloudFingerprint = cloudProgress ? progressFingerprint(cloudProgress) : null;
      if (initialized && cloudFingerprint === syncedFingerprintRef.current) return;
      const needsWrite = !cloudProgress || fingerprint !== cloudFingerprint;

      if (cloudProgress && canMigrateLocal && hasLocalProgress(localProgress)) {
        const { conflicts } = mergeProgress(cloudProgress, localProgress);
        if (conflicts.length) {
          setSyncConflict(true);
          try {
            localStorage.setItem(
              `${LOCAL_CONFLICT_BACKUP_PREFIX}${authUser.uid}`,
              JSON.stringify({ savedAt: new Date().toISOString(), fields: conflicts, progress: localProgress })
            );
            setSyncStatus("Sync conflict preserved locally");
          } catch (error) {
            setSyncError(`Conflicting local progress could not be backed up: ${error.message}`);
            setSyncStatus("Sync failed");
            return;
          }
        }
      }

      if (!initialized || progressFingerprint(createProgressSnapshot(progressRef.current)) !== fingerprint) {
        applyProgress(selectedProgress);
      }
      initialized = true;
      window.clearTimeout(localFallback);
      setProgressLoadedUid(authUser.uid);
      setSyncReadyUid(authUser.uid);
      syncedFingerprintRef.current = cloudFingerprint;

      if (!canMigrateLocal && !cloudProgress) {
        setSyncStatus("Synced");
        return;
      }
      if (needsWrite) {
        setSyncStatus("Saving…");
        syncedFingerprintRef.current = fingerprint;
        try {
          await setDoc(progressRefForUser, {
            ...selectedProgress,
            updatedAt: Date.now()
          });
          if (!active) return;
          try {
            localStorage.setItem(LOCAL_MIGRATION_OWNER_KEY, authUser.uid);
          } catch {
            setSyncError("Progress synced, but the local migration marker could not be saved.");
          }
          setSyncStatus("Synced");
        } catch (error) {
          if (!active) return;
          syncedFingerprintRef.current = null;
          logSyncError("initial progress write", authUser.uid, error);
          setSyncError(getFirestoreSyncErrorMessage("initial progress write", authUser.uid, error));
          setSyncStatus(navigator.onLine ? "Sync failed" : "Offline");
        }
      } else {
        if (canMigrateLocal) {
          try {
            localStorage.setItem(LOCAL_MIGRATION_OWNER_KEY, authUser.uid);
          } catch {
            setSyncError("Progress loaded, but the local migration marker could not be saved.");
          }
        }
        setSyncStatus("Synced");
      }
    }, (error) => {
      if (!active) return;
      logSyncError("progress listener", authUser.uid, error);
      setSyncError(getFirestoreSyncErrorMessage("progress read (snapshot listener)", authUser.uid, error));
      setSyncStatus(navigator.onLine ? "Sync failed" : "Offline");
    });

    const handleOffline = () => setSyncStatus("Offline");
    const handleOnline = () => {
      setSyncStatus("Saving…");
      setNetworkRevision((revision) => revision + 1);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      active = false;
      window.clearTimeout(localFallback);
      unsubscribe();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser || syncReadyUid !== authUser.uid) return undefined;
    const progress = createProgressSnapshot(currentProgress);
    const fingerprint = progressFingerprint(progress);
    if (fingerprint === syncedFingerprintRef.current) return undefined;

    const timeout = window.setTimeout(async () => {
      if (!auth.currentUser || auth.currentUser.uid !== authUser.uid) return;
      setSyncStatus(navigator.onLine ? "Saving…" : "Offline");
      syncedFingerprintRef.current = fingerprint;
      try {
        await setDoc(getProgressDocument(authUser.uid), {
          ...progress,
          updatedAt: Date.now()
        });
        if (auth.currentUser?.uid !== authUser.uid) return;
        try {
          localStorage.setItem(LOCAL_MIGRATION_OWNER_KEY, authUser.uid);
        } catch {
          setSyncError("Progress synced, but the local migration marker could not be saved.");
        }
        setSyncError("");
        setSyncStatus("Synced");
      } catch (error) {
        syncedFingerprintRef.current = null;
        if (auth.currentUser?.uid !== authUser.uid) return;
        logSyncError("progress update", authUser.uid, error);
        setSyncError(getFirestoreSyncErrorMessage("progress update", authUser.uid, error));
        setSyncStatus(navigator.onLine ? "Sync failed" : "Offline");
      }
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [authUser, syncReadyUid, completed, practiceDates, completionDates, completionEvents, dailyTarget, studyData, syncHeartbeat, networkRevision]);

  useEffect(() => {
    if (!studyData.session?.startedAt) return undefined;
    const interval = window.setInterval(() => setSyncHeartbeat((value) => value + 1), 30_000);
    return () => window.clearInterval(interval);
  }, [studyData.session]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    } catch {
      // The tracker still works for the current session if storage is unavailable.
    }
  }, [completed]);

  useEffect(() => {
    try {
      localStorage.setItem(PRACTICE_DATES_STORAGE_KEY, JSON.stringify(practiceDates));
    } catch {
      // The streak remains available for the current session if storage is unavailable.
    }
  }, [practiceDates]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPLETION_DATES_STORAGE_KEY, JSON.stringify(completionDates));
    } catch {
      // Completion dates remain available for the current session if storage is unavailable.
    }
  }, [completionDates]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPLETION_EVENTS_STORAGE_KEY, JSON.stringify(completionEvents));
    } catch {
      // Completion events remain available for the current session if storage is unavailable.
    }
  }, [completionEvents]);

  useEffect(() => {
    try {
      localStorage.setItem(DAILY_TARGET_STORAGE_KEY, String(dailyTarget));
    } catch {
      // The selected target remains available for the current session if storage is unavailable.
    }
  }, [dailyTarget]);

  useEffect(() => {
    try {
      const session = studyData.session
        ? { ...studyData.session, elapsedMs: getSessionElapsed(studyData.session, clockNow), startedAt: null }
        : null;
      const dailyTotals = studyData.session?.startedAt === null || studyData.session?.startedAt === undefined
        ? studyData.dailyTotals || {}
        : addTimerIntervalToDailyTotals(studyData.dailyTotals || {}, studyData.session.startedAt, clockNow);
      localStorage.setItem(STUDY_TIME_STORAGE_KEY, JSON.stringify({ totals: studyData.totals, dailyTotals, session }));
    } catch {
      // Study timing remains available for the current session if storage is unavailable.
    }
  }, [studyData, clockNow]);

  useEffect(() => {
    if (!studyData.session?.startedAt) return undefined;
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [studyData.session]);

  useEffect(() => {
    const updateToday = () => setToday(getLocalDateKey());
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 0, 0);
    const timeout = window.setTimeout(updateToday, nextMidnight.getTime() - Date.now());
    document.addEventListener("visibilitychange", updateToday);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", updateToday);
    };
  }, [today]);

  useEffect(() => {
    setVisibleProblemCount(PROBLEMS_PER_BATCH);
  }, [query, topic, difficulty, activeView]);

  const problems = useMemo(
    () => initialProblems.map((problem) => ({ ...problem, completed: Boolean(completed[problem.id]) })),
    [completed]
  );
  const solvedCount = problems.filter((p) => p.completed).length;
  const progress = problems.length ? Math.round((solvedCount / problems.length) * 100) : 0;
  const easySolved = problems.filter((p) => p.completed && p.difficulty === "Easy").length;
  const mediumSolved = problems.filter((p) => p.completed && p.difficulty === "Medium").length;
  const hardSolved = problems.filter((p) => p.completed && p.difficulty === "Hard").length;
  const streak = getStreakStats(practiceDates, today);
  const dailyCompletedCount = problems.filter(
    (problem) => problem.completed && completionDates[problem.id]?.includes(today)
  ).length;
  const dailyProgress = Math.round((dailyCompletedCount / dailyTarget) * 100);
  const dailyProgressWidth = Math.min(dailyProgress, 100);
  const dailyTargetReached = dailyCompletedCount >= dailyTarget;
  const activeTimerProblem = studyData.session
    ? initialProblems.find((problem) => problem.id === studyData.session.problemId)
    : null;
  const activeTimerElapsed = getSessionElapsed(studyData.session, clockNow);
  const analytics = useMemo(() => calculateAnalytics({
    problems: initialProblems,
    completed,
    completionDates,
    completionEvents,
    practiceDates,
    studyData,
    dailyTarget,
    today,
    now: clockNow
  }), [completed, completionDates, completionEvents, practiceDates, studyData, dailyTarget, today, clockNow]);

  const filteredProblems = problems.filter((p) => {
    const matchesQuery = p.title.toLowerCase().includes(query.toLowerCase().trim());
    const matchesTopic = topic === "All topics" || p.topic === topic;
    const matchesDifficulty = difficulty === "All levels" || p.difficulty === difficulty;
    const matchesView = activeView !== "Completed" || p.completed;
    return matchesQuery && matchesTopic && matchesDifficulty && matchesView;
  });
  const visibleProblems = filteredProblems.slice(0, visibleProblemCount);
  const remainingProblemCount = filteredProblems.length - visibleProblems.length;
  const nextBatchSize = Math.min(PROBLEMS_PER_BATCH, remainingProblemCount);

  function toggleProblem(id) {
    const isCompleting = !completed[id];
    const completedAt = new Date();
    const practiceDate = getLocalDateKey(completedAt);
    if (isCompleting) {
      setPracticeDates((dates) => dates.includes(practiceDate) ? dates : [...dates, practiceDate]);
      const event = {
        id: globalThis.crypto?.randomUUID?.() || `completion-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        problemId: id,
        completedAt: completedAt.toISOString(),
        date: practiceDate
      };
      setCompletionEvents((events) => [...events, event]);
    }
    setCompleted((current) => ({ ...current, [id]: isCompleting }));
    setCompletionDates((current) => {
      const dates = current[id] || [];
      const updatedDates = isCompleting
        ? [...new Set([...dates, practiceDate])]
        : dates;
      return { ...current, [id]: updatedDates };
    });
  }

  function saveDailyTarget(event) {
    event.preventDefault();
    const target = Number(dailyTargetDraft);
    if (!Number.isSafeInteger(target) || target < 1) return;
    setDailyTarget(target);
    setDailyTargetDraft(String(target));
  }

  function startStudyTimer(problemId) {
    const now = Date.now();
    setClockNow(now);
    setStudyData((current) => {
      const session = current.session;
      if (session?.problemId === problemId) {
        if (session.startedAt !== null) return current;
        return { ...current, session: { ...session, startedAt: now } };
      }

      const dailyTotals = !session || session.startedAt === null
        ? current.dailyTotals || {}
        : addTimerIntervalToDailyTotals(current.dailyTotals || {}, session.startedAt, now);
      const totals = session
        ? {
            ...current.totals,
            [session.problemId]: (current.totals[session.problemId] || 0) + getSessionElapsed(session, now)
          }
        : current.totals;

      return { totals, dailyTotals, session: { problemId, elapsedMs: 0, startedAt: now } };
    });
  }

  function pauseStudyTimer() {
    const now = Date.now();
    setClockNow(now);
    setStudyData((current) => {
      if (!current.session || current.session.startedAt === null) return current;
      const dailyTotals = addTimerIntervalToDailyTotals(
        current.dailyTotals || {},
        current.session.startedAt,
        now
      );
      return {
        ...current,
        dailyTotals,
        session: { ...current.session, elapsedMs: getSessionElapsed(current.session, now), startedAt: null }
      };
    });
  }

  function stopStudyTimer() {
    const now = Date.now();
    setClockNow(now);
    setStudyData((current) => {
      if (!current.session) return current;
      const { session } = current;
      const dailyTotals = session.startedAt === null
        ? current.dailyTotals || {}
        : addTimerIntervalToDailyTotals(current.dailyTotals || {}, session.startedAt, now);
      return {
        totals: {
          ...current.totals,
          [session.problemId]: (current.totals[session.problemId] || 0) + getSessionElapsed(session, now)
        },
        dailyTotals,
        session: null
      };
    });
  }

  function resetProgress() {
    if (window.confirm("Reset all completed problems? This cannot be undone.")) {
      setCompleted({});
    }
  }

  function chooseView(view) {
    setActiveView(view);
    if (view === "Topics") {
      setTopic("All topics");
      document.getElementById("problem-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (view === "Completed") {
      document.getElementById("problem-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (view === "Dashboard") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (view === "Analytics") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function logout() {
    setLoggingOut(true);
    setSyncError("");
    try {
      await signOut(auth);
    } catch (error) {
      setSyncError(error.message);
      setSyncStatus("Sync failed");
    } finally {
      setLoggingOut(false);
    }
  }

  if (authLoading) {
    return <main className="auth-loading"><LoaderCircle size={24} className="auth-spinner" /><span>Checking your account…</span></main>;
  }
  if (!authUser) return <AuthScreen />;
  if (progressLoadedUid !== authUser.uid) {
    return <main className="auth-loading"><LoaderCircle size={24} className="auth-spinner" /><span>Loading your saved progress…</span></main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); chooseView("Dashboard"); }}>
          <span className="brand-mark"><Code2 size={21} /></span>
          <span>algo<span className="brand-accent">path</span><small>DSA WORKSPACE</small></span>
        </a>

        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={activeView === "Dashboard" ? "nav-item active" : "nav-item"} onClick={() => chooseView("Dashboard")}><LayoutDashboard size={18} /> Dashboard</button>
          <button className={activeView === "Analytics" ? "nav-item active" : "nav-item"} onClick={() => chooseView("Analytics")}><Activity size={18} /> Analytics</button>
          <button className={activeView === "Topics" ? "nav-item active" : "nav-item"} onClick={() => chooseView("Topics")}><BookOpen size={18} /> Topics</button>
          <button className={activeView === "Completed" ? "nav-item active" : "nav-item"} onClick={() => chooseView("Completed")}><ListChecks size={18} /> Completed <span className="nav-count">{solvedCount}</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon"><Sparkles size={16} /></span>
            <strong>Small steps. Big progress.</strong>
            <p>Consistency beats cramming. Try to solve one problem today.</p>
          </div>
          <div className="profile-row">
            <div className="avatar">SV</div>
            <div className="profile-copy"><strong>{profileName}</strong><span>{authUser.email}</span></div>
            <button className="logout-button" type="button" onClick={logout} disabled={loggingOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <a className="mobile-header-brand" href="#" onClick={(event) => { event.preventDefault(); chooseView("Dashboard"); }}>
            <span className="brand-mark"><Code2 size={18} /></span>
            <span>AlgoPath</span>
          </a>
          <div className="breadcrumb">Workspace <span>/</span> <strong>{activeView}</strong></div>
          <div className="topbar-right">
            <span className={`local-pill sync-pill${syncStatus === "Sync failed" ? " sync-failed" : ""}`} title={syncError || undefined}>
              <span className={`status-dot ${syncStatus === "Offline" ? "offline-dot" : syncStatus === "Sync failed" ? "failed-dot" : ""}`} />
              {syncConflict ? "Sync conflict preserved locally" : syncStatus}
            </span>
            <span className="account-email">{authUser.email}</span>
            <button className="topbar-logout" type="button" onClick={logout} disabled={loggingOut} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
            <button className="help-button" title="Help" aria-label="Help"><CircleHelp size={19} /></button>
            <div className="mobile-profile">
              <button
                className="mobile-profile-avatar"
                type="button"
                aria-label={`Open profile menu for ${profileName}`}
                aria-expanded={profileMenuOpen}
                aria-controls="mobile-profile-menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                {profileInitials}
              </button>
              {profileMenuOpen && <div className="mobile-profile-menu" id="mobile-profile-menu">
                <strong>{profileName}</strong>
                <span>{authUser.email}</span>
                <button type="button" onClick={logout} disabled={loggingOut}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>}
            </div>
          </div>
        </header>

        <div className="page-content">
          {syncError && <p className="sync-error-message" role="alert">
            Cloud sync issue: {syncError} Your progress remains saved locally and will retry after you make another change or reconnect.
          </p>}
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR DSA JOURNEY</div>
              <h1>{activeView === "Analytics" ? "Your progress, in focus." : activeView === "Completed" ? "Your wins, in one place." : activeView === "Topics" ? "Explore by topic." : `Welcome back, ${profileName.split(" ")[0]}.`}</h1>
              <p className="page-subtitle">{activeView === "Analytics" ? "Explore your study patterns, celebrate consistency, and find your next focus." : "One problem at a time. Track your progress, spot your gaps, keep moving."}</p>
            </div>
            <div className="date-chip"><Activity size={16} /> Your practice space</div>
          </section>

          {activeView === "Dashboard" && <section className="goals-section" aria-labelledby="learning-goals-heading">
            <div className="section-heading goals-heading">
              <div><h2 id="learning-goals-heading">Your learning goals</h2><p>A few milestones to guide your DSA journey.</p></div>
            </div>
            <div className="learning-goals-grid">
              {learningGoals.map(({ title, detail, icon: Icon }) => (
                <article className="learning-goal" key={title}>
                  <span className="goal-icon"><Icon size={17} /></span>
                  <div><h3>{title}</h3><p>{detail}</p></div>
                </article>
              ))}
            </div>
          </section>}

          {activeView === "Analytics" && <AnalyticsDashboard analytics={analytics} today={today} syncError={syncError} />}

          {activeView !== "Analytics" && <section className="stats-grid" aria-label="Progress summary">
            <article className="stat-card primary-stat">
              <div className="stat-top"><span className="stat-label">Problems solved</span><span className="stat-icon purple"><Target size={18} /></span></div>
              <div className="stat-value">{solvedCount}<span> / {problems.length}</span></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
              <div className="stat-foot"><span>{progress}% complete</span><span className="trend-label"><TrendingUp size={13} /> Keep going</span></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span className="stat-label">Easy completed</span><span className="stat-icon green"><Check size={18} /></span></div>
              <div className="stat-value">{easySolved.toString().padStart(2, "0")}</div>
              <div className="stat-foot"><span className="muted">Build your foundations</span><span className="mini-dot green-dot" /></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span className="stat-label">Medium completed</span><span className="stat-icon orange"><Activity size={18} /></span></div>
              <div className="stat-value">{mediumSolved.toString().padStart(2, "0")}</div>
              <div className="stat-foot"><span className="muted">Stretch your thinking</span><span className="mini-dot orange-dot" /></div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span className="stat-label">Practice streak</span><span className="stat-icon pink"><Flame size={18} /></span></div>
              <div className="stat-value">{streak.current}<span>{streak.current === 1 ? " day" : " days"}</span></div>
              <div className="stat-foot">
                <span className="muted">Longest: {streak.best} {streak.best === 1 ? "day" : "days"}</span>
                <span className="muted">Today: {dailyCompletedCount}</span>
              </div>
            </article>
          </section>}

          {activeView === "Dashboard" && <section className="daily-target-card" aria-labelledby="daily-target-heading">
            <div className="daily-target-main">
              <div className="daily-target-heading">
                <span className="daily-target-icon"><Target size={19} /></span>
                <div>
                  <h2 id="daily-target-heading">Daily problem target</h2>
                  <p>{dailyTargetReached ? "You reached your goal for today." : "A little progress every day adds up."}</p>
                </div>
              </div>
              <div className="daily-target-progress-copy">
                <strong>{dailyCompletedCount} of {dailyTarget} problems completed</strong>
                <span>{dailyProgress}%</span>
              </div>
              <div
                className="daily-target-track"
                role="progressbar"
                aria-label="Today's problem target progress"
                aria-valuemin="0"
                aria-valuemax={dailyTarget}
                aria-valuenow={Math.min(dailyCompletedCount, dailyTarget)}
                aria-valuetext={`${dailyCompletedCount} of ${dailyTarget} problems completed`}
              >
                <div className="daily-target-fill" style={{ width: `${dailyProgressWidth}%` }} />
              </div>
              <div className="daily-target-foot">
                <span>{dailyTargetReached ? <><Sparkles size={14} /> Daily target reached. Great work!</> : `${Math.max(dailyTarget - dailyCompletedCount, 0)} more to reach today's goal`}</span>
              </div>
            </div>
            <form className="daily-target-control" onSubmit={saveDailyTarget}>
              <label htmlFor="daily-target-input">Daily goal</label>
              <div className="daily-target-presets" aria-label="Choose a daily goal">
                {[3, 5, 10].map((target) => (
                  <button
                    key={target}
                    className={dailyTarget === target ? "target-preset active" : "target-preset"}
                    type="button"
                    onClick={() => { setDailyTarget(target); setDailyTargetDraft(String(target)); }}
                    aria-pressed={dailyTarget === target}
                  >
                    {target}
                  </button>
                ))}
              </div>
              <div className="daily-target-custom">
                <input
                  id="daily-target-input"
                  type="number"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  step="1"
                  required
                  value={dailyTargetDraft}
                  onChange={(event) => setDailyTargetDraft(event.target.value)}
                  aria-describedby="daily-target-help"
                />
                <button type="submit">Set goal</button>
              </div>
              <span id="daily-target-help" className="daily-target-help">Set any whole number of problems.</span>
            </form>
          </section>}

          {activeView !== "Analytics" && <section className="topic-section">
            <div className="section-heading">
              <div><h2>Topic progress</h2><p>See where you've put in the work.</p></div>
              <div className="topic-actions">
                <button className="text-button" onClick={() => setShowAllTopics((current) => !current)} aria-expanded={showAllTopics}>
                  {showAllTopics ? "Show fewer topics" : `Show all ${topics.length - 1} topics`}
                </button>
                <button className="text-button" onClick={() => { setActiveView("Topics"); document.getElementById("problem-list")?.scrollIntoView({ behavior: "smooth" }); }}>Browse problems <span>→</span></button>
              </div>
            </div>
            <div className="topic-grid">
              {(showAllTopics ? topics.slice(1) : topics.slice(1, 7)).map((t, index) => {
                const topicProblems = problems.filter((p) => p.topic === t);
                const topicSolved = topicProblems.filter((p) => p.completed).length;
                const topicPercent = topicProblems.length ? Math.round(topicSolved / topicProblems.length * 100) : 0;
                const icons = [Code2, Activity, Target, TrendingUp, BookOpen, ListChecks];
                const Icon = icons[index % icons.length];
                return (
                  <button className="topic-card" key={t} onClick={() => { setTopic(t); setActiveView("Topics"); document.getElementById("problem-list")?.scrollIntoView({ behavior: "smooth" }); }}>
                    <div className={`topic-icon topic-color-${index % 6}`}><Icon size={18} /></div>
                    <div className="topic-card-title">{t}<span>{topicSolved}/{topicProblems.length}</span></div>
                    <div className="topic-track"><div style={{ width: `${topicPercent}%` }} /></div>
                    <div className="topic-card-foot">{topicPercent}% complete <span>→</span></div>
                  </button>
                );
              })}
            </div>
          </section>}

          {activeView !== "Analytics" && <section className="problem-section" id="problem-list">
            <div className="section-heading problem-heading">
              <div><h2>{activeView === "Completed" ? "Completed problems" : activeView === "Topics" ? "Problems by topic" : "LeetCode practice collection"}</h2><p>Search and filter by topic or difficulty, then mark your progress.</p></div>
              <span className="problem-total">{filteredProblems.length} problems</span>
            </div>
            {activeTimerProblem && <div className="active-timer-banner" role="status" aria-live="polite">
              <div>
                <span className="active-timer-indicator" />
                <strong>{studyData.session.startedAt === null ? "Timer paused" : "Timer running"}</strong>
                <span className="active-timer-problem">{activeTimerProblem.title}</span>
                <span className="active-timer-clock">{formatStudyTime(activeTimerElapsed)}</span>
              </div>
              <div className="study-controls">
                {studyData.session.startedAt === null
                  ? <button className="study-control-button resume" onClick={() => startStudyTimer(activeTimerProblem.id)}><Play size={13} /> Resume</button>
                  : <button className="study-control-button pause" onClick={pauseStudyTimer}><Pause size={13} /> Pause</button>}
                <button className="study-control-button stop" onClick={stopStudyTimer}><Square size={12} /> Stop</button>
              </div>
            </div>}

            <div className="filter-bar">
              <label className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search problems..." aria-label="Search problems" />{query && <button onClick={() => setQuery("")} aria-label="Clear search" className="clear-search"><X size={14} /></button>}</label>
              <div className="filter-controls">
                <label className="select-wrap"><select aria-label="Filter by topic" value={topic} onChange={(e) => setTopic(e.target.value)}>{topics.map((t) => <option key={t}>{t}</option>)}</select><ChevronDown size={15} /></label>
                <label className="select-wrap"><select aria-label="Filter by difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option>All levels</option><option>Easy</option><option>Medium</option><option>Hard</option></select><ChevronDown size={15} /></label>
                <button className="filter-reset" onClick={() => { setQuery(""); setTopic("All topics"); setDifficulty("All levels"); setActiveView("Dashboard"); }}>Reset</button>
              </div>
              <button className="mobile-filter-toggle" onClick={() => setShowMobileFilters(!showMobileFilters)}><Settings2 size={16} /> Filters</button>
            </div>

            {showMobileFilters && <div className="mobile-filters">
              <label>Topic<select value={topic} onChange={(e) => setTopic(e.target.value)}>{topics.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>Difficulty<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option>All levels</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
            </div>}

            <div className="problem-table-wrap">
              <table className="problem-table">
                <thead><tr><th className="check-column">STATUS</th><th>PROBLEM</th><th>TOPIC</th><th>DIFFICULTY</th><th>STUDY TIME</th><th className="link-column">LINK</th></tr></thead>
                <tbody>
                  {visibleProblems.map((p) => (
                    <tr key={p.id} className={`${p.completed ? "is-completed" : ""}${studyData.session?.problemId === p.id ? " has-active-timer" : ""}`}>
                      <td><button className={p.completed ? "completion-check checked" : "completion-check"} onClick={() => toggleProblem(p.id)} aria-label={`${p.completed ? "Mark incomplete" : "Mark complete"}: ${p.title}`} title={p.completed ? "Mark incomplete" : "Mark complete"}>{p.completed && <Check size={14} />}</button></td>
                      <td><span className="problem-title">{p.title}</span>{p.completed && <span className="completed-tag">DONE</span>}</td>
                      <td><span className="topic-pill">{p.topic}</span></td>
                      <td><span className={`difficulty ${p.difficulty.toLowerCase()}`}><span />{p.difficulty}</span></td>
                      <td className="study-time-cell">
                        <span className="study-time-value">{formatStudyTime((studyData.totals[p.id] || 0) + (studyData.session?.problemId === p.id ? activeTimerElapsed : 0))}</span>
                        <div className="study-controls">
                          {studyData.session?.problemId !== p.id
                            ? <button className="study-control-button start" onClick={() => startStudyTimer(p.id)}><Play size={13} /> Start</button>
                            : studyData.session.startedAt === null
                              ? <button className="study-control-button resume" onClick={() => startStudyTimer(p.id)}><Play size={13} /> Resume</button>
                              : <button className="study-control-button pause" onClick={pauseStudyTimer}><Pause size={13} /> Pause</button>}
                          {studyData.session?.problemId === p.id && <button className="study-control-button stop" onClick={stopStudyTimer}><Square size={12} /> Stop</button>}
                        </div>
                      </td>
                      <td><a className="external-link" href={p.url} target="_blank" rel="noreferrer" aria-label={`Open ${p.title} on LeetCode`}><ExternalLink size={16} /></a></td>
                    </tr>
                  ))}
                  {filteredProblems.length === 0 && <tr><td colSpan="6"><div className="empty-state"><Search size={22} /><strong>No problems found</strong><span>Try another search or reset your filters.</span><button onClick={() => { setQuery(""); setTopic("All topics"); setDifficulty("All levels"); setActiveView("Dashboard"); }}>Clear filters</button></div></td></tr>}
                </tbody>
              </table>
            </div>
            {remainingProblemCount > 0 && <button
              className="load-more-button"
              onClick={() => setVisibleProblemCount((count) => count + PROBLEMS_PER_BATCH)}
              aria-label={`Show next ${nextBatchSize} problems, ${remainingProblemCount} remaining`}
            >
              <span>Show next {nextBatchSize} problems</span>
              <span className="load-more-remaining">{remainingProblemCount} remaining</span>
              <ChevronDown size={17} aria-hidden="true" />
            </button>}
            <div className="table-footer"><span>Showing {visibleProblems.length} of {filteredProblems.length} matching problems</span><button onClick={resetProgress} className="reset-progress">Reset progress</button></div>
          </section>}

        </div>
        <footer className="app-footer">
          <strong className="footer-brand">SPYRA</strong>
          <p className="footer-tagline">Crafted with precision by SPYRA.</p>
          <p className="footer-description">Building digital experiences that move you forward.</p>
          <p className="footer-copyright">© {new Date().getFullYear()} SPYRA. All rights reserved.</p>
          <span className="footer-storage"><span className="footer-status" /> Data stored in this browser</span>
        </footer>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className={activeView === "Dashboard" ? "mobile-nav-active" : ""} onClick={() => chooseView("Dashboard")}><LayoutDashboard size={19} /><span>Home</span></button>
        <button className={activeView === "Analytics" ? "mobile-nav-active" : ""} onClick={() => chooseView("Analytics")}><Activity size={19} /><span>Analytics</span></button>
        <button className={activeView === "Topics" ? "mobile-nav-active" : ""} onClick={() => chooseView("Topics")}><BookOpen size={19} /><span>Topics</span></button>
        <button className={activeView === "Completed" ? "mobile-nav-active" : ""} onClick={() => chooseView("Completed")}><ListChecks size={19} /><span>Done</span></button>
      </nav>
    </div>
  );
}
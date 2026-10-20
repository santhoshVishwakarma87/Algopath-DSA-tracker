import { addTimerIntervalToDailyTotals } from "./analytics.js";

export const LOCAL_MIGRATION_OWNER_KEY = "dsa-tracker-migration-owner-v1";
export const LOCAL_CONFLICT_BACKUP_PREFIX = "dsa-tracker-conflict-backup-v1-";

export function createProgressSnapshot({
  completed, practiceDates, completionDates, completionEvents, dailyTarget, studyData
}) {
  const now = Date.now();
  const session = studyData.session
    ? {
        problemId: studyData.session.problemId,
        elapsedMs: studyData.session.elapsedMs
          + (studyData.session.startedAt === null ? 0 : Math.max(0, now - studyData.session.startedAt)),
        startedAt: null
      }
    : null;
  const dailyTotals = studyData.session?.startedAt === null || studyData.session?.startedAt === undefined
    ? studyData.dailyTotals || {}
    : addTimerIntervalToDailyTotals(studyData.dailyTotals || {}, studyData.session.startedAt, now);

  return {
    schemaVersion: 1,
    completed,
    practiceDates,
    completionDates,
    completionEvents: completionEvents || [],
    dailyTarget,
    studyData: { totals: studyData.totals, dailyTotals, session }
  };
}

export function hasLocalProgress(progress) {
  return Object.keys(progress.completed).length > 0
    || progress.practiceDates.length > 0
    || Object.keys(progress.completionDates).length > 0
    || (progress.completionEvents || []).length > 0
    || progress.dailyTarget !== 5
    || Object.values(progress.studyData.totals).some((milliseconds) => milliseconds > 0)
    || Object.values(progress.studyData.dailyTotals || {}).some((milliseconds) => milliseconds > 0)
    || Boolean(progress.studyData.session);
}

export function mergeProgress(cloud, local) {
  const conflicts = [];
  const completed = { ...local.completed, ...cloud.completed };
  for (const [id, value] of Object.entries(local.completed)) {
    if (Object.hasOwn(cloud.completed, id) && cloud.completed[id] !== value) conflicts.push(`completed.${id}`);
  }

  const completionDates = { ...local.completionDates };
  for (const [id, dates] of Object.entries(cloud.completionDates)) {
    completionDates[id] = [...new Set([...(completionDates[id] || []), ...dates])];
  }

  const completionEventsById = new Map();
  for (const event of [...(local.completionEvents || []), ...(cloud.completionEvents || [])]) {
    completionEventsById.set(event.id, event);
  }
  const completionEvents = [...completionEventsById.values()]
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));

  const totals = { ...local.studyData.totals };
  for (const [id, milliseconds] of Object.entries(cloud.studyData.totals)) {
    if (Object.hasOwn(totals, id) && totals[id] !== milliseconds) {
      conflicts.push(`studyData.totals.${id}`);
    }
    totals[id] = Math.max(totals[id] || 0, milliseconds);
  }

  const dailyTotals = { ...(local.studyData.dailyTotals || {}) };
  for (const [date, milliseconds] of Object.entries(cloud.studyData.dailyTotals || {})) {
    if (Object.hasOwn(dailyTotals, date) && dailyTotals[date] !== milliseconds) {
      conflicts.push(`studyData.dailyTotals.${date}`);
    }
    dailyTotals[date] = Math.max(dailyTotals[date] || 0, milliseconds);
  }

  if (local.dailyTarget !== cloud.dailyTarget) conflicts.push("dailyTarget");
  if (local.studyData.session && cloud.studyData.session
    && JSON.stringify(local.studyData.session) !== JSON.stringify(cloud.studyData.session)) {
    conflicts.push("studyData.session");
  }

  return {
    progress: {
      schemaVersion: 1,
      completed,
      practiceDates: [...new Set([...local.practiceDates, ...cloud.practiceDates])],
      completionDates,
      completionEvents,
      dailyTarget: cloud.dailyTarget,
      studyData: {
        totals,
        dailyTotals,
        session: !cloud.studyData.session
          ? local.studyData.session
          : local.studyData.session?.problemId === cloud.studyData.session.problemId
            && local.studyData.session.elapsedMs > cloud.studyData.session.elapsedMs
            ? local.studyData.session
            : cloud.studyData.session
      }
    },
    conflicts
  };
}

export function progressFingerprint(progress) {
  return JSON.stringify(progress);
}

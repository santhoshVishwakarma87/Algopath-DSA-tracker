const DAY_MS = 24 * 60 * 60 * 1000;

export function isAnalyticsDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addTimerIntervalToDailyTotals(dailyTotals = {}, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return dailyTotals;
  const updated = { ...dailyTotals };
  let cursor = startMs;

  while (cursor < endMs) {
    const start = new Date(cursor);
    const nextDay = new Date(start);
    nextDay.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(nextDay.getTime(), endMs);
    const dateKey = getAnalyticsDateKey(start);
    updated[dateKey] = (updated[dateKey] || 0) + segmentEnd - cursor;
    cursor = segmentEnd;
  }

  return updated;
}

export function getAnalyticsDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function getMonday(dateKey) {
  const date = getDateFromKey(dateKey);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return getAnalyticsDateKey(date);
}

function getUniqueValidDates(dates) {
  return [...new Set(Array.isArray(dates) ? dates.filter(isAnalyticsDateKey) : [])];
}

export function calculateActivityCalendar(completionCounts, today) {
  const end = getDateFromKey(today);
  const start = getDateFromKey(today);
  start.setFullYear(start.getFullYear() - 1);
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const weeks = [];
  const monthLabels = [];
  const cursor = new Date(gridStart);

  while (cursor <= end || cursor.getDay() !== 0) {
    const week = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(cursor);
      const dateKey = getAnalyticsDateKey(date);
      const inRange = date >= start && date <= end;
      const count = inRange ? completionCounts.get(dateKey) || 0 : 0;
      week.push({ date: dateKey, count, inRange });
      if (inRange && date.getDate() === 1) {
        monthLabels.push({
          label: date.toLocaleDateString(undefined, { month: "short" }),
          week: weeks.length
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return {
    weeks: weeks.map((week) => week.map((day) => ({
      ...day,
      level: day.count === 0 ? 0 : day.count === 1 ? 1 : day.count <= 3 ? 2 : day.count <= 5 ? 3 : 4
    }))),
    monthLabels
  };
}

function getElapsedSession(session, now) {
  if (!session || !Number.isFinite(session.elapsedMs) || session.elapsedMs < 0) return 0;
  return session.elapsedMs + (session.startedAt === null ? 0 : Math.max(0, now - session.startedAt));
}

export function calculateAnalytics({
  problems,
  completed,
  completionDates,
  completionEvents,
  practiceDates,
  studyData,
  dailyTarget,
  today,
  now = Date.now()
}) {
  const problemById = new Map(problems.map((problem) => [String(problem.id), problem]));
  const completionDays = new Map();
  const recentActivity = [];

  for (const [problemId, dates] of Object.entries(completionDates || {})) {
    const problem = problemById.get(problemId);
    if (!problem) continue;
    for (const date of getUniqueValidDates(dates)) {
      if (!completionDays.has(date)) completionDays.set(date, new Set());
      completionDays.get(date).add(problemId);
      recentActivity.push({ problem, date });
    }
  }

  for (const event of Array.isArray(completionEvents) ? completionEvents : []) {
    const problem = problemById.get(String(event.problemId));
    if (!problem || !isAnalyticsDateKey(event.date)) continue;
    if (!completionDays.has(event.date)) completionDays.set(event.date, new Set());
    completionDays.get(event.date).add(String(problem.id));
    if (!recentActivity.some((activity) => activity.problem.id === problem.id && activity.date === event.date)) {
      recentActivity.push({ problem, date: event.date });
    }
  }

  recentActivity.sort((a, b) => b.date.localeCompare(a.date) || a.problem.title.localeCompare(b.problem.title));

  const dayKeys = Array.from({ length: 7 }, (_, index) => {
    const date = getDateFromKey(today);
    date.setDate(date.getDate() - (6 - index));
    return getAnalyticsDateKey(date);
  });
  const thisWeekStart = getMonday(today);
  const lastWeekDate = getDateFromKey(thisWeekStart);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeekStart = getAnalyticsDateKey(lastWeekDate);
  const thisWeekEnd = getDateFromKey(thisWeekStart);
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
  const lastWeekEnd = getDateFromKey(thisWeekStart);

  const countInRange = (start, end) => [...completionDays.entries()]
    .reduce((count, [date, ids]) => date >= start && date < end ? count + ids.size : count, 0);
  const problemsThisWeek = countInRange(thisWeekStart, getAnalyticsDateKey(thisWeekEnd));
  const problemsLastWeek = countInRange(lastWeekStart, getAnalyticsDateKey(lastWeekEnd));

  const completedCount = problems.reduce((count, problem) => count + (completed[problem.id] ? 1 : 0), 0);
  const inProgressCount = problems.reduce((count, problem) => {
    const hasTimerData = (studyData?.totals?.[problem.id] || 0) > 0
      || studyData?.session?.problemId === problem.id;
    return count + (!completed[problem.id] && hasTimerData ? 1 : 0);
  }, 0);
  const totalStudyMs = Object.values(studyData?.totals || {})
    .reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0)
    + getElapsedSession(studyData?.session, now);
  const completedStudyMs = problems.reduce((sum, problem) => {
    if (!completed[problem.id]) return sum;
    const saved = studyData?.totals?.[problem.id] || 0;
    const active = studyData?.session?.problemId === problem.id
      ? getElapsedSession(studyData.session, now)
      : 0;
    return sum + (Number.isFinite(saved) && saved > 0 ? saved : 0) + active;
  }, 0);

  const datedTotals = { ...(studyData?.dailyTotals || {}) };
  if (studyData?.session?.startedAt !== null && studyData?.session?.startedAt !== undefined) {
    Object.assign(
      datedTotals,
      addTimerIntervalToDailyTotals(datedTotals, studyData.session.startedAt, now)
    );
  }
  const dailyActivity = dayKeys.map((date) => ({
    date,
    solved: completionDays.get(date)?.size || 0,
    studyMs: Number.isFinite(datedTotals[date]) ? datedTotals[date] : 0,
    studyTracked: Object.hasOwn(datedTotals, date)
  }));
  const activityCalendar = calculateActivityCalendar(
    new Map([...completionDays].map(([date, problemIds]) => [date, problemIds.size])),
    today
  );
  const hasDatedStudyTime = Object.entries(datedTotals)
    .some(([date, milliseconds]) => isAnalyticsDateKey(date) && Number.isFinite(milliseconds) && milliseconds > 0);
  const studyTodayMs = hasDatedStudyTime ? datedTotals[today] || 0 : null;
  const studyThisWeekMs = hasDatedStudyTime
    ? Object.entries(datedTotals).reduce((sum, [date, milliseconds]) => (
        date >= thisWeekStart && date < getAnalyticsDateKey(thisWeekEnd) && Number.isFinite(milliseconds)
          ? sum + milliseconds
          : sum
      ), 0)
    : null;

  const topicStats = [...new Set(problems.map((problem) => problem.topic))].map((topic) => {
    const topicProblems = problems.filter((problem) => problem.topic === topic);
    const topicCompleted = topicProblems.filter((problem) => completed[problem.id]).length;
    return {
      topic,
      total: topicProblems.length,
      completed: topicCompleted,
      percentage: topicProblems.length ? Math.round(topicCompleted / topicProblems.length * 100) : 0
    };
  });

  const activityDates = new Set([
    ...completionDays.keys(),
    ...getUniqueValidDates(practiceDates)
  ]);
  const completionDayNumbers = [...activityDates]
    .map((date) => Date.parse(`${date}T00:00:00.000Z`) / DAY_MS)
    .sort((a, b) => a - b);
  const activityDaySet = new Set(completionDayNumbers);
  const todayNumber = Date.parse(`${today}T00:00:00.000Z`) / DAY_MS;
  let currentDay = activityDaySet.has(todayNumber) ? todayNumber : todayNumber - 1;
  let currentStreak = 0;
  while (activityDaySet.has(currentDay)) {
    currentStreak += 1;
    currentDay -= 1;
  }
  let longestStreak = 0;
  let currentRun = 0;
  let previousDay = null;
  for (const day of completionDayNumbers) {
    currentRun = previousDay !== null && day === previousDay + 1 ? currentRun + 1 : 1;
    longestStreak = Math.max(longestStreak, currentRun);
    previousDay = day;
  }

  const dailyCompletedCount = problems.filter((problem) => (
    completed[problem.id] && getUniqueValidDates(completionDates?.[problem.id]).includes(today)
  )).length;
  const targetAchievement = dailyTarget > 0 ? Math.round(dailyCompletedCount / dailyTarget * 100) : 0;
  const totalCount = problems.length;

  return {
    totalCount,
    completedCount,
    inProgressCount,
    remainingCount: Math.max(totalCount - completedCount - inProgressCount, 0),
    completionPercentage: totalCount ? Math.round(completedCount / totalCount * 100) : 0,
    totalStudyMs,
    studyTodayMs,
    studyThisWeekMs,
    averageCompletedStudyMs: completedCount ? completedStudyMs / completedCount : null,
    dailyActivity,
    activityCalendar,
    problemsThisWeek,
    problemsLastWeek,
    topicStats,
    dailyCompletedCount,
    targetAchievement,
    targetReached: dailyCompletedCount >= dailyTarget,
    currentStreak,
    longestStreak,
    recentActivity: recentActivity.slice(0, 8),
    hasCompletionHistory: activityDates.size > 0,
    dailyTarget,
    studyTotals: studyData?.totals || {},
    activeTimer: studyData?.session
      ? { problemId: studyData.session.problemId, elapsedMs: getElapsedSession(studyData.session, now) }
      : null
  };
}

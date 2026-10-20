import {
  Activity, Award, BookOpen, CalendarDays, Check, Clock3, Flame, Target, TrendingDown, TrendingUp
} from "lucide-react";

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function formatDate(dateKey, options = { month: "short", day: "numeric" }) {
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString(undefined, options);
}

function StatCard({ icon: Icon, label, value, detail, tone = "purple" }) {
  return (
    <article className="analytics-stat-card">
      <div className="analytics-stat-heading">
        <span>{label}</span>
        <span className={`analytics-stat-icon ${tone}`}><Icon size={17} aria-hidden="true" /></span>
      </div>
      <strong className="analytics-stat-value">{value}</strong>
      <span className="analytics-stat-detail">{detail}</span>
    </article>
  );
}

export default function AnalyticsDashboard({ analytics, today, syncError }) {
  const maxDailySolved = Math.max(...analytics.dailyActivity.map((day) => day.solved), 1);
  const weekChange = analytics.problemsLastWeek > 0
    ? Math.round((analytics.problemsThisWeek - analytics.problemsLastWeek) / analytics.problemsLastWeek * 100)
    : null;
  const weekChangeLabel = weekChange === null
    ? analytics.problemsThisWeek > 0 ? "New activity this week" : "No prior-week baseline"
    : `${Math.abs(weekChange)}% ${weekChange > 0 ? "increase" : weekChange < 0 ? "decrease" : "no change"} vs last week`;
  const recentActivity = analytics.recentActivity;

  return (
    <section className="analytics-dashboard" aria-labelledby="analytics-heading">
      {syncError && (
        <div className="analytics-notice" role="status">
          Analytics are using your locally saved progress while cloud sync is unavailable.
        </div>
      )}

      <div className="analytics-section-heading">
        <div>
          <h2 id="analytics-heading">Overall progress</h2>
          <p>Progress is calculated from your existing problem collection and saved completion status.</p>
        </div>
        <span className="analytics-date-chip"><CalendarDays size={15} /> {formatDate(today, { weekday: "short", month: "long", day: "numeric" })}</span>
      </div>
      <div className="analytics-stat-grid">
        <StatCard icon={BookOpen} label="Available problems" value={analytics.totalCount} detail="In your current collection" />
        <StatCard icon={Check} label="Completed" value={`${analytics.completedCount} / ${analytics.totalCount}`} detail={`${analytics.completionPercentage}% overall completion`} tone="green" />
        <StatCard icon={Activity} label="In progress" value={analytics.inProgressCount} detail="Uncompleted problems with timer activity" tone="orange" />
        <StatCard icon={Target} label="Remaining" value={analytics.remainingCount} detail="Not completed or timed yet" tone="pink" />
      </div>

      <div className="analytics-section-heading">
        <div>
          <h2>Study time</h2>
          <p>Lifetime totals include the current timer once. Daily totals are tracked from dated timer activity.</p>
        </div>
      </div>
      <div className="analytics-stat-grid">
        <StatCard icon={Clock3} label="Total study time" value={formatDuration(analytics.totalStudyMs)} detail="Recorded across all problem timers" />
        <StatCard icon={CalendarDays} label="Today" value={analytics.studyTodayMs === null ? "—" : formatDuration(analytics.studyTodayMs)} detail={analytics.studyTodayMs === null ? "Dated tracking starts with recorded timer activity" : "Reliable timer time recorded today"} tone="green" />
        <StatCard icon={CalendarDays} label="This week" value={analytics.studyThisWeekMs === null ? "—" : formatDuration(analytics.studyThisWeekMs)} detail={analytics.studyThisWeekMs === null ? "Older lifetime totals have no date breakdown" : "Reliable timer time recorded this week"} tone="orange" />
        <StatCard icon={TrendingUp} label="Avg. per completed problem" value={analytics.averageCompletedStudyMs === null ? "—" : formatDuration(analytics.averageCompletedStudyMs)} detail={analytics.completedCount ? "Timer time on completed problems" : "Complete a problem to see an average"} tone="pink" />
      </div>

      <div className="analytics-panels-grid">
        <section className="analytics-panel daily-activity-panel" aria-labelledby="daily-activity-heading">
          <div className="analytics-panel-heading">
            <div><h2 id="daily-activity-heading">Daily activity</h2><p>Problems completed over the last 7 days</p></div>
            <span className="analytics-panel-icon"><Activity size={17} /></span>
          </div>
          <div className="activity-chart" role="list" aria-label="Problems completed each day in the last 7 days">
            {analytics.dailyActivity.map((day) => {
              const barHeight = day.solved ? Math.max(8, day.solved / maxDailySolved * 100) : 2;
              const studyDescription = day.studyTracked
                ? `${formatDuration(day.studyMs)} study time`
                : "Study time not recorded for this date";
              return (
                <div
                  className="activity-chart-day"
                  key={day.date}
                  role="listitem"
                  title={`${formatDate(day.date, { weekday: "long", month: "long", day: "numeric" })}: ${day.solved} ${day.solved === 1 ? "problem" : "problems"} solved; ${studyDescription}`}
                  aria-label={`${formatDate(day.date, { weekday: "long", month: "long", day: "numeric" })}: ${day.solved} solved; ${studyDescription}`}
                >
                  <span className="activity-count">{day.solved}</span>
                  <div className="activity-chart-track" aria-hidden="true">
                    <div className={`activity-chart-bar${day.solved === 0 ? " zero" : ""}`} style={{ height: `${barHeight}%` }} />
                  </div>
                  <span className="activity-day-label">{formatDate(day.date, { weekday: "short" })}</span>
                  <span className="activity-study-label">{day.studyTracked ? formatDuration(day.studyMs) : " "}</span>
                </div>
              );
            })}
          </div>
          {!analytics.hasCompletionHistory && (
            <p className="analytics-inline-empty">Completed-problem history will appear here as you mark problems done.</p>
          )}
        </section>

        <section className="analytics-panel weekly-panel" aria-labelledby="weekly-performance-heading">
          <div className="analytics-panel-heading">
            <div><h2 id="weekly-performance-heading">Weekly performance</h2><p>Monday–Sunday, based on recorded completion dates</p></div>
            <span className="analytics-panel-icon"><TrendingUp size={17} /></span>
          </div>
          <div className="weekly-comparison">
            <div><span>This week</span><strong>{analytics.problemsThisWeek}</strong><small>problems solved</small></div>
            <div className="weekly-comparison-divider" aria-hidden="true" />
            <div><span>Last week</span><strong>{analytics.problemsLastWeek}</strong><small>problems solved</small></div>
          </div>
          <p className={`weekly-change${weekChange !== null && weekChange < 0 ? " negative" : ""}`}>
            {weekChange !== null && weekChange < 0 ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
            {weekChangeLabel}
          </p>
        </section>
      </div>

      <section className="analytics-panel target-panel" aria-labelledby="analytics-target-heading">
        <div className="analytics-panel-heading">
          <div><h2 id="analytics-target-heading">Daily target</h2><p>Today’s completed problems against your saved goal of {analytics.dailyTarget}.</p></div>
          <span className="analytics-panel-icon"><Target size={17} /></span>
        </div>
        <div className="analytics-target-progress">
          <div className="analytics-target-copy">
            <strong>{analytics.dailyCompletedCount} of {analytics.dailyTarget} completed</strong>
            <span>{analytics.targetAchievement}%</span>
          </div>
          <div
            className="analytics-target-track"
            role="progressbar"
            aria-label="Daily target achievement"
            aria-valuemin="0"
            aria-valuemax={analytics.dailyTarget}
            aria-valuenow={Math.min(analytics.dailyCompletedCount, analytics.dailyTarget)}
            aria-valuetext={`${analytics.dailyCompletedCount} of ${analytics.dailyTarget} problems completed`}
          >
            <div style={{ width: `${Math.min(analytics.targetAchievement, 100)}%` }} />
          </div>
          <p className={analytics.targetReached ? "target-reached" : ""}>
            {analytics.targetReached
              ? "Daily target reached. Great work!"
              : `${Math.max(analytics.dailyTarget - analytics.dailyCompletedCount, 0)} more to reach today’s target`}
          </p>
        </div>
      </section>

      <div className="analytics-panels-grid">
        <section className="analytics-panel streak-panel" aria-labelledby="streak-heading">
          <div className="analytics-panel-heading">
            <div><h2 id="streak-heading">Streak tracking</h2><p>Consecutive days with at least one recorded completion</p></div>
            <span className="analytics-panel-icon"><Flame size={17} /></span>
          </div>
          <div className="streak-values">
            <div><strong>{analytics.currentStreak}</strong><span>Current {analytics.currentStreak === 1 ? "day" : "days"}</span></div>
            <div><strong>{analytics.longestStreak}</strong><span>Longest {analytics.longestStreak === 1 ? "day" : "days"}</span></div>
            <div><strong>{analytics.dailyCompletedCount}</strong><span>Completed today</span></div>
          </div>
          <p className="analytics-footnote">
            {analytics.hasCompletionHistory
              ? "Only saved completion dates count. Older completed statuses without timestamps are not backfilled."
              : "Streak tracking starts with recorded completion activity; no earlier history is assumed."}
          </p>
        </section>

        <section className="analytics-panel recent-activity-panel" aria-labelledby="recent-activity-heading">
          <div className="analytics-panel-heading">
            <div><h2 id="recent-activity-heading">Recent activity</h2><p>Your latest problems with recorded completion dates</p></div>
            <span className="analytics-panel-icon"><Award size={17} /></span>
          </div>
          {recentActivity.length ? (
            <ul className="recent-activity-list">
              {recentActivity.map(({ problem, date }) => {
                const timerTotal = (analytics.studyTotals[problem.id] || 0)
                  + (analytics.activeTimer?.problemId === problem.id ? analytics.activeTimer.elapsedMs : 0);
                return (
                  <li key={`${problem.id}-${date}`}>
                    <span className="recent-activity-check"><Check size={13} /></span>
                    <span className="recent-activity-copy"><strong>{problem.title}</strong><span>{problem.topic} · {formatDate(date, { month: "short", day: "numeric", year: "numeric" })}</span></span>
                    <span className="recent-activity-time">{timerTotal > 0 ? formatDuration(timerTotal) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="analytics-empty-state">
              <BookOpen size={22} />
              <strong>No completed problems yet</strong>
              <span>Mark a problem complete to start building your activity history.</span>
            </div>
          )}
        </section>
      </div>

      <section className="analytics-panel contribution-panel" aria-labelledby="contribution-heading">
        <div className="analytics-panel-heading">
          <div><h2 id="contribution-heading">Completion activity</h2><p>Problems completed each day over the last 12 months</p></div>
          <span className="analytics-panel-icon"><CalendarDays size={17} /></span>
        </div>
        {analytics.hasCompletionHistory ? (
          <div className="contribution-scroll">
            <div className="contribution-calendar" role="group" aria-label="Problem completion activity calendar for the last 12 months">
              <div className="contribution-weekday-labels" aria-hidden="true">
                <span />
                <span>Mon</span>
                <span />
                <span>Wed</span>
                <span />
                <span>Fri</span>
                <span />
              </div>
              <div className="contribution-calendar-content">
                <div
                  className="contribution-month-labels"
                  style={{ gridTemplateColumns: `repeat(${analytics.activityCalendar.weeks.length}, 11px)` }}
                  aria-hidden="true"
                >
                  {analytics.activityCalendar.monthLabels.map(({ label, week }, index) => (
                    <span key={`${label}-${week}-${index}`} style={{ gridColumnStart: week + 1 }}>{label}</span>
                  ))}
                </div>
                <div
                  className="contribution-weeks"
                  style={{ gridTemplateColumns: `repeat(${analytics.activityCalendar.weeks.length}, 11px)` }}
                >
                  {analytics.activityCalendar.weeks.map((week, weekIndex) => (
                    <div className="contribution-week" key={weekIndex}>
                      {week.map(({ date, count, level, inRange }) => (
                        <span
                          key={date}
                          className={`contribution-day level-${level}${inRange ? "" : " outside-range"}`}
                          title={inRange ? `${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}: ${count} ${count === 1 ? "problem" : "problems"} completed` : undefined}
                          aria-label={inRange ? `${formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}: ${count} ${count === 1 ? "problem" : "problems"} completed` : undefined}
                          aria-hidden={!inRange}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="contribution-footer">
              <span>Less</span>
              <span className="contribution-legend" aria-label="Activity intensity from none to high">
                {[0, 1, 2, 3, 4].map((level) => <i className={`contribution-day level-${level}`} key={level} aria-hidden="true" />)}
              </span>
              <span>More</span>
            </div>
          </div>
        ) : (
          <div className="analytics-empty-state contribution-empty-state">
            <CalendarDays size={22} />
            <strong>No completion history yet</strong>
            <span>Mark a problem complete to start your activity calendar. Older completed statuses are not backfilled.</span>
          </div>
        )}
      </section>

      <section className="analytics-panel topic-breakdown-panel" aria-labelledby="topic-breakdown-heading">
        <div className="analytics-panel-heading">
          <div><h2 id="topic-breakdown-heading">Topic breakdown</h2><p>Completion by the topics actually present in your problem collection</p></div>
          <span className="analytics-panel-icon"><BookOpen size={17} /></span>
        </div>
        <div className="analytics-topic-list">
          {analytics.topicStats.map(({ topic, total, completed, percentage }) => (
            <div className="analytics-topic-row" key={topic}>
              <div className="analytics-topic-copy"><strong>{topic}</strong><span>{completed} / {total} completed · {percentage}%</span></div>
              <div className="analytics-topic-track" role="progressbar" aria-label={`${topic} completion`} aria-valuemin="0" aria-valuemax={total} aria-valuenow={completed} aria-valuetext={`${completed} of ${total} completed`}>
                <div style={{ width: `${percentage}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

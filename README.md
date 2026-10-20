# AlgoPath DSA Tracker

A responsive React application for tracking Data Structures and Algorithms practice.

## Features

- Dashboard with solved count and completion percentage
- Advanced Analytics dashboard with completion, timer, weekly, topic, streak, target, and recent-activity insights
- Curated collection of 450 LeetCode problems across 22 DSA topics
- Topic progress cards with an option to expand the full topic list
- Search by problem title
- Topic and difficulty filters
- Mark problems completed or incomplete
- Daily and best practice streaks, recorded when a problem is completed
- Per-problem study timers with pause, resume, and locally saved time
- Progress saved in browser `localStorage`
- Firebase email/password and Google authentication
- Per-user Firestore synchronization with a local-first migration
- Responsive desktop, tablet, and mobile layouts
- Direct links to the corresponding LeetCode problem pages

## Run locally

1. Install the current Node.js LTS version from https://nodejs.org/
2. Unzip this project.
3. Open the `dsa-tracker` folder in VS Code.
4. Open Terminal in VS Code and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open the local URL shown by Vite, usually http://localhost:5173.

## Build for deployment

```bash
npm run build
npm run preview
```

The production output is written to `dist/`.

## Data note

The curated problem collection uses LeetCode problem titles, difficulty levels, and problem links. Each problem is grouped under a primary practice topic to make the collection easier to browse.

Progress is saved in browser `localStorage` and, after signing in, synchronized to `users/{uid}/tracker/progress` in Cloud Firestore. This reuses the existing `auth` and `db` exports from `src/firebase.js`; it does not initialize another Firebase app. Existing local progress is migrated without deleting its original localStorage keys. If local and cloud fields conflict during the initial merge, a copy of the local snapshot is kept under `dsa-tracker-conflict-backup-v1-{uid}` in localStorage; the cloud value wins for conflicting completion statuses and daily targets, and the greater recorded duration wins for conflicting problem timers. Completion dates and practice dates are combined.

Practice and completion dates use the device's local calendar and are recorded when a problem is marked complete. Existing completed problems are not assigned dates retroactively. Analytics streaks and the 12-month contribution calendar use only recorded activity; completed status is never used to fabricate history. New completion transitions also record an exact ISO timestamp and local `YYYY-MM-DD` date in `completionEvents`, saved under `dsa-tracker-completion-events-v1` in localStorage and in the existing `users/{uid}/tracker/progress` Firestore document. Repeated synchronization merges these events by stable event ID. Date-only history from before this change remains usable, but no exact timestamp is inferred for it. Unmarking a problem changes its current status without erasing past completion history. The dashboard's daily problem target defaults to 5, can be changed to a preset or custom whole number, and is saved in browser storage. Today's target total counts distinct problems currently marked complete today.

Study time is stored separately per problem in the current browser. A running session is safely restored as paused after a refresh, so time away from the app is not counted. Analytics retains the existing per-problem lifetime totals and records date-based timer totals in `studyData.dailyTotals` as active timer time is paused, stopped, switched, or synchronized. Older lifetime totals are not assigned to dates retroactively; today/week timer metrics and chart tooltips only use reliable date-bucket records.

## Firebase setup

The application reuses the Firebase project configuration in [`src/firebase.js`](./src/firebase.js). The Firebase web configuration is intended for client apps; do not add Admin SDK credentials or service-account keys to this project.

In Firebase Console, for the configured project:

1. In **Authentication → Sign-in method**, enable **Email/Password** and **Google**.
2. In **Authentication → Settings → Authorized domains**, add the hostnames used to run/deploy the app (localhost is normally preconfigured for local development).
3. Create or enable **Cloud Firestore** in the project.
4. Open **Firestore Database → Rules**, replace the rules with the contents of [`firestore.rules`](./firestore.rules), and click **Publish**. The tracker reads and writes the single document `users/{uid}/tracker/progress`; the rules permit only a signed-in user whose Firebase UID matches `{uid}` to access that document. All other paths remain denied by default. Never use public read/write rules.

The rules file is provided in the repository but is not deployed automatically. No Firebase Console settings or live sign-in/cloud operations have been verified by the local build.

## Test authentication and synchronization

1. Run `npm run dev`, then create an account with email/password or use **Continue with Google**. Email/password registration requires a password of at least 6 characters.
2. Confirm the dashboard appears after authentication, and the account email and sync status are visible.
3. Mark a problem complete, change the daily target, and record some study time. Wait for the status to show **Synced**.
4. In Firebase Console, open **Firestore Database → Data → users → {your Firebase UID} → tracker → progress**. Confirm the document exists and its `completed`, `completionDates`, `dailyTarget`, and `studyData` fields reflect your changes. A successful production build alone does not verify a live Firebase write.
5. Refresh the page and confirm progress is restored. Sign in on another browser/device with the same account to check cloud synchronization.
6. Sign out and confirm the sign-in screen appears. Existing localStorage data is retained.
7. Test a different account and confirm its progress is isolated to its UID.

This tracker currently has no problem-notes or revision-history features or corresponding localStorage fields; those are therefore not part of its current synchronized data. The current synced fields are completed-problem states, practice dates, per-problem completion dates, daily target, per-problem study totals, date-based timer totals, and the active timer session.

The production build can be checked with `npm run build`.

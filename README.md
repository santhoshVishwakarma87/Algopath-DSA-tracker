# AlgoPath DSA Tracker

AlgoPath is a responsive web application for organizing Data Structures and Algorithms practice. It brings a curated LeetCode problem collection, progress tracking, study timers, daily goals, and activity analytics into one workspace. Sign in to sync progress with Firebase, or use the app's local browser storage when cloud sync is unavailable.

- **Live app:** [algopath-dsa-tracker.vercel.app](https://algopath-dsa-tracker.vercel.app)
- **Source code:** [santhoshVishwakarma87/Algopath-DSA-tracker](https://github.com/santhoshVishwakarma87/Algopath-DSA-tracker)

## Features

- **Problem collection:** Browse 450 curated LeetCode problems across 22 topics, with difficulty labels and direct links to LeetCode.
- **Search and filters:** Search by problem title and filter by topic or difficulty. Browse the dashboard, topic view, or completed-problems view.
- **Progress tracking:** Mark problems complete or incomplete and see overall and difficulty-level progress.
- **Daily targets and streaks:** Set a positive whole-number daily target (default: 5), see today's completion progress, and track current and best practice streaks from recorded activity.
- **Per-problem study timer:** Start, pause, resume, and switch timers. Timer totals are saved locally; an active timer is restored as paused after a page refresh so time away is not counted.
- **Analytics dashboard:** View completion totals, study time, recent activity, weekly comparisons, daily activity, topic breakdown, streaks, and a 12-month completion calendar.
- **Authentication:** Sign in with Google or email and password. Email/password accounts can be created in the app.
- **Cloud synchronization:** Signed-in progress is stored per Firebase user in Cloud Firestore. Local progress can be migrated on sign-in, and local storage remains available if cloud sync is unavailable.
- **Responsive interface:** Layouts adapt to desktop, tablet, and mobile screens, using the Cherry + Alabaster visual theme.

> **Scope note:** The current application does not implement problem notes or revision tracking. Analytics and historical activity are based on recorded completion and timer data; older completion statuses without dates are not backfilled with assumed history.

## Screenshots

Screenshots are not currently included in the repository. To add them, save captures of the app under `screenshots/` and link them here, for example:

```md
![AlgoPath dashboard](./screenshots/dashboard.png)
```

## Technology stack

- **UI:** React and JavaScript (ES modules)
- **Build and development server:** Vite
- **Authentication and data:** Firebase Authentication and Cloud Firestore
- **Browser persistence:** LocalStorage
- **Icons:** Lucide React
- **Fonts:** DM Sans and Space Grotesk, loaded from Google Fonts
- **Hosting:** Vercel (live deployment)

## Architecture overview

```text
src/
├── main.jsx                 # React entry point and stylesheet import
├── App.jsx                  # Dashboard, navigation, local state, timers, and Firestore sync
├── AuthScreen.jsx           # Google and email/password authentication UI
├── AnalyticsDashboard.jsx   # Analytics presentation
├── analytics.js             # Activity, streak, timer, and topic calculations
├── problems.js              # Curated problem data
├── progressSync.js          # Progress snapshots, local/cloud merge, and conflict handling
├── firebase.js              # Firebase app, Authentication, Firestore, and Analytics setup
└── styles.css               # Responsive Cherry + Alabaster interface styles
```

Progress is kept in the browser's LocalStorage and, after authentication, synchronized to the signed-in user's Firestore document at `users/{uid}/tracker/progress`. The browser app accesses only the signed-in user's document; the repository's [`firestore.rules`](./firestore.rules) restricts reads and writes to a matching authenticated UID. Firebase Analytics is initialized when supported by the browser.

The local progress model records completed states, practice dates, completion dates and events, the daily target, per-problem timer totals, dated timer totals, and the active timer session. During initial synchronization, local and cloud data are merged: completion and practice dates are combined, cloud completion states and daily target take precedence in conflicts, and the greater timer total is retained. Conflicting local data is preserved in a per-user LocalStorage backup. Existing local progress keys are not deleted.

## Getting started

### Prerequisites

- Node.js (current LTS recommended)
- npm
- A Firebase project configured for the application (see [Firebase setup](#firebase-setup))

### Install and run locally

```bash
git clone https://github.com/santhoshVishwakarma87/Algopath-DSA-tracker.git
cd Algopath-DSA-tracker
npm install
npm run dev
```

Open the local URL printed by Vite, typically <http://localhost:5173>.

Create a production build and serve it locally with:

```bash
npm run build
npm run preview
```

Vite writes the production files to `dist/`.

## Environment configuration

There are currently **no required environment variables**: the application does not read `import.meta.env` or `VITE_*` variables. Firebase's web-app configuration is currently defined in [`src/firebase.js`](./src/firebase.js), so no `.env` file is needed to run this version.

When using a different Firebase project, update the web-app configuration in `src/firebase.js` to that project's Firebase web configuration. Firebase web configuration is used by client applications and is not a substitute for access control; do not put Firebase Admin SDK credentials, service-account keys, or other server secrets in the frontend or repository. Protect Firestore data with Authentication and restrictive Firestore rules.

## Firebase setup

For the Firebase project configured by the application:

1. In **Firebase Console → Authentication → Sign-in method**, enable **Google** and **Email/Password**.
2. In **Authentication → Settings → Authorized domains**, add the hostnames used to access the app. `localhost` is normally available for local development; add your deployed Vercel hostname as well.
3. Create or enable **Cloud Firestore**.
4. In **Firestore Database → Rules**, publish the rules from [`firestore.rules`](./firestore.rules). These rules allow an authenticated user to read and write only `users/{uid}/tracker/progress` when `{uid}` matches their Firebase Authentication UID. All other paths remain denied by default.

The rules file is not deployed automatically by `npm run build` or by the frontend deployment. Do not replace them with public read/write rules.

### Verify authentication and sync

1. Start the app with `npm run dev`.
2. Create an email/password account or use **Continue with Google**.
3. Complete a problem, change the daily target, or record time with a study timer.
4. Wait for the sync status to report **Synced**. In Firebase Console, inspect **Firestore Database → Data → users → {your UID} → tracker → progress**.
5. Refresh the app or sign in to the same account in another browser to check that cloud progress is restored.

## Deployment

The live application is hosted at [algopath-dsa-tracker.vercel.app](https://algopath-dsa-tracker.vercel.app). To deploy your own copy:

1. Import the GitHub repository into Vercel.
2. Use the Vite defaults: build command `npm run build` and output directory `dist`.
3. No Vercel environment variables are required by the current source.
4. Add the deployment hostname to Firebase Authentication's authorized domains and make sure the intended Firestore rules are published.

You can also deploy the generated `dist/` directory to another static host that supports a Vite single-page application.

## Troubleshooting

| Issue | What to check |
| --- | --- |
| `npm install` or Vite fails to start | Confirm Node.js and npm are installed, then run `npm install` from the project root. |
| Google sign-in is blocked or reports `auth/unauthorized-domain` | Allow pop-ups for the site and add its hostname under **Firebase Authentication → Settings → Authorized domains**. |
| Email/password sign-in fails | Ensure **Email/Password** is enabled in Firebase Authentication. New passwords must contain at least six characters. |
| Firestore sync reports `permission-denied` | Publish the repository's [`firestore.rules`](./firestore.rules), verify Cloud Firestore is enabled, and confirm the signed-in user's UID matches the document path. |
| Sign-in or Firestore requests fail with network errors | Check the browser's network connection, browser console, and Firebase project configuration in [`src/firebase.js`](./src/firebase.js). |
| Progress appears only in one browser | LocalStorage is browser-specific. Sign in to the same Firebase account in both browsers and confirm sync reaches **Synced**. |
| Timer continues after refreshing | A running timer is deliberately restored as paused. Resume it in the app to continue counting active study time. |
| Older completed problems do not appear in historical activity | Completion dates are recorded when a problem is marked complete. The app does not infer dates for older completion statuses. |

## Data and analytics notes

- Practice and completion dates use the device's local calendar. Marking a problem complete records activity; unmarking it changes current completion status but does not erase the recorded historical completion.
- Today's target count is the number of distinct problems currently marked complete today.
- Lifetime timer totals and dated timer totals are distinct. Older lifetime totals are not assigned to dates retroactively, so date-based analytics only use reliable recorded timer activity.
- Authentication is required to enter the tracker. LocalStorage provides browser-local persistence and a fallback when cloud synchronization is unavailable; Firestore synchronization requires a working Firebase connection.

## License

See [`LICENSE`](./LICENSE).

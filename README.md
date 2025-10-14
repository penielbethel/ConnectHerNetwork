ConnectHer Network — Web + Mobile + Backend (Monorepo)

Overview
- Single repository serves static web from `public/` and backend APIs/socket from `server.js`.
- React Native mobile app uses the same backend (`/api/*` and Socket.IO).

Quick Start (Local)
- Install: `npm install`
- Env: copy `.env.example` to `.env` and fill values
- Run server: `npm start`
- Mobile dev (Android): `npx react-native run-android`

Environment Variables
- `MONGO_URI`: MongoDB connection string
- `JWT_SECRET`: token signing secret
- `PORT`: server port (Render sets automatically; keep a fallback)
- `ROOT_URL`: public base URL used by clients
- Optional: `CLOUDINARY_*`, Firebase keys (configure in Render)

Deployment (Render)
- Ensure `package.json` has `start: node server.js`
- Add environment variables in Render Dashboard
- Static web is served from `public/`; API under `/api/*`

Notes
- Do not commit `.env`, service-account files, or `uploads/`
- Android build outputs and local config are ignored by `.gitignore`
## Firebase Configuration

ConnectHer uses Firebase both on Android (client) and on the Node.js server (Admin SDK) for FCM push notifications. Make sure the client and server point to the same Firebase project or document any intentional differences.

- Android app uses `android/app/google-services.json` with `project_id` `connecther-mobile` and `mobilesdk_app_id` `1:701275464049:android:d6a2d8ffac85b3973c56d0` for package `com.connecthermobile`.
- Server Admin SDK loads credentials from environment variables via `firebase.js`. A local `firebase-service-account.json` shows `project_id` `connecther-76f65` (example credentials). If you use environment variables in production, ensure they match the intended Firebase project.

Recommended alignment:
- If `connecther-mobile` is the canonical project, update your server `FIREBASE_*` env vars to the service account of `connecther-mobile`.
- If `connecther-76f65` is correct for the backend, replace the Android `google-services.json` with the file generated for the same project and Android package `com.connecthermobile`.
- After changing projects, reinstall the app so FCM tokens refresh. Verify tokens are being saved via `POST https://connecther.network/api/notifications/save-token`.

Troubleshooting tips:
- Confirm server imports `./firebase` (Admin SDK initializer). Check logs for token save and push send results.
- Verify device receives foreground and background FCM messages; the app mirrors remote messages into local notifications via `src/services/pushNotifications.ts`.
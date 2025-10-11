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
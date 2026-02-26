# Sharely

## Project Overview
Sharely is a browser extension + admin dashboard system for managing shared access to premium web services via cookie management.

## Architecture
- **Admin Dashboard** (`server/`): Node.js/Express web app with SQLite database
  - Login system with session-based auth
  - Service management (add/edit/delete web services)
  - Cookie management (add/edit/delete cookies per service)
  - Extension settings (API key, theme, version)
  - API endpoint for the extension to fetch config
- **Browser Extension** (`extension/`): Chrome Manifest V3 extension
  - Popup UI showing available services
  - Settings panel for connecting to admin server
  - Cookie injection via Chrome cookies API
  - Dark/light theme support
  - Search and category filtering

## Key Files
- `server/server.js` - Express server (port 5000)
- `server/public/` - Admin dashboard frontend (HTML/CSS/JS)
- `server/data/sharely.db` - SQLite database (auto-created)
- `extension/manifest.json` - Extension manifest
- `extension/popup.html/js/css` - Extension popup UI
- `extension/background.js` - Background service worker

## Stack
- Node.js + Express
- SQLite (better-sqlite3)
- Vanilla HTML/CSS/JS frontend
- Chrome Extension Manifest V3

## Default Admin Credentials
- Username: `admin`
- Password: `admin123`

## API Endpoints
- `POST /api/auth/login` - Login
- `GET /api/services` - List services (auth required)
- `POST /api/services` - Create service
- `GET /api/cookies` - List cookies
- `POST /api/cookies` - Create cookie
- `GET /api/settings` - Get extension settings
- `GET /api/extension/config?api_key=...` - Extension config endpoint (API key auth)

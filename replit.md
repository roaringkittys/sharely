# Sharely

## Project Overview
Sharely is a Chrome browser extension + admin dashboard system for managing shared access to premium web services via cookie injection.

## Architecture
- **Admin Dashboard** (`server/`): Node.js/Express web app with SQLite database
  - Login system with session-based auth
  - Service management with custom PNG logo upload
  - Cookie management — grouped by label as "accounts" per service
  - Bulk JSON cookie import (forces secure/httpOnly/no_restriction)
  - Extension settings (API key, theme, version)
  - Easy Cookie Extractor snippet on dashboard home
- **Browser Extension** (`extension/`): Chrome Manifest V3 popup extension
  - Service grid with PNG logos or emoji fallback
  - Multi-account picker: services with multiple cookie groups show an account selector
  - Account badge showing number of accounts
  - Cookie injection via background.js service worker (survives popup close)
  - SameSite mapping: "none" → "no_restriction" for Chrome
  - Debug logging + verification of cookies in background console
  - Dark/light theme, search, category filtering

## Key Files
- `server/server.js` - Express server (port 5000)
- `server/public/` - Admin dashboard frontend
- `server/public/uploads/` - Uploaded service logos
- `server/data/sharely.db` - SQLite database (auto-created)
- `extension/manifest.json` - Extension manifest (popup mode, no side panel)
- `extension/popup.html` - Extension popup with account picker overlay
- `extension/sharely-extension.js` - Extension UI logic
- `extension/sharely-extension.css` - Styles (glassmorphism, account picker)
- `extension/background.js` - Service worker: cookie inject + verify + tab open

## Stack
- Node.js + Express + Multer (file uploads)
- SQLite (better-sqlite3)
- Vanilla HTML/CSS/JS + Bootstrap 5 + jQuery
- Chrome Extension Manifest V3

## Default Admin Credentials
- Username: `admin`
- Password: `admin123`

## Database Schema (services table)
- id, name, domain, icon (emoji), icon_url (uploaded PNG path), category, enabled

## Cookies / Accounts Concept
- Cookies are grouped by `label` field under each service
- Each label group = one "account"  
- Example: Netflix can have "Account 1" and "Account 2" with different cookie sets
- Extension shows a picker when a service has multiple accounts

## Cookie Settings for Authentication (e.g. Netflix)
- secure: true, httpOnly: true, sameSite: no_restriction
- These are forced in bulk import automatically

## API Endpoints
- `POST /api/auth/login` - Login
- `GET /api/services` - List services
- `POST /api/services` - Create service
- `POST /api/services/:id/upload-icon` - Upload logo (multipart)
- `DELETE /api/services/:id/upload-icon` - Remove logo
- `GET /api/cookies` - List cookies
- `POST /api/cookies` - Create cookie
- `POST /api/cookies/bulk` - Bulk JSON import
- `GET /api/settings` - Get extension settings
- `GET /api/extension/config` - Extension config (X-API-Key header)
  - Returns services with accounts[] grouped by label

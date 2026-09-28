DT MUSIC SCORES — INSTALLABLE APP PACKAGE

This version is a Progressive Web App (PWA). It preserves the existing HTML app and adds install support.

HOW TO INSTALL ON WINDOWS (recommended)
1. Upload this folder to an HTTPS host such as GitHub Pages or Firebase Hosting.
2. Open the hosted URL in Microsoft Edge or Google Chrome.
3. In Edge: Menu (...) > Apps > Install DT Music Scores.
   In Chrome: look for the Install icon in the address bar, or Menu > Cast, save, and share > Install page as app.
4. It will open in its own app window and can be pinned to Start/taskbar.

IMPORTANT — GOOGLE DRIVE LOGIN
Your existing Google OAuth Client ID is preserved. Google may reject sign-in on a new hosted domain until that domain is added as an Authorized JavaScript origin in Google Cloud Console.

LOCAL DATA
The existing IndexedDB storage, PDF library, setlists, arrangements, runtime state, and ZIP backup system are preserved.

OFFLINE
The app shell is cached after first successful load. Local scores already stored in IndexedDB remain local. Google Drive sync naturally requires internet.

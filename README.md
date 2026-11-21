# Basketball Scoreboard & Stat Tracker

A fast, mobile-first basketball scoreboard and live stat tracker that produces standalone **Easy Stats-compatible HTML Box Score reports** with **11-Zone Hot/Cold Shot Charts**, **Game Flow charts**, **Possession %**, and **100% offline automated Game Recaps**.

---

## Privacy & Two-Phase Google Drive Architecture

To keep the GitHub repository 100% public-safe, **no player names or rosters are stored in the repository code**:

1. **Pre-Game Roster Fetch (Connects to Google Drive ONCE at Setup)**:
   - Reads `teams_rosters.json` from private Google Drive folder [`1-GSovenRouWVnOw-L9kbSbrT061SLLT9`](https://drive.google.com/drive/u/0/folders/1-GSovenRouWVnOw-L9kbSbrT061SLLT9) when you select your team (`B11 Dunker 2` or `B15 Dunker 5`) and set up the match roster.
2. **Live Match Scoring (ZERO Google Connections — 100% Offline)**:
   - Once the roster is loaded, all live scoring, countdown clock, possession % tracking, shot zone selection, and play-by-play editing run completely offline in your browser (`localStorage`).
3. **Post-Game Save (Connects to Google Drive ONCE After the Game)**:
   - Saves the generated Easy Stats `.html` report and `.json` match data to Google Drive folder [`14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1`](https://drive.google.com/drive/u/0/folders/14BGvyAmc0jLTixB6bKnXpsGHAGuAfuS1) inside a newly created subfolder prefixed with `2026Summer_B11_DD2_` or `2026Summer_B15_DD5_` and suffixed with `_yyyymmddhhmmss`.

---

## How to Get the Key & Set Up the Google Connection

### Method 1 (Recommended — Never Expires, No Google Cloud Billing Required): Google Apps Script Web App URL + Secret Key

1. **Upload `teams_rosters.json` to Your Roster Folder**:
   - Drag and drop your local `teams_rosters.json` file (which is excluded from Git via `.gitignore`) into your Google Drive folder:
     [`https://drive.google.com/drive/u/0/folders/1-GSovenRouWVnOw-L9kbSbrT061SLLT9`](https://drive.google.com/drive/u/0/folders/1-GSovenRouWVnOw-L9kbSbrT061SLLT9)
2. **Create Your Google Apps Script Key / Endpoint**:
   - Go to [`https://script.google.com`](https://script.google.com) and click **New project**.
   - Copy and paste the contents of [`google-drive-bridge/Code.gs`](./google-drive-bridge/Code.gs) into the editor.
   - *(Optional)* Set `var SECRET_KEY = 'your-secret-password';` on line 24 of `Code.gs` so only someone with your secret key can load rosters or save games.
   - Click **Deploy → New deployment** (top right).
   - Click the gear icon next to **Select type** and choose **Web app**.
   - Set:
     - **Execute as**: `Me`
     - **Who has access**: `Anyone`
   - Click **Deploy**, grant permission to your Google account, and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
3. **Paste Into the Scoreboard App**:
   - Open the Scoreboard App → **👥 Roster & Setup** → **⚙️ Setup Google Connection Key**.
   - Paste your **Web App URL** and **Secret Key**, then tap **Save & Sync Roster**.
   - The app saves your key in your device's browser `localStorage` (never in GitHub) and immediately loads your teams and players!

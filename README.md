# Telegram OSINT Reconnaissance Hub

![Python Version](https://img.shields.io/badge/python-3.8%2B-blue.svg)
![Flask](https://img.shields.io/badge/framework-Flask-lightgrey.svg)
![Interface](https://img.shields.io/badge/UI-Interactive%20Graph%20%2B%20Grid-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

An advanced, automated Open Source Intelligence (OSINT) reconnaissance platform designed for analyzing Telegram entities, investigating threat actors, resolving anonymous handles, and tracking digital footprints. The engine accepts Telegram usernames, phone numbers (E.164), channel handles, or numeric user IDs and streams deep tactical intelligence in real-time.

---

## Table of Contents

- [Features Overview](#features-overview)
- [Reconnaissance Modules](#reconnaissance-modules)
- [Interactive Cyber Graph & UI](#interactive-cyber-graph--ui)
- [Architecture](#architecture)
- [Installation & Quickstart](#installation--quickstart)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Configuration & Themes](#configuration--themes)
- [Operational Security (OPSEC)](#operational-security-opsec)
- [Disclaimer & License](#disclaimer--license)

---

## Features Overview

- **Multi-Type Target Auto-Detection**: Automatically identifies whether input is a phone number (`+1...`), a permanent numeric Telegram User ID (`123456789`), a public handle (`@username`), or a keyword query.
- **Real-Time Streaming Telemetry**: Utilizes Server-Sent Events (SSE) to deliver intelligence card-by-card with a live progress HUD and terminal log strip.
- **Interactive Force-Directed Graph**: Toggle between a standard responsive card grid and an interactive HTML5 canvas graph featuring particle flow animations, node dragging, zoom/pan navigation, and hover intelligence popups.
- **Individual Module Re-check**: Re-probe individual modules directly on demand without restarting the entire reconnaissance pipeline.
- **Web Audio Sound Synthesizer**: Built-in procedural audio synthesizer for tactical audio feedback (beeps, arrival notifications, and purge sweeps) using the native browser Web Audio API.
- **Local Data Persistence**: Automatically stores target profiles in structured JSON format for instant retrieval across sessions.

---

## Reconnaissance Modules

The platform integrates 16 specialized reconnaissance and correlation vectors:

| # | Module | Description |
|---|--------|-------------|
| 1 | **Live Web Gateway Probe** | Extracts public Telegram bio, display name, entity classification (User, Channel, Supergroup, Bot), verification status, and avatar image from `t.me`. |
| 2 | **Phone Number Routing & Intel** | Parses E.164 phone numbering plans, provides country geolocation hints, and identifies Telegram Anonymous Fragment numbers (`+888` TON blockchain). |
| 3 | **Phone-to-Username Discovery** | Maps phone numbers to contact sync vectors and public lookup aggregators (MTProto contact sync, Truecaller, Sync.me, WhatsApp endpoints, and telecom registries). |
| 4 | **Historical Username & Wayback Archive** | Queries the Wayback Machine CDX API for historical `t.me` snapshots spanning 2013 to the present, alongside commands for rename tracking bots (`@SangMata_BOT`, `@UserInfobot`, etc.). |
| 5 | **Sequential User ID Epoch Estimator** | Calculates Telegram account vintage, era, and creation year range based on Telegram's sequential 32-bit and 64-bit monotonically increasing user IDs. |
| 6 | **Fragment TON Blockchain Intel** | Queries Fragment.com TON blockchain auctions for anonymous +888 virtual phone numbers, auctioned usernames, and TON DNS endpoints (`.t.me`). |
| 7 | **Breach Correlation & Leaked DBs** | Generates de-anonymization search queries across breach archives (IntelX, Snusbase, DeHashed, LeakCheck) to connect handles or numbers to credential dumps. |
| 8 | **Malware C2 & Threat Intel Pivots** | Cross-references handles against malware detonation sandboxes, dynamic sandbox traces, and IoC registries (VirusTotal, Hybrid Analysis, ANY.RUN, ThreatFox, GitHub leaked bot tokens). |
| 9 | **Cryptocurrency & Financial Tracking** | Identifies illicit escrow payment rails (USDT TRC-20, BTC, ETH, TON), provides blockchain explorer pivots, and offers regex address pattern matchers. |
| 10 | **Cybercrime Underground & Dark Web** | Cross-searches Russian and international threat actor forums (BreachForums, XSS.is, Exploit.in), pastebins (Rentry, JustPaste.it, Pastebin), and Tor hidden service search engines (Ahmia). |
| 11 | **Metadata Forensics & Forward Origin** | Maps immutable MTProto artifacts including `forward_from_chat` parent IDs, custom sticker pack creator User IDs, monotonic channel message ID gaps, and media SHA-256 fingerprinting. |
| 12 | **Geospatial & Trilateration Intel** | Outlines trilateration methodologies using Telegram's location-based services (Nearby), calculates UTC timezone operational shifts based on posting cadence, and analyzes VoIP P2P STUN IP leak surfaces. |
| 13 | **Search Directories & Analytics** | Queries specialized Telegram intelligence indices including TGStat, Telemetr.io, Lyzem, Telegago, and TDirectory for channel growth metrics and repost graphs. |
| 14 | **Targeted Search Dorks** | Synthesizes search dorks for Google, Yandex, and DuckDuckGo targeting leaked documents (`pdf`, `xlsx`, `sql`), private invite links, web preview indexes, and exposed bot tokens. |
| 15 | **Telegram Deep Links** | Generates direct dispatch links for native applications (`tg://resolve`), web preview gateways, and web clients (Telegram Web A, Web K). |
| 16 | **Alias & Bot Permutations** | Generates predictive permutations of the handle (`_bot`, `_channel`, `_support`, `_vip`, `_backup`, `join_*`) to discover linked shadow assets and phishing impersonations. |

---

## Interactive Cyber Graph & UI

Switch seamlessly between two visualization modes using the header controls:

1. **Grid Mode**: A multi-column dashboard with formatted data tables, quick-copy blocks, direct action buttons, and individual re-check triggers.
2. **Cyber Graph Mode**: An HTML5 interactive canvas connecting the target node to all discovered intelligence nodes via simulated spring and repulsive physics.
   - **Drag**: Click and drag any node to reposition.
   - **Zoom & Pan**: Use the mouse wheel to zoom in/out and drag the canvas background to pan.
   - **Hover Inspection**: Hovering over any satellite node displays a live preview card containing the module's intelligence.
   - **Dynamic Filtering**: The top search box filters both grid cards and dims unmatching nodes in the graph in real-time.

---

## Architecture

```text
+-------------------------------------------------------------+
|                      Web Browser Client                     |
|  - Real-time SSE listener (EventSource)                     |
|  - Web Audio API Sound Synthesizer                          |
|  - Force-Directed HTML5 Canvas Graph Engine                 |
|  - Responsive CSS Grid & Tactical Themes                    |
+-------------------------------------------------------------+
                              |  ^ (SSE Stream / JSON)
                              v  |
+-------------------------------------------------------------+
|                     Flask Backend (app.py)                  |
|  - Target taxonomy classifier (detect_target_type)          |
|  - Live t.me HTTP parser & metadata extractor               |
|  - Wayback Machine CDX API integration                      |
|  - Dork & permutation heuristic generators                  |
|  - Local JSON Intel Cache & Settings Manager                |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                 Local Intel Storage Directory               |
|                 (default: ~/TelegramOSINTData/)             |
+-------------------------------------------------------------+
```

---

## Installation & Quickstart

### Prerequisites

- Python 3.8 or higher
- Standard Python package manager (`pip`)

### Step-by-Step Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/telegram-osint-hub.git
   cd telegram-osint-hub
   ```

2. **Create and activate a virtual environment (recommended):**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install Flask
   ```

4. **Launch the application:**
   ```bash
   python app.py
   ```

5. **Open the interface:**
   Navigate to `http://localhost:5001` (or your configured port) in any modern browser.

---

## Usage

### Basic Execution

- **Default Port**: The server starts on port `5001` by default.
- **Custom Port**: Pass `--port <number>` via the command line:
  ```bash
  python app.py --port 8080
  ```

### Input Examples

In the main search bar, you can input:

- **Telegram Username**: `durov`, `@telegram`, `investigator_test`
- **International Phone Number**: `+14155552671`, `+447700900077`, `88801234567`
- **Telegram User ID**: `123456789`
- **Direct URL**: `https://t.me/durov`

Click **PROBE TELEGRAM** or press **Enter**. The system will establish a live Server-Sent Events stream and progressively populate intelligence cards and graph nodes.

---

## API Reference

### 1. Real-Time OSINT Event Stream
- **Endpoint**: `GET /api/osint/stream`
- **Parameters**:
  - `target` (string, required): The handle, phone number, or user ID.
- **Response**: `text/event-stream`
  - Events emitted: `start`, `log`, `card`, `complete`, `error`.

### 2. Single Module Re-check
- **Endpoint**: `POST /api/osint/recheck`
- **Body** (`application/json`):
  ```json
  {
    "username": "durov",
    "card_type": "tg_profile"
  }
  ```
- **Response**: Updated module JSON payload and status code.

### 3. Fetch Stored Records
- **Endpoint**: `GET /api/osint/records`
- **Response**: Array of cached target profile objects sorted by timestamp (newest first).

### 4. Purge All Records
- **Endpoint**: `POST /api/osint/clear`
- **Response**: JSON confirmation and count of deleted records.

### 5. Settings Management
- **Endpoint**: `GET /api/settings`
  - Retrieves current application settings.
- **Endpoint**: `POST /api/settings`
  - Updates configurations such as `theme`, `sound_enabled`, and `data_path`.

---

## Configuration & Themes

Application preferences are stored in `config.json` in the root folder:

```json
{
    "data_path": "/home/user/TelegramOSINTData",
    "theme": "matrix",
    "sound_enabled": true
}
```

Available visual themes (accessible via the Settings modal):
- **The Matrix** (`matrix`): Classic hacker green phosphor on obsidian black (default).
- **Cyberpunk** (`cyberpunk`): Neon pink, cyan, and deep purple accents.
- **Dracula** (`dracula`): Muted purple, soft yellow, and dark slate.
- **Dark Slate** (`default`): Clean tactical graphite and teal styling.

---

## Operational Security (OPSEC)

When investigating targets involving threat actors or illicit groups:

1. **Use Dedicated Sock Puppets**: Never conduct live contact synchronization or call resolution tests using personal Telegram accounts.
2. **Network Isolation**: Run investigations through a secure VPN or Tor proxy to avoid disclosing investigator IP addresses during deep link resolution.
3. **VoIP Precautions**: Do not initiate direct Telegram peer-to-peer calls unless connected through an anonymized proxy, as P2P MTProto connections can expose peer IP addresses.
4. **Airgapped Storage**: Use the Settings modal to designate an encrypted disk partition for storing target profile JSON files.

---

## Disclaimer & License

### Legal & Ethical Disclaimer
This tool is developed exclusively for authorized security research, academic study, threat intelligence analysis, and legitimate open-source intelligence gathering. Users are solely responsible for ensuring compliance with applicable local, state, and international privacy laws and platform terms of service. The authors assume no liability for misuse of this software.

### License
This project is licensed under the MIT License. See the `LICENSE` file for details.

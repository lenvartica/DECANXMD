⚡ DECAN XMD
<p align="center">
  <img src="assets/bot.png" alt="DECAN XMD" width="720">
</p>
<p align="center">
  <strong>DECAN XMD — Terminal-First WhatsApp Automation</strong><br>
  <em>Automation • Intelligence • WhatsApp • Terminal</em>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/DECAN%20XMD-v1.2.0-00f5ff?style=for-the-badge&labelColor=050816">
  <img src="https://img.shields.io/badge/Node.js-24-7c3aed?style=for-the-badge&labelColor=050816">
  <img src="https://img.shields.io/badge/Mode-Terminal%20First-00ff9d?style=for-the-badge&labelColor=050816">
  <img src="https://img.shields.io/badge/WhatsApp-Automation-25d366?style=for-the-badge&labelColor=050816">
</p>
---
◇ THE DECAN XMD EXPERIENCE
DECAN XMD is a terminal-first WhatsApp automation runtime built around one simple idea:
> **No unnecessary dashboard. No unnecessary browser layer. Just the bot.**
Designed for hosting panels, VPS environments, and command-line deployments where the terminal is the control center.
```text
╔══════════════════════════════════════════════════════════════╗
║  ⚡ DECAN XMD  ·  v1.2.0                                    ║
╠══════════════════════════════════════════════════════════════╣
║  ● ONLINE   WhatsApp automation runtime ready               ║
║  MODE       TERMINAL FIRST · HOSTING PANEL                   ║
║  LOGS       Live device, command and error events            ║
╚══════════════════════════════════════════════════════════════╝
```
◈ CORE
Capability	Status
WhatsApp automation	⚡ Active
Terminal-first runtime	✓
Hosting-panel friendly	✓
Persistent sessions	✓
Command/plugin architecture	✓
Live runtime logs	✓
Web dashboard dependency	✕
Browser control panel requirement	✕
✦ BUILT FOR THE TERMINAL
DECAN XMD keeps the terminal as the primary interface.
```text
                         ┌─────────────────────┐
                         │     DECAN XMD       │
                         │    CORE RUNTIME     │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
       │   WhatsApp   │      │   Commands   │      │ Events & Logs│
       │    Engine    │      │   / Plugins  │      │              │
       └──────────────┘      └──────────────┘      └──────────────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │    HOSTING PANEL    │
                         │      TERMINAL       │
                         └─────────────────────┘
```
No browser dashboard is required for the bot runtime.
⟡ COMMAND ECOSYSTEM
DECAN XMD uses a modular command architecture so features can be added without turning the core runtime into one giant file.
🤖 AI and intelligent utilities
👥 Group management
🛡️ Security and moderation
🎮 Games and entertainment
🎵 Audio and media
📁 Files and documents
🔎 Search tools
🧰 Developer utilities
📊 System information
💬 WhatsApp utilities
🖼️ Image and media tools
🏆 Sports utilities
💰 Economy features
🧩 Plugin functionality
⚙️ General bot utilities
◉ SESSION ARCHITECTURE
```text
             ┌─────────────┐
             │    START    │
             └──────┬──────┘
                    │
                    ▼
           ┌──────────────────┐
           │ LOAD LOCAL SESSION│
           └────────┬─────────┘
                    │
               ┌────┴─────┐
               │          │
             VALID     MISSING /
               │        INVALID
               ▼          │
        ┌──────────┐      ▼
        │  RESTORE │  ┌─────────┐
        │  DEVICE  │  │ PAIRING │
        └────┬─────┘  └────┬────┘
             │             │
             └──────┬──────┘
                    ▼
               ┌───────────┐
               │   ONLINE  │
               └─────┬─────┘
                     │
                     ▼
               ┌──────────────┐
               │ SAVE SESSION │
               └──────────────┘
```
Keep authentication/session data private. Never commit credentials, tokens, or private session files to GitHub.
⚡ QUICK START
1. Clone the repository
```bash
git clone https://github.com/lenvartica/DECANXMD.git
cd DECANXMD
```
2. Install dependencies
```bash
npm install
```
3. Configure environment
Review `.env.example`, then create your local `.env` file and fill in the configuration required by your installation.
Never publish the real `.env` file or its values.
4. Start the bot
```bash
npm start
```
The project's current runtime entry file is `server.js`. If you are starting it directly rather than using the package script, use:
```bash
node server.js
```
◇ HOSTING PANEL MODE
DECAN XMD is designed for Node.js hosting panels and VPS environments.
Configure the panel with the Node.js version required by the project and install dependencies with:
```bash
npm install
```
Set the startup file to:
```text
server.js
```
If the hosting panel supports an npm start command, use the start script defined in `package.json`.
The bot does not require a web dashboard or HTTP port simply to operate as a WhatsApp automation runtime. Follow the actual configuration of your deployment if you enable any optional web-facing features.
⟐ PROJECT STRUCTURE
```text
DECANXMD/
│
├── server.js              ← Runtime/server entry point
├── terminal.js            ← Terminal interface
├── bot-commands.js        ← Command handling
├── package.json           ← Project metadata and scripts
├── package-lock.json      ← Locked dependency versions
├── commands/              ← Modular commands
├── lib/                   ← Core runtime libraries
├── assets/                ← Branding and media
├── public/                ← Public-facing assets, if used
├── .env.example           ← Environment variable template
├── INSTALL.bat            ← Windows installation helper
├── START.bat              ← Windows startup helper
├── CHANGELOG.md           ← Version history
└── PANEL_TERMINAL.md      ← Hosting-panel/terminal guidance
```
Runtime-generated data and authentication files should remain outside source control.
◇ DESIGN PHILOSOPHY
```text
DARK CORE
    +
CYAN ENERGY
    +
NEON SIGNALS
    +
MODULAR AUTOMATION
    +
TERMINAL CONTROL
    =
DECAN XMD
```
DECAN XMD is designed to feel like a command center, not another generic WhatsApp script.
🧠 DECAN KONNECT
DECAN XMD is part of the DECAN KONNECT technology ecosystem.
Founder & Developer: Lenny Muriuki
> Technology should connect people, systems and ideas — without unnecessary complexity.
⚠️ SECURITY
Never publish:
WhatsApp authentication/session files
API keys
Passwords
Private tokens
Database credentials
Environment secrets
Private deployment configuration
Use `.gitignore` to keep runtime secrets outside Git.
📜 DISCLAIMER
DECAN XMD is an automation project intended for legitimate development, testing, and authorized automation.
Users are responsible for complying with WhatsApp's terms, applicable laws, and the rules of any service they connect to.
✦ DECAN XMD
```text
██████╗ ███████╗ ██████╗ █████╗ ███╗   ██╗
██╔══██╗██╔════╝██╔════╝██╔══██╗████╗  ██║
██║  ██║█████╗  ██║     ███████║██╔██╗ ██║
██║  ██║██╔══╝  ██║     ██╔══██║██║╚██╗██║
██████╔╝███████╗╚██████╗██║  ██║██║ ╚████║
╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝

                 X M D
```
<p align="center">
  <strong>DECAN XMD</strong><br>
  <sub>Terminal • Automation • Intelligence • WhatsApp</sub>
</p>

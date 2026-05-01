# Project Zomboid Server Manager

A desktop app for running and managing Project Zomboid Build 42 dedicated servers on Windows. Skip the .bat files and the manual mod-juggling — install the dedicated server, configure it, manage workshop mods, schedule restarts, broadcast chat, and watch player activity from one window.

<img width="1384" height="889" alt="Dashboard" src="https://github.com/user-attachments/assets/d7c14a72-c1ff-4af8-acd7-b802b7e2f31c" />

---

## What it does

- **One-click install of SteamCMD + the Build 42 dedicated server** to whichever drive you choose, or import an install you already have.
- **Live Dashboard** with a slim status header, broadcast chat to all connected players, and a real-time online-player list.
- **Workshop mods** with automatic Mod ID detection — paste a workshop URL, the manager downloads it via SteamCMD, reads each `mod.info`, and writes the correct IDs into `servertest.ini` so the server actually loads them.
- **Player history + live tracking** with steam IDs, session times, and a fallback that pulls live names directly from the server console when the connect-log regex doesn't match.
- **Settings, sandbox, and INI editing** — both a guided form and the raw `servertest.ini` editor, plus the `SandboxVars.lua` editor.
- **Recurring daily restart schedules** — set "Restart at 02:30" and the manager broadcasts 5-min and 1-min warnings, then performs a clean save → quit → relaunch automatically.
- **In-game chat log** captured from the server log so you can see what players are saying without alt-tabbing.
- **Backups & wipe** — snapshot your save before risky changes, or wipe the world / players / config selectively.
- **Auto-updates** — the app polls GitHub Releases and installs new versions on relaunch. No need to redownload manually.

## Latest update — v1.2.3

- New slim Dashboard header: status + IP / players / uptime · server name · Start / Restart / Stop, all on one row.
- In-game chat log added to the Monitoring tab.
- Recurring daily restart schedules in Settings → Schedules. Add as many times as you want (e.g. 02:30, 14:00). Persists across manager restarts.
- Players tab now shows names live from the server console, even when the connection-log format doesn't match a known regex.
- Installer page restructured with clear "Current Install" → "Step 1 SteamCMD" → "Step 2 PZ Server" → "Move existing server" sections. You can now change the install drive before installing or point the manager at an existing server you've moved manually.
- In-app patch notes — click the version button at the bottom of the sidebar to read the changelog. Auto-opens once after each update.

Full changelog: see the in-app patch notes button or [Releases](../../releases).

## Installation

1. Download the latest installer from the [Releases page](../../releases/latest):  
   `PZ-Server-Manager-Setup-X.Y.Z.exe`
2. Double-click to run. Windows SmartScreen will warn that the app is from an unrecognised publisher (the build is unsigned) — click **More info → Run anyway**. This is one-time.
3. Click through the wizard. The installer is per-user (no admin prompt) and creates a Start Menu / Desktop shortcut.
4. Launch **PZ Server Manager** from the Start Menu.
5. On first run, go to the **Installer** tab and:
   - (Optional) Change the install drive in the **Current Install** card if you want SteamCMD or the PZ server on a different drive.
   - Click **Install SteamCMD** — small download, takes ~30 seconds.
   - Click **Install PZ Server** — full Build 42 dedicated server, ~2-3 GB. **You must own Project Zomboid on Steam.**
   - Already have a server installed elsewhere? Use the **"Already have a server installed elsewhere?"** card to point the manager at it instead.

That's it — the Dashboard's **Start** button takes it from there.

## Auto-updates

Once installed, the manager checks GitHub for new versions on launch. When one is available it downloads in the background and prompts you to restart and install. You can also click **Check for Updates** in the top-right at any time. No need to revisit the Releases page once you've installed.

## Building from source

```bash
git clone https://github.com/bp8np4fh6b-del/Project-Zomboid-Server-Manager.git
cd Project-Zomboid-Server-Manager
npm install
npm run dev          # Vite dev server + Electron in dev mode
npm run dist:win     # Build a fresh installer into ./release
```

Built with Electron + React + Vite + TypeScript + Tailwind. Auto-updates via `electron-updater`, packaged with `electron-builder`.

## Screenshots

<details>
<summary>Click to expand all screenshots</summary>

<img width="1726" height="1126" alt="Installer" src="https://github.com/user-attachments/assets/feb1682a-002d-47a3-8641-c45673322571" />

<img width="1723" height="1125" alt="Settings" src="https://github.com/user-attachments/assets/47be8f3a-7784-401d-b49a-ef9e22f64fa1" />

<img width="1734" height="1133" alt="Sandbox" src="https://github.com/user-attachments/assets/fb9ef7f1-9f75-444f-bd75-0f550b9827a3" />

<img width="1723" height="1134" alt="Mods" src="https://github.com/user-attachments/assets/707259f1-86c7-401b-b6a4-2ef29bef22a6" />

<img width="1723" height="1134" alt="Players" src="https://github.com/user-attachments/assets/7b9fb269-ed58-40e8-8101-67cbee916332" />

<img width="1722" height="1127" alt="Monitoring" src="https://github.com/user-attachments/assets/48898635-c1f2-453f-a22d-99752a9868c0" />

<img width="1716" height="1130" alt="Wipe" src="https://github.com/user-attachments/assets/2f34aee9-760e-403e-bf8b-b4dadebcc1f0" />

</details>

## Requirements

- Windows 10 or 11, 64-bit
- A Steam account that **owns Project Zomboid** (required to download the dedicated server files)
- ~3 GB free disk space (PZ server + mods)
- Recommended: 8 GB+ RAM if running the server on the same machine

## Known limitations

- Windows only for now. Linux / macOS aren't supported by the installer.
- The build is unsigned — Windows SmartScreen will warn on first launch (see Installation step 2).
- Live broadcast chat and the live player list rely on the manager talking to the running server through stdin. If you launch the dedicated server outside the manager, those features won't be available for that session.

## Support

If something's broken, hit me up:

- **Discord:** `davidlee2904`
- **Email:** Dwils178@gmail.com

Bug reports are most useful with a screenshot or the relevant lines from the in-app log panel.

## License

(Add a license here if you want one — MIT is a common choice.)

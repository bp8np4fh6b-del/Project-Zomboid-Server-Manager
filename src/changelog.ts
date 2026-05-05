// Manager changelog — one entry per shipped version, newest first.
// Each entry feeds the in-app patch-notes modal opened from the sidebar
// version button (and auto-opened once after the manager updates itself).

export interface ChangelogSection {
  added?: string[]
  fixed?: string[]
  qol?: string[]
  notes?: string[]
}

export interface ChangelogEntry {
  version: string
  date: string
  url: string
  sections: ChangelogSection
}

const REPO_RELEASES = 'https://github.com/bp8np4fh6b-del/Project-Zomboid-Server-Manager/releases'

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.3',
    date: '2026-05-05',
    url: `${REPO_RELEASES}/tag/v0.2.3`,
    sections: {
      notes: [
        'Version line reset from 1.x back to 0.x — the manager is treated as pre-release until further notice. Historical releases (1.0.1 through 1.2.3) on GitHub stay as-is; new builds carry on under 0.x.',
        'Kick / Ban use PZ\'s built-in `kickuser` / `banuser` server commands. Bans persist via the server\'s `db/ban.json` — unbanning still requires the server console for now.',
        'Section ordering in this changelog modal is now Notes → Added → Quality of Life → Fixed.',
      ],
      added: [
        'Kick and Ban controls on every online player, available from both the Players tab and the Dashboard\'s Live Console. Each action has an optional reason field and a confirm step (with an extra warning on Ban), and a transient success / error toast surfaces the outcome.',
        'New Installer flow: a single "Set up server" button orchestrates SteamCMD download then PZ Dedicated Server download as one continuous wizard with combined two-phase progress, replacing the old click-each-button card stack.',
        'Installer auto-scans your Steam libraries (via `libraryfolders.vdf`) on first open. If an existing PZ Dedicated Server install is detected on any drive, a banner offers "Use this" so you adopt it in one click instead of re-downloading 2–3 GB.',
        '"I already have one" path in the wizard lets you point at any existing dedicated server folder, with `detectExistingServer` validating the launcher before adopting it.',
        'Once the server is fully installed, the Installer tab collapses into a compact summary card showing the current paths plus Reinstall / Repair and Move-to-a-different-drive shortcuts, with a Go-to-Dashboard CTA after a fresh install.',
        'Admin status chip on the Players tab and Dashboard Live Console — at a glance you can see whether kick / ban actions are currently available.',
      ],
      qol: [
        'Changelog modal: "Older / Newer" buttons renamed to Back / Next; the footer "View on GitHub" button is now a Close button, and the GitHub link is an inline clickable text link at the end of each entry\'s body.',
        'Removed the legacy File / Edit / View / Window / Help menu bar — none of those entries did anything for this app, and the renderer ships its own UI chrome.',
        'Modern themed scrollbars throughout the manager — thin, dark, transparent track, and consistent with the rest of the UI instead of the chunky default Windows scrollbar.',
        'Steam-library auto-scan presents found installs with their source ("Steam library: D:\\SteamLibrary", etc.) so you can tell which one you\'re adopting before you click.',
      ],
      fixed: [
        'Server failed to start when the launcher path contained spaces (the default Steam path "Project Zomboid Dedicated Server" does). The cmd.exe quoting now uses `cmd /d /s /c "<full quoted command>"` with `windowsVerbatimArguments`, so paths with spaces survive end-to-end.',
        'Kick / Ban now ride on the same in-house stdin console the rest of the manager uses — Build 42\'s RCON path was returning `RCONERROR` even with a valid password set. Stdin is fire-and-forget, so success means "command sent"; the player-list poll confirms the effect within a few seconds and the Activity feed gets an audit entry.',
      ],
    },
  },
  {
    version: '1.2.3',
    date: '2026-04-30',
    url: `${REPO_RELEASES}/tag/v1.2.3`,
    sections: {
      added: [
        'Dashboard redesigned: slim horizontal status bar with online/offline + IP / online count / uptime on the left, server name in the middle, and Start / Restart / Stop on the right.',
        'In-game chat log on the Monitoring tab — see public chat messages in real time without alt-tabbing to the server console.',
        'Daily Schedules — set restarts at specific clock times (e.g. "Restart at 02:30") in the new Schedules tab inside Settings. Multiple schedules supported, persisted across manager restarts, with broadcast warnings 5 min and 1 min before each fire.',
      ],
      fixed: [
        'Players tab now shows player names even when the connect-log regex misses Build 42\'s line format. Live names from the console populate the list (and persist) automatically every 5 seconds.',
      ],
      qol: [
        'Installer page restructured: install paths up top, SteamCMD step, server step, and a clearer "Already have a server installed elsewhere?" import flow. Each install card explicitly shows its target path so you understand where things will land.',
      ],
      notes: [
        'The temporary "Restart in N minutes" control on the Dashboard has moved to Settings → Schedules. The live broadcast chat input on the Dashboard stays.',
        'Steam IDs and IPs still come from the connection-log parser; they\'ll backfill onto live-detected players if the regex catches a matching line.',
      ],
    },
  },
  {
    version: '1.2.2',
    date: '2026-04-30',
    url: `${REPO_RELEASES}/tag/v1.2.2`,
    sections: {
      fixed: [
        'Replaced the RCON system with an in-house live console driven by the server process stdin — no port, no password, no firewall surface, and it no longer fails silently when port 27015 is blocked.',
        'Live Console panel on the Dashboard is now visible even when the server is offline; controls activate when the server comes online.',
        'Manual "Check for Updates" no longer renders a duplicate pill. The button and the update-state pill are now a single element that swaps based on state.',
      ],
      added: [
        'In-app patch notes: click the version in the sidebar to open the changelog. The dialog also auto-opens once after each update so you immediately see what changed.',
        'Manager version is more prominent in the sidebar footer and links straight to the GitHub release for the version you\'re reading.',
      ],
      notes: [
        'RCONPort/RCONPassword are no longer auto-written to servertest.ini. Existing entries are harmless and can be left alone.',
      ],
    },
  },
  {
    version: '1.2.1',
    date: '2026-04-30',
    url: `${REPO_RELEASES}/tag/v1.2.1`,
    sections: {
      added: [
        'Live Console on the Dashboard with broadcast chat, scheduled restarts (with player warnings), and a live online-player list.',
        'Scheduled restarts perform a clean save → quit → relaunch on a timer with optional 5-min and 1-min warning broadcasts.',
      ],
      fixed: [
        'Players tab now uses live player data while the server is running, with log-parsing as fallback.',
        'Monitoring tab rebuilt as a Server Activity feed: status, online count, uptime, and a chronological event list. The fake CPU/RAM charts are gone.',
      ],
      qol: [
        'Install paths moved to the top of the Installer page so you can choose the install drive before running the install.',
        'Bundle size dropped (635 KB → 265 KB) after dropping pidusage.',
      ],
    },
  },
  {
    version: '1.2.0',
    date: '2026-04-30',
    url: `${REPO_RELEASES}/tag/v1.2.0`,
    sections: {
      added: [
        'Configurable install directories for the manager, the PZ server, and the Zomboid user folder — different drives supported.',
        'Import an existing PZ dedicated server install instead of running a fresh download.',
        'Real CPU + RAM charts on the Monitoring tab via pidusage.',
      ],
      fixed: [
        'Player monitoring on Build 42: connect/disconnect parser broadened to match more line formats; added a Parser Diagnostics panel for unmatched lines.',
      ],
      qol: [
        'Manager version visible in the sidebar.',
        'Manual "Check for Updates" button in the top bar.',
      ],
    },
  },
  {
    version: '1.0.1',
    date: '2026-04-29',
    url: `${REPO_RELEASES}/tag/v1.0.1`,
    sections: {
      added: [
        'Auto-update via electron-updater pointing at GitHub Releases. Future versions install themselves with one click.',
      ],
    },
  },
]

export const LATEST_CHANGELOG = CHANGELOG[0]

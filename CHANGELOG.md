# DECAN XMD Changelog

## 🚀 VERSION 1.2.0 — Fewer limits, more commands, sturdier core

**Football, WWE, photo studio and downloads (54 more commands, 124 new in total)**
- `.pair <number>` now sends the step-by-step instructions first, then the pairing code alone in a second message so it is easy to copy. In a group it goes to your private chat.
- Football: `squad` `nextmatch` `lastresults` (form) `scorers` `leaguenews` `injuries` `fulltable` `titlerace` `relegation` `wcgroups` `ustable` (+ `nbatable` `nfltable` `nhltable` `mlbtable`) `sportsmenu`.
- WWE: `wwechamps` `wweschedule` `wweresults` `wwerumors` `wwemania` `royalrumble` `summerslam` `survivorseries` `aew` `superstar` `wwedraft` `wwehof` `wwewomen` (fresh headlines, there is no free live wrestling feed).
- Photo studio (reply to an image; many take a strength 1-10): `hd` `autofix` `hdr` `darken` `fade` `warm` `cool` `vintage` `noir` `glow` `dreamy` `cyberpunk` `sunset` `emboss` `oldphoto` `vignettefx` `cleanimg` `mirrorfx` `neonedge` `duotone` `polaroid` `roundcorners` `picfilters`.
- Downloads: `apksearch` `apkdl <package>` `appinfo` `gitclone <owner/repo>` `ghrelease <owner/repo> [n]` `ytthumb <link>`.
- Menu: 4 new sections (Downloaders & Apps, Football & Sports, WWE & Wrestling, Photo Studio).
- `.tostatus` posts a replied photo, video, voice note or text (or typed text) to your WhatsApp status in one command. `.save` now re-sends replied photos, videos, voice notes and statuses to your own chat (add `here` to keep it in the current chat).
- Every reply now uses the signature layout from the welcome message and menu: the `┏❒ 👑 ✦ DECAN XMD ✦ 👑 ❒` header, `┃` side rails and a `┗❒` footer (style `decan`, now the default; `.frame` still lets you pick others). Tables and code blocks keep their width.
- One frame everywhere: text tools (`mock` `clap` `vapor` `uwu` `leet` `piglatin` `bold` `style` `fancy`…) and photo/video captions now use the same frame as every other reply. `.version` is a short card; `.changelog [page]` and `.postupdate release` split long notes into clean pages.
- Status fix: `.tostatus` (and `.statusimage` / `.statusvideo` / `.textstatus`) now reach your contacts and every member of your groups, not only people who had messaged the bot. `.tostatus video [seconds]` turns a replied photo into a short vertical video status.
- Bigger downloads: `.insta` `.fb` `.tiktok` `.twitter` `.reddit` `.pinterest` and `.video` stream to disk and send from disk. Add a quality (`720`, `1080`) and/or `doc` to get a document; large files are sent as documents automatically. Limits are settable: `MAX_VIDEO_MB` (700), `MAX_APK_MB` (400), `MAX_INLINE_VIDEO_MB` (64).
- `.movie <title>` shows the details card plus free full-length copies (Internet Archive and YouTube); `.movie <number>` sends the file as a document. `.drama <title>` and `.cartoon <title>` do the same (reply to a photo with `.cartoon` to cartoonize it as before). Limits: `MAX_MOVIE_MB` (1500), `MAX_MOVIE_MINUTES` (300).
- `.apk` now searches Aptoide, F-Droid and GitHub releases together, falls back to the next source if one has no file, and `.apksearch` lists all results so `.apk <number>` downloads your pick.
- Note: `scorers` depends on ESPN exposing a leaders feed for the league; if it does not, the command says so instead of failing.

**Fixes**
- Network failures no longer show a bare "fetch failed". Replies now say what went wrong (DNS, timeout, refused, HTTP status), and GET requests retry once on a dropped connection or a 429/5xx.
- Reconnects now back off (3s, 6s, 12s … up to 60s) instead of hammering WhatsApp every 3 seconds, and a "connection replaced" (440) stops auto-reconnect instead of starting a tug-of-war with the other copy of the bot — the root cause of the "Bad MAC" / bot-goes-silent problem.
- The same WhatsApp message delivered twice (live + offline sync) is now handled once. This replaces what the old fixed 1.5s cooldown was doing by accident.
- Welcome message showed a hard-coded "Thunder XMD" and "Version 1.1.0". It now shows your WhatsApp name and the real version; the menu and dashboard show the real version too.
- `.tuner` crashed when sent with no note.
- `.gpt/.gemini/.groq/.or` with no API key for that provider now use any other provider that does have a key before falling back to the free keyless model, and the keyless path tries two request shapes with a clear message if it is down.

**Limits removed or made yours to set**
- Global per-user command cooldown: was fixed at 1.5s, now off by default. `setvar COOLDOWN:<seconds>` or `limits cooldown <s>` turns it back on.
- Download size (was 90 MB), media length (was 25 min) and media size (was 62 MB) are now settings: `MAX_DOWNLOAD_MB` (150), `MAX_MEDIA_MINUTES` (60), `MAX_MEDIA_MB` (100). Change them live with `.limits` or in the dashboard's Environment panel — no restart.
- `.access <command> everyone|admin|owner` lets the owner decide who can use any ordinary command. Commands that run code on the host, change the bot's login/settings, drive your own WhatsApp account, or are destructive moderation (kick, promote, demote, exec …) stay locked on purpose.
- `.alias <shortcut> <command> [preset text]` — your own command shortcuts.

**Menu, bold text and fonts (merged from the Framed Menu + Reordered Menu updates)**
- The reordered, themed menu is now the menu, built on your `core.js`. Every entry is bold, section titles use a Unicode font, and the version/uptime/RAM header is live.
- Fixed 15 dead entries in the reordered menu that pointed at commands that do not exist (`remini`, `jail`, `tomp3`, `tovn`, `getsession`, `clearsession`, `detect`, `reactstatus`, `statusreply`, `devices`, `qrgen`, `commit`, `js`, `bug`, `setmenu`). Each now points at the real equivalent (`upscale`, `wasted`, `mp3`, `audioconvert`, `sessions`, `clearcache`, `spamcheck`, `textqr`, `javascript`, `report`, `menufont`) or is dropped. The menu also hides any name that is not a registered command and anything you have disabled, so it can never show a dead entry again.
- Fixed bold that would not render: `* 1.*` (a space after the opening asterisk) is not bold in WhatsApp; numbers are now padded outside the markers.
- Every command reply is now framed automatically (from the Framed Menu update); text that is already framed is never wrapped twice, and a command can opt out with `noFrame: true`.
- 6 new menu sections: Fonts & Text Style, Text Tools, Money & Finance, Dates & Time, Numbers & Converters, Control Center.
- `.menu list` (numbered index) • `.menu <number or name>` (one section, e.g. `.menu ai`) • `.menu new` • `.menu cats` • `.menu cat <category>` (everything in a category, e.g. `.menu cat tools`).
- `.menufont <name|number|reset|list>` chooses the font for menu titles. New font engine with 29 styles (bold, serif, italic, script, fraktur, double-struck, mono, circled, squared, bracketed, fullwidth, small caps, super/subscript, upside-down, strikethrough, underline …) that also patches the Unicode "holes" (ℬ ℭ ℂ ℎ …) so no letter ever turns into a blank box.

**69 new commands** (all computed locally, so they work even when a website is down)
- Control: `access` `alias` `unalias` `aliases` `limits` `doctor` `menufont`
- Fonts: `style` `fontlist` `bold` `italic` `mono` `smallcaps` `bubble` `strike` `underline`
- Text: `wordcount` `textcase` `slug` `lorem` `mock` `clap` `vapor` `uwu` `leet` `piglatin` `nato` `acronym` `initials` `charcount` `sortlines` `uniquelines` `reverselines` `numberlines` `extractemails` `extracturls` `extractnumbers` `anagram` `palindrome`
- Money: `loan` `savings` `compound` `splitbill` `vat` `tip` `discount` `percent` `percentchange` `roi` `margin` `breakeven`
- Dates: `age` `daysbetween` `dateadd` `workdays` `weeknum` `dayofweek` `leapyear` `sleepcalc` `generation` `birthstone`
- Numbers & dev: `roman` `numwords` `prime` `baseconv` `temp` `hexcolor` `ipcalc` `urlparse`
- Game: `wordle`

## 🔥 VERSION 3.7.1 — Command runtime stability

- Stabilised command lifecycle loading for restored multi-device sessions.
- Prevented missing or malformed hooks, events, and ticker collections from crashing the bot.
- Preserved existing WhatsApp sessions and command handlers.
- Kept channel forwarding support intact while welcome messages remain link-free.


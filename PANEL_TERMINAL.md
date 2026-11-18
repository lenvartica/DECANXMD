# DECAN XMD — Hosting Panel Terminal Mode

## First setup
1. Upload this ZIP to your Node.js hosting panel.
2. Use Node.js 20.6+.
3. Install dependencies:
   `npm install`
4. Set the panel startup command to:
   `npm run terminal`
5. Start the application.
6. In the panel terminal enter the WhatsApp number with country code, for example:
   `2547XXXXXXXX`
7. The terminal prints the real WhatsApp pairing code under the **DECANXMD READY** banner.
8. On WhatsApp open **Settings → Linked devices → Link a device → Link with phone number instead** and enter that code.

## Non-interactive panels
If the panel does not provide interactive stdin, add this environment variable before starting:

`PAIR_PHONE=2547XXXXXXXX`

Then start with:

`npm run terminal`

## Important
`DECANXMD` is the bot name/terminal label. WhatsApp generates the actual pairing code; the bot cannot choose an arbitrary pairing code such as `DECANXMD`.

## Normal production mode
If you already paired a device and want only the web runtime without the terminal pairing prompt, use:

`npm run panel`

The project keeps local session data under `data/` so a restart can restore registered sessions.

## Security
- Do not publish `.env` files or WhatsApp session credentials.
- The supplied package intentionally excludes the original `.env` file.
- JavaScript application files are packaged in a lightweight runtime-obfuscated form.
- Obfuscation is not encryption and should not be treated as a substitute for protecting server access and credentials.

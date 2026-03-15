# Getting Started

You'll need to have the following environment to work with this project:

- Node.js LTS

That's all folks!

# Build for Firefox

```
npm install
npm run build-ff
```

Auto-reload on change:
```
npm run watch-ff
```

# Build for Chrome

```
npm install
npm run build
```

Auto-reload on change:
```
npm run watch
```

Main config values are exposed in `config.js` at the root of the project
for QA and dev to conveniently create custom-builds.

# Build exact version from ZIP

To get the exact same build from source.zip, extract its content in an empty
folder then run:

Firefox:
```
npm ci && npm run pack-ff
```

Will generate: `vpn-proton-firefox.zip`

Chrome:
```
npm ci && npm run pack
```

Will generate: `vpn-proton-chrome.zip`

All steps including unzipping and dependencies install:
```
apt-get install zip
unzip source.zip -d vpn-bex
cd vpn-bex
npm ci
npm run pack-ff
mv vpn-proton-firefox.zip ../vpn-proton-firefox.zip
cd ..
rm -rf vpn-bex
```

# Localhost Provisioning Bridge

This extension includes a small localhost provisioning bridge so a local page
can seed the extension without going through the normal account website flow.

The moving pieces are:

- `source/js/provisionBridge.ts`
  Listens for `window.postMessage(...)` on `http://localhost/*` and `http://127.0.0.1/*`.
- `source/js/messaging/provisionSession.ts`
  Saves the Proton session into extension storage.
- `source/js/messaging/applyProvisioningSetup.ts`
  Applies optional initial settings and optional initial connection behavior.

Important constraints:

- The provisioning page must be served from `http://localhost/...` or `http://127.0.0.1/...`.
- `file://...` pages will not work because the content script is only injected on localhost URLs.
- The page must post a message with `type: "provisionSession"` to `window.location.origin`.

## Payload Shape

The page sends this message:

```js
window.postMessage({
  type: "provisionSession",
  data: {
    uid: "proton-uid",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    persistent: true,
    redirectURI: "optional-redirect-uri",
    partnerId: "optional-partner-id",
    setup: {
      settings: {
        notificationsEnabled: true,
        preventWebrtcLeak: true,
        autoConnect: true,
        secureCore: false,
        splitTunneling: {
          enabled: true,
          mode: "exclude",
          domains: [
            "example.com",
            {
              domain: "internal.example",
              withSubDomains: true,
              mode: "exclude"
            }
          ]
        }
      },
      connect: {
        connectNow: true,
        choice: {
          connected: true,
          pick: "fastest",
          exitCountry: "NL",
          entryCountry: "CH",
          city: "Amsterdam",
          logicalId: 12345,
          tier: 1
        },
        serverId: 67890,
        serverLabel: "12"
      }
    }
  }
}, window.location.origin);
```

## Top-Level Fields

- `uid`
  Proton session UID.
- `accessToken`
  Proton access token.
- `refreshToken`
  Proton refresh token.
- `persistent`
  Whether the stored session should persist across restarts.
- `redirectURI`
  Optional redirect URI stored with the session.
- `partnerId`
  Optional partner identifier stored with the session.
- `setup`
  Optional extra provisioning instructions described below.

## `setup.settings`

These values are applied through the extension's own storage-backed settings:

- `notificationsEnabled: boolean`
  Stores the notifications toggle.
- `preventWebrtcLeak: boolean`
  Stores the WebRTC leak protection setting and immediately applies the related privacy setting.
- `autoConnect: boolean`
  Stores the auto-connect preference used during state recovery.
- `secureCore: boolean`
  Stores the Secure Core preference used when filtering candidate logical servers.
- `splitTunneling`
  Stores split tunneling configuration.

`splitTunneling` fields:

- `enabled: boolean`
  Enables or disables split tunneling.
- `mode: "include" | "exclude"`
  Selects include mode or exclude mode.
- `domains`
  Array of domains. Each item may be:
  - a string such as `"example.com"` which defaults to `withSubDomains: true`
  - an object with:
    - `domain: string`
    - `withSubDomains?: boolean`
    - `mode?: "include" | "exclude"`

## `setup.connect`

This controls initial connection behavior and also seeds the extension's
`last-choice` state for future auto-connect.

- `false` or omitted
  Do not choose or connect to anything.
- `true`
  Equivalent to a quick-connect style request:
  `connectNow: true` and `choice: { connected: true, pick: "fastest" }`
- object
  Full control over selection behavior.

Object fields:

- `connectNow?: boolean`
  If `true` or omitted, the extension connects immediately after provisioning.
  If `false`, only the stored choice is updated.
- `choice?: object`
  Server selection filter. This follows the extension's `last-choice` model.
- `serverId?: string | number`
  If provided, tries to use a specific server within the selected logical.
- `serverLabel?: string`
  Alternative server selector inside the selected logical.

`choice` fields:

- `connected?: boolean`
  Should generally be `true` for any connectable saved choice.
- `pick?: "fastest" | "random" | "closest"`
  Selection strategy. Current provisioning behavior treats `random` specially and uses best/fastest selection otherwise.
- `entryCountry?: string`
  Filter by entry country.
- `exitCountry?: string`
  Filter by exit country.
- `city?: string`
  Filter by city name.
- `logicalId?: string | number`
  Force a specific logical server group.
- `requiredFeatures?: number`
  Raw Proton feature bitmask filter.
- `excludedFeatures?: number`
  Raw Proton feature bitmask exclusion.
- `tier?: number`
  Filter by Proton tier.
- `filter?: "other"`
  Reuses the extension's existing "other" filter semantics.

Selection notes:

- The extension first loads and filters logical servers using the same logic as the popup.
- `secureCore` affects the candidate logical set before connect selection.
- If both `serverId` and `serverLabel` are absent, the extension picks a server from the chosen logical using its normal selection logic.
- If `connectNow` is `false`, the stored choice is still updated so later auto-connect can reuse it.

## Minimal Localhost Example

Save the following as an HTML file, serve it from `http://localhost` or
`http://127.0.0.1`, replace the placeholder tokens, and open it in the browser
with the extension installed:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Proton VPN Provisioning Example</title>
</head>
<body>
  <textarea id="payload" rows="24" cols="100">{
  "uid": "replace-me",
  "accessToken": "replace-me",
  "refreshToken": "replace-me",
  "persistent": true,
  "setup": {
    "settings": {
      "notificationsEnabled": false,
      "preventWebrtcLeak": true,
      "autoConnect": true,
      "secureCore": false,
      "splitTunneling": {
        "enabled": true,
        "mode": "exclude",
        "domains": [
          "localhost",
          {
            "domain": "internal.example",
            "withSubDomains": true,
            "mode": "exclude"
          }
        ]
      }
    },
    "connect": {
      "connectNow": true,
      "choice": {
        "connected": true,
        "pick": "fastest",
        "exitCountry": "NL"
      }
    }
  }
}</textarea>

  <button id="send">Send provisionSession</button>
  <pre id="status"></pre>

  <script>
    const sendButton = document.getElementById("send");
    const payloadInput = document.getElementById("payload");
    const status = document.getElementById("status");

    sendButton.addEventListener("click", () => {
      try {
        const payload = JSON.parse(payloadInput.value);
        window.postMessage(
          { type: "provisionSession", data: payload },
          window.location.origin
        );
        status.textContent =
          "Provisioning message sent to page origin: " + window.location.origin;
      } catch (error) {
        status.textContent = "Invalid JSON: " + String(error);
      }
    });
  </script>
</body>
</html>
```

One simple way to try it locally:

```bash
python -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000/your-file-name.html`

The extension content script will see the localhost page and forward the
payload to the background script.

# opencode Chrome Extension

Chrome control tools for opencode. This repository contains:

- a Chrome MV3 extension
- a Native Messaging host
- an opencode plugin that exposes browser tools

The project is independent from the opencode repository. It uses the public `@opencode-ai/plugin` package.

## Build

```sh
bun install
bun run build
```

## Install Native Host

```sh
bun run install-host
```

Dry-run the manifest path and contents:

```sh
bun run install-host:dry-run
```

The installer currently supports macOS and writes:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.opencode.chrome_extension.json
```

## Load Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select:

```text
/Users/mrbear/code/opencode-chrome-extension/packages/extension/dist/extension
```

## Use From opencode

Add the built plugin to an opencode config:

```json
{
  "plugin": [
    "/Users/mrbear/code/opencode-chrome-extension/packages/opencode-plugin/dist/index.js"
  ]
}
```

The plugin reads the current host port and token from:

```text
~/.opencode-chrome-extension/runtime.json
```

The file is written by the Native Messaging host after Chrome starts the extension.

## Tools

- `chrome_status`
- `chrome_tabs_list`
- `chrome_tab_select`
- `chrome_tab_new`
- `chrome_tab_goto`
- `chrome_tab_screenshot`
- `chrome_dom_snapshot`
- `chrome_click`
- `chrome_type`
- `chrome_keypress`
- `chrome_scroll`
- `chrome_evaluate`
- `chrome_console_logs`

## Troubleshooting

If `chrome_status` says the runtime file is missing, confirm that Chrome is running and that the extension is loaded and enabled.

If Chrome says the native host is missing, run `bun run install-host`, then reload the extension from `chrome://extensions`.

# Run it as a service

Keeps the server running in the background and starts it again after a
reboot or a crash. The examples assume the settings are in `.env` in the
app folder (see "Run the server" in the README).

## Linux (systemd)

`/etc/systemd/system/bite-stamped.service`:

```ini
[Unit]
Description=Bite-Stamped restaurant journal
After=network-online.target

[Service]
User=bite-stamped
WorkingDirectory=/opt/bite-stamped
ExecStart=/usr/bin/node --env-file=.env --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/bite-stamped/data

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now bite-stamped` and `journalctl -u bite-stamped -f` for the log.

## macOS (launchd)

`~/Library/LaunchAgents/com.example.bite-stamped.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.bite-stamped</string>
  <key>WorkingDirectory</key><string>/Users/you/bite-stamped</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>--env-file=.env</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>server/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/bite-stamped/data/bite-stamped.log</string>
  <key>StandardErrorPath</key><string>/Users/you/bite-stamped/data/bite-stamped.log</string>
</dict></plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.example.bite-stamped.plist`. Use the
path of your `node` (`which node`).

## Restart after an update

After `git pull`, restart the service so the server picks up the change:

- Linux: `sudo systemctl restart bite-stamped`
- macOS: `launchctl kickstart -k gui/$(id -u)/com.example.bite-stamped`

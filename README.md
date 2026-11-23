# ENVLOGGER

**Powerful Roblox / Luau environment behavior logger** for obfuscated scripts.

Run any Lua/Luau script inside a fully instrumented offline sandbox and capture real behavior:

| Category | Captured |
|----------|----------|
| Services | `game:GetService` counts |
| Instances | `Instance.new`, parent, `WaitForChild`, UI trees |
| HTTP | `HttpGet`, `RequestAsync`, `syn.request` URLs |
| Remotes | `FireServer` / `InvokeServer` args |
| Loadstring | nested chunk size + head bytes |
| Task | `task.spawn` / `defer` / `delay` / `wait` |
| Filesystem | `writefile` / `readfile` / `isfile` / `makefolder` |
| Executor | `getgenv`, `gethui`, `setthreadidentity`, `setclipboard` |
| Probes | unknown globals (soft ever-callable proxies) |
| Errors | compile + runtime (soft-fail) |

CLI + Discord-ready. **No live Roblox game. No real network.**

---

## Install

```bash
git clone https://github.com/Zain20m/envlogger.git
cd envlogger
# Need a Luau binary:
export ENVLOGGER_LUAU=/path/to/luau
```

## CLI

```bash
node src/run.js samples/sosa.lua -o out/sosa.txt
node src/run.js --url https://raw.githubusercontent.com/219rbg/Ifk/refs/heads/main/Sosa
node src/run.js samples/sosa.lua --json
```

## Discord

See [`discord/bot-snippet.js`](discord/bot-snippet.js) — `/envlog` slash command:

- Attach a `.lua` file **or** paste a raw URL
- Bot replies with a short summary + full `envlogger-report.txt` attachment

Wire `envlogCommand` + `handleEnvlog` into your discord.js v14 bot. Set `ENVLOGGER_ROOT` to this repo.

## Tested samples

| Sample | Result |
|--------|--------|
| **Sosa** (frx, 194KB) | 41 stmts · Players/Tween/Teleport/Http/UIS/RS · nested loadstring 96KB · GUI tree · `gethui` / `setthreadidentity` / `isfile` |
| Centurion 6.1 | services + Path2D canary path + loadstring probe |
| hello | smoke OK |

```text
-- ENVLOGGER report  stmts=41  elapsed=0.10s  source=193810 bytes
-- status: finished
-- services: Players, TweenService, TeleportService, HttpService, UserInputService, ReplicatedStorage
-- loadstring captures: [1] 96495 bytes
```

## Layout

```
runtime/envlogger.luau   # sandbox + instrumentation
src/run.js               # Node CLI
discord/bot-snippet.js   # discord.js slash command
samples/                 # test scripts (sosa, hello)
tests/run_samples.sh     # batch runner
```

## Safety

Obfuscated scripts can be malicious. ENVLOGGER never talks to Roblox servers; HTTP is stubbed and only URLs are recorded. Review reports before acting on them.

## License

MIT

# happy-fleet — the fleet hub (Original Happy)

Lets the agents of one Happy account find and message each other. Every
session (Claude or Codex, any machine) has these happy MCP tools (messages:
happy 1.2.6+orig.34 or newer; tasks: orig.36):

- `list_agents` — the other sessions online now: name (= title), agent,
  machine, directory, busy / idle, session id.
- `send_to_agent(to, text)` — delivered at once, into the running turn if the
  target is busy. The answer, if any, comes back the same way.
- `schedule_task` / `list_tasks` / `delete_task` — a prompt sent to the
  session that created the task, once (`at`) or on a 5-field cron schedule,
  in a time zone (default: the hub machine's). An offline session gets a due
  task once when it is back. At most every 5 minutes; 20 tasks per session.

No Commander, no `#` parsing, no briefings: the rules agents need are in the
tool descriptions (happy-cli `src/claude/utils/happyTools.ts`).

## Use

```bash
happy fleet on        # no agent.key in HAPPY_HOME_DIR: shows a QR code to scan with the Happy app
happy fleet status
happy fleet logs -f
happy fleet off       # --delete also removes $HAPPY_HOME_DIR/fleet
```

The happy daemon runs the hub (`happy-cli` `src/daemon/fleet.ts`): starts it
with the daemon, restarts it if it exits, and runs the new code after
`happy update`. Everything follows `HAPPY_HOME_DIR`: one hub per directory
(= per account).

## How it works

- **Transport**: the relay's per-account RPC. The hub registers
  `original-happy-fleet`; a session calls it on its own socket. The relay
  routes by the account of the token, so accounts never mix.
- **Who is calling**: the request body is sealed with the caller session's
  key. Only the hub (holding the account secret, `agent.key`) can open it,
  and opening it proves the sender; a session cannot pose as another.
  Answers are sealed with the same key. Requests carry a timestamp and a
  nonce; stale or repeated ones are refused.
- **Delivery**: the hub writes a user message into the target session,
  framed by a header the sender cannot forge — who sent it (title, agent,
  machine, path, session id), that it is not from the owner and carries no
  owner authority — and the body between random-boundary markers.
- **Storm isolation**: one target per send; in a 10-minute window at most 8
  messages between a pair (both directions), 20 from one sender, 60 on the
  account (`FLEET_WINDOW_MS`, `FLEET_PAIR_MAX`, `FLEET_SENDER_MAX`,
  `FLEET_ACCOUNT_MAX` in `$HAPPY_HOME_DIR/fleet/.env`). A refusal tells the
  agent not to retry in a loop. Messages are at most 8000 characters.
- **One hub per account**: a lease in the relay's key-value store
  (`original-happy.fleet.lease`, `lease.mjs`), renewed every minute; a second
  hub waits and takes over after 3 minutes without renewal.
- **Visibility**: the sender's chat shows a grey line `→ name: …`; the
  receiver's shows the message as `[from name] …`; a task run as
  `[定时任务 name] …`.
- **Scheduled tasks** are kept in the relay's key-value store
  (`original-happy.fleet.tasks`), encrypted with a key derived from the
  account secret; the hub checks them every 20 seconds. A run is delivered
  with a header the agent cannot forge (task, run time, no extra authority,
  "call notify_owner when done").

Nothing but `fleet.log` (rotated at 5 MB) and the pid file is kept on disk;
tasks live on the relay.
The hub reads session metadata only, never messages.

## Files

| | |
| --- | --- |
| `hub.mjs` | the hub process |
| `protocol.mjs` | names, targets, limits, replay checks, the envelope (pure; tested) |
| `tasks.mjs` | cron, time zones, due runs, the task envelope (pure; tested) |
| `crypto.mjs` | account and session keys (from happy-agent) |
| `lease.mjs` | one hub per account |
| `config.mjs` | defaults and `.env` overrides |

Tests: `pnpm test` (node:test). The CLI side: happy-cli `src/fleet/`,
`src/daemon/fleet.test.ts`.

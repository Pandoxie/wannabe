# wannabe — release directory

Written by `scripts/release-cli.mjs`; after an install this file is also in
`~/.happy-dist/README.md`.

```bash
bash install.sh                                     # from this directory, on this machine
curl -fsSL <URL>/install.sh | HAPPY_DIST_URL=<URL> bash   # from where you published it
```

- `install.sh` installs `happy`, `happy-agent` and `happy-fleet`, remembers
  this source in `~/.happy-dist/url`, and sets up a nightly `happy update`
  (opt out: `touch ~/.happy-dist/no-nightly`).
- `happy update` — update Claude Code, Codex and happy; sessions restart only
  when something changed. `happy update list | status | verify | <version>`.
- `happy help all` — every command (also `COMMANDS.md` here).
- `happy uninstall` — lists what it would remove; `--yes` removes it.
- `sandbox/` (if published here): `happy cage install`.

<div align="center">

<img src="assets/critter.svg" width="112" alt="The little orange companion that lives in the pane">

# Merges for Claude Code

**Your open pull requests, their CI status and a one-press Merge button, in a pane right beside the chat.**

</div>

---

Merges is a Claude Code mod. It finds every open pull request in your GitHub account and your organizations, shows whether its checks passed, and lets you merge the ready ones with a single press. A small orange companion keeps you company: it bobs and blinks while something is ready, scuttles while a merge runs, and naps when there is nothing left to do.

| | |
|---|---|
| **Works for anyone** | It asks your own signed-in `gh` who you are. Nothing is configured, nothing about the author is baked in. |
| **One press** | `Merge` appears only on a pull request that is not a draft, has no conflicts and whose checks passed. It squash-merges and deletes the branch. |
| **Always fresh** | The list refreshes every minute and whenever you press `Refresh`. |
| **Claude-styled** | Theme colors of Claude Code itself: the orange accent for what is ready, green, amber and red for check states. |

## Install

You need [Claude Code](https://code.claude.com) 2.1.287 or newer and the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`.

At the prompt of a terminal session:

```
/plugin install merge-panel --marketplace ShadowDemonHD-ru/claude-merge-panel
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```bash
claude plugin install merge-panel --marketplace ShadowDemonHD-ru/claude-merge-panel
```

The pane opens by itself in each new session. Closed it? Type `/merges`.

## What each card shows

- the repository and pull request number;
- the title;
- the state: `✓ Checks passed`, `◌ Checks running`, `✗ Checks failed`, `Conflicts with the base branch` or `Draft`;
- `Merge` when it is ready, and a link to open it on GitHub.

The header sums it up: how many are ready, how many wait on checks, how many need attention, and when the list was last synced.

## Safety

The mod only runs `gh`, never a shell, checks every value GitHub returns against strict patterns before it reaches a command, and merges only on your press. It makes no network calls of its own and never touches a token. Details in [SECURITY.md](SECURITY.md). Before installing any mod, this one included, you can list everything it hooks and calls without running it:

```bash
claude plugin validate .
```

## Surfaces

The pane draws in the Claude Code desktop app (Code tab) and the terminal; in the terminal the companion is a `✻` glyph. The VS Code chat panel runs hooks but does not draw panes.

## License

[MIT](LICENSE)

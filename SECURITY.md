# Security

## What the mod can do

The mod runs inside Claude Code with your user's rights, like any plugin. It does three things and nothing else:

- runs the GitHub CLI `gh`, signed in as you, to read your open pull requests, their mergeability and CI checks (`gh api user`, `gh api user/orgs`, `gh search prs`, `gh pr view`);
- runs `gh pr merge --squash --delete-branch` **only when you press Merge**, and only for a pull request the last refresh listed as ready;
- draws the Merges pane and a toast.

It makes no network calls of its own, writes no files, and never reads, stores or sends a token: authentication stays inside `gh`.

## How it guards against injection

- Commands are started by argument vector, with no shell, so text from GitHub can never become a command.
- Every value from GitHub is checked before use: logins, `owner/repo` names and PR numbers must match strict patterns, links must be `https://github.com/<owner>/<repo>/pull/<n>`, titles are cut to 200 characters and drawn as plain text.
- A press merges the pull request the pane listed, looked up again and re-checked, not a value carried by the button.

`claude plugin validate .` lists every hook and every engine call the module makes, without running it: read that list before installing any mod, this one included.

## Keeping what you install the code you read

The `main` branch of this repository is protected against force pushes and deletion. To pin an exact version, install from a tag you have reviewed instead of the moving branch.

## Reporting a problem

Open a private security advisory under the repository's **Security** tab rather than a public issue.

# Maintainer guide

The project repository is [q1/cookie-quick-manager](https://github.com/q1/cookie-quick-manager).
It is a fork of Ysard's project, with a separate product and release identity.
Keep the upstream credit and GPL notices when updating repository metadata.

## GitHub setup

Use `--repo q1/cookie-quick-manager` for GitHub CLI commands. In a fork,
unqualified commands can resolve to the upstream repository. Check the target
before opening a pull request or changing settings.

```sh
gh repo view q1/cookie-quick-manager --json nameWithOwner,defaultBranchRef
gh pr list --repo q1/cookie-quick-manager
```

The current default branch is `fpi`. A branch rename is a separate maintenance
change: update links, open pull requests, and local tracking branches together.
The historical branch name does not change Cookie Loom's product identity.

Maintain these repository settings:

- Keep issues and private vulnerability reporting enabled for the bug and
  feature forms and [SECURITY.md](../SECURITY.md).
- Keep secret scanning, push protection, vulnerability alerts, and Dependabot
  security updates enabled. `.github/dependabot.yml` also schedules dependency
  and action updates.
- Keep the Cookie Loom description, topics, and repository homepage current.
  Use this project's own store URLs once published.
- Protect the default branch against force pushes and deletion. Once CI has
  run, require **Checks, builds, and packages** and **Browser tests** before
  merging. Set review requirements to match the number of active maintainers;
  do not require an independent approval when only one maintainer can provide it.
- Keep automatic deletion of merged topic branches enabled. Keep release permissions narrow and store
  signing credentials outside the repository.

`CODEOWNERS` identifies the actual repository owner, `@q1`. Update it when
maintainership changes; do not list contributors without their agreement.

## Reviewing contributions

Check the user-visible behavior, permission changes, full cookie identity,
destructive-action scope, and imported-data handling. Require browser evidence
for claims about extension APIs. A successful demo test cannot establish that
an optional permission prompt or browser cookie store works.

CI uses read-only repository permissions and pinned action revisions. It runs
pull-request code without repository secrets. Keep that boundary: do not change
the tests to run untrusted contributions under `pull_request_target`.

Review dependency changes with the lockfile and
[the dependency review](dependency-review.md). Production advisories fail CI;
known development-tool advisories still require explicit review and follow-up.
Do not suppress an audit finding solely to make the status green.

CodeRabbit inherits the existing organization settings and excludes the archived
`legacy/` tree from automated review. Maintained code and documentation stay in
scope. Service capacity limits can still skip its review; the required CI checks
and maintainer review remain necessary.

Use [the release guide](releasing.md) to promote reviewed artifacts. Signing,
GitHub releases, and store publication remain deliberate maintainer actions.

# Release guide

Cookie Loom is a distinct project, not an update published under Cookie Quick
Manager's identity. There is no implied access to the upstream store listings
or signing keys. A local zip is an unsigned build, not a published release.

## Prepare the source

1. Review the final changes and update [CHANGELOG.md](../CHANGELOG.md).
2. Set consistent package and extension versions. Keep the GPL license and
   [NOTICE](../NOTICE), including upstream attribution.
3. Review the lockfile, dependency licenses, generated manifests, permission
   explanations, and [PRIVACY.md](../PRIVACY.md).
4. Confirm the repository links, publisher identity, product name, and Firefox
   add-on ID are owned by this project and separate from upstream. Keep the
   add-on ID stable after publication. Never reuse upstream signing material.
5. Build from a clean checkout using Bun 1.4.3 from `.bun-version` and the
   committed `bun.lock`:

   ```sh
   bun install --frozen-lockfile --ignore-scripts
   bun run format:check
   bun audit --prod
   bun run typecheck
   bun run test
   bun run build
   bun run lint:firefox
   bunx --bun playwright install chromium firefox
   bun run test:e2e
   bun run test:firefox
   bun run zip
   bun run verify:builds
   bun run verify:sources
   bun run release:prepare
   ```

6. Complete [browser verification](verification.md) on current stable Chromium
   and Firefox. Record exact versions, results, and known limitations. Do not
   infer Firefox API support from a Chromium test or a demo screenshot.
   Review the explicit Preact vendor warning exception in
   [the development guide](development.md); raw `web-ext lint` is not warning-free.
7. Inspect extension archives. Exclude the legacy extension, test profiles,
   synthetic demo entrypoints, development tooling, secrets, and cookie exports.

## Publish artifacts

Regular CI stages the two unsigned extension ZIPs, the corresponding source ZIP,
`RELEASE.json`, and `SHA256SUMS` as one `cookie-loom-unsigned-packages` artifact.
It rebuilds from the source archive and compares every file in both browser ZIPs
with the production builds. `RELEASE.json` records the source commit, Bun version,
build run, and archive hashes. Artifacts expire; tagged preview releases provide
durable downloads. No workflow signs an extension or submits a store listing.

The preview workflow publishes only annotated tags named
`v<package-version>-preview.<positive integer>` on commits already merged into
`fpi`. It validates the tag/version and committed release notes, reruns the full
CI suite including minimum-browser checks, downloads that run's verified
artifact, and checks its checksums/source revision before publishing. Only the
publication job has repository write permission. An existing release is never
overwritten on a rerun.

After reviewing and merging release preparation, create the preview tag on the
exact merged commit. For example, for the first preview:

```sh
git switch fpi
git pull --ff-only origin fpi
git tag -a v0.1.1-preview.1 -m 'Cookie Loom 0.1.1 preview 1'
git push origin refs/tags/v0.1.1-preview.1
```

Use [the committed release notes](releases/v0.1.0-preview.1.md) as the template
for subsequent previews. A workflow failure leaves the release unpublished;
inspect it before retrying. If upload succeeds but publication fails, a draft may
remain: inspect its assets and finish that draft deliberately. Never replace an
already published artifact. New fixes need a new source revision and preview tag.
The browser manifests keep a store-compatible numeric version; a preview suffix
belongs to the GitHub tag rather than the browser version.

Preview notes must state untested manual checks and unsigned/temporary install
limits. A stable/store release additionally requires native permission prompts,
signed installation, update-path verification, and real listing URLs. The preview
workflow does not promote a build to stable.

Attach the browser-specific extension archives, source revision, and checksums
to a tagged release. Include build instructions and the corresponding source
for the distributed binaries. Store reviewers must be able to reproduce the
build; include the source archive and necessary instructions when requested.
Keep signing credentials in the publishing environment, never in Git.
Use an annotated version tag and release notes that describe user-visible
changes and remaining limitations. Confirm that the tag identifies the tested
commit; do not rebuild from a different revision under the same version.

`bun run zip` creates `cookie-loom-<version>-chrome.zip`,
`cookie-loom-<version>-firefox.zip`, and `cookie-loom-<version>-sources.zip` in
`apps/extension/.output/`. The source archive contains the monorepo build inputs,
`bun.lock`, `bunfig.toml`, `.bun-version`, shared core package, license notices,
the pinned web-ext patch, and documentation. WXT
excludes test files and documentation PNG screenshots/concepts; runtime icons
remain included. Use the repository for the complete development/test suite,
design imagery, and store screenshots. CI enforces 95,000 bytes per browser ZIP
and 500,000 bytes for the build-input source ZIP, alongside raw startup/installed
budgets. Increases require an explicit reviewed justification.
To verify the source artifact independently, extract it into an empty directory
and run `bun install --frozen-lockfile --ignore-scripts` followed by `bun run build`
with Bun 1.4.3. No publisher credentials are needed for a source rebuild.
Use `sha256sum --check SHA256SUMS` or `shasum -a 256 --check SHA256SUMS`
after downloading all five release files. Checksums detect corruption; they do
not by themselves authenticate the publisher.

For Chromium, create a separate Chrome Web Store listing and complete its
privacy and permission disclosures. The local `.output/chrome-mv3` directory
is for unpacked development installation. Follow
[Chrome's distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute).
Prepared copy, disclosures, exact-size images, and reviewer test instructions
are in [the store submission kit](store-listing.md).

For Firefox, submit the new extension for Mozilla signing, either for a public
AMO listing or signed self-distribution. Ordinary release Firefox requires
signed add-ons for persistent installation. Temporary `about:debugging` loading
is a development workflow. Follow [Mozilla's signing and distribution guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
and provide buildable source for generated/minified code.

Before submission, recheck each store's current rules, required manifest fields,
and data-collection declarations. Describe the extension as local-only only if
that remains true in the final artifact. Do not claim mobile, Safari, privacy
certification, encryption, or upstream endorsement without evidence.

## After publication

Verify the installed store build, record its immutable source tag and artifact
checksums, and update the README with the real listing URLs. Check the upgrade
path with existing settings and protection identities. Monitor reports without
asking users to share real cookie dumps. Follow [SECURITY.md](../SECURITY.md)
for private vulnerability handling.

Repository settings and review conventions are described in
[the maintainer guide](maintaining.md).

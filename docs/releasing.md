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
5. Build from a clean checkout using the declared Node version and committed
   lockfile:

   ```sh
   npm ci
   npm run format:check
   npm audit --omit=dev
   npm run check
   npm test
   npm run build
   npm run lint:firefox
   npx playwright install chromium firefox
   npm run test:e2e
   npm run test:firefox
   npm run zip
   npm run verify:builds
   ```

6. Complete [browser verification](verification.md) on current stable Chromium
   and Firefox. Record exact versions, results, and known limitations. Do not
   infer Firefox API support from a Chromium test or a demo screenshot.
   Review the explicit React vendor warning exception in
   [the development guide](development.md); raw `web-ext lint` is not warning-free.
7. Inspect extension archives. Exclude the legacy extension, test profiles,
   synthetic demo entrypoints, development tooling, secrets, and cookie exports.

## Publish artifacts

CI stages the two unsigned extension ZIPs, the corresponding source ZIP, and
`SHA256SUMS` as one `cookie-loom-unsigned-packages` artifact. Download it from a
successful run on the exact revision you intend to release. CI never creates a
GitHub release, signs an extension, or submits a store listing automatically.
Complete the manual browser checks before promoting these artifacts.

Attach the browser-specific extension archives, source revision, and checksums
to a tagged release. Include build instructions and the corresponding source
for the distributed binaries. Store reviewers must be able to reproduce the
build; include the source archive and necessary instructions when requested.
Keep signing credentials in the publishing environment, never in Git.
Use an annotated version tag and release notes that describe user-visible
changes and remaining limitations. Confirm that the tag identifies the tested
commit; do not rebuild from a different revision under the same version.

`npm run zip` creates `cookie-loom-<version>-chrome.zip`,
`cookie-loom-<version>-firefox.zip`, and `cookie-loom-<version>-sources.zip` in
`apps/extension/.output/`. The source archive contains the monorepo build inputs,
root lockfile, shared core package, license notices, and documentation. WXT
excludes test files; use the repository for the complete development/test suite.
To verify the source artifact independently, extract it into an empty directory
and run `npm ci` followed by `npm run build` with Node 24.

For Chromium, create a separate Chrome Web Store listing and complete its
privacy and permission disclosures. The local `.output/chrome-mv3` directory
is for unpacked development installation. Follow
[Chrome's distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute).

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

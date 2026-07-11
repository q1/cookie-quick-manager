# Cookie Quick Manager 0.6.0 QA and compatibility report

Date: 2026-07-11

This report records evidence for the current dual-target recode. It deliberately separates current-artifact verification from the historical Firefox baseline; Firefox lint alone is not treated as runtime parity.

## Target artifacts

- Chromium Manifest V3, minimum Chrome 130
- Firefox Manifest V3, minimum Firefox desktop 140
- Firefox for Android, minimum Firefox 142
- Package and both manifests: version 0.6.0

The Chromium and Firefox ZIPs were rebuilt from clean target directories and verified byte-for-byte against every file in those directories.

## Automated release gate

Command:

```bash
npm run check
```

The gate is self-contained. Starting without `qa/certs/` or a fixture process, it generated a development certificate, started the fixture on loopback, ran the browsers, and stopped the process it owned.

Latest clean result:

- 34/34 browser-independent unit, core, adapter, manifest, and locale contracts passed
- source, QA, build-script, and Firefox RDP probe syntax checks passed
- Chromium and Firefox builds passed
- Firefox `web-ext lint`: 0 errors, 0 warnings, 2 known-library notices
- 35/35 Chromium Playwright workflows passed
- `npm audit`: 0 vulnerabilities
- `git diff --check`: passed

The final 35-scenario Chromium suite also passed in a separate repeat execution.

## Chromium runtime coverage

The suite loads the unpacked extension into headless Chromium and exercises production UI/adapters, not test-only reimplementations.

Passing scenarios:

1. Fixture cookie seeding
2. Manager domain listing
3. Auto-refresh on additions and website expiry tombstones
4. Subdomain grouping
5. Name filtering
6. Protected host-cookie restoration after website deletion
7. Cookie value editing
8. Single-cookie JSON export and count rendering
9. Exact unprotect/delete
10. JSON import through the real file handler
11. Domain-cookie editing
12. Protected domain-cookie attribute restoration
13. Fresh-value rotation winning over a stale pending restore
14. Exact protected path identity
15. Exact unprotected `/`, `/app`, and unusual-path deletion
16. Host-only/domain sibling collision restore and deletion
17. Delete-key safety inside editors
18. Filtered bulk deletion leaving non-visible cookies untouched
19. Domain JSON round-trip with quotes, backslashes, template tokens, and Unicode
20. Full pre-mutation validation of invalid multi-record imports
21. Aging backups: live nameless cookie restored, expired persistent record skipped
22. Netscape host/domain, HttpOnly, Secure, uppercase flags, BOM, and default-store round-trip
23. Partitioned cookie edit/export/import/delete
24. Same-site partition identities with opposite ancestor bits shown distinctly
25. Actual subdomain grouping
26. Site-specific launch including applicable parent-domain cookies but not host-only parents
27. Domain label-boundary handling
28. Prototype-named intranet domain safety
29. Actual popup cookie/LocalStorage counts and LocalStorage clearing
30. Secure SameSite=None creation on HTTPS
31. Chromium options hiding Firefox-only FPI controls
32. Options persistence
33. Privileged settings-tree markup rendered literally
34. Settings restore replacing the snapshot and removing stale exact-protection keys
35. Settings reset restoring complete defaults

The runner also fails on uncaught page exceptions and extension-page/service-worker console errors.

## Firefox current-artifact evidence

The current Firefox artifact:

- builds with the Firefox background-script manifest;
- installs in Firefox 151 headless;
- passed the seven strengthened runtime smoke assertions: fixture seeding, manager launch/listing, grouping, filtering, host-cookie selection, protection activation, and protected-cookie survival after page deletion;
- preserved `partitionKey.topLevelSite` and `hasCrossSiteAncestor` in targeted Firefox 151 set/query probes;
- handled exact nameless and host/domain tombstone deletion in targeted Firefox 151 probes.

The committed RDP probe was hardened so fixture, selection, protection, and survival checks fail closed. Its asynchronous protection step now polls synchronously rather than mistaking an RDP Promise grip for a result.

This is useful current-artifact smoke evidence, but it is not a full Firefox equivalent of the 35-scenario Chromium suite.

## Historical baseline

The original 0.5rc2 Firefox artifact remains useful for reconstructing intent. The old Chromium suite had 14 passing checks, and the historical Firefox probe had seven. Fan-out review showed that those checks contained shortcuts and false negatives: they did not expose service-worker cold-start cleanup, malformed domain URLs, incomplete cookie identity, partition blindness, unsafe repeated imports, or native `cookies.remove()` over-deletion.

Those historical results are retained as behavioral context, not release signoff for 0.6.0.

## Remaining matrix limitations

- The full 35-scenario suite is Chromium-only; current Firefox automation is a seven-check smoke plus targeted API probes.
- Firefox 140, Firefox Android 142, and real Android UI behavior were not run on this machine.
- Chromium and Firefox private/incognito enablement and container/store isolation do not yet have a full automated browser-policy matrix.
- The packaged privileged UI still contains legacy jQuery, Bootstrap 3, Moment, and context-menu libraries. Unused treeview/theme assets were removed, DOM sinks were hardened, and Firefox lint reports notices rather than errors, but dependency modernization remains worthwhile.

## Conclusion

Version 0.6.0 has substantially stronger evidence than the previous parity candidate for its core intent: exact cookie management, safe protection, faithful import/export, site-specific search, settings integrity, and popup LocalStorage actions. Chromium is covered by a broad reproducible release gate. Firefox has a valid, lint-clean, runtime-smoked artifact, with deeper cross-browser and private-store automation still explicitly open.

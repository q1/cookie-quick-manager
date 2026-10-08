import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'apps/extension/.output');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const extensionPackage = JSON.parse(
  await readFile(resolve(root, 'apps/extension/package.json'), 'utf8'),
);
const demoSource = await readFile(resolve(root, 'apps/extension/src/lib/demo-gateway.ts'), 'utf8');
const demoData = [
  ...new Set([...demoSource.matchAll(/["'`](demo-[a-z\d-]+)["'`]/gi)].map((match) => match[1])),
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sameMembers(actual, expected, label) {
  check(Array.isArray(actual), `${label} must be an array.`);
  check(
    actual.length === expected.length && expected.every((value) => actual.includes(value)),
    `${label} must contain exactly: ${expected.join(', ')}. Found: ${actual.join(', ')}.`,
  );
}

function minimumVersion(actual, minimum, label) {
  check(
    typeof actual === 'string' && /^\d+(?:\.\d+){0,3}$/.test(actual),
    `${label} is missing or invalid.`,
  );
  const value = actual.split('.').map(Number);
  const floor = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(value.length, floor.length); index++) {
    if ((value[index] ?? 0) > (floor[index] ?? 0)) return;
    check(
      (value[index] ?? 0) >= (floor[index] ?? 0),
      `${label} must be at least ${minimum}; found ${actual}.`,
    );
  }
}

async function inventory(directory, prefix = '') {
  const files = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    check(!entry.isSymbolicLink(), `Build contains a symbolic link: ${path}.`);
    if (entry.isDirectory()) {
      for (const [nested, contents] of await inventory(resolve(directory, entry.name), path)) {
        files.set(nested, contents);
      }
    } else {
      check(entry.isFile(), `Unexpected build entry: ${path}.`);
      files.set(path, await readFile(resolve(directory, entry.name)));
    }
  }
  return files;
}

function resourceChecker(files, platform) {
  return (reference, location, { base = '', glob = false } = {}) => {
    check(
      typeof reference === 'string' && reference.length > 0,
      `${platform}: ${location} must reference a file.`,
    );
    check(
      !/^[a-z][a-z\d+.-]*:/i.test(reference) && !reference.startsWith('//'),
      `${platform}: ${location} must use a local resource, found ${reference}.`,
    );
    check(
      !/[?#\\\0]/.test(reference),
      `${platform}: unsupported resource path at ${location}: ${reference}.`,
    );
    let decoded;
    try {
      decoded = decodeURIComponent(reference);
    } catch {
      throw new Error(`${platform}: invalid encoded resource at ${location}.`);
    }
    check(
      !decoded.split('/').includes('..') && !/[\\\0]/.test(decoded),
      `${platform}: resource escapes the build at ${location}: ${reference}.`,
    );
    const path = posix.normalize(
      reference.startsWith('/') ? decoded.slice(1) : posix.join(base, decoded),
    );
    if (glob && path.includes('*')) {
      const pattern = new RegExp(
        `^${path
          .split('*')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      check(
        [...files.keys()].some((file) => pattern.test(file)),
        `${platform}: resource pattern matches no files at ${location}: ${reference}.`,
      );
    } else {
      check(
        files.has(path),
        `${platform}: missing resource ${reference} referenced by ${location}.`,
      );
      check(
        files.get(path).length > 0,
        `${platform}: empty resource ${reference} referenced by ${location}.`,
      );
    }
  };
}

function checkManifestResources(manifest, requireResource) {
  const icons = (value, label) => {
    if (!value) return;
    if (typeof value === 'string') requireResource(value, label);
    else
      for (const [size, path] of Object.entries(value)) requireResource(path, `${label}.${size}`);
  };
  icons(manifest.icons, 'icons');
  for (const key of ['action', 'browser_action', 'page_action']) {
    icons(manifest[key]?.default_icon, `${key}.default_icon`);
    if (manifest[key]?.default_popup)
      requireResource(manifest[key].default_popup, `${key}.default_popup`);
  }
  for (const field of ['service_worker', 'page']) {
    if (manifest.background?.[field])
      requireResource(manifest.background[field], `background.${field}`);
  }
  for (const script of manifest.background?.scripts ?? [])
    requireResource(script, 'background.scripts');
  for (const field of ['options_page', 'devtools_page']) {
    if (manifest[field]) requireResource(manifest[field], field);
  }
  if (manifest.options_ui?.page) requireResource(manifest.options_ui.page, 'options_ui.page');
  if (manifest.sidebar_action?.default_panel)
    requireResource(manifest.sidebar_action.default_panel, 'sidebar_action.default_panel');
  icons(manifest.sidebar_action?.default_icon, 'sidebar_action.default_icon');
  for (const path of Object.values(manifest.chrome_url_overrides ?? {}))
    requireResource(path, 'chrome_url_overrides');
  for (const path of manifest.sandbox?.pages ?? []) requireResource(path, 'sandbox.pages');
  for (const group of manifest.content_scripts ?? []) {
    for (const path of [...(group.js ?? []), ...(group.css ?? [])])
      requireResource(path, 'content_scripts');
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const path of typeof entry === 'string' ? [entry] : (entry.resources ?? [])) {
      requireResource(path, 'web_accessible_resources', { glob: true });
    }
  }
  for (const entry of manifest.declarative_net_request?.rule_resources ?? [])
    requireResource(entry.path, 'declarative_net_request.rule_resources');
  for (const path of Object.values(manifest.theme?.images ?? {})) {
    for (const file of Array.isArray(path) ? path : [path]) requireResource(file, 'theme.images');
  }
  if (manifest.default_locale)
    requireResource(`_locales/${manifest.default_locale}/messages.json`, 'default_locale');
}

function checkBundledCode(files, requireResource, platform) {
  const forbiddenContent = [
    [/\b(?:createDemoGateway|demoCookies|DEMO_STORES)\b/, 'demo gateway code'],
    [/\b(?:window\.vAPI|vAPI\.templates|window\.jQuery)\b/, 'legacy extension code'],
    [/(?:@playwright\/test|@testing-library\/|["'`]vitest["'`])/, 'test framework code'],
    [/(?:^|[\s/"'`])node_modules\//, 'unbundled node_modules path'],
    [
      /(?:@vite\/client|@react-refresh|react-refresh\/|__vite_plugin_react_preamble_installed__|import\.meta\.hot|__WXT_DEV_SERVER)/,
      'development runtime',
    ],
    [/(?:react|react-dom|react-jsx-runtime)\.development\.(?:js|cjs)/, 'development React build'],
    [/(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/, 'local development server URL'],
    [/[#@]\s*sourceMappingURL\s*=/, 'source map reference'],
  ];
  for (const [path, buffer] of files) {
    check(
      !/(?:^|\/)(?:demo|legacy|tests?|__tests__|node_modules|src|\.vite|\.wxt|coverage|test-results|playwright-report)(?:\/|$)/i.test(
        path,
      ),
      `${platform}: non-production directory in build: ${path}.`,
    );
    check(
      !/(?:\.(?:map|tsx?|jsx|log|zip)|\.(?:test|spec)\.[^/]+|(?:^|\/)\.env(?:\..*)?|(?:^|\/)(?:vite|vitest|playwright|wxt)\.config\.[^/]+)$/i.test(
        path,
      ),
      `${platform}: non-production artifact in build: ${path}.`,
    );
    check(
      !/(?:^|[/.])(?:demo|test|spec)(?:[/.]|$)/i.test(path),
      `${platform}: demo or test artifact in build: ${path}.`,
    );
    if (!/\.(?:html|js|mjs|cjs|css|json)$/i.test(path)) continue;
    const source = buffer.toString('utf8');
    check(
      !demoData.some((value) => source.includes(value)),
      `${platform}: synthetic demo data or store IDs found in ${path}.`,
    );
    for (const [pattern, label] of forbiddenContent)
      check(!pattern.test(source), `${platform}: ${label} found in ${path}.`);
    if (path.endsWith('.html')) {
      check(!/<base\b/i.test(source), `${platform}: ${path} changes the local resource base.`);
      for (const match of source.matchAll(/<(?:script|link)\b([^>]*?)>/gi)) {
        const attribute = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(match[1]);
        if (attribute)
          requireResource(attribute[1], `${path} asset`, { base: posix.dirname(path) });
        else check(!/^<script\b/i.test(match[0]), `${platform}: inline script found in ${path}.`);
      }
    } else if (/\.(?:js|mjs|cjs)$/.test(path)) {
      const imports = [
        ...source.matchAll(/(?:^|;)\s*(?:import|export)[\s{*][^;]*?\bfrom\s*["']([^"']+)["']/g),
        ...source.matchAll(/(?:^|;)\s*import\s*["']([^"']+)["']/g),
        ...source.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g),
      ];
      for (const match of imports)
        requireResource(match[1], `${path} import`, { base: posix.dirname(path) });
    } else if (path.endsWith('.css')) {
      for (const match of source.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g)) {
        if (!match[1].startsWith('data:'))
          requireResource(match[1], `${path} CSS URL`, { base: posix.dirname(path) });
      }
    }
  }
}

async function verify(platform) {
  const directory = resolve(output, `${platform}-mv3`);
  check(
    (await lstat(directory).catch(() => null))?.isDirectory(),
    `Missing ${platform} production build. Run npm run build first.`,
  );
  const files = await inventory(directory);
  check(files.has('manifest.json'), `${platform}: manifest.json is missing.`);
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  const productSlug = manifest.name?.toLowerCase().replace(/\s+/g, '-');
  check(
    productSlug === packageJson.name,
    `${platform}: manifest name must match the root package product (${packageJson.name}).`,
  );
  check(manifest.name === 'Cookie Loom', `${platform}: unexpected product name ${manifest.name}.`);
  check(
    manifest.version === packageJson.version && manifest.version === extensionPackage.version,
    `${platform}: manifest and package versions differ.`,
  );
  check(
    extensionPackage.name === `@${packageJson.name}/extension`,
    'Extension package name does not match the root product.',
  );
  check(
    packageJson.license === 'GPL-3.0-or-later' && extensionPackage.license === packageJson.license,
    'Package licenses must preserve GPL-3.0-or-later.',
  );
  check(manifest.manifest_version === 3, `${platform}: production build must use Manifest V3.`);
  sameMembers(
    manifest.permissions,
    [
      'cookies',
      'storage',
      'activeTab',
      ...(platform === 'firefox' ? ['contextualIdentities'] : []),
    ],
    `${platform} required permissions`,
  );
  sameMembers(manifest.optional_permissions, ['scripting'], `${platform} optional permissions`);
  sameMembers(
    manifest.optional_host_permissions,
    ['http://*/*', 'https://*/*'],
    `${platform} optional host permissions`,
  );
  check(!manifest.host_permissions?.length, `${platform}: website access must remain optional.`);
  check(
    manifest.action?.default_popup === 'popup.html',
    `${platform}: popup entry point must be popup.html.`,
  );
  check(
    manifest.action?.default_title === manifest.name,
    `${platform}: toolbar title must match the product name.`,
  );
  check(
    manifest.options_ui?.page === 'options.html' && manifest.options_ui.open_in_tab === true,
    `${platform}: options must open options.html in a tab.`,
  );
  const csp =
    typeof manifest.content_security_policy === 'string'
      ? manifest.content_security_policy
      : (manifest.content_security_policy?.extension_pages ?? '');
  check(
    !/(?:unsafe-eval|unsafe-inline|https?:|wss?:)/i.test(csp),
    `${platform}: extension CSP allows remote or unsafe script execution.`,
  );

  if (platform === 'chrome') {
    minimumVersion(manifest.minimum_chrome_version, '132', 'Chrome minimum version');
    check(
      manifest.background?.service_worker &&
        !manifest.background.scripts &&
        !manifest.background.page,
      'Chrome must use a background service worker.',
    );
    check(!manifest.browser_specific_settings, 'Chrome build contains Firefox-only settings.');
  } else {
    const gecko = manifest.browser_specific_settings?.gecko;
    minimumVersion(gecko?.strict_min_version, '140.0', 'Firefox desktop minimum version');
    minimumVersion(
      manifest.browser_specific_settings?.gecko_android?.strict_min_version,
      '142.0',
      'Firefox Android minimum version',
    );
    check(
      typeof gecko?.id === 'string' && gecko.id.length > 0,
      'Firefox build requires a stable extension ID.',
    );
    sameMembers(
      gecko?.data_collection_permissions?.required,
      ['none'],
      'Firefox required data collection',
    );
    check(
      !gecko.data_collection_permissions.optional?.length,
      'Firefox must not request optional data collection.',
    );
    check(
      Array.isArray(manifest.background?.scripts) &&
        manifest.background.scripts.length > 0 &&
        !manifest.background.service_worker &&
        !manifest.background.page,
      'Firefox must use background scripts, not a service worker or page.',
    );
    check(
      !manifest.minimum_chrome_version,
      'Firefox build contains a Chrome-only minimum version.',
    );
  }
  check(
    manifest.background.persistent !== true,
    `${platform}: persistent background is not supported in this MV3 build.`,
  );
  const requireResource = resourceChecker(files, platform);
  checkManifestResources(manifest, requireResource);
  for (const page of ['popup.html', 'workbench.html', 'options.html']) {
    requireResource(page, 'required UI');
    check(
      files.get(page).toString('utf8').includes('id="root"'),
      `${platform}: ${page} is missing the React mount point.`,
    );
  }
  for (const file of ['LICENSE', 'NOTICE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md']) {
    requireResource(file, 'bundled notice');
    const original = await readFile(resolve(root, file));
    check(
      files.get(file).equals(original),
      `${platform}: bundled ${file} is stale. Run npm run prepare:assets and rebuild.`,
    );
  }
  requireResource('icon.svg', 'product icon');
  check(
    /<svg\b/.test(files.get('icon.svg').toString('utf8')),
    `${platform}: icon.svg is not an SVG.`,
  );
  for (const size of [16, 32, 48, 96, 128]) {
    const icon = manifest.icons?.[size];
    requireResource(icon, `required ${size}px icon`);
    const data = files.get(icon);
    check(
      data.length >= 24 &&
        data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      `${platform}: ${size}px icon must be a PNG.`,
    );
    check(
      data.readUInt32BE(16) === size && data.readUInt32BE(20) === size,
      `${platform}: ${icon} must be exactly ${size} × ${size} pixels.`,
    );
  }
  checkBundledCode(files, requireResource, platform);
  return { platform, manifest, count: files.size };
}

try {
  const builds = await Promise.all(['chrome', 'firefox'].map(verify));
  check(
    builds[0].manifest.name === builds[1].manifest.name &&
      builds[0].manifest.version === builds[1].manifest.version,
    'Chrome and Firefox product metadata differ.',
  );
  console.log(
    `Verified ${builds[0].manifest.name} ${packageJson.version}: ${builds.map((build) => `${build.platform} MV3 (${build.count} files)`).join(', ')}. Permissions, resources, notices, icons, and production artifacts passed.`,
  );
} catch (error) {
  console.error(
    `Build verification failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

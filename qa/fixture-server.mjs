import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTTP_PORT = Number(process.env.CQM_FIXTURE_HTTP_PORT || 4173);
const HTTPS_PORT = Number(process.env.CQM_FIXTURE_HTTPS_PORT || 4443);
const CERT_DIR = path.join(__dirname, 'certs');
const CERT_PATH = path.join(CERT_DIR, 'fixture-cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'fixture-key.pem');

function sendJson(res, statusCode, payload, headers = {}) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers,
    });
    res.end(JSON.stringify(payload, null, 2));
}

function getBaseDomain(hostname) {
    const hostWithoutPort = hostname.split(':')[0];
    const parts = hostWithoutPort.split('.');

    if (parts.length >= 2)
        return parts.slice(-2).join('.');

    return hostWithoutPort;
}

function buildFixturePage(origin, protocol, hostname) {
    const baseDomain = getBaseDomain(hostname);
    const hostOnlyOrigin = `${protocol}//${baseDomain}${origin.includes(':') ? ':' + origin.split(':').pop() : ''}`;
    const subdomainOrigin = `${protocol}//sub.${baseDomain}${origin.includes(':') ? ':' + origin.split(':').pop() : ''}`;
    const secureHint = protocol === 'https:' ? 'This page is served over HTTPS.' : 'This page is served over HTTP.';

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cookie Quick Manager Fixture</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 24px;
        line-height: 1.4;
      }
      h1, h2 {
        margin-bottom: 8px;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .card {
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 16px;
      }
      button, input {
        margin: 4px 0;
      }
      button {
        cursor: pointer;
      }
      code, pre {
        background: #f6f8fa;
        border-radius: 6px;
        padding: 2px 4px;
      }
      pre {
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .links a {
        display: inline-block;
        margin-right: 12px;
        margin-bottom: 8px;
      }
      .status {
        font-size: 0.95rem;
        color: #555;
      }
    </style>
  </head>
  <body>
    <h1>Cookie Quick Manager Fixture</h1>
    <p class="status">
      Origin: <code>${origin}</code><br>
      Hostname: <code>${hostname}</code><br>
      Base domain: <code>${baseDomain}</code><br>
      ${secureHint}
    </p>

    <div class="links">
      <a href="http://${baseDomain}:${HTTP_PORT}/">HTTP base host</a>
      <a href="http://sub.${baseDomain}:${HTTP_PORT}/">HTTP subdomain</a>
      <a href="https://${baseDomain}:${HTTPS_PORT}/">HTTPS base host</a>
      <a href="https://sub.${baseDomain}:${HTTPS_PORT}/">HTTPS subdomain</a>
    </div>

    <div class="grid">
      <section class="card">
        <h2>JS cookies</h2>
        <button onclick="setHostCookie()">Set host-only JS cookie</button><br>
        <button onclick="setDomainCookie()">Set domain JS cookie (.${baseDomain})</button><br>
        <button onclick="deleteJsCookie('fixture_js_host')">Delete host cookie via JS</button><br>
        <button onclick="deleteJsCookie('fixture_js_domain', '.${baseDomain}')">Delete domain cookie via JS</button>
      </section>

      <section class="card">
        <h2>Server cookies</h2>
        <button onclick="callApi('/api/set-cookie?name=fixture_http_only&value=httpOnly&httpOnly=1&sameSite=Lax&maxAge=3600')">Set HttpOnly cookie</button><br>
        <button onclick="callApi('/api/set-cookie?name=fixture_server_domain&value=shared&domain=.${baseDomain}&sameSite=Lax&maxAge=3600')">Set domain cookie from server</button><br>
        <button onclick="callApi('/api/delete-cookie?name=fixture_http_only')">Delete HttpOnly cookie</button><br>
        <button onclick="callApi('/api/delete-cookie?name=fixture_server_domain&domain=.${baseDomain}')">Delete server domain cookie</button><br>
        <button onclick="callApi('/api/set-cookie?name=fixture_secure&value=secure&secure=1&sameSite=None&maxAge=3600')">Set secure SameSite=None cookie</button>
      </section>

      <section class="card">
        <h2>Local storage</h2>
        <button onclick="setLocalFixtureValues()">Set fixture localStorage values</button><br>
        <button onclick="window.localStorage.removeItem('fixture_local_a'); refreshState();">Delete one localStorage key</button><br>
        <button onclick="window.localStorage.clear(); refreshState();">Clear localStorage</button>
      </section>
    </div>

    <h2>State</h2>
    <pre id="state">Loading…</pre>

    <script>
      async function callApi(pathname) {
        const response = await fetch(pathname, {credentials: 'include'});
        const result = await response.json();
        await refreshState(result);
      }

      function setHostCookie() {
        document.cookie = 'fixture_js_host=' + Date.now() + '; Path=/; SameSite=Lax';
        refreshState();
      }

      function setDomainCookie() {
        document.cookie = 'fixture_js_domain=' + Date.now() + '; Path=/; Domain=.${baseDomain}; SameSite=Lax';
        refreshState();
      }

      function deleteJsCookie(name, domain = '') {
        const domainPart = domain ? '; Domain=' + domain : '';
        document.cookie = name + '=; Path=/' + domainPart + '; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        refreshState();
      }

      function setLocalFixtureValues() {
        window.localStorage.setItem('fixture_local_a', 'alpha');
        window.localStorage.setItem('fixture_local_b', 'beta');
        refreshState();
      }

      async function refreshState(lastApiResult = null) {
        const localStorageSnapshot = {};
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          localStorageSnapshot[key] = window.localStorage.getItem(key);
        }

        const payload = {
          href: window.location.href,
          documentCookie: document.cookie,
          localStorage: localStorageSnapshot,
          lastApiResult,
        };

        document.getElementById('state').textContent = JSON.stringify(payload, null, 2);
      }

      refreshState();
    </script>
  </body>
</html>`;
}

function handleApiSetCookie(reqUrl, isSecureRequest, res) {
    const name = reqUrl.searchParams.get('name') || 'fixture_cookie';
    const value = reqUrl.searchParams.get('value') || String(Date.now());
    const pathValue = reqUrl.searchParams.get('path') || '/';
    const domain = reqUrl.searchParams.get('domain');
    const sameSite = reqUrl.searchParams.get('sameSite');
    const maxAge = reqUrl.searchParams.get('maxAge');
    const httpOnly = reqUrl.searchParams.get('httpOnly') === '1';
    const secure = reqUrl.searchParams.get('secure') === '1';

    const cookieParts = [`${name}=${value}`, `Path=${pathValue}`];
    if (domain)
        cookieParts.push(`Domain=${domain}`);
    if (sameSite)
        cookieParts.push(`SameSite=${sameSite}`);
    if (maxAge)
        cookieParts.push(`Max-Age=${maxAge}`);
    if (httpOnly)
        cookieParts.push('HttpOnly');
    if (secure)
        cookieParts.push('Secure');

    sendJson(res, 200, {
        ok: true,
        requestProtocol: isSecureRequest ? 'https' : 'http',
        setCookie: cookieParts.join('; '),
    }, {
        'Set-Cookie': cookieParts.join('; '),
    });
}

function handleApiDeleteCookie(reqUrl, res) {
    const name = reqUrl.searchParams.get('name') || 'fixture_cookie';
    const pathValue = reqUrl.searchParams.get('path') || '/';
    const domain = reqUrl.searchParams.get('domain');

    const cookieParts = [
        `${name}=`,
        `Path=${pathValue}`,
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Max-Age=0',
        'SameSite=Lax',
    ];

    if (domain)
        cookieParts.push(`Domain=${domain}`);

    sendJson(res, 200, {
        ok: true,
        deletedCookie: cookieParts.join('; '),
    }, {
        'Set-Cookie': cookieParts.join('; '),
    });
}

function requestHandler(isSecureRequest) {
    return (req, res) => {
        const reqUrl = new URL(req.url, `${isSecureRequest ? 'https' : 'http'}://${req.headers.host}`);

        if (reqUrl.pathname === '/api/set-cookie') {
            handleApiSetCookie(reqUrl, isSecureRequest, res);
            return;
        }

        if (reqUrl.pathname === '/api/delete-cookie') {
            handleApiDeleteCookie(reqUrl, res);
            return;
        }

        if (reqUrl.pathname === '/api/request-info') {
            sendJson(res, 200, {
                ok: true,
                cookiesHeader: req.headers.cookie || '',
                origin: `${isSecureRequest ? 'https' : 'http'}://${req.headers.host}`,
            });
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        res.end(buildFixturePage(
            `${isSecureRequest ? 'https' : 'http'}://${req.headers.host}`,
            `${isSecureRequest ? 'https' : 'http'}:`,
            req.headers.host,
        ));
    };
}

if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
    console.error('Missing HTTPS fixture certificate.');
    console.error('Run `npm run fixture:cert` first to generate qa/certs/fixture-cert.pem and fixture-key.pem.');
    process.exit(1);
}

const LISTEN_HOST = process.env.CQM_FIXTURE_HOST || '127.0.0.1';

http.createServer(requestHandler(false)).listen(HTTP_PORT, LISTEN_HOST, () => {
    console.log(`HTTP fixture server listening on http://lvh.me:${HTTP_PORT}/`);
});

https.createServer({
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH),
}, requestHandler(true)).listen(HTTPS_PORT, LISTEN_HOST, () => {
    console.log(`HTTPS fixture server listening on https://lvh.me:${HTTPS_PORT}/`);
});

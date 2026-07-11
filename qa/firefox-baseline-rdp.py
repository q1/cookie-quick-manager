#!/usr/bin/env python3

import json
import re
import socket
import subprocess
import sys
import time
from pathlib import Path


FIXTURE_URL = "http://lvh.me:4173/"


def discover_firefox_debug_session():
    ps_output = subprocess.check_output(
        ["ps", "-eo", "pid=,cmd="],
        text=True,
    )

    pattern = re.compile(
        r"^\s*\d+\s+/usr/bin/firefox\s+-start-debugger-server\s+(\d+)\s+.*?-profile\s+(\S+)",
        re.MULTILINE,
    )
    matches = pattern.findall(ps_output)
    if not matches:
        raise RuntimeError(
            "Could not find a Firefox instance launched with -start-debugger-server. "
            "Start the baseline extension with web-ext first."
        )

    port, profile_dir = matches[-1]
    return int(port), Path(profile_dir)


def extract_extension_uuid(profile_dir: Path):
    prefs_path = profile_dir / "prefs.js"
    prefs_text = prefs_path.read_text()
    match = re.search(r'user_pref\("extensions\.webextensions\.uuids", "(.*)"\);', prefs_text)
    if not match:
        raise RuntimeError("Could not locate extensions.webextensions.uuids in Firefox prefs.js")

    raw_json = match.group(1).encode("utf-8").decode("unicode_escape")
    uuid_map = json.loads(raw_json)

    temporary_ids = [key for key in uuid_map.keys() if key.endswith("@temporary-addon")]
    if not temporary_ids:
        raise RuntimeError("Could not find the temporary baseline extension UUID in Firefox prefs.js")

    return uuid_map[temporary_ids[-1]]


class RDPClient:
    def __init__(self, port: int):
        self.sock = socket.create_connection(("127.0.0.1", port))
        self._recv_packet(timeout=3)

    def close(self):
        self.sock.close()

    def _send_packet(self, payload):
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.sock.sendall(str(len(data)).encode("utf-8") + b":" + data)

    def _recv_packet(self, timeout=5):
        self.sock.settimeout(timeout)
        prefix = b""
        while b":" not in prefix:
            chunk = self.sock.recv(1)
            if not chunk:
                raise EOFError("Firefox RDP socket closed unexpectedly")
            prefix += chunk

        size_raw, remainder = prefix.split(b":", 1)
        size = int(size_raw.decode("utf-8"))
        payload = remainder
        while len(payload) < size:
            payload += self.sock.recv(size - len(payload))
        return json.loads(payload.decode("utf-8"))

    def _recv_until(self, predicate, timeout=8):
        deadline = time.time() + timeout
        while time.time() < deadline:
            packet = self._recv_packet(timeout=timeout)
            if predicate(packet):
                return packet
        raise TimeoutError("Timed out waiting for the expected Firefox RDP packet")

    def list_tabs(self):
        self._send_packet({"to": "root", "type": "listTabs"})
        return self._recv_until(lambda packet: "tabs" in packet)["tabs"]

    def get_target(self, tab_actor):
        self._send_packet({"to": tab_actor, "type": "getTarget"})
        return self._recv_until(lambda packet: "frame" in packet)["frame"]

    def navigate(self, frame_actor, url):
        self._send_packet({"to": frame_actor, "type": "navigateTo", "url": url})
        time.sleep(3)

    def evaluate(self, console_actor, expression, timeout=8):
        self._send_packet({"to": console_actor, "type": "evaluateJSAsync", "text": expression})
        packet = self._recv_until(
            lambda packet: packet.get("type") == "evaluationResult" and packet.get("from") == console_actor,
            timeout=timeout,
        )
        if packet.get("hasException"):
            raise RuntimeError(packet.get("exceptionMessage", "Unknown Firefox RDP evaluation error"))
        return packet.get("result")


def get_selected_target(client: RDPClient):
    tabs = client.list_tabs()
    selected = next((tab for tab in tabs if tab.get("selected")), tabs[0])
    frame = client.get_target(selected["actor"])
    return selected, frame


def main():
    port, profile_dir = discover_firefox_debug_session()
    extension_uuid = extract_extension_uuid(profile_dir)
    manager_url = f"moz-extension://{extension_uuid}/cookies.html?parent_url=http%3A%2F%2Flvh.me%3A4173%2F"

    client = RDPClient(port)
    results = []

    try:
        _, frame = get_selected_target(client)
        client.navigate(frame["actor"], FIXTURE_URL)

        _, frame = get_selected_target(client)
        seed_result = client.evaluate(
            frame["consoleActor"],
            (
                "document.cookie='fixture_js_host=baseline-host; path=/';"
                "document.cookie='fixture_js_domain=baseline-domain; domain=.lvh.me; path=/';"
                "localStorage.setItem('fixture_local_a','alpha');"
                "localStorage.setItem('fixture_local_b','beta');"
                "document.cookie"
            ),
        )
        results.append({
            "check": "fixture-seeding",
            "status": "passed",
            "details": seed_result,
        })
        if not ("fixture_js_host=baseline-host" in seed_result and "fixture_js_domain=baseline-domain" in seed_result):
            raise RuntimeError(f"Firefox fixture cookies were not seeded: {seed_result}")

        client.navigate(frame["actor"], manager_url)

        _, frame = get_selected_target(client)
        manager_state = client.evaluate(
            frame["consoleActor"],
            """JSON.stringify({
                title: document.title,
                domains: [...document.querySelectorAll('#domain-list li')].map(li => (li.childNodes[0]?.textContent || li.textContent).trim()),
                cookies: [...document.querySelectorAll('#cookie-list li')].map(li => li.textContent.trim())
            })""",
        )
        manager_state_data = json.loads(manager_state)
        results.append({
            "check": "manager-domain-list",
            "status": "passed",
            "details": manager_state_data,
        })
        if not (
            manager_state_data["title"] == "Cookie Quick Manager"
            and any("lvh.me" in domain for domain in manager_state_data["domains"])
            and manager_state_data["cookies"]
        ):
            raise RuntimeError(f"Firefox manager did not render fixture cookies: {manager_state_data}")

        grouped_domains = client.evaluate(
            frame["consoleActor"],
            """(() => {
                document.querySelector('#query-subdomains').click();
                return 'ok';
            })()""",
        )
        time.sleep(1)
        _, frame = get_selected_target(client)
        grouped_domains = client.evaluate(
            frame["consoleActor"],
            """JSON.stringify({
                domains: [...document.querySelectorAll('#domain-list li')].map(li => ({
                    domain: (li.childNodes[0]?.textContent || li.textContent).trim(),
                    count: li.querySelector('.badge')?.textContent?.trim() || ''
                }))
            })""",
        )
        results.append({
            "check": "group-subdomains",
            "status": "passed",
            "details": json.loads(grouped_domains),
        })
        grouped_domains_data = json.loads(grouped_domains)
        if not (len(grouped_domains_data["domains"]) == 1 and grouped_domains_data["domains"][0]["domain"] == "lvh.me"):
            raise RuntimeError(f"Unexpected grouped Firefox domains: {grouped_domains_data}")

        filtered_by_name = client.evaluate(
            frame["consoleActor"],
            """(() => {
                document.querySelector('#query-subdomains').click();
                document.querySelector('#search_domain').value = 'lvh.me :name:"fixture_js_domain"';
                document.querySelector('#actualize_button').click();
                return 'ok';
            })()""",
            timeout=10,
        )
        time.sleep(1)
        _, frame = get_selected_target(client)
        filtered_by_name = client.evaluate(
            frame["consoleActor"],
            """JSON.stringify({
                domains: [...document.querySelectorAll('#domain-list li')].map(li => (li.childNodes[0]?.textContent || li.textContent).trim()),
                cookies: [...document.querySelectorAll('#cookie-list li')].map(li => li.textContent.trim())
            })""",
            timeout=10,
        )
        results.append({
            "check": "search-filter-by-name",
            "status": "passed",
            "details": json.loads(filtered_by_name),
        })
        filtered_by_name_data = json.loads(filtered_by_name)
        if not (
            len(filtered_by_name_data["cookies"]) == 1
            and "fixture_js_domain" in filtered_by_name_data["cookies"][0]
        ):
            raise RuntimeError(f"Unexpected Firefox name-filter result: {filtered_by_name_data}")

        client.evaluate(
            frame["consoleActor"],
            "document.querySelector('#search_domain').value = 'lvh.me'; document.querySelector('#actualize_button').click(); 'ok'",
            timeout=10,
        )
        time.sleep(1)
        _, frame = get_selected_target(client)

        client.evaluate(
            frame["consoleActor"],
            "[...document.querySelectorAll('#domain-list li')].find(li => (li.childNodes[0]?.textContent || li.textContent).trim()==='lvh.me').click(); 'ok'",
        )
        time.sleep(1)

        _, frame = get_selected_target(client)
        host_cookie_state = client.evaluate(
            frame["consoleActor"],
            """JSON.stringify({
                selectedDomain: document.querySelector('#domain').value,
                selectedName: document.querySelector('#name').value,
                protectIconClass: document.querySelector('#protect_button span').className,
                cookieList: [...document.querySelectorAll('#cookie-list li')].map(li => li.textContent.trim())
            })""",
        )
        host_cookie_state_data = json.loads(host_cookie_state)
        results.append({
            "check": "select-host-cookie",
            "status": "passed",
            "details": host_cookie_state_data,
        })
        if not (
            host_cookie_state_data["selectedDomain"] == "lvh.me"
            and host_cookie_state_data["selectedName"] == "fixture_js_host"
            and any("fixture_js_host" in cookie for cookie in host_cookie_state_data["cookieList"])
        ):
            raise RuntimeError(f"Firefox host cookie selection failed: {host_cookie_state_data}")

        protect_icon_class = client.evaluate(
            frame["consoleActor"],
            "document.querySelector('#protect_button span').className",
        )
        if "glyphicon-unlock" in protect_icon_class:
            client.evaluate(frame["consoleActor"], "document.querySelector('#protect_button').click(); true")
        deadline = time.time() + 5
        while time.time() < deadline:
            normalized_protect_state = client.evaluate(
                frame["consoleActor"],
                "JSON.stringify({protectIconClass: document.querySelector('#protect_button span').className})",
            )
            normalized_protect_state_data = json.loads(normalized_protect_state)
            if "glyphicon-lock" in normalized_protect_state_data["protectIconClass"]:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Firefox protection did not activate before timeout")
        results.append({
            "check": "protect-state-normalized",
            "status": "passed",
            "details": normalized_protect_state_data,
        })
        protect_icon_class = normalized_protect_state_data["protectIconClass"]
        if "glyphicon-lock" not in protect_icon_class or "glyphicon-unlock" in protect_icon_class:
            raise RuntimeError(f"Firefox protection did not activate: {normalized_protect_state_data}")

        client.navigate(frame["actor"], FIXTURE_URL)
        _, frame = get_selected_target(client)
        before_delete = client.evaluate(frame["consoleActor"], "document.cookie")
        client.evaluate(
            frame["consoleActor"],
            "document.cookie='fixture_js_host=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'; document.cookie",
        )
        time.sleep(2)
        _, frame = get_selected_target(client)
        after_delete = client.evaluate(frame["consoleActor"], "document.cookie")
        results.append({
            "check": "protected-cookie-delete-from-page-js",
            "status": "passed",
            "details": {
                "beforeDelete": before_delete,
                "afterDeleteWait": after_delete,
            },
        })
        if not ("fixture_js_host=" in before_delete and "fixture_js_host=" in after_delete):
            raise RuntimeError(
                "Firefox protected cookie did not survive page deletion: "
                f"before={before_delete!r}, after={after_delete!r}"
            )

        print(json.dumps({
            "ok": True,
            "port": port,
            "profileDir": str(profile_dir),
            "extensionUuid": extension_uuid,
            "results": results,
        }, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": str(exc),
        }, indent=2))
        sys.exit(1)

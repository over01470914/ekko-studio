#!/usr/bin/env python3
"""Read-only lab module-off smoke: proves personal-agent is absent while the core responds.

Uses the isolated lab control files only; never touches production state or a real user home.
"""
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path.home() / 'Library/Application Support/ekko-personal-lab'
PORT = 4362
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(path, token=None):
    request = urllib.request.Request(f'http://127.0.0.1:{PORT}{path}',
                                     headers={'Authorization': 'Bearer ' + token} if token else {})
    try:
        with OPENER.open(request, timeout=8) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def main():
    credentials = json.loads((ROOT / 'lab-credentials.json').read_text())
    _, health = call('/health')
    unauthenticated, _ = call('/api/studio/extensions')
    authenticated, discovery = call('/api/studio/extensions', credentials['token'])
    if not health or not discovery:
        raise SystemExit('Lab not ready or discovery failed')
    ids = [item['id'] for item in discovery['extensions']]
    module_route, _ = call('/api/studio/personal-agent/state', credentials['token'])
    print(json.dumps({'health': health['status'], 'webui_version': health['webui_version'],
                      'discovery_unauthenticated': unauthenticated, 'discovery_authenticated': authenticated,
                      'advertised_extensions': ids, 'personalAgentAbsent': 'personal-agent' not in ids,
                      'personal_route_status_when_off': module_route}, indent=2))


if __name__ == '__main__':
    main()
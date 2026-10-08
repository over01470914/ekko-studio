#!/usr/bin/env python3
"""Personal Lab r1: exact-owner lifecycle and isolation receipt.
Never invokes production CLI stop, launchctl, a shared Bridge or a shell.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request

REPO = Path(__file__).resolve().parents[1]
ROOT = Path.home() / 'Library/Application Support/ekko-personal-lab'
SHORT = Path.home() / '.hermes/cache/scratch/pa-lab'
PORT = 4362
STATE = ROOT / 'runtime.json'
NODE = Path.home() / '.local/bin/node'
HERMES_ROOT = Path.home() / '.hermes/hermes-agent'
PRODUCTION = 'http://127.0.0.1:8648'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http(url, token=None):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token} if token else {})
    with OPENER.open(req, timeout=8) as res:
        return json.load(res)


def identity():
    health = http(PRODUCTION + '/health')
    return {'bridgePid': health.get('agent_bridge', {}).get('pid'), 'bridgeReady': health.get('agent_bridge', {}).get('ready'),
            'version': health.get('webui_version')}


def fingerprints():
    paths = [Path.home() / '.hermes/config.yaml', Path.home() / '.hermes/SOUL.md', Path.home() / '.hermes/memories/MEMORY.md']
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.exists()}


def env():
    root = str(ROOT)
    return {'HOME': str(Path.home()), 'USER': os.environ.get('USER', ''),
            'PATH': str(Path.home() / '.local/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin',
            'LANG': 'en_US.UTF-8', 'NODE_ENV': 'production', 'NODE_OPTIONS': '--max-old-space-size=2048',
            'PERSONAL_LAB_ROOT': root, 'PORT': str(PORT), 'BIND_HOST': '127.0.0.1',
            'HERMES_WEB_UI_HOME': str(ROOT / 'studio-home'), 'HERMES_WEBUI_STATE_DIR': str(ROOT / 'studio-home'),
            'HERMES_HOME': str(ROOT / 'hermes-home'), 'UPLOAD_DIR': str(ROOT / 'uploads'),
            'WORKSPACE_BASE': str(ROOT / 'fixtures'), 'TMPDIR': str(SHORT),
            'HERMES_BIN': str(Path.home() / '.local/bin/hermes'),
            'HERMES_AGENT_ROOT': str(HERMES_ROOT),
            'HERMES_AGENT_BRIDGE_PYTHON': str(HERMES_ROOT / 'venv/bin/python'),
            'HERMES_AGENT_BRIDGE_ENDPOINT': 'ipc://' + str(SHORT / 'broker.sock'),
            'HERMES_AGENT_BRIDGE_WORKER_TRANSPORT': 'ipc',
            'HERMES_AGENT_BRIDGE_KILL_STALE_IPC': '0',
            'HERMES_AGENT_BRIDGE_AUTO_RESTART': '0',
            'HERMES_WEB_UI_DISABLE_GATEWAY_AUTOSTART': '1',
            'HERMES_WEB_UI_STOP_GATEWAYS_ON_SHUTDOWN': '0',
            'HERMES_WEB_UI_DISABLE_MCP_AUTOINJECT': '1',
            'HERMES_WEB_UI_DISABLE_SKILL_INJECTION': '1',
            'HERMES_LAN_DISCOVERY_ENABLED': '0',
            'HERMES_GATEWAY_URL': 'http://127.0.0.1:1',
            'HERMES_WEB_UI_DISABLE_UPDATE_CHECK': 'true'}


def assert_lab():
    if REPO == Path.home() / 'projects/hermes-studio':
        raise RuntimeError('Refusing production checkout')
    for p in [ROOT, SHORT, ROOT / 'studio-home', ROOT / 'hermes-home', ROOT / 'uploads', ROOT / 'fixtures', ROOT / 'logs']:
        p.mkdir(parents=True, exist_ok=True, mode=0o700)
        p.chmod(0o700)
    if len(os.fsencode(str(SHORT / 'broker.sock'))) >= 100:
        raise RuntimeError('Unix endpoint path too long')
    if not (REPO / 'dist/server/index.js').exists():
        raise RuntimeError('Build this worktree before launching')


def port_listeners():
    # The user's Tailscale forwarder owns the same numeric port on another
    # address. It is not our process and must never be stopped or replaced.
    p = subprocess.run(['/usr/sbin/lsof', '-nP', '-t', '-iTCP@127.0.0.1:' + str(PORT), '-sTCP:LISTEN'], capture_output=True, text=True)
    return [int(i) for i in p.stdout.split()]


def start():
    assert_lab()
    if port_listeners():
        raise RuntimeError('Port occupied; refusing to release or replace incumbent')
    before = identity()
    hashes = fingerprints()
    credentials = ROOT / 'lab-credentials.json'
    if not credentials.exists():
        subprocess.run([str(NODE), str(REPO / 'node_modules/vite-node/vite-node.mjs'),
                        str(REPO / 'scripts/personal-lab-seed.ts')], cwd=REPO, env=env(), check=True, timeout=60)
    config = ROOT / 'hermes-home/config.yaml'
    if not config.exists():
        config.write_text('model:\n  default: unconfigured\nagent:\n  max_turns: 1\nterminal:\n  cwd: ' + str(ROOT / 'fixtures') + '\nmemory:\n  memory_enabled: false\n  user_profile_enabled: false\n', encoding='utf-8')
        config.chmod(0o600)
    log = open(ROOT / 'logs/server.log', 'ab', buffering=0)
    child = subprocess.Popen([str(NODE), str(REPO / 'dist/server/index.js')], cwd=REPO, env=env(),
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    log.close()
    launched = {'pid': child.pid, 'cwd': str(REPO), 'port': PORT, 'started_at': time.time(), 'production_before': before,
                'production_fingerprints_before': hashes, 'isolationRevision': '1.0.0'}
    STATE.write_text(json.dumps(launched, indent=2))
    STATE.chmod(0o600)
    deadline = time.time() + 90
    while time.time() < deadline:
        if child.poll() is not None:
            raise RuntimeError('Lab exited before ready; read lab logs')
        try:
            health = http('http://127.0.0.1:' + str(PORT) + '/health')
            if health.get('status') == 'ok':
                after = identity()
                if before['bridgePid'] != after['bridgePid'] or not after['bridgeReady']:
                    raise RuntimeError('Production bridge changed during lab start')
                if fingerprints() != hashes:
                    raise RuntimeError('Production control fingerprints changed; investigate concurrent writer before proceeding')
                receipt = {'event': 'started', 'labPid': child.pid, 'labHome': str(ROOT / 'studio-home'), 'health': health,
                           'production': after, 'network': 'loopback HTTP may be mapped to authenticated tailnet peers',
                           'claims': 'isolated baseline only; personal file functionality not yet implemented'}
                (ROOT / 'start-receipt.json').write_text(json.dumps(receipt, indent=2))
                print(json.dumps(receipt))
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError('Lab readiness timed out')


def stop():
    if not STATE.exists():
        raise RuntimeError('No lab ownership receipt')
    state = json.loads(STATE.read_text())
    pid = int(state['pid'])
    listeners = port_listeners()
    if pid not in listeners:
        raise RuntimeError('Exact lab PID does not own port; refusing to stop another process')
    cwd = subprocess.check_output(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True)
    if 'n' + str(REPO) + '\n' not in cwd:
        raise RuntimeError('PID cwd mismatch')
    before = identity()
    os.kill(pid, signal.SIGTERM)
    deadline = time.time() + 20
    while time.time() < deadline and pid in port_listeners():
        time.sleep(0.25)
    if pid in port_listeners():
        raise RuntimeError('Graceful shutdown did not release lab port; no broad forced cleanup attempted')
    after = identity()
    if before['bridgePid'] != after['bridgePid'] or not after['bridgeReady']:
        raise RuntimeError('Production bridge changed during lab stop')
    receipt = {'event': 'stopped', 'labPid': pid, 'portReleased': not port_listeners(), 'production': after,
               'productionFingerprintsUnchanged': fingerprints() == state.get('production_fingerprints_before')}
    (ROOT / 'stop-receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


def status():
    print(json.dumps({'listeners': port_listeners(), 'ownership': json.loads(STATE.read_text()) if STATE.exists() else None,
                      'production': identity()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    {'start': start, 'stop': stop, 'status': status}[args.action]()

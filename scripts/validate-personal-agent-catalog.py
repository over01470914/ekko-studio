#!/usr/bin/env python3
"""Strict, scoped change-catalog verification for Personal Agent changes."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'docs/personal-agent/change-catalog.json'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='4874651e1a39df252361df2219294e6fdafe65af')
    args = parser.parse_args()
    data = json.loads(CATALOG.read_text())
    if data.get('schemaVersion') != 1 or not isinstance(data.get('changes'), list) or not data['changes']:
        raise ValueError('Invalid or empty catalog')
    ids = set()
    declared = set()
    for entry in data['changes']:
        for field in ['id', 'project', 'date', 'revision', 'component', 'files', 'contracts', 'verification', 'limitations']:
            if field not in entry:
                raise ValueError('Missing catalog field: ' + field)
        if entry['id'] in ids:
            raise ValueError('Duplicate catalog change ID')
        ids.add(entry['id'])
        if not entry['files'] or not entry['verification']:
            raise ValueError('Files and real verification evidence required')
        for value in entry['files']:
            path = Path(value)
            if path.is_absolute() or '..' in path.parts or not (ROOT / path).is_file():
                raise ValueError('Invalid catalog path: ' + value)
            declared.add(value)
    changed = set(subprocess.check_output(['git', 'diff', '--name-only', args.base, '--'], cwd=ROOT, text=True).splitlines())
    changed.update(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines())
    missing = sorted(changed - declared)
    if missing:
        raise ValueError('Changed paths missing from catalog: ' + ', '.join(missing))
    print(json.dumps({'catalog': 'valid', 'changes': len(ids), 'covered_changed_paths': len(changed), 'base': args.base}))


if __name__ == '__main__':
    main()

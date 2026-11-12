#!/usr/bin/env python3
"""Check the GitHub page before a release.

* every local image / file linked from README.md, CHANGELOG.md and docs exists in the repository;
* README "What's new" and CHANGELOG.md mention the version in release-notes.json;
* screenshots are JPEG/PNG and not oversized.
"""
from pathlib import Path
import json
import re
import sys

BASE = Path(__file__).resolve().parents[1]
PAGES = ('README.md', 'CHANGELOG.md', 'RELEASING.md', 'docs/screenshots/README.md', 'packages/README.md')
LINK = re.compile(r'\]\(([^)\s]+)\)|src="([^"]+)"')
MAX_SHOT = 900 * 1024

problems = []
for page in PAGES:
    path = BASE / page
    if not path.is_file():
        problems.append('missing page: ' + page)
        continue
    for match in LINK.finditer(path.read_text(encoding='utf-8')):
        target = match.group(1) or match.group(2)
        if re.match(r'^(https?:|mailto:|#)', target):
            continue
        target = target.split('#', 1)[0]
        message = '%s links to a missing file: %s' % (page, target)
        if target and not (path.parent / target).exists() and message not in problems:
            problems.append(message)

version = json.loads((BASE / 'release-notes.json').read_text(encoding='utf-8'))['version']
readme = (BASE / 'README.md').read_text(encoding='utf-8')
if "What's new — V%s" % version not in readme:
    problems.append("README.md: update the \"What's new — V%s\" section" % version)
if '## V%s' % version not in (BASE / 'CHANGELOG.md').read_text(encoding='utf-8'):
    problems.append('CHANGELOG.md: add a "## V%s" entry' % version)

for shot in sorted((BASE / 'docs/screenshots').iterdir()):
    if shot.name == 'README.md':
        continue
    if shot.suffix.lower() not in ('.jpg', '.png'):
        problems.append('screenshot must be .jpg or .png: ' + shot.name)
    elif shot.stat().st_size > MAX_SHOT:
        problems.append('screenshot larger than 900 KB (compress it): %s' % shot.name)

if problems:
    print('\n'.join('[PAGE] ' + p for p in problems))
    sys.exit(1)
print('GitHub page OK for V%s' % version)

#!/usr/bin/env python3
"""Prepare and verify official Ultra Quran releases without installing the packages.

    python3 -B scripts/prepare_release.py                       # inspect packages/, build dist/
    python3 -B scripts/prepare_release.py --verify-published D  # compare downloaded release assets in D
    python3 -B scripts/prepare_release.py --verify-public       # download the public assets and compare
"""
import argparse
import ast
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile

REPO = 'K3bOra/UltraQuran'
PACKAGE = 'enigma2-plugin-extensions-ultraquran'
PREFIX = 'usr/lib/enigma2/python/Plugins/Extensions/UltraQuran/'
REQUIRED = ('__init__.py', 'plugin.py', 'plugin.png', 'screen.py', 'layout.py', 'support.py', 'updater.py')
BASE = Path(__file__).resolve().parents[1]
LIMIT = 96 * 1024 * 1024
FIXED_ASSETS = ('update.json', 'install.sh', 'RELEASE_NOTES.md', 'SHA256SUMS')


def asset_name(version, kind):
    return '%s_%s_all.%s' % (PACKAGE, version, kind)


def release_assets(version):
    return (asset_name(version, 'ipk'), asset_name(version, 'deb')) + FIXED_ASSETS


def members(payload):
    if payload[:8] != b'!<arch>\n':
        raise ValueError('Not an ar-format package')
    offset, result = 8, {}
    while offset < len(payload):
        header = payload[offset:offset + 60]
        if len(header) != 60 or header[-2:] != b'`\n':
            raise ValueError('Invalid package member header')
        size = int(header[48:58].strip())
        name = header[:16].decode('ascii').strip().rstrip('/')
        if size < 0 or name in result:
            raise ValueError('Invalid or duplicate package member')
        offset += 60
        result[name] = payload[offset:offset + size]
        if len(result[name]) != size:
            raise ValueError('Truncated package member')
        offset += size + size % 2
    controls = [n for n in result if re.fullmatch(r'control\.tar\.(gz|xz)', n)]
    data = [n for n in result if re.fullmatch(r'data\.tar\.(gz|xz)', n)]
    if (offset != len(payload) or len(controls) != 1 or len(data) != 1
            or set(result) != {'debian-binary', *controls, *data} or result['debian-binary'] != b'2.0\n'):
        raise ValueError('Unexpected package archive layout')
    return result, controls[0], data[0]


def inspect_package(path):
    payload = path.read_bytes()
    kind = path.suffix.lstrip('.')
    if kind not in ('ipk', 'deb') or not 0 < len(payload) <= LIMIT:
        raise ValueError('Unexpected package type or size: ' + path.name)
    parts, control_name, data_name = members(payload)
    with tarfile.open(fileobj=io.BytesIO(parts[control_name]), mode='r:*') as archive:
        controls = [m for m in archive if m.name.removeprefix('./') == 'control' and m.isfile()]
        if len(controls) != 1 or controls[0].size > 16384:
            raise ValueError('Missing or invalid package control')
        control = archive.extractfile(controls[0]).read().decode('utf-8')

    def field(name):
        matches = re.findall(r'^' + name + r':\s*(\S+)', control, re.M)
        if len(matches) != 1:
            raise ValueError('Missing or duplicate control field: ' + name)
        return matches[0]

    if field('Package') != PACKAGE or field('Architecture') != 'all':
        raise ValueError('Wrong plugin or architecture in ' + path.name)
    version = field('Version')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Only stable package versions (x.y.z) may be released')
    if path.name != asset_name(version, kind):
        raise ValueError('Rename %s to %s' % (path.name, asset_name(version, kind)))
    present, runtime_version, update_url = set(), None, None
    with tarfile.open(fileobj=io.BytesIO(parts[data_name]), mode='r:*') as archive:
        for item in archive:
            normalized = item.name.removeprefix('./')
            if item.name.startswith('/') or '..' in PurePosixPath(item.name).parts or not (item.isdir() or item.isfile()):
                raise ValueError('Unsafe package path or entry: ' + item.name)
            if not item.isfile():
                continue
            if normalized in present:
                raise ValueError('Duplicate package path: ' + normalized)
            present.add(normalized)
            if normalized.endswith(('.pyc', '.pyo')) or '__pycache__' in PurePosixPath(normalized).parts:
                raise ValueError('Bundled Python bytecode: ' + normalized)
            if normalized.endswith('.py'):
                data = archive.extractfile(item).read()
                tree = ast.parse(data.decode('utf-8'), filename=normalized)
                if normalized in (PREFIX + '__init__.py', PREFIX + 'updater.py'):
                    for node in tree.body:
                        if isinstance(node, ast.Assign):
                            for target in node.targets:
                                if isinstance(target, ast.Name) and target.id == 'VERSION':
                                    runtime_version = ast.literal_eval(node.value)
                                if isinstance(target, ast.Name) and target.id == 'UPDATE_URL':
                                    update_url = ast.literal_eval(node.value)
    missing = [name for name in REQUIRED if PREFIX + name not in present]
    if missing:
        raise ValueError('Incomplete plugin in %s: %s' % (path.name, ', '.join(missing)))
    if runtime_version != version:
        raise ValueError('__init__.VERSION (%s) does not match package Version (%s)' % (runtime_version, version))
    if update_url != 'https://raw.githubusercontent.com/%s/main/update.json' % REPO:
        raise ValueError('updater.UPDATE_URL must point to %s main/update.json' % REPO)
    return {'version': version, 'kind': kind,
            'url': 'https://github.com/%s/releases/download/v%s/%s' % (REPO, version, path.name),
            'sha256': hashlib.sha256(payload).hexdigest(), 'size': len(payload)}


def load_notes(version):
    notes = json.loads((BASE / 'release-notes.json').read_text(encoding='utf-8'))
    if notes.get('version') != version:
        raise ValueError('release-notes.json version (%s) differs from packages (%s)' % (notes.get('version'), version))
    for key in ('notes', 'notes_ar'):
        if not isinstance(notes.get(key), list) or not notes[key] or not all(isinstance(x, str) and x.strip() for x in notes[key]):
            raise ValueError('Missing release notes: ' + key)
    return notes


def manifest(ipk, deb, notes):
    version = ipk['version']
    return {
        'version': version,
        'name': 'Ultra Quran ' + version,
        'ipk': ipk['url'], 'ipk_sha256': ipk['sha256'], 'ipk_size': ipk['size'],
        'deb': deb['url'], 'deb_sha256': deb['sha256'], 'deb_size': deb['size'],
        'notes': notes['notes'],
        'notes_ar': notes['notes_ar'],
    }


def release_body(version, notes):
    title = 'Ultra Quran %s - Enigma2 & DreamOS' % version
    body = (
        '# ' + title + '\n\n'
        '**IPK ' + version + ' — OpenATV / OpenBH / OpenPLi (Python 3)**\n`' + asset_name(version, 'ipk') + '`\n\n'
        '**DEB ' + version + ' — DreamOS (Python 2.7)**\n`' + asset_name(version, 'deb') + '`\n\n'
        '## What’s new\n\n' + '\n'.join('- ' + x for x in notes['notes']) + '\n\n'
        '## الجديد\n\n' + '\n'.join('- ' + x for x in notes['notes_ar']) + '\n\n'
        '## Installation / التثبيت\n\n'
        '```sh\nwget -qO- https://raw.githubusercontent.com/' + REPO + '/main/install.sh | /bin/sh\n```\n'
        'The same command selects the IPK on Open images and the DEB on DreamOS, and checks size, SHA-256, '
        'package name, version and architecture before installing.\n\n'
        'نفس الأمر بيختار IPK للأوبن وDEB للدريم، وبيتأكد من الحجم وبصمة SHA-256 واسم الحزمة ورقمها قبل التثبيت.\n\n'
        'Already installed? Press the **red button** on the plugin home screen to update online.\n\n'
        'البلجن متسطب عندك؟ دوس **الزرار الأحمر** في الرئيسية للتحديث أونلاين.\n'
    )
    return title, body


def prepare():
    if os.environ.get('GITHUB_REPOSITORY', REPO).lower() != REPO.lower():
        raise ValueError('Release workflow belongs to ' + REPO)
    directory = BASE / 'packages'
    found = sorted(p for p in directory.iterdir() if p.suffix in ('.ipk', '.deb'))
    if sorted(p.suffix for p in found) != ['.deb', '.ipk']:
        raise ValueError('Keep exactly one IPK and one DreamOS DEB in packages/')
    infos = {p.suffix.lstrip('.'): inspect_package(p) for p in found}
    ipk, deb = infos['ipk'], infos['deb']
    if ipk['version'] != deb['version']:
        raise ValueError('IPK (%s) and DEB (%s) versions must match' % (ipk['version'], deb['version']))
    version = ipk['version']
    notes = load_notes(version)
    dest = BASE / 'dist'
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir()
    for p in found:
        shutil.copyfile(p, dest / p.name)
    shutil.copyfile(BASE / 'install.sh', dest / 'install.sh')
    (dest / 'update.json').write_text(json.dumps(manifest(ipk, deb, notes), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    title, body = release_body(version, notes)
    (dest / 'notes.md').write_text(body, encoding='utf-8')
    (dest / 'RELEASE_NOTES.md').write_text(body, encoding='utf-8')
    (dest / 'release-info.json').write_text(json.dumps({'tag': 'v' + version, 'version': version, 'title': title}) + '\n')
    (dest / 'SHA256SUMS').write_text(''.join(
        hashlib.sha256((dest / n).read_bytes()).hexdigest() + '  ' + n + '\n'
        for n in release_assets(version) if n != 'SHA256SUMS'))
    print('Prepared Ultra Quran v%s (IPK %.1f MB, DEB %.1f MB)' % (version, ipk['size'] / 1048576, deb['size'] / 1048576))


def verify(directory):
    dest = BASE / 'dist'
    version = json.loads((dest / 'release-info.json').read_text())['version']
    for name in release_assets(version):
        if (directory / name).read_bytes() != (dest / name).read_bytes():
            raise ValueError('Published asset differs: ' + name)
    actual = json.loads((directory / 'update.json').read_text(encoding='utf-8'))
    for kind in ('ipk', 'deb'):
        info = inspect_package(directory / asset_name(version, kind))
        if (actual.get(kind), actual.get(kind + '_sha256'), actual.get(kind + '_size')) != (info['url'], info['sha256'], info['size']):
            raise ValueError('Package differs from update.json: ' + kind)
    print('All %d downloaded release assets verified' % len(release_assets(version)))


def verify_public():
    import tempfile
    from urllib.request import Request, urlopen
    tag = json.loads((BASE / 'dist/release-info.json').read_text())['tag']
    version = tag[1:]
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        for name in release_assets(version):
            url = 'https://github.com/%s/releases/download/%s/%s' % (REPO, tag, name)
            with urlopen(Request(url, headers={'User-Agent': 'UltraQuran-release-verifier'}), timeout=180) as response:
                payload = response.read(LIMIT + 1)
            if len(payload) > LIMIT:
                raise ValueError('Public asset exceeds limit: ' + name)
            (directory / name).write_bytes(payload)
        verify(directory)
    print('Public downloads and update.json verified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--verify-published', type=Path)
    parser.add_argument('--verify-public', action='store_true')
    args = parser.parse_args()
    if args.verify_public:
        verify_public()
    elif args.verify_published:
        verify(args.verify_published)
    else:
        prepare()

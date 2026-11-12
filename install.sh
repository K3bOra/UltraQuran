#!/bin/sh
# Ultra Quran: unified official installer (IPK for OpenATV / OpenBH / OpenPLi, DEB for DreamOS).
# Supports: Open Enigma2 Python 3.5+ / DreamOS Python 2.7.9+ or 3.5+.
set -u

UQ_PACKAGE='enigma2-plugin-extensions-ultraquran'
UQ_CHANNEL=''
uq_deb=0
uq_ipk=0
if command -v dpkg >/dev/null 2>&1 && [ -f /var/lib/dpkg/status ]; then uq_deb=1; fi
if command -v opkg >/dev/null 2>&1; then uq_ipk=1; fi

if [ "$uq_deb" -eq 1 ] && [ "$uq_ipk" -eq 0 ]; then
    UQ_CHANNEL='dreamos'
elif [ "$uq_deb" -eq 0 ] && [ "$uq_ipk" -eq 1 ]; then
    UQ_CHANNEL='ipk'
elif [ "$uq_deb" -eq 1 ] && [ "$uq_ipk" -eq 1 ]; then
    uq_deb_plugin=0; uq_ipk_plugin=0; uq_deb_e2=0; uq_ipk_e2=0
    if dpkg -s "$UQ_PACKAGE" 2>/dev/null | grep -q '^Status:.* installed$'; then uq_deb_plugin=1; fi
    if opkg status "$UQ_PACKAGE" 2>/dev/null | grep -q '^Status:.* installed$'; then uq_ipk_plugin=1; fi
    if [ "$uq_deb_plugin" -ne "$uq_ipk_plugin" ]; then
        if [ "$uq_deb_plugin" -eq 1 ]; then UQ_CHANNEL='dreamos'; else UQ_CHANNEL='ipk'; fi
    elif [ "$uq_deb_plugin" -eq 1 ]; then
        printf '%s\n' '[ERROR] Ultra Quran is registered in BOTH package managers; not installing.'
        exit 1
    else
        if dpkg -s enigma2 2>/dev/null | grep -q '^Status:.* installed$'; then uq_deb_e2=1; fi
        if opkg status enigma2 2>/dev/null | grep -q '^Status:.* installed$'; then uq_ipk_e2=1; fi
        if [ "$uq_deb_e2" -ne "$uq_ipk_e2" ]; then
            if [ "$uq_deb_e2" -eq 1 ]; then UQ_CHANNEL='dreamos'; else UQ_CHANNEL='ipk'; fi
        fi
    fi
    if [ -z "$UQ_CHANNEL" ]; then
        printf '%s\n' '[ERROR] Both package managers found; cannot choose DEB/IPK safely.'
        exit 1
    fi
else
    printf '%s\n' '[ERROR] No supported package manager: dpkg or opkg.'
    exit 1
fi

UQ_PYTHON=''
if [ "$UQ_CHANNEL" = dreamos ]; then
    uq_candidates='python2.7 python2 python python3'
else
    uq_candidates='python3 python'
fi
for uq_candidate in $uq_candidates; do
    if command -v "$uq_candidate" >/dev/null 2>&1 && \
       "$uq_candidate" -c 'import sys; v=sys.version_info; sys.exit(0 if (v[0]==2 and v[:3]>=(2,7,9)) or (v[0]==3 and v[:2]>=(3,5)) else 1)' 2>/dev/null; then
        if [ "$UQ_CHANNEL" = ipk ] && ! "$uq_candidate" -c 'import sys; sys.exit(0 if sys.version_info[0]==3 else 1)' 2>/dev/null; then
            continue
        fi
        UQ_PYTHON="$uq_candidate"
        break
    fi
done
if [ -z "$UQ_PYTHON" ]; then
    printf '[ERROR] Unsupported Python runtime for %s (DreamOS: 2.7.9+ or 3.5+; Open: 3.5+).\n' "$UQ_CHANNEL"
    exit 1
fi

"$UQ_PYTHON" - "$UQ_CHANNEL" "$@" <<'ULTRAQURAN_UNIFIED_PY'
# -*- coding: utf-8 -*-
from __future__ import print_function, division
import hashlib
import io
import json
import os
import re
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time

try:
    from urllib.request import Request, HTTPRedirectHandler, HTTPSHandler, build_opener
    from urllib.parse import urlsplit
    STRING_TYPE = (str,)
    INT_TYPE = (int,)
except ImportError:
    from urllib2 import Request, HTTPRedirectHandler, HTTPSHandler, build_opener
    from urlparse import urlsplit
    STRING_TYPE = (str, unicode)  # noqa: F821 (Python 2)
    INT_TYPE = (int, long)  # noqa: F821 (Python 2)

REPO = 'K3bOra/UltraQuran'
PACKAGE = 'enigma2-plugin-extensions-ultraquran'
MAX_PACKAGE = 96 * 1024 * 1024
MAX_MANIFEST = 128 * 1024
DOWNLOAD_SECONDS = 900
CLOCK = getattr(time, 'monotonic', time.time)


def say(message):
    sys.stdout.write(str(message) + '\n')
    sys.stdout.flush()


def fail(message):
    raise RuntimeError(message)


def fullmatch(pattern, value):
    return re.match(r'(?:' + pattern + r')\Z', value) is not None


def only_github_https(url):
    part = urlsplit(url)
    host = part.hostname or ''
    if (part.scheme != 'https' or part.username or part.password or part.port
            or not (host == 'github.com' or host.endswith('.githubusercontent.com'))):
        raise ValueError('Only verified GitHub HTTPS package downloads are allowed')


class GitHubRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        only_github_https(newurl)
        return HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)


def verified_https_opener():
    if not hasattr(ssl, 'create_default_context'):
        fail('Verified HTTPS is unavailable: upgrade Python/SSL support')
    # Never disable TLS certificate or hostname validation for executable packages.
    context = ssl.create_default_context()
    return build_opener(GitHubRedirect(), HTTPSHandler(context=context))


def download(url, limit, sink, show_progress=False):
    """Stream `url` into the file object `sink`; return (byte count, sha256 hex)."""
    only_github_https(url)
    request = Request(url, headers={
        'User-Agent': 'UltraQuran-Official-Unified-Installer',
        'Cache-Control': 'no-cache',
    })
    response = verified_https_opener().open(request, timeout=30)
    try:
        only_github_https(response.geturl())
        length_header = response.headers.get('Content-Length', '')
        expected = int(length_header) if length_header.isdigit() else 0
        if expected > limit:
            raise ValueError('Download exceeds the size limit')
        digest = hashlib.sha256()
        count, last_report = 0, CLOCK()
        start = CLOCK()
        while True:
            if CLOCK() - start > DOWNLOAD_SECONDS:
                fail('GitHub download exceeded fifteen minutes; check internet connection')
            part = response.read(min(65536, limit + 1 - count))
            if not part:
                break
            count += len(part)
            if count > limit:
                raise ValueError('Downloaded file is too large')
            sink.write(part)
            digest.update(part)
            if show_progress and CLOCK() - last_report >= 3:
                if expected:
                    say('[DOWNLOAD] %d%% (%.1f / %.1f MB)' % (
                        min(100, 100 * count // expected), count / 1048576, expected / 1048576))
                else:
                    say('[DOWNLOAD] %.1f MB received' % (count / 1048576))
                last_report = CLOCK()
        if expected and count != expected:
            fail('Download interrupted: size does not match HTTP metadata')
        return count, digest.hexdigest()
    finally:
        response.close()


def get_manifest(channel):
    uri = 'https://github.com/%s/releases/latest/download/update.json' % REPO
    sink = io.BytesIO()
    download(uri, MAX_MANIFEST, sink)
    meta = json.loads(sink.getvalue().decode('utf-8'))
    if not isinstance(meta, dict):
        raise ValueError('Malformed release manifest')
    version = meta.get('version')
    if not isinstance(version, STRING_TYPE) or not fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid official release version')
    key = 'deb' if channel == 'dreamos' else 'ipk'
    filename = '%s_%s_all.%s' % (PACKAGE, version, key)
    expected_url = 'https://github.com/%s/releases/download/v%s/%s' % (REPO, version, filename)
    if meta.get(key) != expected_url:
        raise ValueError('Release URL does not match the official platform package')
    size = meta.get(key + '_size')
    if type(size) not in INT_TYPE or not 0 < size <= MAX_PACKAGE:
        raise ValueError('Invalid release package size')
    sha = meta.get(key + '_sha256')
    if not isinstance(sha, STRING_TYPE) or not fullmatch(r'[0-9a-fA-F]{64}', sha):
        raise ValueError('SHA-256 missing or invalid')
    return meta, key, filename


def control_from_package(path):
    """Read the control file of an ar-format package (IPK / DEB) without loading the data archive."""
    members = {}
    with open(path, 'rb') as handle:
        if handle.read(8) != b'!<arch>\n':
            raise ValueError('Not a Debian ar-format package')
        while True:
            header = handle.read(60)
            if not header:
                break
            if len(header) != 60 or header[-2:] != b'\x60\n':
                raise ValueError('Invalid package ar member header')
            try:
                length = int(header[48:58].strip())
                name = header[:16].decode('ascii').strip().rstrip('/')
            except (ValueError, UnicodeDecodeError):
                raise ValueError('Invalid ar member name/size')
            if length < 0 or name in members:
                raise ValueError('Invalid or duplicate ar member')
            if name == 'debian-binary' or name.startswith('control.tar.'):
                members[name] = handle.read(length)
                if len(members[name]) != length:
                    raise ValueError('Truncated archive member')
            else:
                members[name] = None
                handle.seek(length, 1)
            if length % 2:
                handle.seek(1, 1)
    if members.get('debian-binary') != b'2.0\n':
        raise ValueError('Invalid Debian package metadata')
    control_names = [x for x in members if x in ('control.tar.gz', 'control.tar.xz')]
    data_names = [x for x in members if x in ('data.tar.gz', 'data.tar.xz')]
    if len(control_names) != 1 or len(data_names) != 1:
        raise ValueError('Missing package control/data archive')
    with tarfile.open(fileobj=io.BytesIO(members[control_names[0]]), mode='r:*') as archive:
        controls = [x for x in archive if x.name in ('control', './control') and x.isfile()]
        if len(controls) != 1 or controls[0].size > 16384:
            raise ValueError('Invalid package control file')
        return archive.extractfile(controls[0]).read().decode('utf-8')


def fields_from_control(text):
    values = {}
    for key in ('Package', 'Version', 'Architecture'):
        matches = re.findall(r'^' + key + r':\s*(\S+)', text, re.M)
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous package field: ' + key)
        values[key] = matches[0]
    return values


def verify_file(path, meta):
    values = fields_from_control(control_from_package(path))
    for key, wanted in (('Package', PACKAGE), ('Version', meta['version']), ('Architecture', 'all')):
        if values[key] != wanted:
            raise ValueError('Unexpected %s: %s' % (key, values[key]))


def installed_status(channel):
    command = (['dpkg', '-s', PACKAGE] if channel == 'dreamos'
               else ['opkg', 'status', PACKAGE])
    try:
        out = subprocess.check_output(command, stderr=subprocess.STDOUT).decode('utf-8', 'replace')
    except (subprocess.CalledProcessError, OSError):
        return ''
    if re.search(r'^Status:.* installed$', out, re.M) is None:
        return ''
    found = re.search(r'^Version:\s*(\S+)', out, re.M)
    return found.group(1) if found else ''


def numeric_version(text):
    found = re.match(r'^(\d+)\.(\d+)\.(\d+)', text)
    if not found:
        raise ValueError('Cannot compare installed version; no changes made')
    return tuple(int(x) for x in found.groups())


def main(argv):
    if not argv or argv[0] not in ('dreamos', 'ipk'):
        raise ValueError('Missing target platform')
    channel, args = argv[0], argv[1:]
    if args not in ([], ['--verify-only']):
        raise ValueError('Supported option: --verify-only')
    say('\n=================================================')
    say('Ultra Quran | %s' % ('DreamOS (DEB)' if channel == 'dreamos' else 'Open Enigma2 (IPK)'))
    say('=================================================')
    say('[1/4] Reading the official GitHub release...')
    meta, key, filename = get_manifest(channel)
    say('[2/4] Downloading and verifying %s (%.1f MB)' % (filename, meta[key + '_size'] / 1048576))
    fd, path = tempfile.mkstemp(prefix='ultraquran_verified_', suffix='.' + key, dir='/tmp')
    try:
        with os.fdopen(fd, 'wb') as handle:
            size, sha = download(meta[key], MAX_PACKAGE, handle, True)
        if size != meta[key + '_size'] or sha != meta[key + '_sha256'].lower():
            raise ValueError('Size/SHA-256 verification failed; no installation performed')
        verify_file(path, meta)
        say('[OK] Verified SHA-256, size, package name, architecture and version: ' + meta['version'])
        if args == ['--verify-only']:
            say('[VERIFIED] No installation performed.')
            return
        if os.geteuid() != 0:
            fail('Run the installer as root on the receiver')
        installed = installed_status(channel)
        if installed and numeric_version(installed) > numeric_version(meta['version']):
            raise ValueError('Newer official package is already installed; downgrade refused')
        if installed == meta['version']:
            say('[OK] Latest official version is already installed.')
            return
        if channel == 'dreamos':
            say('[3/4] DreamOS: installing with dpkg...')
            command = ['dpkg', '--refuse-downgrade', '-i', path]
        else:
            say('[3/4] Refreshing Open Enigma2 package lists...')
            if subprocess.call(['opkg', 'update']):
                say('[WARN] Some feeds failed to refresh; using available package lists.')
            command = ['opkg', 'install', path]
        say('[4/4] Installing official package. Favorites, resume points and downloads are preserved...')
        if subprocess.call(command):
            fail('Package manager failed; inspect the output above')
        say('[OK] Ultra Quran %s installed.' % meta['version'])
        say('     Restart the Enigma2 GUI, then open Plugins > Ultra Quran.')
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        sys.stderr.write('[ERROR] %s\n' % error)
        sys.exit(1)
ULTRAQURAN_UNIFIED_PY
exit $?

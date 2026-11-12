# Current Ultra Quran packages

Keep exactly one IPK and one DreamOS DEB here, with their original package names:

- `enigma2-plugin-extensions-ultraquran_<version>_all.ipk` — OpenATV / OpenBH / OpenPLi
- `enigma2-plugin-extensions-ultraquran_<version>_all.deb` — DreamOS

Both must carry the same `Version`, matching `VERSION` in the plugin's `__init__.py` and `release-notes.json`.

See [the publishing guide](../RELEASING.md). The manifest (`update.json`), installer and `SHA256SUMS` are generated from the actual packages and attached to the verified release. Published versions are never overwritten.

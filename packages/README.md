# Current Ultra Quran packages

Keep exactly one IPK and one DreamOS DEB here, with these names (the same in every release):

- `UltraQuran_Open.ipk` — OpenATV / OpenBH / OpenPLi
- `UltraQuran_DreamOS.deb` — DreamOS

Both must carry the same `Version`, matching `VERSION` in the plugin's `__init__.py` and `release-notes.json`.

See [the publishing guide](../RELEASING.md). The manifest (`update.json`), installer and `SHA256SUMS` are generated from the actual packages and attached to the verified release. Published versions are never overwritten.

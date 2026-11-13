# Ultra Quran — Android app

A thin Android shell around the web app (`https://k3bora.github.io/UltraQuran/`) that adds what a browser cannot do:

- **Adhan with the app closed and the screen locked.** The page sends 30 days of prayer times and the chosen muezzin to `window.UltraQuranNative.schedulePrayers()`. The app sets alarm-clock alarms (`AdhanScheduler`), keeps the adhan recordings on the phone (`AdhanCache`) and plays them through a foreground service (`AdhanService`) with a stop button. Alarms are restored after reboot or a time change (`BootReceiver`).
- **Background playback notification** with previous / play-pause / next / close (`PlaybackService`), which also keeps the app alive while a recitation or radio plays.
- Full-screen video, GPS for prayer times, external links in the browser, back button.

No third-party libraries; plain Java against the Android SDK.

## Build

```
export ANDROID_HOME=/path/to/android-sdk
export UQ_KEYSTORE=/path/to/ultraquran-release.jks UQ_KEYSTORE_PASSWORD=...
gradle assembleRelease          # Gradle 8.9+; output: app/build/outputs/apk/release/app-release.apk
```

The GitHub workflow `.github/workflows/android.yml` builds the same APK when the repository secrets `UQ_KEYSTORE_B64` (base64 of the keystore) and `UQ_KEYSTORE_PASSWORD` are set. Keep the keystore private: every update must be signed with the same key or phones will refuse to install it over the old version.

Bump `versionCode` / `versionName` in `app/build.gradle` and `BuildConfigLite.VERSION` for each release.

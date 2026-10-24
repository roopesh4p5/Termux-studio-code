# Termux Studio Code

A lightweight, tablet-first Android code workspace — developed by Roopesh.
See `../android_tablet_code_workspace_prd.md` for the product spec.

## Architecture

- `android/` — tiny native host (Java, no Gradle): splash screen, WebView, and a
  `window.Native` bridge (`Bridge.java`) for filesystem, project search (`SearchOps.java`),
  HTTP (used by git), Termux `RUN_COMMAND` integration and private secret storage.
- `web/src/` — the UI, bundled with esbuild into the APK assets:
  CodeMirror 6 editor, isomorphic-git (Git runs in-app over the bridge),
  Prettier (formatting, lazy-loaded), marked + DOMPurify (Markdown preview).

## Build (on-device, in Termux)

```sh
pkg install openjdk-21 aapt aapt2 d8 apksigner esbuild nodejs
# android.jar (API 34) expected at ~/android-sdk/android-34/android.jar
bash build.sh            # -> TermuxStudioCode.apk
bash build.sh --install  # also copies to Download/ and opens the installer
```

Notes: esbuild can't read files on Android shared storage, so the build copies
`web/src` to `~/codeworkspace-build` first; npm dependencies live in
`~/codeworkspace-deps`. The signing key is `~/.codeworkspace/release.jks` —
keep it, or updates won't install over the existing app.

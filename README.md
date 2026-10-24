# Termux Studio Code

A tablet-first code workspace for Android: a VS Code-style editor that pairs with Termux for running your tools. Developed by Roopesh.

**Website, download and setup guide:** https://roopesh4p5.github.io/Termux-studio-code/

## Quick start

1. Install Termux from F-Droid: https://f-droid.org/packages/com.termux/ (not the Play Store build).
2. In Termux, run:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/roopesh4p5/Termux-studio-code/dev/docs/setup.sh | bash
   ```

   This installs ttyd, git, nodejs and python, sets `allow-external-apps=true`, asks for storage access, and opens the APK installer.
3. Open the app, then allow **All files access** and **Run commands in Termux environment**.

Direct APK: [docs/TermuxStudioCode.apk](docs/TermuxStudioCode.apk)

## Repository layout

- `codeworkspace/`: app source (Java host in `android/`, web UI in `web/`). See [codeworkspace/README.md](codeworkspace/README.md) for the on-device build.
- `docs/`: GitHub Pages site, setup script and release APK.
- `android_tablet_code_workspace_prd.md`: product spec.

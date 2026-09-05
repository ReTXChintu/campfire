; Inno Setup script for the Windows desktop build (admin panel + native MKV playback — see
; AGENTS.md). Compiled by the release-deploy CI workflow (.github/workflows/release-deploy.yml)
; via ISCC after `flutter build windows --release`; can also be run by hand from this folder with
; Inno Setup installed: `iscc campfire.iss /DMyAppVersion=1.2.3` (pass the version explicitly, or
; it falls back to 0.0.0 below so a plain double-click compile in the Inno Setup IDE still works).
;
; AppId is a fixed, permanent GUID — Inno Setup uses it to recognize "this is an upgrade of the
; same app" across versions (Start Menu entry, uninstall registration, etc.). Never change it.
#define MyAppName "Campfire"
#define MyAppExeName "campfire_mobile.exe"
#define MyAppPublisher "Campfire"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define ReleaseDir "..\..\build\windows\x64\runner\Release"

[Setup]
AppId={{9E4B6F2A-3C81-4D5E-B7F0-6A2D8C1E4F9B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Fixed output name — apps/frontend/.env's VITE_DESKTOP_APP_DOWNLOAD_URL points at this exact
; filename, always overwritten by the next build, same convention as the Android APK.
OutputDir=Output
OutputBaseFilename=CampfireSetup
SetupIconFile=..\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
; Not code-signed (no certificate) — Windows SmartScreen will warn on first run regardless of
; installer vs. raw exe; see apps/mobile/README.md's install instructions.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Everything flutter build windows produced — the exe plus every required DLL/data folder — none
; of it works if split apart, so the whole Release directory is staged as-is.
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

; Prismux Windows NSIS Installer Customization (Mount Point 6)
; Note: Prismux ships with ZERO preinstalled official plugins.
; Active official plugins (qq / fishdock-hook) are installed on demand via the Prismux Plugin Center.
; Retired plugins (pet / ssh) have been replaced by Prismux built-in capabilities.
; SAFETY INVARIANT: This script NEVER modifies or deletes %USERPROFILE%\.prismux
; (memory.db, credentials, wallpapers, active plugins, threads) or portable data\ folders.

!include "StrFunc.nsh"
!ifdef BUILD_UNINSTALLER
  ${UnStrRep}
  !define PrismuxStrRep '${UnStrRep}'
!else
  ${StrRep}
  !define PrismuxStrRep '${StrRep}'
!endif

!ifndef BUILD_UNINSTALLER
  Var PrismuxOptionsDialog
  Var PrismuxDesktopShortcutCheckbox
  Var PrismuxCreateDesktopShortcut
  Var PrismuxHadExistingInstall
  Var PrismuxHadExistingDesktopShortcut
  Var PrismuxOptionsPageVisited

  ; Override electron-builder's desktop shortcut flag predicate so unchecking
  ; "Create desktop shortcut" (or silently updating an install with no desktop shortcut)
  ; prevents addDesktopLink from creating a desktop .lnk in the first place.
  !ifdef isNoDesktopShortcut
    !undef isNoDesktopShortcut
  !endif
  !macro _prismuxSkipDesktopShortcut _a _b _t _f
    ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
    StrCmp "$R9" "true" `${_t}` 0
    StrCmp "$PrismuxCreateDesktopShortcut" "0" `${_t}` `${_f}`
  !macroend
  !define isNoDesktopShortcut `"" prismuxSkipDesktopShortcut ""`
!endif

!macro customAppRunningMessages
  Push $0
  Push $1
  ${If} $IsPowerShellAvailable == 0
    System::Call 'kernel32::SetEnvironmentVariable(t "PRISMUX_INSTALL_DIR", t "$INSTDIR")'
    nsExec::ExecToStack `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetDirectoryName($$_.ExecutablePath) -eq $$env:PRISMUX_INSTALL_DIR } | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($$_.ExecutablePath) } | Where-Object { $$_ -in 'Prismux', 'Prismux (Nightly)', 'Prismux (Beta)' } | Select-Object -First 1 | ForEach-Object { [Console]::Write($$_) }"`
    Pop $0
    Pop $1
    System::Call 'kernel32::SetEnvironmentVariable(t "PRISMUX_INSTALL_DIR", p 0)'
    ${If} $0 == 0
      ${If} $1 == "Prismux"
      ${OrIf} $1 == "Prismux (Nightly)"
      ${OrIf} $1 == "Prismux (Beta)"
        ${PrismuxStrRep} $appRunningMessage $appRunningMessage "${PRODUCT_NAME}" $1
        ${PrismuxStrRep} $appClosingMessage $appClosingMessage "${PRODUCT_NAME}" $1
        ${PrismuxStrRep} $appCannotBeClosedMessage $appCannotBeClosedMessage "${PRODUCT_NAME}" $1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!ifndef BUILD_UNINSTALLER
  ; Define sweep helpers inside customHeader so electron-builder's common.nsh / multiUser.nsh
  ; defines (${APP_EXECUTABLE_FILENAME}, ${INSTALL_REGISTRY_KEY}, ${UNINSTALL_REGISTRY_KEY})
  ; and global shortcut vars ($newStartMenuLink, $newDesktopLink) are already declared.
  !macro customHeader
  ; Safely removes ONLY known obsolete/renamed Prismux/Electron/Tauri binary and resource
  ; files inside $INSTDIR immediately before fresh v0.2.0+ payload extraction.
  ; Preserves portable "$INSTDIR\data" and NEVER touches "$PROFILE\.prismux".
  Function PrismuxSweepObsoleteInstDirFiles
    Push $0
    StrCpy $0 "0"

    ; Guard: never operate on empty paths or the user's ~/.prismux data root.
    ${If} "$INSTDIR" == ""
    ${OrIf} "$INSTDIR" == "$PROFILE"
    ${OrIf} "$INSTDIR" == "$PROFILE\.prismux"
    ${OrIf} "$INSTDIR" == "$LOCALAPPDATA"
      Pop $0
      Return
    ${EndIf}

    ; Only sweep when $INSTDIR already holds a recognizable prior Prismux artifact.
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${OrIf} ${FileExists} "$INSTDIR\Prismux.exe"
    ${OrIf} ${FileExists} "$INSTDIR\resources\app.asar"
    ${OrIf} ${FileExists} "$INSTDIR\resources\server.asar"
    ${OrIf} ${FileExists} "$INSTDIR\resources\prismux-daemon\cli.js"
    ${OrIf} ${FileExists} "$INSTDIR\workbench-ui\index.html"
    ${OrIf} ${FileExists} "$INSTDIR\Uninstall.exe"
      StrCpy $0 "1"
    ${EndIf}

    ${If} $0 != "1"
      Pop $0
      Return
    ${EndIf}

    DetailPrint "Cleaning obsolete files from previous Prismux installation in $INSTDIR..."

    ; 1. Legacy Tauri v0.0.1 shell artifacts if upgrading in-place into an old folder.
    RMDir /r "$INSTDIR\workbench-ui"
    RMDir /r "$INSTDIR\daemon"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\WebView2Loader.dll"

    ; 2. Stale / renamed Electron resources & ASAR archives (fresh copies are extracted next).
    Delete "$INSTDIR\resources\app.asar"
    RMDir /r "$INSTDIR\resources\app.asar.unpacked"
    Delete "$INSTDIR\resources\server.asar"
    RMDir /r "$INSTDIR\resources\server.asar.unpacked"
    Delete "$INSTDIR\resources\default_app.asar"
    Delete "$INSTDIR\resources\app-update.yml"
    Delete "$INSTDIR\resources\elevate.exe"
    RMDir /r "$INSTDIR\resources\prismux-daemon"
    RMDir /r "$INSTDIR\resources\native"
    RMDir /r "$INSTDIR\resources\windows-tools"
    RMDir /r "$INSTDIR\resources\wsl-runtime"
    RMDir /r "$INSTDIR\resources\resources"
    ; Retired/stale plugin directories if an older dev/custom archive ever placed them here.
    RMDir /r "$INSTDIR\resources\plugins-official"
    RMDir /r "$INSTDIR\resources\plugins"
    RMDir /r "$INSTDIR\resources\plugin-pet"
    RMDir /r "$INSTDIR\resources\plugin-ssh"
    RMDir "$INSTDIR\resources"

    ; 3. Obsolete / version-specific Electron runtime DLLs, paks, snapshots & renamed executables.
    RMDir /r "$INSTDIR\swiftshader"
    RMDir /r "$INSTDIR\locales"
    Delete "$INSTDIR\d3dcompiler_47.dll"
    Delete "$INSTDIR\dxcompiler.dll"
    Delete "$INSTDIR\dxil.dll"
    Delete "$INSTDIR\ffmpeg.dll"
    Delete "$INSTDIR\libEGL.dll"
    Delete "$INSTDIR\libGLESv2.dll"
    Delete "$INSTDIR\vk_swiftshader.dll"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\vulkan-1.dll"
    Delete "$INSTDIR\icudtl.dat"
    Delete "$INSTDIR\snapshot_blob.bin"
    Delete "$INSTDIR\v8_context_snapshot.bin"
    Delete "$INSTDIR\chrome_100_percent.pak"
    Delete "$INSTDIR\chrome_200_percent.pak"
    Delete "$INSTDIR\resources.pak"
    Delete "$INSTDIR\LICENSE.electron.txt"
    Delete "$INSTDIR\LICENSES.chromium.html"
    Delete "$INSTDIR\Prismux (Alpha).exe"

    ClearErrors
    Pop $0
  FunctionEnd

  ; Cleans a separate legacy Tauri-era installation directory (e.g. %LOCALAPPDATA%\Prismux).
  ; Takes candidate directory path on top of the stack.
  ; Strictly validates legacy Tauri markers and NEVER deletes portable data\ or ~/.prismux.
  Function PrismuxSweepLegacyTauriDir
    Exch $R8
    Push $0
    StrCpy $0 "0"

    ${If} "$R8" == ""
    ${OrIf} "$R8" == "$INSTDIR"
    ${OrIf} "$R8" == "$PROFILE"
    ${OrIf} "$R8" == "$PROFILE\.prismux"
    ${OrIf} "$R8" == "$LOCALAPPDATA"
    ${OrIf} "$R8" == "$LOCALAPPDATA\Programs"
      Goto PrismuxSweepLegacyTauriDirDone
    ${EndIf}

    ; Verify this directory is genuinely a legacy Tauri Prismux installation (NOT an Electron install).
    ${If} ${FileExists} "$R8\workbench-ui\index.html"
      StrCpy $0 "1"
    ${ElseIf} ${FileExists} "$R8\Prismux.exe"
      ${IfNot} ${FileExists} "$R8\resources\app.asar"
        ${If} ${FileExists} "$R8\Uninstall.exe"
        ${OrIf} ${FileExists} "$R8\daemon\dist\cli.js"
          StrCpy $0 "1"
        ${EndIf}
      ${EndIf}
    ${EndIf}

    ${If} $0 != "1"
      Goto PrismuxSweepLegacyTauriDirDone
    ${EndIf}

    DetailPrint "Removing legacy Tauri-era Prismux files from $R8..."
    Delete "$R8\Prismux.exe"
    Delete "$R8\WebView2Loader.dll"
    Delete "$R8\LICENSE"
    Delete "$R8\README.md"
    Delete "$R8\PORTABLE_MODE.txt"
    Delete "$R8\Uninstall.exe"
    RMDir /r "$R8\daemon"
    RMDir /r "$R8\workbench-ui"
    ; Only removes $R8 if empty; preserves portable "$R8\data\" if present.
    RMDir "$R8"
    ClearErrors

  PrismuxSweepLegacyTauriDirDone:
    Pop $0
    Pop $R8
  FunctionEnd

  ; Removes exact legacy Prismux Tauri/Alpha shortcuts and uninstall registry entries so
  ; Windows "Installed apps" and Start Menu never show duplicate Prismux entries.
  ; NEVER touches unrelated apps or %USERPROFILE%\.prismux.
  Function PrismuxCleanupLegacyRegistryAndShortcuts
    Push $0
    Push $1

    ; 1. Detect and sweep legacy Tauri installation locations (never touching $INSTDIR here).
    ReadRegStr $0 HKCU "Software\Prismux" "InstallDir"
    ${If} "$0" != ""
      Push "$0"
      Call PrismuxSweepLegacyTauriDir
    ${EndIf}

    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "InstallLocation"
    ${If} "$0" != ""
      Push "$0"
      Call PrismuxSweepLegacyTauriDir
    ${EndIf}

    Push "$LOCALAPPDATA\Prismux"
    Call PrismuxSweepLegacyTauriDir

    ; 2. Remove exact legacy Tauri HKCU Uninstall entry if distinct from electron-builder's GUID key.
    ${If} "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" != "${UNINSTALL_REGISTRY_KEY}"
      ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "DisplayName"
      ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "Publisher"
      ${If} "$0" == "Prismux"
      ${OrIf} "$1" == "Fish-under-sea / Prismux Contributors"
      ${OrIf} "$1" == "Prismux Contributors"
        DetailPrint "Removing legacy Prismux uninstall registry entry..."
        DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux"
      ${EndIf}
    ${EndIf}

    ; 3. Remove exact legacy Tauri HKCU Software\Prismux metadata key if distinct from current key.
    ${If} "Software\Prismux" != "${INSTALL_REGISTRY_KEY}"
      ReadRegStr $0 HKCU "Software\Prismux" "InstallDir"
      ${If} "$0" != ""
        DeleteRegKey HKCU "Software\Prismux"
      ${EndIf}
    ${EndIf}

    ; 4. Remove exact legacy Tauri v2 identifier key if present and distinct from current key.
    ${If} "Software\io.prismux.desktop" != "${INSTALL_REGISTRY_KEY}"
      ReadRegStr $0 HKCU "Software\io.prismux.desktop" "InstallDir"
      ReadRegStr $1 HKCU "Software\io.prismux.desktop" ""
      ${If} "$0" != ""
      ${OrIf} "$1" != ""
        DeleteRegKey HKCU "Software\io.prismux.desktop"
      ${EndIf}
    ${EndIf}

    ; 5. Remove legacy Tauri / Alpha duplicate Start Menu and Desktop shortcuts.
    ${If} ${FileExists} "$SMPROGRAMS\Prismux\Uninstall Prismux.lnk"
      WinShell::UninstShortcut "$SMPROGRAMS\Prismux\Uninstall Prismux.lnk"
      Delete "$SMPROGRAMS\Prismux\Uninstall Prismux.lnk"
    ${EndIf}
    ${If} "$newStartMenuLink" != "$SMPROGRAMS\Prismux\Prismux.lnk"
    ${AndIf} ${FileExists} "$SMPROGRAMS\Prismux\Prismux.lnk"
      WinShell::UninstShortcut "$SMPROGRAMS\Prismux\Prismux.lnk"
      Delete "$SMPROGRAMS\Prismux\Prismux.lnk"
    ${EndIf}
    RMDir "$SMPROGRAMS\Prismux"

    ${If} "$newStartMenuLink" != "$SMPROGRAMS\Prismux (Alpha).lnk"
    ${AndIf} ${FileExists} "$SMPROGRAMS\Prismux (Alpha).lnk"
      WinShell::UninstShortcut "$SMPROGRAMS\Prismux (Alpha).lnk"
      Delete "$SMPROGRAMS\Prismux (Alpha).lnk"
    ${EndIf}
    ${If} "$newDesktopLink" != "$DESKTOP\Prismux (Alpha).lnk"
    ${AndIf} ${FileExists} "$DESKTOP\Prismux (Alpha).lnk"
      WinShell::UninstShortcut "$DESKTOP\Prismux (Alpha).lnk"
      Delete "$DESKTOP\Prismux (Alpha).lnk"
    ${EndIf}

    ClearErrors
    Pop $1
    Pop $0
  FunctionEnd
  !macroend

  ; Runs right after uninstallOldVersion and right BEFORE installApplicationFiles.
  ; Preserves electron-builder's exact uninstall error check, then sweeps obsolete
  ; in-place $INSTDIR files and legacy Tauri-era directories/shortcuts/registry keys.
  !macro customUnInstallCheck
    ${If} ${Errors}
      DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
      ClearErrors
    ${ElseIf} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      SetErrorLevel 2
      Quit
    ${EndIf}

    Call PrismuxSweepObsoleteInstDirFiles
    Call PrismuxCleanupLegacyRegistryAndShortcuts
  !macroend

  !macro customInit
    Push $0
    StrCpy $PrismuxCreateDesktopShortcut "1"
    StrCpy $PrismuxHadExistingInstall "0"
    StrCpy $PrismuxHadExistingDesktopShortcut "0"
    StrCpy $PrismuxOptionsPageVisited "0"

    ; Respect explicit --no-desktop-shortcut CLI flag.
    ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
    ${If} $R9 == "true"
      StrCpy $PrismuxCreateDesktopShortcut "0"
    ${EndIf}

    ; Ensure default per-user install directory resolves to %LOCALAPPDATA%\Programs\<APP_FILENAME>
    ; (e.g. $LOCALAPPDATA\Programs\Prismux) instead of Program Files, while honoring explicit /D=,
    ; existing HKCU installation paths, and custom choices on the directory page.
    !ifndef INSTALL_MODE_PER_ALL_USERS
      ${If} $installMode != "all"
        !insertmacro GetDParameter $0
        ${If} $0 == ""
        ${AndIf} $perUserInstallationFolder == ""
          StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
        ${EndIf}
      ${EndIf}
    !endif

    ; Detect prior installation and existing desktop shortcut BEFORE uninstallOldVersion runs.
    !ifndef INSTALL_MODE_PER_ALL_USERS
      !ifndef ONE_CLICK
        ${If} $hasPerUserInstallation == "1"
        ${OrIf} $hasPerMachineInstallation == "1"
          StrCpy $PrismuxHadExistingInstall "1"
        ${EndIf}
      !endif
    !endif
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      StrCpy $PrismuxHadExistingInstall "1"
    ${EndIf}

    ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      StrCpy $PrismuxHadExistingDesktopShortcut "1"
    ${Else}
      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
      ${If} $0 != ""
      ${AndIf} ${FileExists} "$DESKTOP\$0.lnk"
        StrCpy $PrismuxHadExistingDesktopShortcut "1"
      ${ElseIf} ${FileExists} "$DESKTOP\${PRODUCT_FILENAME}.lnk"
        StrCpy $PrismuxHadExistingDesktopShortcut "1"
      ${EndIf}
    ${EndIf}

    ; Silent auto-updates (/S) or --updated installs skip interactive pages and preserve
    ; the user's existing desktop shortcut state (never force-adding one if absent).
    ${If} ${Silent}
    ${OrIf} ${isUpdated}
      ${If} $PrismuxHadExistingInstall == "1"
      ${AndIf} $PrismuxHadExistingDesktopShortcut == "0"
        StrCpy $PrismuxCreateDesktopShortcut "0"
      ${EndIf}
    ${EndIf}
    Pop $0
  !macroend

  !macro customPageAfterChangeDir
    Page custom PrismuxOptionsPageCreate PrismuxOptionsPageLeave

    Function PrismuxDesktopShortcutToggle
      Exch $0
      ${NSD_GetState} $PrismuxDesktopShortcutCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $PrismuxCreateDesktopShortcut "1"
      ${Else}
        StrCpy $PrismuxCreateDesktopShortcut "0"
      ${EndIf}
      Pop $0
    FunctionEnd

    Function PrismuxOptionsPageCreate
      ${If} ${Silent}
      ${OrIf} ${isUpdated}
        Abort
      ${EndIf}

      Push $0
      Push $1
      Push $2
      Push $3
      Push $4

      ; Adapt copy automatically to Simplified Chinese, Traditional Chinese, or English.
      ${If} $LANGUAGE == 2052
      ${OrIf} $LANGUAGE == 4100
        StrCpy $0 "安装选项"
        StrCpy $1 "配置桌面快捷方式等附加安装选项。"
        StrCpy $2 "请选择安装 ${PRODUCT_NAME} 时要执行的附加任务："
        StrCpy $3 "创建桌面快捷方式"
        StrCpy $4 "取消勾选后，安装完成将不会在桌面创建快捷图标（仍可通过开始菜单启动）。"
      ${ElseIf} $LANGUAGE == 1028
      ${OrIf} $LANGUAGE == 3076
      ${OrIf} $LANGUAGE == 5124
        StrCpy $0 "安裝選項"
        StrCpy $1 "設定桌面捷徑等附加安裝選項。"
        StrCpy $2 "請選擇安裝 ${PRODUCT_NAME} 時要執行的附加工作："
        StrCpy $3 "建立桌面捷徑"
        StrCpy $4 "取消勾選後，安裝完成將不會在桌面建立捷徑圖示（仍可從開始功能表啟動）。"
      ${Else}
        StrCpy $0 "Installation Options"
        StrCpy $1 "Choose shortcut options before installing ${PRODUCT_NAME}."
        StrCpy $2 "Select additional tasks to perform while installing ${PRODUCT_NAME}:"
        StrCpy $3 "Create desktop shortcut"
        StrCpy $4 "Uncheck this option to skip creating a desktop icon (the Start Menu shortcut will still be created)."
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "$0" "$1"

      nsDialogs::Create 1018
      Pop $PrismuxOptionsDialog
      ${If} $PrismuxOptionsDialog == error
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Pop $0
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0u 0u 100% 18u "$2"
      Pop $R0

      ${NSD_CreateCheckbox} 10u 26u 280u 16u "$3"
      Pop $PrismuxDesktopShortcutCheckbox
      ${If} $PrismuxCreateDesktopShortcut == "1"
        ${NSD_Check} $PrismuxDesktopShortcutCheckbox
      ${Else}
        ${NSD_Uncheck} $PrismuxDesktopShortcutCheckbox
      ${EndIf}
      ${NSD_OnClick} $PrismuxDesktopShortcutCheckbox PrismuxDesktopShortcutToggle

      ${NSD_CreateLabel} 22u 46u 270u 30u "$4"
      Pop $R0

      StrCpy $PrismuxOptionsPageVisited "1"

      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function PrismuxOptionsPageLeave
      Push $0
      ${NSD_GetState} $PrismuxDesktopShortcutCheckbox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $PrismuxCreateDesktopShortcut "1"
      ${Else}
        StrCpy $PrismuxCreateDesktopShortcut "0"
      ${EndIf}
      Pop $0
    FunctionEnd
  !macroend
!endif

!macro customInstall
  DetailPrint "Prismux core installed (2 active official plugins: qq / fishdock-hook are NOT preinstalled by default)."
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${IfNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${If} $PrismuxCreateDesktopShortcut == "0"
      ; Defense-in-depth: ensure no desktop shortcut remains when unchecked
      ; (only removes Prismux's own desktop .lnk; never touches any other user file).
      ${If} ${FileExists} "$newDesktopLink"
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${EndIf}
    ${ElseIf} $PrismuxOptionsPageVisited == "1"
      ; User explicitly kept "Create desktop shortcut" checked in interactive wizard:
      ; guarantee the desktop .lnk exists with full-bleed white-shell icon and AUMI.
      ${IfNot} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${EndIf}
    ${EndIf}
  !endif
  ; Refresh Windows Shell icon/shortcut cache after legacy shortcut sweep.
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

; Prismux Windows NSIS Installer Customization (Mount Point 6)
; Note: Prismux ships with ZERO preinstalled official plugins.
; Active official plugins (qq / fishdock-hook) are installed on demand via the Prismux Plugin Center.
; Retired plugins (pet / ssh) have been replaced by Prismux built-in capabilities.

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
!macroend

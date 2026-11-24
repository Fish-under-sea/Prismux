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
!macroend

; Prismux Windows Installer Script (NSIS 3 / MUI2)
; Quiet-Luxury Restrained 5-Step Flow:
;   1. Welcome -> 2. Directory (/D supported) -> 3. Components & Portable Mode -> 4. InstFiles -> 5. Finish

!ifndef VERSION
  !define VERSION "0.0.1-alpha.1"
!endif

!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.0.1.1"
!endif

!ifndef STAGE_DIR
  !define STAGE_DIR "..\..\..\.work\release-stage"
!endif

!ifndef OUT_FILE
  !define OUT_FILE "..\..\..\.work\release-out\Prismux-Setup-${VERSION}.exe"
!endif

Unicode True

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Name "Prismux"
Caption "Prismux ${VERSION} 安装程序"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Prismux"
InstallDirRegKey HKCU "Software\Prismux" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=2052 "ProductName" "Prismux"
VIAddVersionKey /LANG=2052 "CompanyName" "Fish-under-sea / Prismux Contributors"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (c) 2026 Fish-under-sea / Prismux Contributors"
VIAddVersionKey /LANG=2052 "FileDescription" "Prismux 极简液态玻璃 AI 超级工作台安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${VERSION}"

; Quiet-Luxury Visual Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "..\icons\icon.ico"
!define MUI_UNICON "..\icons\icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "111827"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

; Step 1: Welcome
!define MUI_WELCOMEPAGE_TITLE "Prismux ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "欢迎安装 Prismux —— 极简液态玻璃 AI 超级工作台与 24h 秘书系统。$\r$\n$\r$\n• 仅安装极简高效内核（原生桌面壳 + 24h 守护中枢 + 单文件 SQLite 记忆引擎）$\r$\n• QQ / 桌宠 / FISH-Dock 灵动岛 / SSH 四大官方插件默认绝不预装$\r$\n• 支持安装目录同级 data\ 零残留便携模式$\r$\n$\r$\n点击「下一步」继续安装。"
!insertmacro MUI_PAGE_WELCOME

; Step 2: Directory (/D=path supported natively)
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 Prismux 的安装目录。如在安装目录同级建立 data\ 目录，记忆库、同步缓存与插件加密凭据将全部收敛于该目录内，不在系统用户目录写入残留。"
!insertmacro MUI_PAGE_DIRECTORY

; Step 3: Custom Component Confirmation & Portable Mode Page
Page custom PrismuxComponentsPageCreate PrismuxComponentsPageLeave

; Step 4: Installing (1px-3px smooth progress bar + detail hooks)
!insertmacro MUI_PAGE_INSTFILES

; Step 5: Complete
!define MUI_FINISHPAGE_RUN "$INSTDIR\Prismux.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 Prismux"
!define MUI_FINISHPAGE_TITLE "Prismux 安装完成"
!define MUI_FINISHPAGE_TEXT "Prismux 极简内核（${VERSION}）已准备就绪。$\r$\n$\r$\n四大官方独立插件（qq / pet / fishdock-hook / ssh）默认均未预装；启动后可在内置「插件市场」按需单装，并支持随时可逆卸载零残留。"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages (SimpChinese primary, English fallback)
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; Localized quiet-luxury hooks (requires MUI_LANGUAGE declared first)
!include "prismux-installer.nsh"

Var ComponentsDialog
Var PortableCheckbox
Var PortableChecked

Function .onInit
  StrCpy $PortableChecked "0"
FunctionEnd

Function PrismuxComponentsPageCreate
  !insertmacro MUI_HEADER_TEXT "组件确认与便携模式" "仅安装极简高效内核，四大官方独立插件默认绝不预装"

  nsDialogs::Create 1018
  Pop $ComponentsDialog
  ${If} $ComponentsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 2u 100% 24u "核心安装清单（固定包含，极致轻量）：$\r$\n  [必需] Prismux.exe 原生桌面壳 + 24h Daemon 守护中枢 + Workbench UI + 单文件 SQLite 记忆引擎"
  Pop $0

  ${NSD_CreateGroupBox} 0u 32u 100% 68u "四大官方独立插件（默认绝不预装）"
  Pop $0

  ${NSD_CreateLabel} 10u 46u 280u 48u "以下扩展插件在安装阶段均保持 preinstalled: false，不会自动捆绑写入本机：$\r$\n  • qq（@prismux/plugin-qq）   • pet（@prismux/plugin-pet）$\r$\n  • fishdock-hook               • ssh（@prismux/plugin-ssh）$\r$\n安装完成后可在应用内「插件市场」按需选装并校验 SHA-256。"
  Pop $0

  ${NSD_CreateCheckBox} 0u 108u 100% 18u "在安装目录同级创建 data\ 目录（启用零残留便携模式）"
  Pop $PortableCheckbox
  ${If} $PortableChecked == ${BST_CHECKED}
    ${NSD_Check} $PortableCheckbox
  ${EndIf}

  ${NSD_CreateLabel} 14u 126u 286u 14u "提示：若目录下已存在 data\，Daemon 与 Rust 原生壳启动时将自动启用便携隔离。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function PrismuxComponentsPageLeave
  ${NSD_GetState} $PortableCheckbox $PortableChecked
FunctionEnd

Section "MinimalCore" SecMinimalCore
  SectionIn RO

  !insertmacro NSIS_HOOK_PREINSTALL

  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}\*.*"

  ${If} $PortableChecked == ${BST_CHECKED}
    CreateDirectory "$INSTDIR\data"
    DetailPrint "$(PRISMUX_PORTABLE_DETECTED)"
  ${EndIf}

  ; Persist installation directory & Windows Apps & Features registration (HKCU only, no admin required)
  WriteRegStr HKCU "Software\Prismux" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Prismux" "Version" "${VERSION}"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "DisplayName" "Prismux"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "Publisher" "Fish-under-sea / Prismux Contributors"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "DisplayIcon" "$INSTDIR\Prismux.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Prismux"
  CreateShortcut "$SMPROGRAMS\Prismux\Prismux.lnk" "$INSTDIR\Prismux.exe"
  CreateShortcut "$SMPROGRAMS\Prismux\Uninstall Prismux.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Prismux.lnk" "$INSTDIR\Prismux.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd

Section "Uninstall"
  !insertmacro NSIS_HOOK_PREUNINSTALL

  Delete "$DESKTOP\Prismux.lnk"
  Delete "$SMPROGRAMS\Prismux\Prismux.lnk"
  Delete "$SMPROGRAMS\Prismux\Uninstall Prismux.lnk"
  RMDir "$SMPROGRAMS\Prismux"

  Delete "$INSTDIR\Prismux.exe"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\PORTABLE_MODE.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\daemon"
  RMDir /r "$INSTDIR\workbench-ui"

  ; Intentionally avoid RMDir /r on $INSTDIR so user's portable data\ directory stays safe
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Prismux"
  DeleteRegKey HKCU "Software\Prismux"

  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd

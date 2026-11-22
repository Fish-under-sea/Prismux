; Prismux Windows NSIS Quiet-Luxury Installer Hooks
; Design Mandate: docs/specs/ui-ux-design-mandate.md (Section 3)
; ---------------------------------------------------------------------------
; Quiet-luxury monochrome appearance guards (only applied if not already set)

!ifndef MUI_BGCOLOR
  !define MUI_BGCOLOR "FFFFFF"
!endif

!ifndef MUI_INSTFILESPAGE_PROGRESSBAR
  !define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!endif

; ---------------------------------------------------------------------------
; Localized Step 2 & Step 3 quiet-luxury engineering declarations
; Note: 5-step flow = 欢迎 -> 安装路径 -> 组件确认 -> 安装中 -> 完成

LangString PRISMUX_STEP2_PORTABLE ${LANG_SIMPCHINESE} "支持便携模式：若在安装目录同级创建 data\\ 目录，Prismux 将把记忆库、缓存与凭据全部收敛至 data\\，不在系统用户目录写入残留。"
LangString PRISMUX_STEP2_PORTABLE ${LANG_ENGLISH} "Portable Mode supported: creating a sibling data\\ directory keeps memory DB, cache, and credentials self-contained."

LangString PRISMUX_STEP3_CORE_NOTICE ${LANG_SIMPCHINESE} "组件确认：仅安装极简高效内核（守护中枢 + 工作台界面 + 单文件 SQLite 记忆引擎）；QQ 机器人、桌宠、FISH-Dock 灵动岛、SSH 运维四大官方独立插件默认绝不预装，安装完成后可在内置插件市场按需选装。"
LangString PRISMUX_STEP3_CORE_NOTICE ${LANG_ENGLISH} "Component Confirmation: minimal core only (daemon + workbench UI + SQLite memory). Official plugins (qq, pet, fishdock-hook, ssh) are NEVER preinstalled and remain optional in Plugin Market."

LangString PRISMUX_PORTABLE_DETECTED ${LANG_SIMPCHINESE} "检测到同级 data\\ 目录，已自动启用零残留便携配置布局。"
LangString PRISMUX_PORTABLE_DETECTED ${LANG_ENGLISH} "Detected sibling data\\ directory; zero-residue portable layout enabled."

LangString PRISMUX_POSTINSTALL_SUMMARY ${LANG_SIMPCHINESE} "Prismux 极简内核安装完成。四大官方插件（qq / pet / fishdock-hook / ssh）未预装，可在启动后按需选装。"
LangString PRISMUX_POSTINSTALL_SUMMARY ${LANG_ENGLISH} "Prismux minimal core installed. All 4 official plugins remain optional and uninstalled by default."

LangString PRISMUX_PREUNINSTALL_NOTICE ${LANG_SIMPCHINESE} "正在清理 Prismux 程序文件；如使用便携 data\\ 目录，请自行决定是否保留个人数据。"
LangString PRISMUX_PREUNINSTALL_NOTICE ${LANG_ENGLISH} "Removing Prismux binaries; if using portable data\\, personal data remains under your control."

; ---------------------------------------------------------------------------
; Tauri v2 NSIS lifecycle hook macros
; ---------------------------------------------------------------------------

!macro NSIS_HOOK_PREINSTALL
  SetDetailsPrint both
  DetailPrint "$(PRISMUX_STEP3_CORE_NOTICE)"
  DetailPrint "$(PRISMUX_STEP2_PORTABLE)"
  IfFileExists "$INSTDIR\data\*.*" 0 +2
    DetailPrint "$(PRISMUX_PORTABLE_DETECTED)"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetDetailsPrint both
  DetailPrint "$(PRISMUX_POSTINSTALL_SUMMARY)"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  SetDetailsPrint both
  DetailPrint "$(PRISMUX_PREUNINSTALL_NOTICE)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetDetailsPrint both
!macroend

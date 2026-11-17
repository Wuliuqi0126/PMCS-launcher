Unicode true

!define APP_NAME "PMCS launcher"
!define APP_VERSION "1.3.0"
!define APP_EXE "PMCS launcher.exe"
!define PUBLISHER "PMCS launcher"
!define REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PMCSLauncher"

Name "${APP_NAME} ${APP_VERSION}"
Caption "安装 ${APP_NAME} ${APP_VERSION}"
OutFile "..\setup\PMCS launcher-1.3.0-安装包.exe"
InstallDir "$LOCALAPPDATA\Programs\PMCS launcher"
InstallDirRegKey HKCU "Software\PMCS launcher" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
XPStyle on
CRCCheck on
ShowInstDetails show
ShowUninstDetails show
BrandingText "PMCS launcher 1.3.0"
VIProductVersion "1.3.0.0"
VIAddVersionKey "ProductName" "PMCS launcher"
VIAddVersionKey "CompanyName" "PMCS launcher"
VIAddVersionKey "FileDescription" "PMCS launcher安装程序（兼容版）"
VIAddVersionKey "FileVersion" "1.3.0.0"
VIAddVersionKey "ProductVersion" "1.3.0"

Icon "..\assets\icon.ico"
UninstallIcon "..\assets\icon.ico"

DirText "请选择 PMCS launcher 的安装位置，然后点击安装。"
UninstallText "将从以下目录卸载 PMCS launcher："

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  SetShellVarContext current
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Section "PMCS launcher" SEC_MAIN
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  File "使用说明.txt"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\PMCS launcher"
  CreateShortcut "$SMPROGRAMS\PMCS launcher\PMCS launcher.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\PMCS launcher\卸载 PMCS launcher.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\PMCS launcher.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "Software\PMCS launcher" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REG_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${REG_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${REG_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REG_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${REG_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "${REG_KEY}" "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"
  WriteRegDWORD HKCU "${REG_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REG_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\PMCS launcher.lnk"
  Delete "$SMPROGRAMS\PMCS launcher\PMCS launcher.lnk"
  Delete "$SMPROGRAMS\PMCS launcher\卸载 PMCS launcher.lnk"
  RMDir "$SMPROGRAMS\PMCS launcher"
  DeleteRegKey HKCU "${REG_KEY}"
  DeleteRegKey HKCU "Software\PMCS launcher"
  RMDir /r "$INSTDIR"
SectionEnd

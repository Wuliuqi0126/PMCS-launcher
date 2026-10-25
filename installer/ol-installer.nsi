Unicode true
!include "MUI2.nsh"

!define APP_NAME "OL启动器"
!define APP_VERSION "1.3.0"
!define APP_EXE "OL启动器.exe"
!define PUBLISHER "OL Launcher"
!define REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OLLauncher"

Name "${APP_NAME} ${APP_VERSION}"
Caption "安装 ${APP_NAME} ${APP_VERSION}"
OutFile "..\setup\OL启动器-1.3.0-安装包-侧边图版.exe"
InstallDir "$LOCALAPPDATA\Programs\OL启动器"
InstallDirRegKey HKCU "Software\OL Launcher" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
XPStyle on
CRCCheck on
ShowInstDetails show
ShowUninstDetails show
BrandingText "OL Launcher 1.3.0"
VIProductVersion "1.3.0.0"
VIAddVersionKey "ProductName" "OL启动器"
VIAddVersionKey "CompanyName" "OL Launcher"
VIAddVersionKey "FileDescription" "OL启动器安装程序"
VIAddVersionKey "FileVersion" "1.3.0.0"
VIAddVersionKey "ProductVersion" "1.3.0"

!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "..\assets\installer-sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "..\assets\installer-sidebar.bmp"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "运行 ${APP_NAME}"
!define MUI_FINISHPAGE_LINK "OL Launcher 1.3.0"
!define MUI_FINISHPAGE_LINK_LOCATION "https://www.minecraft.net/zh-hans"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Section "OL启动器" SEC_MAIN
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  File "使用说明.txt"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\OL启动器"
  CreateShortcut "$SMPROGRAMS\OL启动器\OL启动器.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\OL启动器\卸载 OL启动器.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\OL启动器.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "Software\OL Launcher" "InstallDir" "$INSTDIR"
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
  Delete "$DESKTOP\OL启动器.lnk"
  Delete "$SMPROGRAMS\OL启动器\OL启动器.lnk"
  Delete "$SMPROGRAMS\OL启动器\卸载 OL启动器.lnk"
  RMDir "$SMPROGRAMS\OL启动器"
  DeleteRegKey HKCU "${REG_KEY}"
  DeleteRegKey HKCU "Software\OL Launcher"
  RMDir /r "$INSTDIR"
SectionEnd

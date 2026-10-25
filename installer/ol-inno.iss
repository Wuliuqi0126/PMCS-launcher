; OL Launcher 1.3.0 - standard Inno Setup installer

[Setup]
AppId={{A3F9B6D2-7C4E-4A83-9B1D-2F8E6C5A1D47}
AppName=OL我的世界启动器
AppVersion=1.3.0
AppVerName=OL我的世界启动器 1.3.0
AppPublisher=OL Launcher
AppPublisherURL=https://www.minecraft.net/
DefaultDirName={localappdata}\Programs\OL我的世界启动器
DefaultGroupName=OL我的世界启动器
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\setup
OutputBaseFilename=OL启动器-1.3.0-安装程序
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\OL我的世界启动器.exe
UninstallDisplayName=OL我的世界启动器 1.3.0
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
DisableWelcomePage=no
DisableDirPage=no
UsePreviousAppDir=yes
CloseApplications=yes
RestartApplications=no
MinVersion=10.0

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "E:\OLBuild\msi\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\OL我的世界启动器"; Filename: "{app}\OL我的世界启动器.exe"; WorkingDir: "{app}"; IconFilename: "{app}\OL我的世界启动器.exe"
Name: "{autodesktop}\OL我的世界启动器"; Filename: "{app}\OL我的世界启动器.exe"; WorkingDir: "{app}"; IconFilename: "{app}\OL我的世界启动器.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\OL我的世界启动器.exe"; Description: "{cm:LaunchProgram,OL我的世界启动器}"; Flags: nowait postinstall skipifsilent

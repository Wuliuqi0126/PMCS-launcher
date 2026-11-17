; PMCS launcher 1.3.0 - standard Inno Setup installer

[Setup]
AppId={{A3F9B6D2-7C4E-4A83-9B1D-2F8E6C5A1D47}
AppName=PMCS launcher
AppVersion=1.3.0
AppVerName=PMCS launcher 1.3.0
AppPublisher=PMCS launcher
AppPublisherURL=https://www.minecraft.net/
DefaultDirName={localappdata}\Programs\PMCS launcher
DefaultGroupName=PMCS launcher
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\setup
OutputBaseFilename=PMCS launcher-1.3.0-安装程序
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\PMCS launcher.exe
UninstallDisplayName=PMCS launcher 1.3.0
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
Name: "{autoprograms}\PMCS launcher"; Filename: "{app}\PMCS launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\PMCS launcher.exe"
Name: "{autodesktop}\PMCS launcher"; Filename: "{app}\PMCS launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\PMCS launcher.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\PMCS launcher.exe"; Description: "{cm:LaunchProgram,PMCS launcher}"; Flags: nowait postinstall skipifsilent

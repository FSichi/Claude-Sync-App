; Instalador de Claude Archivo para Windows (Inno Setup 6).
; Se arma con installer\armar.ps1, que le pasa la versión, la carpeta del código y el Node.js portátil.
; Instala por usuario, sin permisos de administrador. Desinstalar saca solo la app:
; nunca toca la configuración del usuario (%LOCALAPPDATA%\Claude-Archivo) ni los archivos de copias.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir ".."
#endif
#ifndef NodeDir
  #define NodeDir "..\build\node"
#endif

; Comillas dobles duplicadas a propósito: así quedan bien dentro de Parameters: "...".
#define Lanzador '--headless ""{app}\node\node.exe"" ""{app}\src\servidor.js"" --abrir'

[Setup]
AppId={{8B2E6F1C-4D3A-4E5B-9C7D-1A2B3C4D5E6F}
AppName=Claude Archivo
AppVersion={#AppVersion}
AppVerName=Claude Archivo {#AppVersion}
AppPublisher=Facundo Sichi
AppPublisherURL=https://github.com/FSichi/Claude-Sync-App
AppSupportURL=https://github.com/FSichi/Claude-Sync-App/issues
AppUpdatesURL=https://github.com/FSichi/Claude-Sync-App/releases
DefaultDirName={localappdata}\Programs\Claude Archivo
DefaultGroupName=Claude Archivo
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#SourceDir}\dist
OutputBaseFilename=Claude-Archivo-Setup-{#AppVersion}
SetupIconFile={#SourceDir}\ui\icono.ico
UninstallDisplayIcon={app}\ui\icono.ico
UninstallDisplayName=Claude Archivo
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "escritorio"; Description: "Crear un acceso directo en el Escritorio"; GroupDescription: "Accesos directos:"

[Files]
Source: "{#SourceDir}\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs
Source: "{#SourceDir}\ui\*"; DestDir: "{app}\ui"; Flags: ignoreversion recursesubdirs
Source: "{#SourceDir}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\config.predeterminado.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LEEME.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\Abrir Claude Archivo.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#NodeDir}\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "{#NodeDir}\LICENSE"; DestDir: "{app}\node"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Claude Archivo"; Filename: "{sys}\conhost.exe"; Parameters: "{#Lanzador}"; WorkingDir: "{app}"; IconFilename: "{app}\ui\icono.ico"; Comment: "Respaldo y visor de tus conversaciones de Claude"
Name: "{autodesktop}\Claude Archivo"; Filename: "{sys}\conhost.exe"; Parameters: "{#Lanzador}"; WorkingDir: "{app}"; IconFilename: "{app}\ui\icono.ico"; Comment: "Respaldo y visor de tus conversaciones de Claude"; Tasks: escritorio

[Run]
Filename: "{sys}\conhost.exe"; Parameters: "{#Lanzador}"; WorkingDir: "{app}"; Description: "Abrir Claude Archivo"; Flags: postinstall nowait skipifsilent
; Cuando la propia app se actualiza, la vuelve a abrir al terminar (ver AbrirAlActualizar).
Filename: "{sys}\conhost.exe"; Parameters: "{#Lanzador}"; WorkingDir: "{app}"; Flags: nowait; Check: AbrirAlActualizar

[Code]
// La app se actualiza con una instalación silenciosa y /ABRIR=si. Las demás instalaciones silenciosas
// (el CI, una instalación desatendida) no tienen que dejar la app abierta.
function AbrirAlActualizar: Boolean;
begin
  Result := WizardSilent and (ExpandConstant('{param:ABRIR|no}') = 'si');
end;

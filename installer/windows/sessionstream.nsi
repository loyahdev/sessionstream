Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef STAGE_DIR
  !error "Pass STAGE_DIR containing SessionStream.vst3"
!endif
!ifndef OUTPUT_FILE
  !error "Pass OUTPUT_FILE"
!endif
!ifndef PROJECT_DIR
  !error "Pass PROJECT_DIR"
!endif
!ifndef PACKAGE_VERSION
  !error "Pass PACKAGE_VERSION from package.json"
!endif
!ifndef DISPLAY_VERSION
  !error "Pass DISPLAY_VERSION"
!endif

!ifdef SESSIONSTREAM_SETUP
  !include "nsDialogs.nsh"
  !addplugindir /x86-unicode "${SETUP_PLUGINS}"
  !define MUI_CUSTOMFUNCTION_GUIINIT SetupFrame
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.SetupFrame
  Name "SessionStream Setup"
!else
  Name "SessionStream ${DISPLAY_VERSION}"
!endif
OutFile "${OUTPUT_FILE}"
InstallDir "$COMMONFILES64\VST3\SessionStream.vst3"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "SessionStream - Your session. Anywhere."
VIProductVersion "${PACKAGE_VERSION}.0"
VIAddVersionKey "ProductName" "SessionStream"
VIAddVersionKey "ProductVersion" "${PACKAGE_VERSION}"
VIAddVersionKey "FileVersion" "${PACKAGE_VERSION}"
VIAddVersionKey "FileDescription" "SessionStream Windows x64 and ARM64 VST3 installer"
VIAddVersionKey "LegalCopyright" "SessionStream contributors"

!define MUI_ABORTWARNING
!ifdef SESSIONSTREAM_SETUP
  Page custom SetupReview
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SetupShowLicense
  !define MUI_LICENSEPAGE_BUTTON "Agree and Install"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "Select Agree and Install to accept the license and install SessionStream."
  !insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}/LICENSE"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SetupShowProgress
  !insertmacro MUI_PAGE_INSTFILES
  Page custom SetupFinish
!else
!define MUI_WELCOMEPAGE_TEXT "Install SessionStream ${DISPLAY_VERSION} for Windows 11 on Intel/AMD x64 or ARM64.$\r$\n$\r$\nSave and close your DAW before installing or updating.$\r$\n$\r$\nIncludes native x64 and ARM64 VST3 plugins and the streaming runtime. On ARM64, the separate x64 streaming helper uses Windows 11 emulation. No separate Node.js or Cloudflare installation is needed."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}/LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "SessionStream is installed.$\r$\n$\r$\nReopen your DAW, rescan VST3 plugins if needed, and add SessionStream to the track or master bus you want to share.$\r$\n$\r$\nUse a 64-bit x64 DAW or a native ARM64 DAW. Both plugin architectures are included. Works with most DAWs supporting VST3, including REAPER, Ableton Live, FL Studio, Cubase and Studio One."
!insertmacro MUI_PAGE_FINISH
!endif
!insertmacro MUI_UNPAGE_CONFIRM
!ifdef SESSIONSTREAM_SETUP
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.SetupRemovalProgress
!endif
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!ifdef SESSIONSTREAM_SETUP
  ChangeUI IDD_INST "${SETUP_DIALOGS}"
  ChangeUI IDD_LICENSE "${SETUP_DIALOGS}"
  ChangeUI IDD_INSTFILES "${SETUP_DIALOGS}"
  !include "${PROJECT_DIR}/installer/setup/WindowsSetup.nsh"
!endif

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "SessionStream requires 64-bit Windows 11 (Intel/AMD x64 or ARM64)." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin11}
    MessageBox MB_ICONSTOP "SessionStream requires Windows 11 or newer." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${IfNot} ${IsNativeAMD64}
  ${AndIfNot} ${IsNativeARM64}
    MessageBox MB_ICONSTOP "This installer supports Intel/AMD x64 and ARM64." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Section "SessionStream VST3" SEC_PLUGIN
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  DetailPrint "Installing SessionStream VST3 and bundled streaming runtime"
  ; File replacement fails visibly if a DAW/helper still has a binary open.
  ; Do not terminate the user's DAW or other processes during an upgrade.
  ClearErrors
  File /r "${STAGE_DIR}\SessionStream.vst3\*"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "Could not replace SessionStream files. Close your DAW and wait for its streaming helper to stop, then run this installer again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetOutPath "$PROGRAMFILES64\SessionStream"
  WriteUninstaller "$PROGRAMFILES64\SessionStream\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "DisplayName" "SessionStream"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "DisplayVersion" "${PACKAGE_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "Publisher" "SessionStream"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "UninstallString" '"$PROGRAMFILES64\SessionStream\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "QuietUninstallString" '"$PROGRAMFILES64\SessionStream\Uninstall.exe" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "NoRepair" 1
  CreateShortcut "$SMPROGRAMS\Uninstall SessionStream.lnk" "$PROGRAMFILES64\SessionStream\Uninstall.exe"
SectionEnd

Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  ReadRegStr $INSTDIR HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream" "InstallLocation"
  ${If} $INSTDIR == ""
    MessageBox MB_ICONSTOP "SessionStream install location is missing. No files were removed." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  RMDir /r "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\Contents\*"
    MessageBox MB_ICONSTOP "Some SessionStream files are still in use. Close your DAW and try uninstalling again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SessionStream"
  Delete "$SMPROGRAMS\Uninstall SessionStream.lnk"
  Delete "$PROGRAMFILES64\SessionStream\Uninstall.exe"
  RMDir "$PROGRAMFILES64\SessionStream"
SectionEnd

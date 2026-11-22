!define SetupSurface 15221A
!define SetupInk EDF3E7
!define SetupMuted B5C4B5
!define SetupRecess 0B130F

Var SetupTitleFont
Var SetupMonoFont
Var SetupHighContrast

!macro SetupColor handle text background
  ${If} $SetupHighContrast == 0
    SetCtlColors ${handle} ${text} ${background}
  ${EndIf}
!macroend

!macro SetupControl parent id text background font
  GetDlgItem $0 ${parent} ${id}
  !insertmacro SetupColor $0 ${text} ${background}
  ${If} ${font} != 0
    SendMessage $0 ${WM_SETFONT} ${font} 1
  ${EndIf}
!macroend

!macro SetupText x y width height text color background font
  ${NSD_CreateLabel} ${x} ${y} ${width} ${height} "${text}"
  Pop $0
  !insertmacro SetupColor $0 ${color} ${background}
  ${If} ${font} != 0
    SendMessage $0 ${WM_SETFONT} ${font} 1
  ${EndIf}
  System::Call 'user32::SetWindowPos(p r0,p 0,i 0,i 0,i 0,i 0,i 0x13)'
!macroend

Function SetupFrame
  ; HIGHCONTRASTW is 12 bytes in the 32-bit NSIS process.
  System::Call '*(i 12,i 0,p 0)p.r0'
  System::Call 'user32::SystemParametersInfoW(i 0x42,i 12,p r0,i 0)i.r1'
  System::Call '*$0(i,i.r2,p)'
  System::Free $0
  IntOp $2 $2 & 1
  ${If} $1 == 0
    StrCpy $2 0
  ${EndIf}
  StrCpy $SetupHighContrast $2
  CreateFont $SetupTitleFont "Segoe UI" 21 600
  CreateFont $SetupMonoFont "Consolas" 9 500
  !insertmacro SetupColor $HWNDPARENT ${SetupInk} ${SetupSurface}
  !insertmacro SetupControl $HWNDPARENT 1300 ${SetupInk} ${SetupSurface} $SetupMonoFont
  StudioSwitch::Frame /NOUNLOAD
  ${If} $SetupHighContrast == 0
    StudioSwitch::Apply /NOUNLOAD
  ${EndIf}
FunctionEnd

Function SetupShowLicense
  FindWindow $2 "#32770" "" $HWNDPARENT
  !insertmacro SetupColor $2 ${SetupInk} ${SetupSurface}
  !insertmacro SetupControl $2 1311 ${SetupInk} ${SetupSurface} $SetupTitleFont
  !insertmacro SetupControl $2 1006 ${SetupMuted} ${SetupSurface} 0
FunctionEnd

Function SetupShowProgress
  GetDlgItem $0 $HWNDPARENT 1301
  EnableWindow $0 0
  !insertmacro SetupColor $mui.InstFilesPage ${SetupInk} ${SetupSurface}
  !insertmacro SetupControl $mui.InstFilesPage 1311 ${SetupInk} ${SetupSurface} $SetupTitleFont
  !insertmacro SetupControl $mui.InstFilesPage 1312 ${SetupMuted} ${SetupSurface} 0
  !insertmacro SetupControl $mui.InstFilesPage 1313 ${SetupRecess} ${SetupRecess} 0
  !insertmacro SetupColor $mui.InstFilesPage.Text ${SetupInk} ${SetupRecess}
  ${If} $SetupHighContrast == 0
    System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar,w "",w "")'
    SendMessage $mui.InstFilesPage.ProgressBar 0x409 0 0x79E8C2
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0x5F6D58
  ${EndIf}
FunctionEnd

Function SetupReview
  Push "Stream your$\r$\nDAW."
  Push "Send your mix live to anyone with a browser."
  Push "Continue"
  Call SetupPage
FunctionEnd

Function SetupFinish
  IfAbort setupFailed
  Push "Ready to stream"
  Push "Reopen your DAW and add SessionStream to a track or your master bus."
  Push "Done"
  Call SetupPage
  Return
  setupFailed:
    Push "Installation interrupted"
    Push "Close your DAW and run setup again."
    Push "Close"
    Call SetupPage
FunctionEnd

Function SetupPage
  Pop $5
  Pop $6
  Pop $7
  GetDlgItem $0 $HWNDPARENT 1301
  EnableWindow $0 1
  GetDlgItem $0 $HWNDPARENT 1
  ${NSD_SetText} $0 $5
  ${If} $5 != "Continue"
    GetDlgItem $0 $HWNDPARENT 2
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
  ${EndIf}
  nsDialogs::Create 1018
  Pop $2
  ${If} $2 == error
    Abort
  ${EndIf}
  !insertmacro SetupColor $2 ${SetupInk} ${SetupSurface}
  ${If} $5 == "Continue"
    !insertmacro SetupText 0 3u 155u 53u "$7" ${SetupInk} ${SetupSurface} $SetupTitleFont
    !insertmacro SetupText 0 58u 148u 23u "$6" ${SetupMuted} ${SetupSurface} 0
    !insertmacro SetupText 0 84u 149u 27u "Add it to a track or your master bus. Start a stream and share the link." ${SetupInk} ${SetupSurface} 0
    InitPluginsDir
    File "/oname=$PLUGINSDIR\Studio.bmp" "${SETUP_PHOTO}"
    ${NSD_CreateLabel} 166u 6u 138u 102u ""
    Pop $0
    StudioSwitch::Animate /NOUNLOAD $0 "$PLUGINSDIR\Studio.bmp"
    !insertmacro SetupText 0 120u 230u 14u "Close your DAW before installing." ${SetupMuted} ${SetupSurface} 0
    !insertmacro SetupText 267u 120u 37u 14u "VST3" ${SetupMuted} ${SetupSurface} $SetupMonoFont
  ${Else}
    !insertmacro SetupText 0 5u 304u 28u "$7" ${SetupInk} ${SetupSurface} $SetupTitleFont
    !insertmacro SetupText 0 38u 304u 16u "$6" ${SetupMuted} ${SetupSurface} 0
    ${If} $5 == "Done"
      !insertmacro SetupText 0 64u 304u 25u "Start streaming in the plugin, then share the invite link." ${SetupMuted} ${SetupSurface} 0
    ${EndIf}
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function un.SetupFrame
  GetDlgItem $0 $HWNDPARENT 1300
  ${NSD_SetText} $0 "SESSIONSTREAM UNINSTALL"
FunctionEnd

Function un.SetupRemovalProgress
  GetDlgItem $0 $mui.InstFilesPage 1311
  ${NSD_SetText} $0 "Removing SessionStream"
  GetDlgItem $0 $mui.InstFilesPage 1312
  ${NSD_SetText} $0 "Keep this window open while the plugin files are removed."
FunctionEnd

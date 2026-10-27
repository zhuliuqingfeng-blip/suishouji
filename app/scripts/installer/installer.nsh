!include nsDialogs.nsh
!define MEMO_INSTALLER_SOURCE "${__FILEDIR__}"

!ifndef BUILD_UNINSTALLER
  Var MemoDesktop
  Var MemoDesktopCheck
  Var MemoWasInstalled
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  StrCpy $MemoDesktop 1
  StrCpy $MemoWasInstalled 0
  ${If} $perUserInstallationFolder != ""
    StrCpy $MemoWasInstalled 1
    ReadRegDWORD $MemoDesktop HKCU "${INSTALL_REGISTRY_KEY}" MemoDesktop
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom MemoOptions MemoOptionsLeave
  Function MemoOptions
    ${If} $MemoWasInstalled == 1
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "安装随手记" "程序与个人资料分开保存，后续可直接覆盖升级。"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 42u "安装仅供当前用户使用。$\r$\n你的手记保存在本机的独立应用资料目录，升级与正常卸载都会保留。"
    Pop $0
    ${NSD_CreateCheckbox} 0 56u 100% 14u "在桌面创建随手记快捷方式"
    Pop $MemoDesktopCheck
    ${NSD_SetState} $MemoDesktopCheck $MemoDesktop
    nsDialogs::Show
  FunctionEnd
  Function MemoOptionsLeave
    ${NSD_GetState} $MemoDesktopCheck $MemoDesktop
  FunctionEnd
!macroend

!macro customCheckAppRunning
  InitPluginsDir
  ${If} ${RunningX64}
    StrCpy $PowerShellPath "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  File /oname=$PLUGINSDIR\memo-close.ps1 "${MEMO_INSTALLER_SOURCE}\close-app.ps1"
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_INSTALLER_EXE", t "$INSTDIR\${APP_EXECUTABLE_FILENAME}")'
  nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\memo-close.ps1"'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "随手记尚未正常退出。$\r$\n请完成保存或备份并关闭窗口，然后重新运行安装程序。$\r$\n本次操作已停止，个人资料不会删除。"
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customInstall
  ${If} $MemoDesktop == 1
    ${If} $MemoWasInstalled == 0
    ${OrIf} ${FileExists} "$DESKTOP\随手记.lnk"
      CreateShortCut "$DESKTOP\随手记.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      WinShell::SetLnkAUMI "$DESKTOP\随手记.lnk" "${APP_ID}"
    ${EndIf}
  ${EndIf}
  WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" MemoDesktop $MemoDesktop
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载随手记"
  !define MUI_WELCOMEPAGE_TEXT "只会移除程序。$\r$\n$\r$\n你的手记、重要日子、设置和备份会保留在这台电脑上，重新安装即可继续使用。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ReadRegDWORD $R0 HKCU "${INSTALL_REGISTRY_KEY}" MemoDesktop
    ${If} $R0 == 1
      Delete "$DESKTOP\随手记.lnk"
    ${EndIf}
  ${EndIf}
!macroend

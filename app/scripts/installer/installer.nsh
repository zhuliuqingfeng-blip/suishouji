!include nsDialogs.nsh
!define MEMO_INSTALLER_SOURCE "${__FILEDIR__}"

!ifndef BUILD_UNINSTALLER
  Var MemoDesktop
  Var MemoDesktopCheck
  Var MemoWasInstalled
  Var MemoDataDir
  Var MemoDefaultDir
  Var MemoLegacySource
  Var MemoLegacyExe
  Var MemoRequestedDir
  Var MemoResolvedDir
  Var MemoLocationReason
  Var MemoPlanInput
  Var MemoPowerShell
!endif

# The directory page previews the same plan that is rechecked before replacing files.
# Preview must not create folders or close the current application.
!macro MemoResolveLocation PREVIEW
  InitPluginsDir
  StrCpy $MemoPowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    StrCpy $MemoPowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  File /oname=$PLUGINSDIR\memo-location.ps1 "${MEMO_INSTALLER_SOURCE}\validate-location.ps1"
  File /oname=$PLUGINSDIR\identity.ps1 "${MEMO_INSTALLER_SOURCE}\identity.ps1"
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_INSTALLER_DIR", t "$MemoRequestedDir")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_INSTALLER_DATA", t "$MemoDataDir")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_INSTALLED_DIR", t "$perUserInstallationFolder")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_DEFAULT_DIR", t "$MemoDefaultDir")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_SETUP_DIR", t "$EXEDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_SHORTCUT", t "$DESKTOP\${SHORTCUT_NAME}.lnk")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_APP_ID", t "${APP_ID}")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_APP_GUID", t "${APP_GUID}")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_PLAN_FILE", t "$PLUGINSDIR\plan.ini")'
  System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_LOCATION_PREVIEW", t "${PREVIEW}")'
  nsExec::ExecToStack '"$MemoPowerShell" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\memo-location.ps1"'
  Pop $R0
  Pop $R1
  ${If} $R0 == 0
    ReadINIStr $MemoResolvedDir "$PLUGINSDIR\plan.ini" "plan" "program"
    ReadINIStr $MemoLegacySource "$PLUGINSDIR\plan.ini" "plan" "source"
    ReadINIStr $MemoLegacyExe "$PLUGINSDIR\plan.ini" "plan" "legacyExe"
    ReadINIStr $MemoLocationReason "$PLUGINSDIR\plan.ini" "plan" "reason"
  ${Else}
    StrCpy $R1 "无法写入这个位置，请选择当前用户可以读写的文件夹。"
    ${If} $R0 == 11
      StrCpy $R1 "这个位置包含个人资料或链接目录。请选择其他软件存放位置。"
    ${ElseIf} $R0 == 12
      StrCpy $R1 "这里的“随手记”文件夹包含无法识别的文件。请另选存放位置；安装程序不会覆盖这些文件。"
    ${ElseIf} $R0 == 22
      StrCpy $R1 "已识别旧版随手记，但旧数据库无法校验。原程序和资料已保留，本次安装不会用空资料替代它。"
    ${EndIf}
  ${EndIf}
!macroend

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
  StrCpy $MemoDataDir "$LOCALAPPDATA\随手记"
  StrCpy $MemoDefaultDir "$LOCALAPPDATA\Programs\${APP_FILENAME}"
  !ifdef MEMO_QA
    ReadEnvStr $R0 "MEMO_INSTALL_QA_LOCALAPPDATA"
    ${If} $R0 == ""
      SetErrorLevel 9
      Quit
    ${EndIf}
    StrCpy $MemoDataDir "$R0\随手记"
    StrCpy $MemoDefaultDir "$R0\Programs\${APP_FILENAME}"
    ${If} $perUserInstallationFolder == ""
      !insertmacro GetDParameter $R1
      ${If} $R1 == ""
        StrCpy $INSTDIR "$MemoDefaultDir"
      ${EndIf}
    ${EndIf}
  !endif
  StrCpy $MemoRequestedDir "$INSTDIR"
!macroend

!macro customPageAfterChangeDir
  !insertmacro MUI_DIRECTORYPAGE_INTERFACE
  # Keep NSIS's input separate: native directory pages can assign DirVar after LEAVE.
  Function MemoDirectoryPre
    ${If} $MemoWasInstalled == 1
      Abort
    ${EndIf}
  FunctionEnd
  Function MemoDirectoryLeave
    ${NSD_GetText} $mui.DirectoryPage.Directory $MemoRequestedDir
    ${If} $MemoRequestedDir != $MemoResolvedDir
    ${OrIf} $MemoPlanInput == ""
      StrCpy $MemoPlanInput "$MemoRequestedDir"
    ${EndIf}
    StrCpy $MemoRequestedDir "$MemoPlanInput"
    !insertmacro MemoResolveLocation 1
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "$R1$\r$\n旧程序和资料未改动。"
      Abort
    ${EndIf}
    StrCpy $INSTDIR "$MemoResolvedDir"
    StrCpy $MemoRequestedDir "$MemoResolvedDir"
    ${NSD_SetText} $mui.DirectoryPage.Directory "$MemoResolvedDir"
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE MemoDirectoryPre
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE MemoDirectoryLeave
  !define MUI_DIRECTORYPAGE_VARIABLE $MemoRequestedDir
  !define MUI_DIRECTORYPAGE_TEXT_TOP "选择存放随手记的位置。安装程序会为它创建独立文件夹，不会把程序散放在软件总目录中。"
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "存放位置"
  !insertmacro MUI_PAGE_DIRECTORY
  Page custom MemoOptions MemoOptionsLeave
  Function MemoOptions
    ${If} $MemoWasInstalled == 1
      Abort
    ${EndIf}
    StrCpy $INSTDIR "$MemoResolvedDir"
    !insertmacro MUI_HEADER_TEXT "安装随手记" "程序与个人资料分开保存，后续可直接覆盖升级。"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 46u "程序将安装在：$\r$\n$INSTDIR"
    Pop $0
    ${NSD_CreateLabel} 0 52u 100% 38u "你的手记保存在独立的用户资料目录。$\r$\n升级与正常卸载都会保留。需要更换位置可点“上一步”。"
    Pop $0
    ${NSD_CreateCheckbox} 0 100u 100% 14u "在桌面创建随手记快捷方式"
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
  !ifndef BUILD_UNINSTALLER
    StrCpy $MemoRequestedDir "$INSTDIR"
    ${If} $MemoPlanInput != ""
      StrCpy $MemoRequestedDir "$MemoPlanInput"
    ${EndIf}
    !insertmacro MemoResolveLocation 0
    File /oname=$PLUGINSDIR\memo-prepare.ps1 "${MEMO_INSTALLER_SOURCE}\prepare-legacy.ps1"
    ${If} $R0 != 0
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$R1$\r$\n旧程序和资料未改动。"
      ${EndIf}
      SetErrorLevel 3
      Quit
    ${EndIf}
    StrCpy $INSTDIR "$MemoResolvedDir"
    ${If} $MemoLocationReason == "portable"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION "已识别旧版随手记。正式版将安装在：$\r$\n$INSTDIR$\r$\n$\r$\n旧目录会保留。需要迁移时会自动备份并校验；若已有正式资料，将继续使用正式资料。"
      ${EndIf}
    ${EndIf}
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_INSTALLER_DIR", t "$INSTDIR")'
  !endif
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
  !ifndef BUILD_UNINSTALLER
    ${If} $MemoLegacyExe != ""
      System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_INSTALLER_EXE", t "$MemoLegacyExe")'
      nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\memo-close.ps1"'
      Pop $R0
      Pop $R1
      ${If} $R0 != 0
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "旧免安装版尚未完成保存。请保存并关闭旧版后重新运行安装包。原资料未改动。"
        ${EndIf}
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::SetEnvironmentVariable(t "MEMO_LEGACY_SOURCE", t "$MemoLegacySource")'
    DetailPrint "正在准备旧版资料备份…"
    nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\memo-prepare.ps1"'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "旧版资料备份未完成，本次安装已停止。旧程序和资料仍保留，请关闭旧版后重试。"
      ${EndIf}
      SetErrorLevel 4
      Quit
    ${EndIf}
  !endif
!macroend

!macro customInstall
  ${If} $MemoDesktop == 1
    ${If} $MemoWasInstalled == 0
    ${OrIf} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}
  ${EndIf}
  WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" MemoDesktop $MemoDesktop
  !ifdef MEMO_QA
    ReadEnvStr $R0 "MEMO_INSTALL_QA_LOCALAPPDATA"
    System::Call 'kernel32::SetEnvironmentVariable(t "LOCALAPPDATA", t "$R0")'
  !endif
  DetailPrint "正在校验并完成资料迁移…"
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --installer-maintenance' $R0
  ${If} $R0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "资料迁移尚未完成，旧版原件和备份仍保留。请重新运行安装包重试；现有正式版资料不会被旧数据覆盖。"
    ${EndIf}
    SetErrorLevel 4
    Quit
  ${EndIf}
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
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

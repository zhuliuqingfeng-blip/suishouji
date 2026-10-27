import {build,Platform,Arch} from 'electron-builder';
import fs from 'node:fs/promises';
import path from 'node:path';
import {appRoot,repoRoot} from './paths.mjs';
process.chdir(appRoot);
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const qa=process.argv.includes('--qa');
const locationQA=process.argv.includes('--location-qa');
const version=locationQA&&process.argv.includes('--previous')?'1.8.0':qa?'1.7.99':pkg.version;
await build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never',config:{
  ...pkg.build,
  appId:locationQA?'local.suishouji.installer-location-qa':pkg.build.appId,
  directories:{...pkg.build.directories,output:path.join(repoRoot,'.artifacts',locationQA?'installer-location-qa/'+version:qa?'installer-previous':'installer')},
  extraMetadata:{distribution:'installed',version},
  extraFiles:[{from:'scripts/installer/install-root.json',to:'.suishouji-install-root.json'}],
  artifactName:'suishouji-${version}-setup-${arch}.${ext}',
  win:{...pkg.build.win,target:'nsis'},
  nsis:{
    // Stable upgrade identity. Never regenerate for a release or distribution path.
    guid:locationQA?'8f0de495-bfe9-43aa-bb9f-e7ce5277c862':'42be8a92-8942-4f4c-9e2c-90bd703acc4c',oneClick:false,perMachine:false,allowElevation:false,
    // installer.nsh inserts the native directory page without the upstream hidden path suffix.
    allowToChangeInstallationDirectory:false,deleteAppDataOnUninstall:false,createDesktopShortcut:false,
    createStartMenuShortcut:true,shortcutName:locationQA?'随手记（安装验收）':'随手记',uninstallDisplayName:locationQA?'随手记（安装验收）':'随手记',runAfterFinish:true,
    installerLanguages:['zh_CN'],language:'2052',include:'scripts/installer/installer.nsh'
  }
}});

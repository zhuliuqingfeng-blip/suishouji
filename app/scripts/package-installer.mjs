import {build,Platform,Arch} from 'electron-builder';
import fs from 'node:fs/promises';
import path from 'node:path';
import {appRoot,repoRoot} from './paths.mjs';
process.chdir(appRoot);
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const qa=process.argv.includes('--qa');
const version=qa?'1.7.99':pkg.version;
await build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never',config:{
  ...pkg.build,
  directories:{...pkg.build.directories,output:path.join(repoRoot,'.artifacts',qa?'installer-previous':'installer')},
  extraMetadata:{distribution:'installed',version},
  artifactName:'suishouji-${version}-setup-${arch}.${ext}',
  win:{...pkg.build.win,target:'nsis'},
  nsis:{
    // Stable upgrade identity. Never regenerate for a release or distribution path.
    guid:'42be8a92-8942-4f4c-9e2c-90bd703acc4c',oneClick:false,perMachine:false,allowElevation:false,
    allowToChangeInstallationDirectory:false,deleteAppDataOnUninstall:false,createDesktopShortcut:false,
    createStartMenuShortcut:true,shortcutName:'随手记',uninstallDisplayName:'随手记',runAfterFinish:true,
    installerLanguages:['zh_CN'],language:'2052',include:'scripts/installer/installer.nsh'
  }
}});

/* Host-test compiler adapter. Uses an existing GCC-compatible compiler or MSVC.
 * No installation, firmware build, hardware access or production dependency. */
import {spawnSync} from 'node:child_process';
import {basename,dirname,join} from 'node:path';
export function compileC(sources,include,executable){
  const compiler=process.env.CC||'gcc',msvc=/^cl(?:\.exe)?$/i.test(basename(compiler));
  const args=msvc?['/nologo','/std:c11','/W4','/WX','/D_CRT_SECURE_NO_WARNINGS','/I'+include,...sources,'/Fo'+dirname(executable)+'\\','/Fe'+executable]:['-std=c11','-Wall','-Wextra','-Werror','-I',include,...sources,'-o',executable];
  return spawnSync(compiler,args,{encoding:'utf8',timeout:30000,shell:false,cwd:dirname(executable)});
}

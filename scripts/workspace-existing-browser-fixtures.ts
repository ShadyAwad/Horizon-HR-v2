import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {BusinessFixtures} from './business-scenario-fixtures';
const f=new BusinessFixtures();
try {
 await f.setup('composer-existing');
 const child=spawn(process.execPath,['--import','tsx','scripts/workspace-browser-test.ts'],{windowsHide:true,stdio:'inherit',env:{...process.env,BROWSER_ADMIN_EMAIL:f.admin.email,BROWSER_ADMIN_PASSWORD:f.password}});
 const [code]=await once(child,'exit');assert.equal(code,0,'Existing workspace browser regression');
}finally{await f.cleanup();}

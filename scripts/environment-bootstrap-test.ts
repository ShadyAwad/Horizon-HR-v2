import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadDevelopmentEnvironment} from './development-environment.mjs';
const root=await mkdtemp(path.join(tmpdir(),'stanza-env-test-'));
try{
 await writeFile(path.join(root,'.env'),'DATABASE_URL=postgres://base/old\nSTANZA_ROUTER_AI_MODE=user-authorized\nDEFAULT_FIXTURE=base\n');
 await writeFile(path.join(root,'.env.development.local'),'DATABASE_URL=postgres://local/old\nSTANZA_ROUTER_AI_MODE=application-funded\nDEFAULT_FIXTURE=local\n');
 const explicit:any={NODE_ENV:'test',DATABASE_URL:'postgres://runtime/disposable',DATABASE_MIGRATION_URL:'postgres://migration/disposable',STANZA_ROUTER_AI_MODE:'disabled',REDIS_URL:'redis://localhost:6379/15'};
 loadDevelopmentEnvironment(explicit,root);assert.equal(explicit.DATABASE_URL,'postgres://runtime/disposable');assert.equal(explicit.DATABASE_MIGRATION_URL,'postgres://migration/disposable');assert.equal(explicit.STANZA_ROUTER_AI_MODE,'disabled');assert.equal(explicit.REDIS_URL,'redis://localhost:6379/15');assert.equal(explicit.DEFAULT_FIXTURE,'local');
 const production:any={NODE_ENV:'production'};loadDevelopmentEnvironment(production,root);assert.equal(production.DEFAULT_FIXTURE,'base');
 const disabled:any={NODE_ENV:'test',DATABASE_URL:''};loadDevelopmentEnvironment(disabled,root);assert.equal(disabled.DATABASE_URL,'');
 console.log('PASS explicit disposable DB/Redis/disabled AI boundaries, development precedence, empty values and production exclusion');
}finally{assert.equal(path.dirname(root),tmpdir());assert(path.basename(root).startsWith('stanza-env-test-'));await rm(root,{recursive:true,force:true});}
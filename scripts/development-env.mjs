import {config} from 'dotenv';
if(process.env.NODE_ENV==='production')throw new Error('Development launcher refuses NODE_ENV=production; use npm start.');
config({quiet:true});config({path:'.env.development.local',override:true,quiet:true});
if(process.env.NODE_ENV==='production')throw new Error('Development launcher refuses production environment configuration.');
process.env.NODE_ENV='development';
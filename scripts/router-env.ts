import { config } from 'dotenv';
config({quiet:true});
if(process.env.NODE_ENV!=='production')config({path:'.env.development.local',override:true,quiet:true});

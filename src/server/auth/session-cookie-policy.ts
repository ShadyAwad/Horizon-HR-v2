export function shouldUseSecureCookie(request:{secure:boolean;hostname?:string},environment:NodeJS.ProcessEnv=process.env){
 const hostname=(request.hostname||'').trim().toLowerCase().replace(/^\[/,'').replace(/\]$/,'');
 const loopback=['localhost','127.0.0.1','::1'].includes(hostname);
 return Boolean(environment.NODE_ENV==='production'&&environment.APP_BASE_URL?.startsWith('https://'))||request.secure||!loopback;
}

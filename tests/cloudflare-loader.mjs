// The production Worker runs in Cloudflare. Node's render smoke test supplies
// an empty binding module; D1/R2 behavior is tested separately in API tests.
export function resolve(specifier,context,nextResolve){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = {};',shortCircuit:true};
 return nextResolve(specifier,context);
}

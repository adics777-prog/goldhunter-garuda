// One canonical address: www.goldhuntergaruda.com -> goldhuntergaruda.com (keeps the login cookie on one host).
// Only page visits are redirected; API calls (e.g. the builder) work on both hosts.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.goldhuntergaruda.com' && ['GET', 'HEAD'].includes(context.request.method) && !url.pathname.startsWith('/api/')) {
    url.hostname = 'goldhuntergaruda.com';
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}

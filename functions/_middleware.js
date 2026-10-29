// One canonical address: www.goldhuntergaruda.com -> goldhuntergaruda.com (keeps the login cookie on one host).
// Only page visits are redirected; API calls (e.g. the builder) work on both hosts.
// Pages get the visitor's country on <html data-geo="ID"> so the language is right on the first paint (i18n.js).
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.goldhuntergaruda.com' && ['GET', 'HEAD'].includes(context.request.method) && !url.pathname.startsWith('/api/')) {
    url.hostname = 'goldhuntergaruda.com';
    return Response.redirect(url.toString(), 301);
  }
  const res = await context.next();
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) return res;
  const country = String((context.request.cf && context.request.cf.country) || '').replace(/[^A-Z]/gi, '').slice(0, 2);
  if (!country || !(res.headers.get('content-type') || '').includes('text/html')) return res;
  return new HTMLRewriter().on('html', { element(e) { e.setAttribute('data-geo', country); } }).transform(res);
}

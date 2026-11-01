// Isolated API connectivity prototype for Rene Social Hub.
// No authentication, social publishing or database functionality yet.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ service: 'rene-social-hub-api', status: 'prototype', publishingEnabled: false }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    return Response.json({ error: 'Not implemented', publishingEnabled: false }, { status: 501 });
  }
};

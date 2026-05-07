const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:8001',
      changeOrigin: true,
      ws: true,
      onProxyReq: (proxyReq, req, res) => {
        // Fix body parsing issues only for JSON requests
        if (req.body && Object.keys(req.body).length > 0 && req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      }
    })
  );
};

import http from 'node:http';

http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body><h1>Demo Dashboard</h1><p>Status surface scaffold.</p></body></html>');
}).listen(5174, () => {
  console.log('demo-dashboard listening on http://localhost:5174');
});


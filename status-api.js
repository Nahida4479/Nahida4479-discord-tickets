import http from 'http';

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3001, () => console.log('Health-check server działa na porcie 3001'));


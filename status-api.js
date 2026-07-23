const http = require('http');

http.createServer((req, res) => {
  if (req.url === '/health') {
    if (client.isReady()) {
      res.writeHead(200);
      res.end('OK');
    } else {
      res.writeHead(503);
      res.end('Discord disconnected');
    }
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3001, () => console.log('Health-check server działa na porcie 3001'));

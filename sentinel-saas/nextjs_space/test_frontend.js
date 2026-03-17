const http = require('http');

const req = http.get('http://localhost:3000/api/bot-state', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data.substring(0, 1000)));
});
req.on('error', (e) => console.error(e));

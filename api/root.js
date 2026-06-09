const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const file = path.join(__dirname, '..', 'static', 'index.html');
    const html = fs.readFileSync(file, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    res.end(html);
  } catch (err) {
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
};

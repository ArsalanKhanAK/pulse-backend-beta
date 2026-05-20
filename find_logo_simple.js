const fs = require('fs');
const filePath = 'c:\\xampp\\htdocs\\GYM APP\\frontend\\src\\App.jsx';
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

console.log('=== BRAND LOGO SIMPLE SEARCH ===');
lines.forEach((line, idx) => {
  if (line.includes('PULSE') || line.includes('SAAS') || line.includes('pulseOrange') || line.includes('Power')) {
    if (idx < 2000 && (line.includes('span') || line.includes('h3') || line.includes('h2') || line.includes('div') || line.includes('h1'))) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});

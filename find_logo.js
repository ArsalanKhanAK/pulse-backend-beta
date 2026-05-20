const fs = require('fs');
const filePath = 'c:\\xampp\\htdocs\\GYM APP\\frontend\\src\\App.jsx';
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

console.log('=== BRAND LOGO SEARCH ===');
lines.forEach((line, idx) => {
  if (line.includes('SAAS') || line.includes('SaaS') || line.includes('saas') || line.includes('PULSE') || line.includes('Pulse')) {
    if (line.includes('logo') || line.includes('sidebar') || line.includes('h3') || line.includes('h2') || idx < 2000) {
      if (line.includes('font-black') || line.includes('tracking-wider') || line.includes('text-xl')) {
        console.log(`${idx + 1}: ${line.trim()}`);
      }
    }
  }
});

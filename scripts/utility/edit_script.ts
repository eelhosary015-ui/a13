import fs from 'fs';

const filePath = 'src/components/Sales.tsx';
let data = fs.readFileSync(filePath, 'utf-8');

data = data.replace(/\/api\/sales\//g, '/api/v2/sales/');

fs.writeFileSync(filePath, data);
console.log('Done!');

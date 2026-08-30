import { HttpSession } from '../src/internal/http.js';
const s = new HttpSession();
const r = await s.request('GET', 'https://api.ipify.org?format=json', {});
console.log('current public IP:', r.text.trim());

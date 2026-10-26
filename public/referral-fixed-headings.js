/**
 * Convert ONLY the headings defined by the existing referral templates.
 * Historical drafts use <p><strong>Fixed heading:</strong><br>author text</p>.
 * This is presentation-only when called by the PDF renderer: saved HTML stays untouched.
 */
import {REFERRAL_FIXED_TITLES} from './referral-templates.js';

const normalized=value=>String(value||'').replace(/<[^>]*>/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[:\s]+$/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const known=new Map(REFERRAL_FIXED_TITLES.map(title=>[normalized(title),title]));

export function normalizeReferralHeadings(html=''){
 return String(html||'').replace(
   /<p\b[^>]*>\s*<(strong|b)\b[^>]*>\s*([\s\S]*?)\s*<\/\1>\s*(?:<br\s*\/?>)?([\s\S]*?)<\/p\s*>/gi,
   (original,tag,head,body)=>{
     const title=known.get(normalized(head));
     if(!title)return original;
     const remainder=String(body).trim().replace(/^(?:<br\s*\/?>\s*)+/i,'').trim();
     return '<h2>'+title+'</h2><p>'+(remainder||'<br>')+'</p>';
   }
 );
}

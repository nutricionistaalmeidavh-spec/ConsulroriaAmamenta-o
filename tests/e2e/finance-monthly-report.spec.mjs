import {test,expect} from './fixtures.mjs';
import {login,authHeaders,uniqueLabel} from './helpers.mjs';
import {unzipSync,strFromU8} from 'fflate';

test('consultora fecha outubro, exporta XLSX e corrige recebimento antigo sem recontar consultas', async ({page})=>{
  await login(page);
  const headers={...(await authHeaders(page)),'content-type':'application/json'};
  const paidOct=uniqueLabel('outubro-pago');
  const dueOct=uniqueLabel('outubro-pendente');
  const paidNov=uniqueLabel('novembro-pago');
  const create=async (description,amount_cents,status,paid_at,due_at)=>{
    const response=await page.request.post('/api/clinical/records/financial_entries',{
      headers,data:{description,amount_cents,status,paid:status==='Pago',
        payment_method:status==='Pago'?'Pix':'',
        ...(paid_at?{paid_at}:{}), ...(due_at?{due_at}:{})}
    });
    expect(response.ok(),description+' request '+response.status()).toBeTruthy();
    return (await response.json())[0];
  };
  const oct=await create(paidOct,12000,'Pago','2026-10-05T14:00:00Z','2026-10-04');
  await create(dueOct,7000,'Pendente',null,'2026-10-06');
  await create(paidNov,23000,'Pago','2026-11-02T14:00:00Z','2026-10-20');
  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target=finance]:visible').first().click();
  await page.locator('[data-finance-month]').fill('2026-10');
  await page.locator('[data-finance-month]').dispatchEvent('change');
  await expect(page.locator('[data-finance-period-label]')).toContainText('Outubro de 2026');
  await expect(page.locator('[data-finance-received]')).toContainText('120,00');
  await expect(page.locator('[data-finance-receivable]')).toContainText('70,00');
  await expect(page.locator('[data-finance-live]')).toContainText(paidOct);
  await expect(page.locator('[data-finance-live]')).toContainText(dueOct);
  await expect(page.locator('[data-finance-live]')).not.toContainText(paidNov);

  const csvPromise=page.waitForEvent('download');
  await page.locator('[data-finance-export-csv]').click();
  const csv=await csvPromise;
  const csvStream=await csv.createReadStream();
  const csvChunks=[];for await(const c of csvStream)csvChunks.push(c);
  const csvText=Buffer.concat(csvChunks).toString('utf8');
  expect(csvText).toContain(paidOct);
  expect(csvText).toContain(dueOct);
  expect(csvText).not.toContain(paidNov);

  const xlsxPromise=page.waitForEvent('download');
  await page.locator('[data-finance-export-xlsx]').click();
  const xlsx=await xlsxPromise;
  const xlsxStream=await xlsx.createReadStream();
  const chunks=[];for await(const c of xlsxStream)chunks.push(c);
  const archive=unzipSync(Buffer.concat(chunks));
  expect(strFromU8(archive['xl/workbook.xml'])).toContain('Atendimentos');
  expect(strFromU8(archive['xl/worksheets/sheet2.xml'])).toContain(paidOct);

  await page.locator('[data-finance-period-mode]').selectOption('custom');
  await page.locator('[data-finance-from]').fill('2026-10-04');
  await page.locator('[data-finance-to]').fill('2026-10-04');
  await expect(page.locator('[data-finance-live]')).not.toContainText(paidOct);
  await expect(page.locator('[data-finance-live]')).not.toContainText(dueOct);
  await page.locator('[data-finance-period-mode]').selectOption('month');
  await page.locator('[data-finance-month]').fill('2026-10');

  page.on('dialog',async dialog=>{
    if(dialog.type()==='prompt')await dialog.accept('2026-11-01');
    else await dialog.accept();
  });
  const octCard=page.locator('.finance-card').filter({hasText:paidOct});
  await octCard.locator('[data-action=correct-paid-date]').click();
  await expect(octCard).toHaveCount(0);
  await page.locator('[data-finance-month]').fill('2026-11');
  await expect(page.locator('[data-finance-live]')).toContainText(paidOct);
  await expect(page.locator('[data-finance-received]')).toContainText('350,00');

  const read=await page.request.get('/api/clinical/records/financial_entries?id=eq.'+encodeURIComponent(oct.id)+'&limit=1',{headers});
  expect(read.ok()).toBeTruthy();
  const [stored]=await read.json();
  expect(stored.paid_at).toContain('2026-11-01');
  expect(stored.payment_history?.at(-1)?.reason).toBe('correct_payment_date');
});

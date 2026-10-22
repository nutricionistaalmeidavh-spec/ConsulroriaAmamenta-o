#!/usr/bin/env python3
"""Relatório fiel de screenshots do Playwright e PDFs exportados (100% offline)."""
import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from PIL import Image, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else 'artifacts/qa-visual').resolve()
OUTPUT = ROOT / 'gestao-amamentacao-qa-visual.pdf'
GREEN, DARK, MUTED, PAPER = '#355c4d', '#182e2c', '#61746d', '#f6f8f6'
font = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
font_bold = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
if font.exists() and font_bold.exists():
    pdfmetrics.registerFont(TTFont('ReportRegular', str(font)))
    pdfmetrics.registerFont(TTFont('ReportBold', str(font_bold)))
    NORMAL, BOLD = 'ReportRegular', 'ReportBold'
else:
    NORMAL, BOLD = 'Helvetica', 'Helvetica-Bold'

def label(c, x, y, content, size=11, bold=False, color=DARK):
    c.setFillColor(HexColor(color))
    c.setFont(BOLD if bold else NORMAL, size)
    c.drawString(x, y, str(content))

def wrapped(c, txt, x, y, width, font_size=10, line=15, max_lines=4, color=MUTED):
    lines, current = [], ''
    for word in str(txt).split():
        attempt = (current + ' ' + word).strip()
        if pdfmetrics.stringWidth(attempt, NORMAL, font_size) <= width:
            current = attempt
        else:
            if current: lines.append(current)
            current = word
    if current: lines.append(current)
    for one in lines[:max_lines]:
        label(c, x, y, one, font_size, color=color)
        y -= line

def cover(c, count):
    w, h = landscape(A4)
    c.setPageSize((w, h))
    c.setFillColor(HexColor(DARK)); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(HexColor(GREEN)); c.roundRect(45, h-106, 165, 29, 14, stroke=0, fill=1)
    label(c, 60, h-96, 'GESTÃO DE AMAMENTAÇÃO', 9, True, '#ffffff')
    label(c, 55, h-166, 'Relatório visual de QA', 30, True, '#ffffff')
    label(c, 55, h-203, 'Jornada completa de atendimento', 16, color='#e3f0e9')
    wrapped(c, 'Capturas reais da aplicação em execução no GitHub Actions. Famílias e registros clínicos exclusivamente fictícios. Persistência, finalização e exportação em PDF verificadas por testes.', 55, h-247, 690, 12, 21, color='#d0ded4')
    label(c, 55, 156, f'{count} CAPTURAS DE TELA', 18, True, '#ffffff')
    label(c, 55, 101, 'DESKTOP + MOBILE  |  CADASTRO  |  PRONTUÁRIO  |  7 ETAPAS  |  EXPORTAÇÃO', 10, True, '#ffffff')
    label(c, 55, 58, 'Capturas longas divididas sem reduzir os pixels. PDFs originais exportados anexados.', 9, color='#b4ccc2')
    c.showPage()

def section(c, heading, details):
    w, h = landscape(A4)
    c.setPageSize((w, h))
    c.setFillColor(HexColor(PAPER)); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(HexColor(GREEN)); c.rect(0, h-15, w, 15, fill=1, stroke=0)
    label(c, 50, h-110, 'RELATÓRIO DE EVIDÊNCIAS', 12, True, GREEN)
    label(c, 50, h-173, heading, 29, True, DARK)
    wrapped(c, details, 50, h-224, w-100, 12, 20, 6)
    label(c, 50, 55, 'CENÁRIO DE TESTE ISOLADO  |  SEM PACIENTES REAIS  |  SEM SERVIÇOS PAGOS', 9, True, MUTED)
    c.showPage()

def screen(c, entry, project, position, total):
    source = (ROOT / entry['image']).resolve()
    if ROOT not in source.parents or not source.is_file():
        raise ValueError(f'Captura ausente ou fora da área de QA: {source}')
    with Image.open(source) as inp:
        img = ImageOps.exif_transpose(inp).convert('RGB')
        if img.width < 300 or img.height < 350:
            raise ValueError(f'Imagem pequena ou inválida: {source}')
        pw, ph = A4 if project == 'mobile' else landscape(A4)
        top, bottom, side = 102, 56, 32
        avail_w, avail_h = pw-2*side, ph-top-bottom
        scale = avail_w / img.width
        rows = max(1, int(avail_h / scale))
        chunks = (img.height + rows - 1) // rows
        for part in range(chunks):
            top_pixel = part * rows
            cropped = img.crop((0, top_pixel, img.width, min(img.height, top_pixel+rows)))
            displayed_h = cropped.height * scale
            c.setPageSize((pw, ph))
            c.setFillColor(HexColor(PAPER)); c.rect(0, 0, pw, ph, fill=1, stroke=0)
            c.setFillColor(HexColor(GREEN)); c.rect(0, ph-7, pw, 7, fill=1, stroke=0)
            label(c, side, ph-32, f'{project.upper()}  /  {entry["code"]}', 9, True, GREEN)
            wrapped(c, entry['title'], side, ph-56, avail_w, 10, 14, 2, DARK)
            c.drawImage(ImageReader(cropped), side, ph-top-displayed_h, avail_w, displayed_h, mask='auto')
            c.setStrokeColor(HexColor('#d5e1da'))
            c.rect(side, ph-top-displayed_h, avail_w, displayed_h, stroke=1, fill=0)
            label(c, side, 27, f'Captura {position}/{total}  |  trecho {part+1}/{chunks}', 8, color=MUTED)
            label(c, pw-170, 27, 'DADOS FICTÍCIOS', 8, True, GREEN)
            c.showPage()
            cropped.close()
        img.close()
    return chunks

def main():
    manifests, count, slices = {}, 0, 0
    for project in ('desktop', 'mobile'):
        path = ROOT / f'manifest-{project}.json'
        if not path.is_file(): raise SystemExit(f'Sem evidências do projeto {project}')
        data = json.loads(path.read_text(encoding='utf-8'))
        items = data.get('entries', [])
        if len(items) < 23: raise SystemExit(f'QA incompleto: {project}, {len(items)} screenshots')
        if any(item.get('project') != project for item in items):
            raise SystemExit(f'Origem das capturas inválida: {project}')
        if len(set(item['code'] for item in items)) != len(items):
            raise SystemExit('Capturas duplicadas no manifesto')
        manifests[project] = items
        count += len(items)
    originals = []
    for project in ('desktop', 'mobile'):
        orig = ROOT / 'downloads' / project / 'orientacoes-marina-elisa.pdf'
        if not orig.is_file() or orig.stat().st_size < 2500:
            raise SystemExit(f'PDF exportado ausente ou vazio: {orig}')
        if not PdfReader(str(orig)).pages:
            raise SystemExit(f'PDF exportado sem páginas: {orig}')
        originals.append(orig)
    scratch = ROOT / '.evidence-pages.pdf'
    c = canvas.Canvas(str(scratch), pagesize=landscape(A4), pageCompression=1)
    c.setTitle('Gestão de Amamentação | QA visual completo')
    cover(c, count)
    section(c, 'Cobertura e metodologia', 'Os testes operam o aplicativo real no navegador Chromium, com D1 local e registro da mesma jornada de usuário: inclusão da mãe e bebê, agenda, prontuário, avaliação da mamada, plano semanal e orientação exportada. Após salvar o atendimento, o teste recarrega o sistema e confirma a persistência.')
    for project, items in manifests.items():
        section(c, 'Navegação ' + ('desktop' if project == 'desktop' else 'mobile'), 'Capturas ordenadas pela execução do atendimento. Telas verticais longas são segmentadas em páginas consecutivas para preservar a legibilidade e resolução das imagens originais.')
        for n, item in enumerate(items, 1):
            slices += screen(c, item, project, n, len(items))
    c.save()
    writer = PdfWriter()
    for pg in PdfReader(str(scratch)).pages: writer.add_page(pg)
    for original in originals:
        for pg in PdfReader(str(original)).pages: writer.add_page(pg)
    writer.add_metadata({'/Title':'Gestão de Amamentação - Relatório visual completo', '/Subject':'Dados sintéticos, Playwright E2E, orientações exportadas'})
    with OUTPUT.open('wb') as f: writer.write(f)
    scratch.unlink(missing_ok=True)
    summary = {'screenshots': count, 'capturePages': slices, 'pdfPages': len(writer.pages), 'pdf': str(OUTPUT), 'source': 'Playwright - D1 local isolado', 'generatedAt': datetime.now(timezone.utc).isoformat()}
    (ROOT / 'qa-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))
if __name__ == '__main__':
    main()

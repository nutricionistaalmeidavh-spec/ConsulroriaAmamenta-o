#!/usr/bin/env python3
"""High-resolution QA report from real Playwright screenshots, without mockups.

Run only against image/manifest output from the local synthetic E2E scenario.
Dependencies: reportlab, Pillow, PyMuPDF (all open source).
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

ROOT = Path("artifacts/qa-clinical")
SCREENS = ROOT / "screens"
REPORT = ROOT / "Relatorio_QA_Gestao_Amamentacao.pdf"
PDF_PATIENT = ROOT / "orientacoes-familia-exportado-pelo-sistema.pdf"
NAVY = colors.HexColor("#26243B")
PURPLE = colors.HexColor("#6756AA")
PALE = colors.HexColor("#F7F3FC")
TEXT = colors.HexColor("#32324A")

def fit_text(c, value, x, y, max_width, initial=16):
    size = initial
    while size > 9 and stringWidth(value, "Helvetica-Bold", size) > max_width:
        size -= 0.5
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, value)

def page_header(c, w, h, title, subtitle, count=None):
    c.setFillColor(NAVY)
    c.rect(0, h - 77, w, 77, fill=1, stroke=0)
    c.setFillColor(colors.white)
    fit_text(c, title, 27, h - 35, w - 100, 18)
    c.setFont("Helvetica", 10)
    line = subtitle if len(subtitle) < 190 else subtitle[:187] + "..."
    c.drawString(28, h - 55, line)
    if count is not None:
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(w - 27, h - 35, "%02d" % count)
    c.setFillColor(PURPLE)
    c.rect(0, h - 83, w, 6, fill=1, stroke=0)

def add_screen(c, path, title, note, index):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")
        iw, ih = image.size
        # High-resolution, lossless PDF image embedding. Do not JPEG-recompress.
        scale = min(1.0, 1320 / max(iw, 1), 2440 / max(ih, 1))
        dw, dh = iw * scale, ih * scale
        w = max(dw + 48, 620)
        h = max(dh + 132, 490)
        c.setPageSize((w, h))
        c.setFillColor(PALE)
        c.rect(0, 0, w, h, fill=1, stroke=0)
        page_header(c, w, h, title, note, index)
        image_x = (w - dw) / 2
        image_y = max(30, h - 94 - dh)
        c.setFillColor(colors.white)
        c.roundRect(image_x - 4, image_y - 4, dw + 8, dh + 8, 8, stroke=0, fill=1)
        c.drawImage(ImageReader(image), image_x, image_y, width=dw, height=dh, mask="auto")
        c.setFillColor(TEXT)
        c.setFont("Helvetica", 10)
        c.drawString(26, 15, "Gestão de Amamentação | QA automatizado | Dados inteiramente fictícios")
        c.showPage()

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    manifest = ROOT / "screenshots.json"
    items = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    good = [item for item in items if (SCREENS / item["file"]).is_file()]
    status_path = ROOT / "qa-status.json"
    succeeded = status_path.exists() and json.loads(status_path.read_text(encoding="utf-8")).get("success") is True
    report = canvas.Canvas(str(REPORT), pageCompression=0)
    report.setTitle("Gestão de Amamentação — Evidências de QA com dados fictícios")
    report.setAuthor("ArtiSys · QA automatizado")

    w, h = 960, 620
    report.setPageSize((w, h))
    report.setFillColor(NAVY)
    report.rect(0, 0, w, h, fill=1, stroke=0)
    report.setFillColor(colors.HexColor("#B7A3EF"))
    report.setFont("Helvetica-Bold", 19)
    report.drawString(68, 515, "ARTISYS  /  GESTÃO DE AMAMENTAÇÃO")
    report.setFillColor(colors.white)
    report.setFont("Helvetica-Bold", 36)
    report.drawString(68, 437, "Relatório visual de QA")
    report.setFont("Helvetica", 22)
    report.drawString(68, 397, "Da admissão à exportação das orientações")
    report.setFillColor(colors.HexColor("#D8D2E7"))
    report.setFont("Helvetica", 15)
    report.drawString(68, 330, "%d capturas reais do aplicativo — desktop e mobile" % len(good))
    report.drawString(68, 298, "Pacientes, bebês, avaliações, evolução e orientações são fictícios.")
    report.drawString(68, 266, "Execução exclusivamente com banco D1 local isolado.")
    report.setFillColor(colors.HexColor("#E7D9AB") if not succeeded else colors.HexColor("#BFE5D3"))
    report.setFont("Helvetica-Bold", 15)
    report.drawString(68, 208, "STATUS: %s" % ("PASS — jornada E2E concluída" if succeeded else "PARCIAL — verificar logs da Action"))
    report.setFillColor(colors.HexColor("#D8D2E7"))
    report.setFont("Helvetica", 11)
    report.drawString(68, 90, "Gerado em %s UTC" % datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M"))
    report.showPage()

    # Preserve native PDF quality by rendering export using MuPDF at 180dpi.
    if PDF_PATIENT.exists():
        import fitz
        with fitz.open(PDF_PATIENT) as doc:
            for idx in range(min(doc.page_count, 5)):
                out = SCREENS / ("28-pdf-orientacoes-p%02d.png" % (idx+1))
                out.parent.mkdir(parents=True, exist_ok=True)
                page = doc[idx]
                pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
                pix.save(str(out))
                good.append({
                    "file": out.name,
                    "title": "Documento entregue à família — página %d" % (idx+1),
                    "note": "Renderização de alta definição do PDF original exportado pelo sistema.",
                })

    for i, item in enumerate(good, 1):
        add_screen(report, SCREENS / item["file"], item["title"], item.get("note", ""), i)

    report.save()
    print("QA_REPORT=" + str(REPORT))
    print("QA_SCREENSHOTS=" + str(len(good)))
    print("QA_STATUS=" + ("PASS" if succeeded else "PARTIAL"))

if __name__ == "__main__":
    main()

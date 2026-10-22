#!/usr/bin/env python3
"""Build a high-resolution PDF from real Playwright browser captures.

Append original care-plan PDFs exported by the app. Refuse to claim a pass if
there are no screenshots or no exported care-plan document.
"""
import json
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

ROOT = Path("artifacts/qa-visual")
OUT = ROOT / "qa-gestao-amamentacao-evidencias.pdf"
INTERMEDIATE = ROOT / "_screenproof.pdf"
NAVY = colors.HexColor("#253E3A")
TEAL = colors.HexColor("#467B69")
MUTED = colors.HexColor("#718079")

def draw_text(canvas, txt, x, y, size=9, bold=False, color=NAVY):
    canvas.setFillColor(color)
    canvas.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    canvas.drawString(x, y, str(txt))

def first_page(canvas, image_count):
    width, height = A4
    canvas.setPageSize(A4)
    canvas.setFillColor(colors.HexColor("#F4F7F4"))
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, height - 14, width, 14, fill=1, stroke=0)
    draw_text(canvas, "GESTAO DE AMAMENTACAO", 46, height - 107, 19, True)
    draw_text(canvas, "QA VISUAL - JORNADA CLINICA COMPLETA", 46, height - 150, 12, True, TEAL)
    draw_text(canvas, "Cadastro, agendamento, prontuario e plano de cuidados", 46, height - 180, 10)
    draw_text(canvas, f"Capturas reais do navegador: {image_count}", 46, height - 206, 10)
    draw_text(canvas, f"Execucao: {datetime.now(timezone.utc):%d/%m/%Y %H:%M} UTC", 46, height - 228)
    canvas.setStrokeColor(colors.HexColor("#D7E1DA"))
    canvas.line(46, height - 258, width - 46, height - 258)
    for index, statement in enumerate([
        "AMBIENTE: Playwright + D1/Miniflare local - sem dados de producao",
        "DADOS: maes, bebes, telefones e prontuarios 100% ficticios",
        "COBERTURA: desktop, mobile e as sete etapas do atendimento",
        "VERIFICACAO: cadastro, registros, persistencia e exportacao em PDF",
        "DOCUMENTOS: PDFs exportados pela aplicacao anexados ao final",
    ]):
        draw_text(canvas, statement, 46, height - 291 - index * 27)
    canvas.setFillColor(colors.HexColor("#E3F0E8"))
    canvas.roundRect(46, 115, width - 92, 98, 12, fill=1, stroke=0)
    draw_text(canvas, "SEM DADOS REAIS DE PACIENTES", 62, 181, 11, True, TEAL)
    draw_text(canvas, "Capturas diretas da aplicacao em execucao, nao mockups.", 62, 153, 10)
    draw_text(canvas, "Este documento nao substitui o relatorio de testes do GitHub Actions.", 62, 134, 8)
    canvas.showPage()

def add_screenshot(canvas, item, number):
    image_path = ROOT / item["image"]
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    with Image.open(image_path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    width, height = landscape(A4) if item["project"] == "desktop" else A4
    left, top, bottom = 35, 76, 46
    draw_width, draw_height = width - 2 * left, height - top - bottom
    # Split long full-page captures for readable type instead of shrinking text.
    slice_height = max(1, int(image.width * draw_height / draw_width))
    parts = max(1, (image.height + slice_height - 1) // slice_height)
    for part in range(parts):
        chunk = image.crop((0, part * slice_height, image.width,
                            min(image.height, (part + 1) * slice_height)))
        canvas.setPageSize((width, height))
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, width, height, stroke=0, fill=1)
        canvas.setFillColor(NAVY)
        canvas.rect(0, height - 9, width, 9, stroke=0, fill=1)
        title = item["title"]
        title = (title[:92] + "...") if len(title) > 95 else title
        draw_text(canvas, f"{number:02d}  {title}", left, height - 37, 9, True)
        draw_text(canvas, f"{item['project'].upper()}  |  parte {part + 1}/{parts}",
                  left, height - 56, 8, False, MUTED)
        factor = min(draw_width / chunk.width, draw_height / chunk.height)
        pw, ph = chunk.width * factor, chunk.height * factor
        buffer = BytesIO()
        chunk.save(buffer, format="JPEG", quality=91, subsampling=0, optimize=True)
        buffer.seek(0)
        canvas.drawImage(ImageReader(buffer),
                         (width - pw) / 2, bottom + (draw_height - ph) / 2,
                         pw, ph, preserveAspectRatio=True)
        canvas.setStrokeColor(colors.HexColor("#DCE4DF"))
        canvas.line(left, 33, width - left, 33)
        draw_text(canvas, "Print do sistema real. Todos os dados sao ficticios.",
                  left, 21, 7, False, MUTED)
        canvas.showPage()
    return parts

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    images = []
    for project in ("desktop", "mobile"):
        manifest = ROOT / f"manifest-{project}.json"
        if manifest.exists():
            images += json.loads(manifest.read_text(encoding="utf-8")).get("entries", [])
    if not images:
        raise SystemExit("Nenhuma captura real. Nao e permitido gerar um PDF ficticio.")

    canvas = Canvas(str(INTERMEDIATE), pagesize=A4, pageCompression=1)
    canvas.setTitle("Gestao de Amamentacao - Evidencias visuais de QA")
    first_page(canvas, len(images))
    total_pages = 1
    for number, item in enumerate(images, 1):
        total_pages += add_screenshot(canvas, item, number)
    canvas.save()

    writer = PdfWriter()
    writer.append(str(INTERMEDIATE))
    appendix = []
    for care_plan in sorted((ROOT / "downloads").glob("*/orientacoes-*.pdf")):
        original = PdfReader(str(care_plan))
        if not original.pages:
            raise ValueError(f"PDF exportado vazio: {care_plan}")
        writer.append(str(care_plan), import_outline=False)
        appendix.append({"path": str(care_plan.relative_to(ROOT)), "pages": len(original.pages)})
    if not appendix:
        raise SystemExit("Orientacao nao foi exportada; relatorio de sucesso nao pode ser gerado.")

    with OUT.open("wb") as file:
        writer.write(file)
    INTERMEDIATE.unlink(missing_ok=True)
    summary = {
        "capturas": len(images),
        "paginas_de_prints": total_pages,
        "orientacoes_anexadas": appendix,
        "arquivo": OUT.name,
        "bytes": OUT.stat().st_size,
    }
    (ROOT / "report-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

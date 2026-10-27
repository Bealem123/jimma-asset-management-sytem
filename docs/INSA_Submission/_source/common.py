"""Shared layout for the INSA submission documents: fonts, styles, cover, document control, TOC, diagrams."""
import os
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, Line, String, Polygon, Ellipse, Circle, Group
from reportlab.graphics import renderPDF
from reportlab.platypus.flowables import Flowable

ROOT = r"C:\Users\Bealem\Documents\Bealem\Bealem_Business\JRMS_Reaecrch_Documents\Jimma_Asset_Management_System"
OUT = os.path.join(ROOT, "docs", "INSA_Submission")
LOGO = os.path.join(ROOT, "frontend", "public", "brand", "logo-256.png")
os.makedirs(OUT, exist_ok=True)

FONTS = r"C:\Windows\Fonts"
pdfmetrics.registerFont(TTFont("Body", os.path.join(FONTS, "calibri.ttf")))
pdfmetrics.registerFont(TTFont("Body-Bold", os.path.join(FONTS, "calibrib.ttf")))
pdfmetrics.registerFont(TTFont("Body-Italic", os.path.join(FONTS, "calibrii.ttf")))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", os.path.join(FONTS, "calibriz.ttf")))
pdfmetrics.registerFont(TTFont("Head", os.path.join(FONTS, "cambriab.ttf")))
pdfmetrics.registerFont(TTFont("Mono", os.path.join(FONTS, "consola.ttf")))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")

NAVY = colors.HexColor("#17324D")
TEAL = colors.HexColor("#0E6E68")
INK = colors.HexColor("#1E2A36")
GREY = colors.HexColor("#5B6875")
LINE = colors.HexColor("#C9D3DC")
SHADE = colors.HexColor("#EEF3F6")
SHADE2 = colors.HexColor("#F7F9FB")
HEADBG = colors.HexColor("#DCE7EE")

# diagram fills
F_USER = colors.HexColor("#E8F1FA")
F_PROC = colors.HexColor("#E3F2EF")
F_STORE = colors.HexColor("#FFF6E0")
F_EXT = colors.HexColor("#F3ECF8")
F_ZONE = colors.HexColor("#F8FAFB")

ORG = "Jimma City Administration"
SYSTEM = "Jimma City Smart Asset Management System"
SHORT = "JCSAMS"
AUTHOR = "Bealem Sintayehu"
DATE = "25 October 2026"
VERSION = "1.0"

ss = {}
ss["body"] = ParagraphStyle("body", fontName="Body", fontSize=10.5, leading=14.6, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
ss["bodyL"] = ParagraphStyle("bodyL", parent=ss["body"], alignment=TA_LEFT)
ss["small"] = ParagraphStyle("small", parent=ss["body"], fontSize=9, leading=12, alignment=TA_LEFT, spaceAfter=3)
ss["caption"] = ParagraphStyle("caption", parent=ss["body"], fontName="Body-Italic", fontSize=9, leading=11.5, textColor=GREY, alignment=TA_CENTER, spaceBefore=3, spaceAfter=10)
ss["h1"] = ParagraphStyle("h1", fontName="Head", fontSize=17, leading=21, textColor=NAVY, spaceBefore=4, spaceAfter=10)
ss["h2"] = ParagraphStyle("h2", fontName="Head", fontSize=13, leading=16.5, textColor=NAVY, spaceBefore=12, spaceAfter=6)
ss["h3"] = ParagraphStyle("h3", fontName="Body-Bold", fontSize=11.2, leading=14.5, textColor=TEAL, spaceBefore=9, spaceAfter=4)
ss["cell"] = ParagraphStyle("cell", fontName="Body", fontSize=9.2, leading=11.6, textColor=INK, alignment=TA_LEFT)
ss["cellb"] = ParagraphStyle("cellb", parent=ss["cell"], fontName="Body-Bold")
ss["cellh"] = ParagraphStyle("cellh", parent=ss["cell"], fontName="Body-Bold", textColor=NAVY)
ss["bullet"] = ParagraphStyle("bullet", parent=ss["body"], alignment=TA_LEFT, leftIndent=16, bulletIndent=5, spaceAfter=3)
ss["bullet2"] = ParagraphStyle("bullet2", parent=ss["bullet"], leftIndent=30, bulletIndent=19)
ss["code"] = ParagraphStyle("code", fontName="Mono", fontSize=8.4, leading=11, textColor=INK, backColor=SHADE2,
                            borderColor=LINE, borderWidth=0.5, borderPadding=6, leftIndent=6, rightIndent=6, spaceBefore=4, spaceAfter=10)
ss["note"] = ParagraphStyle("note", parent=ss["body"], alignment=TA_LEFT, backColor=SHADE, borderColor=TEAL, borderWidth=0,
                            borderPadding=(7, 9, 7, 9), leftIndent=4, rightIndent=4, spaceBefore=6, spaceAfter=12)
ss["toc1"] = ParagraphStyle("toc1", fontName="Body-Bold", fontSize=10.5, leading=15, textColor=NAVY, leftIndent=0)
ss["toc2"] = ParagraphStyle("toc2", fontName="Body", fontSize=10, leading=13.5, textColor=INK, leftIndent=18)


# ------------------------------------------------------------------ building blocks
_num = {"h1": 0, "h2": 0, "h3": 0}


def reset_numbers():
    _num.update(h1=0, h2=0, h3=0)


class Heading(Paragraph):
    """A numbered heading the table of contents picks up."""

    def __init__(self, text, level, numbered=True):
        self.toc_level = level
        if numbered:
            if level == 0:
                _num["h1"] += 1; _num["h2"] = 0; _num["h3"] = 0
                label = f"{_num['h1']}"
            elif level == 1:
                _num["h2"] += 1; _num["h3"] = 0
                label = f"{_num['h1']}.{_num['h2']}"
            else:
                _num["h3"] += 1
                # a task heading straight under a chapter is numbered 8.1, 8.2 ... (no "8.0.1")
                label = f"{_num['h1']}.{_num['h2']}.{_num['h3']}" if _num["h2"] else f"{_num['h1']}.{_num['h3']}"
            text = f"{label}&nbsp;&nbsp;{text}"
        self.toc_text = text.replace("&nbsp;&nbsp;", "  ")
        super().__init__(text, ss[("h1", "h2", "h3")[level]])


def H1(t, numbered=True):
    return [CondPageBreak(9 * cm), Heading(t, 0, numbered)]


def H2(t):
    return [CondPageBreak(4 * cm), Heading(t, 1)]


def H3(t):
    return Heading(t, 2)


def P(t, style="body"):
    return Paragraph(t, ss[style])


def bullets(items, style="bullet"):
    out = []
    for it in items:
        if isinstance(it, (list, tuple)):
            out += bullets(it, "bullet2")
        else:
            out.append(Paragraph(it, ss[style], bulletText="\u2022"))
    return out


def numbered(items):
    return [Paragraph(it, ss["bullet"], bulletText=f"{i}.") for i, it in enumerate(items, 1)]


def note(t):
    return Paragraph(t, ss["note"])


def code(t):
    return Paragraph(t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>").replace("  ", "&nbsp;&nbsp;"), ss["code"])


def table(rows, widths, header=True, zebra=True, font=None, keep=False):
    """rows: list of lists of str (or flowables). widths in cm."""
    data = []
    for r_i, row in enumerate(rows):
        cells = []
        for c in row:
            if isinstance(c, str):
                cells.append(Paragraph(c, ss["cellh"] if (header and r_i == 0) else ss["cell"]))
            else:
                cells.append(c)
        data.append(cells)
    t = Table(data, colWidths=[w * cm for w in widths], repeatRows=1 if header else 0, hAlign="LEFT")
    st = [
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        st.append(("BACKGROUND", (0, 0), (-1, 0), HEADBG))
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if (i % 2 == 0):
                st.append(("BACKGROUND", (0, i), (-1, i), SHADE2))
    t.setStyle(TableStyle(st))
    return KeepTogether([t, Spacer(1, 8)]) if keep else [t, Spacer(1, 9)]


def kv_table(rows, w1=4.6, w2=11.4):
    data = [[Paragraph(k, ss["cellb"]), Paragraph(v, ss["cell"])] for k, v in rows]
    t = Table(data, colWidths=[w1 * cm, w2 * cm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("BACKGROUND", (0, 0), (0, -1), SHADE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    return [t, Spacer(1, 10)]


fig_counter = [0]


def figure(drawing, caption):
    fig_counter[0] += 1
    return [KeepTogether([Spacer(1, 4), DrawingFlowable(drawing), P(f"Figure {fig_counter[0]}: {caption}", "caption")])]


class DrawingFlowable(Flowable):
    def __init__(self, d):
        super().__init__()
        self.d = d
        self.width, self.height = d.width, d.height
        self.hAlign = "CENTER"

    def wrap(self, aw, ah):
        self._scale = min(1.0, aw / self.d.width)
        return self.d.width * self._scale, self.d.height * self._scale

    def draw(self):
        s = self._scale
        self.canv.saveState()
        self.canv.scale(s, s)
        renderPDF.draw(self.d, self.canv, 0, 0)
        self.canv.restoreState()


# ------------------------------------------------------------------ diagram primitives
def _lines(text, size, max_w, font="Body"):
    out = []
    for part in text.split("\n"):
        words, cur = part.split(" "), ""
        for w in words:
            trial = (cur + " " + w).strip()
            if pdfmetrics.stringWidth(trial, font, size) <= max_w or not cur:
                cur = trial
            else:
                out.append(cur); cur = w
        out.append(cur)
    return out


def text_block(g, cx, cy, text, size=8.5, max_w=100, font="Body", color=INK, bold_first=False):
    lines = _lines(text, size, max_w, font)
    lead = size * 1.22
    top = cy + (len(lines) - 1) * lead / 2 - size * 0.33
    for i, ln in enumerate(lines):
        f = "Body-Bold" if (bold_first and i == 0) else font
        g.add(String(cx, top - i * lead, ln, fontName=f, fontSize=size, fillColor=color, textAnchor="middle"))


def box(g, x, y, w, h, text, fill=F_PROC, stroke=NAVY, size=8.5, r=5, bold_first=True, dash=None, sw=0.9):
    g.add(Rect(x, y, w, h, rx=r, ry=r, fillColor=fill, strokeColor=stroke, strokeWidth=sw, strokeDashArray=dash))
    text_block(g, x + w / 2, y + h / 2, text, size, w - 10, bold_first=bold_first)
    return (x, y, w, h)


def zone(g, x, y, w, h, title, fill=F_ZONE, stroke=GREY):
    g.add(Rect(x, y, w, h, rx=6, ry=6, fillColor=fill, strokeColor=stroke, strokeWidth=0.8, strokeDashArray=[4, 3]))
    g.add(String(x + 8, y + h - 13, title, fontName="Body-Bold", fontSize=9, fillColor=GREY))


def store(g, x, y, w, h, ident, text, size=8.3):
    """Gane-Sarson data store: open rectangle with an ID compartment."""
    g.add(Rect(x, y, w, h, fillColor=F_STORE, strokeColor=None))
    g.add(Line(x, y, x + w, y, strokeColor=NAVY, strokeWidth=0.9))
    g.add(Line(x, y + h, x + w, y + h, strokeColor=NAVY, strokeWidth=0.9))
    g.add(Line(x, y, x, y + h, strokeColor=NAVY, strokeWidth=0.9))
    g.add(Line(x + 26, y, x + 26, y + h, strokeColor=NAVY, strokeWidth=0.9))
    g.add(String(x + 13, y + h / 2 - 3, ident, fontName="Body-Bold", fontSize=size, fillColor=NAVY, textAnchor="middle"))
    text_block(g, x + 26 + (w - 26) / 2, y + h / 2, text, size, w - 34)
    return (x, y, w, h)


def process(g, x, y, w, h, ident, text, size=8.3):
    """Gane-Sarson process: rounded box with an ID band on top."""
    g.add(Rect(x, y, w, h, rx=7, ry=7, fillColor=F_PROC, strokeColor=TEAL, strokeWidth=1))
    g.add(Line(x, y + h - 15, x + w, y + h - 15, strokeColor=TEAL, strokeWidth=0.7))
    g.add(String(x + w / 2, y + h - 11, ident, fontName="Body-Bold", fontSize=size, fillColor=TEAL, textAnchor="middle"))
    text_block(g, x + w / 2, y + (h - 15) / 2, text, size, w - 10)
    return (x, y, w, h)


def entity(g, x, y, w, h, text, size=8.5):
    g.add(Rect(x + 3, y - 3, w, h, fillColor=colors.HexColor("#D9CCE3"), strokeColor=None))
    g.add(Rect(x, y, w, h, fillColor=F_EXT, strokeColor=colors.HexColor("#6B4E8A"), strokeWidth=0.9))
    text_block(g, x + w / 2, y + h / 2, text, size, w - 8, bold_first=False)
    return (x, y, w, h)


def cylinder(g, x, y, w, h, text, fill=F_STORE, size=8.5):
    e = 7
    g.add(Rect(x, y + e / 2, w, h - e, fillColor=fill, strokeColor=None))
    g.add(Line(x, y + e / 2, x, y + h - e / 2, strokeColor=NAVY, strokeWidth=0.9))
    g.add(Line(x + w, y + e / 2, x + w, y + h - e / 2, strokeColor=NAVY, strokeWidth=0.9))
    g.add(Ellipse(x + w / 2, y + e / 2, w / 2, e / 2, fillColor=fill, strokeColor=NAVY, strokeWidth=0.9))
    g.add(Ellipse(x + w / 2, y + h - e / 2, w / 2, e / 2, fillColor=fill, strokeColor=NAVY, strokeWidth=0.9))
    text_block(g, x + w / 2, y + h / 2 - 2, text, size, w - 8)
    return (x, y, w, h)


def actor(g, cx, y, label, size=8.2):
    """stick figure, feet at y"""
    c = NAVY
    g.add(Circle(cx, y + 30, 5, fillColor=colors.white, strokeColor=c, strokeWidth=0.9))
    g.add(Line(cx, y + 25, cx, y + 12, strokeColor=c, strokeWidth=0.9))
    g.add(Line(cx - 8, y + 21, cx + 8, y + 21, strokeColor=c, strokeWidth=0.9))
    g.add(Line(cx, y + 12, cx - 6, y + 2, strokeColor=c, strokeWidth=0.9))
    g.add(Line(cx, y + 12, cx + 6, y + 2, strokeColor=c, strokeWidth=0.9))
    text_block(g, cx, y - 8, label, size, 90)


def arrow(g, x1, y1, x2, y2, label=None, color=NAVY, size=7.4, both=False, dash=None, lx=0, ly=0, sw=0.85, label_bg=True):
    import math
    g.add(Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=sw, strokeDashArray=dash))

    def head(xa, ya, xb, yb):
        ang = math.atan2(yb - ya, xb - xa)
        L, W = 6.5, 2.8
        p1 = (xb - L * math.cos(ang) + W * math.sin(ang), yb - L * math.sin(ang) - W * math.cos(ang))
        p2 = (xb - L * math.cos(ang) - W * math.sin(ang), yb - L * math.sin(ang) + W * math.cos(ang))
        g.add(Polygon([xb, yb, p1[0], p1[1], p2[0], p2[1]], fillColor=color, strokeColor=color, strokeWidth=0.3))

    head(x1, y1, x2, y2)
    if both:
        head(x2, y2, x1, y1)
    if label:
        mx, my = (x1 + x2) / 2 + lx, (y1 + y2) / 2 + ly
        lines = label.split("\n")
        if label_bg:
            wmax = max(pdfmetrics.stringWidth(l, "Body", size) for l in lines)
            hh = len(lines) * size * 1.18
            g.add(Rect(mx - wmax / 2 - 2, my - hh / 2 - 1, wmax + 4, hh + 1, fillColor=colors.white, strokeColor=None))
        for i, l in enumerate(lines):
            g.add(String(mx, my + (len(lines) - 1) * size * 0.59 - i * size * 1.18 - size * 0.32, l, fontName="Body", fontSize=size, fillColor=GREY, textAnchor="middle"))


def poly_arrow(g, pts, label=None, color=NAVY, size=7.4, dash=None, lpos=None):
    """polyline through pts with an arrowhead at the end"""
    for (a, b) in zip(pts[:-2], pts[1:-1]):
        g.add(Line(a[0], a[1], b[0], b[1], strokeColor=color, strokeWidth=0.85, strokeDashArray=dash))
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    arrow(g, x1, y1, x2, y2, None, color, dash=dash)
    if label and lpos:
        lines = label.split("\n")
        wmax = max(pdfmetrics.stringWidth(l, "Body", size) for l in lines)
        hh = len(lines) * size * 1.18
        g.add(Rect(lpos[0] - wmax / 2 - 2, lpos[1] - hh / 2 - 1, wmax + 4, hh + 1, fillColor=colors.white, strokeColor=None))
        for i, l in enumerate(lines):
            g.add(String(lpos[0], lpos[1] + (len(lines) - 1) * size * 0.59 - i * size * 1.18 - size * 0.32, l, fontName="Body", fontSize=size, fillColor=GREY, textAnchor="middle"))


def legend(g, x, y, items, size=7.6):
    """items: list of (kind, label) with kind in process/store/entity/zone/flow"""
    cx = x
    for kind, label in items:
        if kind == "process":
            g.add(Rect(cx, y, 16, 10, rx=3, ry=3, fillColor=F_PROC, strokeColor=TEAL, strokeWidth=0.8))
        elif kind == "store":
            g.add(Rect(cx, y, 16, 10, fillColor=F_STORE, strokeColor=None))
            g.add(Line(cx, y, cx + 16, y, strokeColor=NAVY)); g.add(Line(cx, y + 10, cx + 16, y + 10, strokeColor=NAVY)); g.add(Line(cx, y, cx, y + 10, strokeColor=NAVY))
        elif kind == "entity":
            g.add(Rect(cx, y, 16, 10, fillColor=F_EXT, strokeColor=colors.HexColor("#6B4E8A"), strokeWidth=0.8))
        elif kind == "flow":
            arrow(g, cx, y + 5, cx + 16, y + 5)
        elif kind == "dashed":
            arrow(g, cx, y + 5, cx + 16, y + 5, dash=[3, 2])
        elif kind == "box":
            g.add(Rect(cx, y, 16, 10, rx=2, ry=2, fillColor=F_USER, strokeColor=NAVY, strokeWidth=0.8))
        g.add(String(cx + 20, y + 2, label, fontName="Body", fontSize=size, fillColor=GREY))
        cx += 26 + pdfmetrics.stringWidth(label, "Body", size) + 14


# ------------------------------------------------------------------ document template
class Doc(BaseDocTemplate):
    def __init__(self, filename, code, title, **kw):
        super().__init__(filename, pagesize=A4, leftMargin=2.2 * cm, rightMargin=2.2 * cm, topMargin=2.3 * cm,
                         bottomMargin=2.1 * cm, title=f"{title} - {SYSTEM}", author=AUTHOR, subject=SYSTEM,
                         creator="Jimma City Smart Asset Management System project", **kw)
        self.code, self.doc_title = code, title
        fr = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate("cover", [fr], onPage=self._cover_page),
                               PageTemplate("body", [fr], onPage=self._body_page)])

    def afterFlowable(self, f):
        if isinstance(f, Heading) and f.toc_level <= 1:
            key = f"h{id(f)}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.toc_text.replace("&amp;", "&"), key, level=f.toc_level, closed=f.toc_level > 0)
            self.notify("TOCEntry", (f.toc_level, f.toc_text, self.page, key))

    def _cover_page(self, c, d):
        W, H = A4
        c.saveState()
        c.setFillColor(NAVY); c.rect(0, H - 1.3 * cm, W, 1.3 * cm, stroke=0, fill=1)
        c.setFillColor(TEAL); c.rect(0, H - 1.5 * cm, W, 0.2 * cm, stroke=0, fill=1)
        c.setFillColor(NAVY); c.rect(0, 0, W, 0.9 * cm, stroke=0, fill=1)
        c.setFont("Body", 8.5); c.setFillColor(colors.white)
        c.drawString(2.2 * cm, 0.33 * cm, "Classification: RESTRICTED. Prepared for the INSA security assessment.")
        c.drawRightString(W - 2.2 * cm, 0.33 * cm, f"{self.code}  |  Version {VERSION}")
        c.restoreState()

    def _body_page(self, c, d):
        W, H = A4
        c.saveState()
        c.setStrokeColor(LINE); c.setLineWidth(0.6)
        c.line(2.2 * cm, H - 1.55 * cm, W - 2.2 * cm, H - 1.55 * cm)
        c.setFont("Body", 8.3); c.setFillColor(GREY)
        c.drawString(2.2 * cm, H - 1.35 * cm, SYSTEM)
        c.drawRightString(W - 2.2 * cm, H - 1.35 * cm, f"{self.doc_title}  |  {self.code}  v{VERSION}")
        c.line(2.2 * cm, 1.5 * cm, W - 2.2 * cm, 1.5 * cm)
        c.drawString(2.2 * cm, 1.08 * cm, "RESTRICTED: for the INSA security assessment only")
        c.restoreState()


def build(doc, story):
    """multiBuild for the TOC; the canvas writes 'Page n of N' once the total is known."""
    from reportlab.pdfgen import canvas as rl_canvas

    class NumberedCanvas(rl_canvas.Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            W, H = A4
            for state in self._saved:
                self.__dict__.update(state)
                n = self._pageNumber
                if n > 1:
                    self.saveState()
                    self.setFont("Body", 8.3); self.setFillColor(GREY)
                    self.drawRightString(W - 2.2 * cm, 1.08 * cm, f"Page {n} of {total}")
                    self.restoreState()
                super().showPage()
            super().save()

    doc.multiBuild(story, canvasmaker=NumberedCanvas)


# ------------------------------------------------------------------ front matter
def cover(code, title, subtitle, purpose):
    st = []
    st.append(Spacer(1, 2.2 * cm))
    if os.path.exists(LOGO):
        img = Image(LOGO, width=3.0 * cm, height=3.0 * cm)
        img.hAlign = "LEFT"
        st.append(img)
    st.append(Spacer(1, 0.6 * cm))
    st.append(Paragraph(ORG.upper(), ParagraphStyle("o", fontName="Body-Bold", fontSize=10.5, textColor=TEAL, leading=14)))
    st.append(Paragraph(SYSTEM, ParagraphStyle("s", fontName="Body", fontSize=13, textColor=GREY, leading=17, spaceAfter=18)))
    st.append(Paragraph(title, ParagraphStyle("t", fontName="Head", fontSize=27, leading=32, textColor=NAVY, spaceAfter=8)))
    st.append(Paragraph(subtitle, ParagraphStyle("st", fontName="Body", fontSize=13, leading=17, textColor=INK, spaceAfter=26)))
    st.append(Paragraph(purpose, ParagraphStyle("p", fontName="Body", fontSize=10.5, leading=15, textColor=INK, spaceAfter=26)))
    rows = [
        ("Document number", code),
        ("Version", f"{VERSION} (submission issue)"),
        ("Date of issue", DATE),
        ("System owner", f"{ORG}, Ethiopia"),
        ("Developed by", "Banmen Technologies"),
        ("Prepared by", f"{AUTHOR}, Project Lead, Banmen Technologies"),
        ("Submitted to", "Information Network Security Administration (INSA), through the Hibir platform"),
        ("Assessment requested", "Web application and API security assessment (penetration test)"),
        ("Classification", "RESTRICTED"),
    ]
    data = [[Paragraph(k, ss["cellb"]), Paragraph(v, ss["cell"])] for k, v in rows]
    t = Table(data, colWidths=[4.4 * cm, 12.2 * cm], hAlign="LEFT")
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                           ("LINEABOVE", (0, 0), (-1, 0), 1.2, NAVY)]))
    st.append(t)
    st.append(NextPageTemplate("body"))
    st.append(PageBreak())
    return st


def document_control(revisions, reviewers=None, distribution=None, related=None):
    st = [P("Document control", "h1")]
    st.append(P("Revision history", "h3"))
    st += table([["Version", "Date", "Author", "Description of change"]] + revisions, [1.6, 2.6, 3.6, 8.8])
    st.append(P("Review and approval", "h3"))
    st.append(P("This document is valid for submission once the people below have reviewed and signed it. Signatures are "
                "collected on the printed copy kept in the project file at the Jimma City Administration.", "bodyL"))
    rv = reviewers or [
        ["Prepared by", f"{AUTHOR}", "Project Lead, Banmen Technologies", "", ""],
        ["Reviewed by", "", "Head, ICT Directorate, Jimma City Administration", "", ""],
        ["Approved by", "", "Office of the Mayor, Jimma City Administration", "", ""],
    ]
    st += table([["Role", "Name", "Position", "Signature", "Date"]] + rv, [2.4, 3.4, 5.4, 3.0, 2.4])
    st.append(P("Distribution", "h3"))
    dist = distribution or [
        ["1", "Information Network Security Administration (INSA), assessment team", "Electronic, through the Hibir platform"],
        ["2", "Office of the Mayor, Jimma City Administration", "Printed and electronic"],
        ["3", "ICT Directorate, Jimma City Administration", "Printed and electronic"],
        ["4", "Project file", "Printed, signed original"],
    ]
    st += table([["Copy", "Recipient", "Form"]] + dist, [1.4, 10.6, 4.6])
    if related:
        st.append(P("Related documents in this submission", "h3"))
        st += table([["Number", "Title"]] + related, [4.0, 12.6])
    st.append(PageBreak())
    return st


RELATED = [
    ["JCSAMS-LTR-000", "Covering letter to INSA"],
    ["JCSAMS-SRS-001", "Software Requirements Specification"],
    ["JCSAMS-SDD-002", "System and Architecture Design Document"],
    ["JCSAMS-TDD-003", "Technical Design and Specification"],
    ["JCSAMS-UG-004", "User Guide"],
    ["JCSAMS-SEC-005", "Security Documentation"],
]


def toc():
    t = TableOfContents()
    t.levelStyles = [ss["toc1"], ss["toc2"]]
    t.dotsMinLevel = 0
    return [P("Contents", "h1"), t, PageBreak()]

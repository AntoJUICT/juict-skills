"""Azure-architectuurdiagrammen als .drawio bronbestand plus standalone SVG.

Waarom deze engine bestaat: bij het genereren van Azure-diagrammen gaan standaard
twee dingen mis. Iconen die niet renderen (Azure2-shapes zijn SVG-images met een
pad, geen mxgraph-stencils, dus een verzonnen pad faalt stil), en layouts waarin
de verbindingslijnen door labels en door elkaar heen lopen.

Deze engine sluit beide af:
  - shape() faalt hard als een (categorie, bestand)-paar niet in de officiele
    Azure2-index staat. Die index wordt uit de draw.io source gebouwd.
  - corridor() reserveert een vrije verticale baan. check() faalt als een cel
    daarin geparkeerd wordt, of buiten zijn groep loopt, of een andere cel raakt.

Gebruik: zie example_scene.py.
"""
from __future__ import annotations

import base64
import html
import json
import os
import re
import sys
import urllib.request

DRAWIO_RAW = 'https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/'
SIDEBAR_URL = DRAWIO_RAW + 'js/diagramly/sidebar/Sidebar-Azure2.js'
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
INDEX_PATH = os.path.join(CACHE, 'azure2-shapes.json')
ICON_DIR = os.path.join(CACHE, 'azure2')


# ------------------------------------------------------------------ geometrie
def _seg_hits_box(x1, y1, x2, y2, bx1, by1, bx2, by2, marge=3):
    """Snijdt het lijnsegment de rechthoek? Alleen orthogonale segmenten, wat de
    router altijd oplevert. De marge voorkomt dat een lijn die netjes tegen een
    rand aan begint of eindigt als doorsnijding wordt gemeld."""
    bx1, by1, bx2, by2 = bx1 + marge, by1 + marge, bx2 - marge, by2 - marge
    if bx2 <= bx1 or by2 <= by1:
        return False
    if abs(y1 - y2) < 0.5:                      # horizontaal
        return by1 < y1 < by2 and min(x1, x2) < bx2 and max(x1, x2) > bx1
    if abs(x1 - x2) < 0.5:                      # verticaal
        return bx1 < x1 < bx2 and min(y1, y2) < by2 and max(y1, y2) > by1
    return False


# --------------------------------------------------------------------- palet
class Theme:
    """Kleuren per rol. Vervang deze waarden door je eigen huisstijl."""

    def __init__(self, primary='#0e7c86', primary_wash='#e2f2f3',
                 accent='#b0700a', accent_wash='#f8efdd',
                 outside='#5b53c2', outside_wash='#ecebf8',
                 ink='#131820', ink2='#47515f', border='#c3ccd9',
                 paper='#ffffff', paper2='#fbfcfd'):
        self.primary, self.primary_wash = primary, primary_wash
        self.accent, self.accent_wash = accent, accent_wash
        self.outside, self.outside_wash = outside, outside_wash
        self.ink, self.ink2, self.border = ink, ink2, border
        self.paper, self.paper2 = paper, paper2


# ------------------------------------------------------------- shape-index
def build_index(force=False):
    """Bouwt de Azure2-shapelijst uit de draw.io source. Cachet in .cache/."""
    if os.path.exists(INDEX_PATH) and not force:
        with open(INDEX_PATH, encoding='utf-8') as f:
            return json.load(f)
    os.makedirs(CACHE, exist_ok=True)
    with urllib.request.urlopen(SIDEBAR_URL, timeout=30) as r:
        src = r.read().decode('utf-8')
    fn2cat = dict(re.findall(
        r"this\.addAzure2(\w+Palette)\(gn, r, sb, s \+ '([a-z0-9_]+)/'\)", src))
    R = 400.0

    def dim(t):
        t = t.strip()
        m = re.fullmatch(r'r \* ([\d.]+)', t) or re.fullmatch(r'([\d.]+)', t)
        if not m:
            return None
        v = float(m.group(1))
        return round(v * R) if t.startswith('r') else round(v)

    bounds = [(m.group(1), m.end()) for m in re.finditer(
        r'Sidebar\.prototype\.addAzure2(\w+Palette)\s*=\s*function\([^)]*\)\s*\{', src)]
    out = {}
    for i, (fn, st) in enumerate(bounds):
        cat = fn2cat.get(fn)
        if not cat:
            continue
        body = src[st:bounds[i + 1][1] if i + 1 < len(bounds) else len(src)]
        lst = []
        for sv, w, h, lb in re.findall(
                r"createVertexTemplateEntry\(\s*s\s*\+\s*'([^']+?\.svg);?'\s*,\s*([^,]+?)\s*,"
                r"\s*([^,]+?)\s*,\s*'[^']*'\s*,\s*'([^']*)'", body):
            W, H = dim(w), dim(h)
            if W and H:
                lst.append({'label': lb, 'svg': sv, 'w': W, 'h': H})
        out[cat] = lst
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f'shape-index: {sum(len(v) for v in out.values())} shapes '
          f'in {len(out)} categorieen -> {INDEX_PATH}')
    return out


def find_shapes(term, index=None):
    """Zoekt shapes op label of bestandsnaam. Gebruik dit VOORDAT je een pad typt."""
    index = index or build_index()
    hits = []
    t = term.lower()
    for cat, entries in sorted(index.items()):
        for e in entries:
            if t in e['label'].lower() or t in e['svg'].lower().replace('_', ' ').lower():
                hits.append((cat, e['svg'], e['label']))
    return hits


def _icon_bytes(cat, svg):
    path = os.path.join(ICON_DIR, cat, svg)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(f'{DRAWIO_RAW}img/lib/azure2/{cat}/{svg}', timeout=30) as r:
            data = r.read()
        with open(path, 'wb') as f:
            f.write(data)
        return data
    with open(path, 'rb') as f:
        return f.read()


# ------------------------------------------------------------------ diagram
class Diagram:
    ICON_H = 56       # alle iconen op gelijke visuele hoogte
    CELL_W = 200      # celbreedte voor icoon plus labels
    TITLE_DY = 8
    TITLE_LH = 13
    SUB_DY = 4
    SUB_LH = 12

    def __init__(self, width=1680, height=1320, theme=None, name='Diagram'):
        self.w, self.h = width, height
        self.t = theme or Theme()
        self.name = name
        self.index = build_index()
        self.nodes, self.groups, self.texts, self.edges = [], [], [], []
        self.corridors = []
        self._seq = 0

    def _id(self, p='n'):
        self._seq += 1
        return f'{p}{self._seq}'

    # -- declaratie ---------------------------------------------------------
    def corridor(self, x, label=''):
        """Reserveert een vrije verticale baan op x. check() handhaaft dit."""
        self.corridors.append({'x': x, 'label': label or f'corridor x={x}'})
        return x

    def shape(self, cat, svg):
        """Zoekt de shape op en faalt hard als hij niet bestaat."""
        for e in self.index.get(cat, []):
            if e['svg'] == svg:
                return e
        hint = ''
        stem = svg.replace('.svg', '').replace('_', ' ')
        near = find_shapes(stem.split()[0], self.index)[:5] if stem else []
        if near:
            hint = '\n  bedoelde je: ' + ', '.join(f'{c}/{s}' for c, s, _ in near)
        sys.exit(f'FOUT: {cat}/{svg} staat niet in de Azure2-index.{hint}')

    def cell(self, cat, svg, title, sub='', cx=0, top=0, color=None):
        """Azure-resource: icoon gecentreerd op cx, titel en subtekst eronder."""
        e = self.shape(cat, svg)
        h = self.ICON_H
        w = round(e['w'] * (self.ICON_H / e['h']))
        n = {'id': self._id(), 'cat': cat, 'svg': svg, 'x': round(cx - w / 2),
             'y': top, 'w': w, 'h': h, 'title': title, 'sub': sub,
             'color': color or self.t.ink2, 'cx': cx}
        n['bottom'] = (top + h + self.TITLE_DY + len(title.split('\n')) * self.TITLE_LH
                       + (self.SUB_DY + len(sub.split('\n')) * self.SUB_LH if sub else 0))
        self.nodes.append(n)
        return n

    def box(self, title, sub='', cx=0, top=0, w=220, h=48, color=None,
            fill=None, dashed=False):
        """Rechthoek voor wat geen Azure-resource is (een app, een team, een pipeline-stap)."""
        n = {'id': self._id(), 'x': round(cx - w / 2), 'y': top, 'w': w, 'h': h,
             'title': title, 'sub': sub, 'color': color or self.t.ink2,
             'fill': fill or self.t.paper, 'dashed': dashed, 'cx': cx, 'plain': True}
        n['bottom'] = top + h + (self.SUB_DY + len(sub.split('\n')) * self.SUB_LH if sub else 0)
        self.nodes.append(n)
        return n

    def group(self, label, x, y, w, h, color=None, fill=None, dashed=False, size=12):
        g = {'id': self._id('g'), 'label': label, 'x': x, 'y': y, 'w': w, 'h': h,
             'color': color or self.t.ink2, 'fill': fill or self.t.paper,
             'dashed': dashed, 'size': size}
        self.groups.append(g)
        return g

    def text(self, s, x, y, w, color=None, size=10, bold=False, align='left',
             lh=13, swatch=None):
        self.texts.append({'id': self._id('t'), 's': s, 'x': x, 'y': y, 'w': w,
                           'color': color or self.t.ink2, 'size': size, 'bold': bold,
                           'align': align, 'lh': lh, 'swatch': swatch})

    def link(self, a, b, label='', color=None, dashed=False, route='auto',
             mid=None, sdx=0, edx=0, lpos=0.5):
        """route: h | v | vhv | hv | vh. mid = vaste corridor-coordinaat.
        sdx/edx schuiven het aanknooppunt op zodat parallelle lijnen niet stapelen."""
        self.edges.append({'id': self._id('e'), 'a': a, 'b': b, 'label': label,
                           'color': color or self.t.ink2, 'dashed': dashed,
                           'route': route, 'mid': mid, 'sdx': sdx, 'edx': edx,
                           'lpos': lpos})

    # -- validatie ---------------------------------------------------------
    def check(self):
        """Faalt zichtbaar op overlappende cellen, cellen buiten hun groep, en
        geblokkeerde corridors. Draai dit voor elke write."""
        problems = []
        items = [(n['title'].split('\n')[0], n['cx'] - self.CELL_W / 2, n['y'],
                  n['cx'] + self.CELL_W / 2, n['bottom']) for n in self.nodes]
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                if a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]:
                    problems.append(f'cellen overlappen: "{a[0]}" en "{b[0]}"')
        for n in self.nodes:
            for g in self.groups:
                if (g['x'] <= n['cx'] <= g['x'] + g['w']
                        and g['y'] <= n['y'] <= g['y'] + g['h']
                        and n['bottom'] > g['y'] + g['h']):
                    problems.append(
                        f'"{n["title"].split(chr(10))[0]}" loopt '
                        f'{round(n["bottom"] - g["y"] - g["h"])}px buiten groep '
                        f'"{g["label"][:34]}"')
        endpoints = {e['a']['id'] for e in self.edges} | {e['b']['id'] for e in self.edges}
        for cor in self.corridors:
            for n in self.nodes:
                if abs(n['cx'] - cor['x']) < 1 or n['id'] in endpoints:
                    continue
                half = (n['w'] if n.get('plain') else self.CELL_W) / 2
                if n['cx'] - half < cor['x'] < n['cx'] + half:
                    problems.append(
                        f'{cor["label"]} geblokkeerd door '
                        f'"{n["title"].split(chr(10))[0]}" (cx={n["cx"]})')
        problems += self._check_crossings()
        return problems

    def _check_crossings(self):
        """Vindt lijnen die door een node lopen die niet hun eigen begin- of eindpunt is.
        Dit is de check die er echt op aankomt: een corridor kan vrij lijken terwijl er
        een resource tussen de twee uiteinden van een lijn staat."""
        problems = []
        for e in self.edges:
            pts, _ = self._route(e, labels=True)
            segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
            for n in self.nodes:
                if n['id'] in (e['a']['id'], e['b']['id']):
                    continue
                # icoon-box plus het labelblok eronder, want daar mag ook niks door
                bx1, bx2 = n['cx'] - self.CELL_W / 2, n['cx'] + self.CELL_W / 2
                if n.get('plain'):
                    bx1, bx2 = n['x'], n['x'] + n['w']
                box = (bx1, n['y'], bx2, n['bottom'])
                for (x1, y1), (x2, y2) in segs:
                    if _seg_hits_box(x1, y1, x2, y2, *box):
                        problems.append(
                            f'lijn "{e["label"] or e["a"]["title"].split(chr(10))[0]} -> '
                            f'{e["b"]["title"].split(chr(10))[0]}" loopt door '
                            f'"{n["title"].split(chr(10))[0]}"')
                        break
        return problems

    # -- routing -----------------------------------------------------------
    def _anchor(self, n, side, labels):
        if side == 'top':
            return n['cx'], n['y']
        if side == 'bottom':
            return n['cx'], (n['bottom'] + 4 if labels else n['y'] + n['h'])
        if side == 'left':
            return n['x'], n['y'] + n['h'] / 2
        return n['x'] + n['w'], n['y'] + n['h'] / 2

    def _route(self, e, labels=False):
        """Geeft (punten, waypoints). De waypoints gaan ook naar draw.io mee."""
        a, b, r = e['a'], e['b'], e['route']
        A = lambda n, s: self._anchor(n, s, labels)  # noqa: E731
        acy, bcy = a['y'] + a['h'] / 2, b['y'] + b['h'] / 2
        if r == 'auto':
            r = e['route'] = 'h' if abs(b['cx'] - a['cx']) > abs(bcy - acy) else 'v'
        if r == 'h':
            right = b['cx'] > a['cx']
            (sx, sy), (ex, ey) = A(a, 'right' if right else 'left'), A(b, 'left' if right else 'right')
            sy, ey = sy + e['sdx'], ey + e['edx']
            if abs(sy - ey) < 1:
                return [(sx, sy), (ex, ey)], []
            mx = e['mid'] if e['mid'] is not None else (sx + ex) / 2
            return [(sx, sy), (mx, sy), (mx, ey), (ex, ey)], [(mx, sy), (mx, ey)]
        if r in ('v', 'vhv'):
            down = bcy > acy
            (sx, sy), (ex, ey) = A(a, 'bottom' if down else 'top'), A(b, 'top' if down else 'bottom')
            sx, ex = sx + e['sdx'], ex + e['edx']
            if r == 'v' and abs(sx - ex) < 1:
                return [(sx, sy), (ex, ey)], []
            my = e['mid'] if e['mid'] is not None else (sy + ey) / 2
            return [(sx, sy), (sx, my), (ex, my), (ex, ey)], [(sx, my), (ex, my)]
        if r == 'hv':
            (sx, sy) = A(a, 'right' if b['cx'] > a['cx'] else 'left')
            (ex, ey) = A(b, 'top' if bcy > acy else 'bottom')
            return [(sx, sy), (ex, sy), (ex, ey)], [(ex, sy)]
        if r == 'vh':
            (sx, sy) = A(a, 'bottom' if bcy > acy else 'top')
            (ex, ey) = A(b, 'left' if b['cx'] > a['cx'] else 'right')
            return [(sx, sy), (sx, ey), (ex, ey)], [(sx, ey)]
        sys.exit(f'FOUT: onbekende route "{r}"')

    # -- renderer: .drawio -------------------------------------------------
    @staticmethod
    def _esc(s):
        return html.escape(s).replace('\n', '&#10;')

    def write_drawio(self, path):
        c = []
        e_ = self._esc
        for g in self.groups:
            st = (f'rounded=1;arcSize=4;whiteSpace=wrap;html=1;fillColor={g["fill"]};'
                  f'strokeColor={g["color"]};strokeWidth=1.5;verticalAlign=top;align=left;'
                  f'spacingLeft=14;spacingTop=6;fontSize={g["size"]};fontStyle=1;'
                  f'fontColor={g["color"]};'
                  + ('dashed=1;dashPattern=8 4;' if g['dashed'] else ''))
            c.append(f'<mxCell id="{g["id"]}" value="{e_(g["label"])}" style="{st}" '
                     f'vertex="1" parent="1"><mxGeometry x="{g["x"]}" y="{g["y"]}" '
                     f'width="{g["w"]}" height="{g["h"]}" as="geometry"/></mxCell>')
        for n in self.nodes:
            if n.get('plain'):
                st = (f'rounded=1;arcSize=12;whiteSpace=wrap;html=1;align=center;'
                      f'verticalAlign=middle;fillColor={n["fill"]};strokeColor={n["color"]};'
                      f'strokeWidth=1.5;fontSize=11;fontStyle=1;fontColor={n["color"]};'
                      + ('dashed=1;dashPattern=6 4;' if n['dashed'] else ''))
            else:
                st = (f'image;aspect=fixed;html=1;points=[];align=center;fontSize=11;'
                      f'fontStyle=1;fontColor={n["color"]};labelPosition=center;'
                      f'verticalLabelPosition=bottom;verticalAlign=top;'
                      f'spacingTop={self.TITLE_DY};'
                      f'image=img/lib/azure2/{n["cat"]}/{n["svg"]};')
            c.append(f'<mxCell id="{n["id"]}" value="{e_(n["title"])}" style="{st}" '
                     f'vertex="1" parent="1"><mxGeometry x="{n["x"]}" y="{n["y"]}" '
                     f'width="{n["w"]}" height="{n["h"]}" as="geometry"/></mxCell>')
            if n['sub']:
                sy = (n['y'] + n['h'] + self.TITLE_DY
                      + len(n['title'].split('\n')) * self.TITLE_LH) if not n.get('plain') \
                    else n['y'] + n['h'] + self.SUB_DY
                sh = len(n['sub'].split('\n')) * self.SUB_LH
                st = (f'text;html=1;whiteSpace=wrap;align=center;verticalAlign=top;'
                      f'fontSize=9;fontColor={n["color"]};')
                c.append(f'<mxCell id="{self._id("s")}" value="{e_(n["sub"])}" style="{st}" '
                         f'vertex="1" parent="1"><mxGeometry x="{n["cx"] - self.CELL_W // 2}" '
                         f'y="{sy}" width="{self.CELL_W}" height="{sh}" as="geometry"/></mxCell>')
        for t in self.texts:
            st = (f'text;html=1;whiteSpace=wrap;align={t["align"]};verticalAlign=top;'
                  f'fontSize={t["size"]};fontColor={t["color"]};'
                  + ('fontStyle=1;' if t['bold'] else ''))
            hh = len(t['s'].split('\n')) * t['lh'] + 4
            c.append(f'<mxCell id="{t["id"]}" value="{e_(t["s"])}" style="{st}" '
                     f'vertex="1" parent="1"><mxGeometry x="{t["x"]}" y="{t["y"]}" '
                     f'width="{t["w"]}" height="{hh}" as="geometry"/></mxCell>')
        for e in self.edges:
            pts, way = self._route(e, labels=False)
            st = (f'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor={e["color"]};'
                  f'strokeWidth=1.4;fontSize=9;fontColor={e["color"]};'
                  f'labelBackgroundColor=#ffffff;endArrow=blockThin;endFill=1;jumpStyle=arc;'
                  + ('dashed=1;dashPattern=4 3;' if e['dashed'] else ''))
            a, b = e['a'], e['b']
            (sx, sy), (ex, ey) = pts[0], pts[-1]
            clamp = lambda v: max(0.0, min(1.0, v))  # noqa: E731
            st += (f'exitX={clamp((sx - a["x"]) / a["w"]):.3f};'
                   f'exitY={clamp((sy - a["y"]) / a["h"]):.3f};exitDx=0;exitDy=0;'
                   f'entryX={clamp((ex - b["x"]) / b["w"]):.3f};'
                   f'entryY={clamp((ey - b["y"]) / b["h"]):.3f};entryDx=0;entryDy=0;')
            geo = '<mxGeometry relative="1" as="geometry">'
            if way:
                geo += ('<Array as="points">'
                        + ''.join(f'<mxPoint x="{x:.0f}" y="{y:.0f}"/>' for x, y in way)
                        + '</Array>')
            geo += '</mxGeometry>'
            c.append(f'<mxCell id="{e["id"]}" value="{e_(e["label"])}" style="{st}" '
                     f'edge="1" parent="1" source="{a["id"]}" target="{b["id"]}">{geo}</mxCell>')

        body = '\n        '.join(c)
        xml = (f'<mxfile host="app.diagrams.net" type="device">\n'
               f'  <diagram name="{html.escape(self.name)}" id="{self.name.lower().replace(" ", "-")}">\n'
               f'    <mxGraphModel dx="{self.w}" dy="{self.h}" grid="0" gridSize="10" guides="1"\n'
               f'        tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1"\n'
               f'        pageWidth="{self.w}" pageHeight="{self.h}" math="0" shadow="0">\n'
               f'      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
               f'        {body}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(xml)
        return len(c)

    # -- renderer: .svg ----------------------------------------------------
    def _svg_text(self, s, x, y, w, color, size, bold, align, lh):
        a = {'left': 'start', 'center': 'middle', 'right': 'end'}[align]
        tx = x if align == 'left' else (x + w / 2 if align == 'center' else x + w)
        out = [f'<text x="{tx:.0f}" y="{y + size:.0f}" fill="{color}" font-size="{size}" '
               f'text-anchor="{a}" font-weight="{"600" if bold else "400"}">']
        for i, line in enumerate(s.split('\n')):
            out.append(f'<tspan x="{tx:.0f}" dy="{0 if i == 0 else lh}">'
                       f'{html.escape(line)}</tspan>')
        return ''.join(out) + '</text>'

    def write_svg(self, path):
        o = [f'<svg xmlns="http://www.w3.org/2000/svg" '
             f'xmlns:xlink="http://www.w3.org/1999/xlink" width="{self.w}" height="{self.h}" '
             f'viewBox="0 0 {self.w} {self.h}" '
             f'font-family="Segoe UI, system-ui, sans-serif">',
             f'<rect width="{self.w}" height="{self.h}" fill="{self.t.paper}"/>', '<defs>']
        for col in {e['color'] for e in self.edges}:
            o.append(f'<marker id="ar{col[1:]}" markerWidth="9" markerHeight="9" '
                     f'refX="7.5" refY="3" orient="auto">'
                     f'<path d="M0,0 L8,3 L0,6 z" fill="{col}"/></marker>')
        o.append('</defs>')
        for g in self.groups:
            d = ' stroke-dasharray="8 4"' if g['dashed'] else ''
            o.append(f'<rect x="{g["x"]}" y="{g["y"]}" width="{g["w"]}" height="{g["h"]}" '
                     f'rx="6" fill="{g["fill"]}" stroke="{g["color"]}" stroke-width="1.5"{d}/>')
            o.append(f'<text x="{g["x"] + 14}" y="{g["y"] + g["size"] + 5}" '
                     f'fill="{g["color"]}" font-size="{g["size"]}" font-weight="600">'
                     f'{html.escape(g["label"])}</text>')
        for e in self.edges:
            pts, _ = self._route(e, labels=True)
            d = 'M ' + ' L '.join(f'{x:.0f},{y:.0f}' for x, y in pts)
            da = ' stroke-dasharray="4 3"' if e['dashed'] else ''
            o.append(f'<path d="{d}" fill="none" stroke="{e["color"]}" stroke-width="1.4"{da} '
                     f'marker-end="url(#ar{e["color"][1:]})"/>')
            if e['label']:
                segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
                (x1, y1), (x2, y2) = max(
                    segs, key=lambda s: abs(s[1][0] - s[0][0]) + abs(s[1][1] - s[0][1]))
                t = e['lpos']
                lx, ly = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
                tw = len(e['label']) * 4.9 + 8
                o.append(f'<rect x="{lx - tw / 2:.0f}" y="{ly - 7:.0f}" width="{tw:.0f}" '
                         f'height="14" rx="3" fill="{self.t.paper}" opacity="0.95"/>')
                o.append(f'<text x="{lx:.0f}" y="{ly + 3.5:.0f}" fill="{e["color"]}" '
                         f'font-size="9" text-anchor="middle">{html.escape(e["label"])}</text>')
        for n in self.nodes:
            if n.get('plain'):
                d = ' stroke-dasharray="6 4"' if n['dashed'] else ''
                o.append(f'<rect x="{n["x"]}" y="{n["y"]}" width="{n["w"]}" height="{n["h"]}" '
                         f'rx="8" fill="{n["fill"]}" stroke="{n["color"]}" '
                         f'stroke-width="1.5"{d}/>')
                o.append(self._svg_text(n['title'], n['x'], n['y'] + n['h'] / 2 - 8, n['w'],
                                        n['color'], 11, True, 'center', self.TITLE_LH))
                ty = n['y'] + n['h'] + self.SUB_DY
            else:
                uri = ('data:image/svg+xml;base64,'
                       + base64.b64encode(_icon_bytes(n['cat'], n['svg'])).decode())
                o.append(f'<image x="{n["x"]}" y="{n["y"]}" width="{n["w"]}" '
                         f'height="{n["h"]}" xlink:href="{uri}"/>')
                o.append(self._svg_text(n['title'], n['cx'] - self.CELL_W / 2,
                                        n['y'] + n['h'] + self.TITLE_DY - 2, self.CELL_W,
                                        n['color'], 11, True, 'center', self.TITLE_LH))
                ty = (n['y'] + n['h'] + self.TITLE_DY
                      + len(n['title'].split('\n')) * self.TITLE_LH)
            if n['sub']:
                o.append(self._svg_text(n['sub'], n['cx'] - self.CELL_W / 2, ty, self.CELL_W,
                                        n['color'], 9, False, 'center', self.SUB_LH))
        for t in self.texts:
            if t.get('swatch'):
                o.append(f'<rect x="{t["x"] - 22}" y="{t["y"] + 1}" width="12" height="12" '
                         f'rx="3" fill="{t["swatch"]}"/>')
            o.append(self._svg_text(t['s'], t['x'], t['y'], t['w'], t['color'], t['size'],
                                    t['bold'], t['align'], t['lh']))
        o.append('</svg>')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(o))
        return len(o)

    # -- oplevering --------------------------------------------------------
    def write(self, stem):
        """Valideert en schrijft <stem>.drawio en <stem>.svg. Faalt bij problemen."""
        problems = self.check()
        if problems:
            print('LAYOUT-PROBLEMEN:')
            for p in problems:
                print('  -', p)
            sys.exit('Niets geschreven. Los de layout op en probeer opnieuw.')
        print('layout in orde: geen overlap, alles binnen de groepen, corridors vrij')
        print(f'{stem}.drawio  ({self.write_drawio(stem + ".drawio")} cellen)')
        print(f'{stem}.svg     ({self.write_svg(stem + ".svg")} regels)')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'index':
        build_index(force=True)
    elif len(sys.argv) > 2 and sys.argv[1] == 'find':
        hits = find_shapes(' '.join(sys.argv[2:]))
        for cat, svg, label in hits:
            print(f'{cat:26} {svg:46} {label}')
        print(f'-- {len(hits)} resultaten')
    else:
        print(__doc__)
        print('gebruik:\n  python azure_drawio.py index          # shape-index (her)bouwen'
              '\n  python azure_drawio.py find <term>     # shape zoeken')

#!/usr/bin/env python3
"""Mission Control v3 - Dark sidebar + light content (professional admin), WCAG verified.
New: Factory tab + dedicated dark mode toggle (sun/moon) with full dark palette.
Renders every screen in light AND dark (-dark suffix).
"""
import os
import math

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 820

FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"
MONO = "SF Mono, Menlo, Consolas, monospace"

C = {
    "sidebar": "#E4E6E8", "sidebar2": "#D8DBDE", "sideborder": "#D5D9DE",
    "sidetext": "#161A1F", "sidesub": "#4E565F",
    "canvas": "#F2F4F6", "topbar": "#FFFFFF",
    "floor": "#EFEDE8", "floorgrid": "#E2DED7", "machine": "#E4E6E8", "belt": "#D8DCE0",
    "card": "#FFFFFF", "inner": "#EEF0F3",
    "border": "#CDD3DA", "border2": "#DDE1E6",
    "black": "#161A1F", "white": "#FFFFFF",
    "text": "#161A1F", "sub": "#3B4149", "faint": "#57606B",
    "green": "#15803D", "greenbg": "#E2F1E7", "greentext": "#157A3C",
    "orange": "#B45309", "orangebg": "#FBEEDD", "orangetext": "#9A4A0B",
    "red": "#B91C1C", "redbg": "#FBE4E4", "redtext": "#B91C1C",
    "blue": "#1D4ED8", "bluebg": "#E4ECF8", "bluetext": "#1D4ED8",
    "purple": "#6D28D9", "purplebg": "#EDE7F9", "purpletext": "#6D28D9",
    "teal": "#0F766E", "tealbg": "#DFF0F0", "tealtext": "#0F766E",
    "yellow": "#A16207", "yellowbg": "#F5EDD6",
    "graychip": "#EEF0F3", "graychiptext": "#3B4149",
}

LIGHT_C = dict(C)

DARK_C = {
    "sidebar": "#14181D", "sidebar2": "#1B2026", "sideborder": "#262C33",
    "sidetext": "#E6E9ED", "sidesub": "#96A0AA",
    "canvas": "#0E1114", "topbar": "#15191D",
    "floor": "#181D22", "floorgrid": "#20262C", "machine": "#20262C", "belt": "#262D34",
    "card": "#1A1F25", "inner": "#22282F",
    "border": "#2E353D", "border2": "#262C33",
    "black": "#2F81F7", "white": "#FFFFFF",
    "text": "#E6E9ED", "sub": "#B6BEC7", "faint": "#8A939E",
    "green": "#3FB950", "greenbg": "#12301F", "greentext": "#56D364",
    "orange": "#D29922", "orangebg": "#332B15", "orangetext": "#E3B341",
    "red": "#F85149", "redbg": "#3A1D1D", "redtext": "#FF7B72",
    "blue": "#58A6FF", "bluebg": "#142B4A", "bluetext": "#79C0FF",
    "purple": "#BC8CFF", "purplebg": "#2A1F3D", "purpletext": "#D2A8FF",
    "teal": "#39C5CF", "tealbg": "#12363B", "tealtext": "#56D4DD",
    "yellow": "#D29922", "yellowbg": "#332B15",
    "graychip": "#22282F", "graychiptext": "#B6BEC7",
}

# Hardcoded light hexes used directly in screens -> dark equivalents (string-level remap)
REMAP = {
    "#161A1F": "#E6E9ED", "#57606B": "#9AA3AD", "#3B4149": "#B6BEC7",
    "#E9ECEF": "#23282F", "#D8DDE3": "#2E353D", "#EEF0F3": "#1E242A",
    "#EDE9E2": "#181D22", "#E0DAD0": "#242B31", "#B9B4AA": "#3F4852",
    "#E4E0D8": "#20262C", "#D8D2C8": "#2A3138", "#CBC5BB": "#333B43",
    "#B0A99D": "#4A535D", "#9AA3AD": "#6B7681", "#D9D4CB": "#262D34",
    "#8A939E": "#6B7681", "#1A1A1A": "#0B0E11",
}

THEME = "light"

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class Svg:
    def __init__(self):
        self.parts = []
    def add(self, s):
        self.parts.append(s)
    def text(self, x, y, s, size=13, fill=None, weight="normal", anchor="start", family=FONT, spacing=None, opacity=1):
        if fill is None:
            fill = C["text"]
        sp = f' letter-spacing="{spacing}"' if spacing else ""
        self.add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" opacity="{opacity}"{sp}>{esc(s)}</text>')
    def rect(self, x, y, w, h, fill="none", rx=0, stroke=None, sw=1, opacity=1):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{st} opacity="{opacity}"/>')
    def circle(self, cx, cy, r, fill="none", stroke=None, sw=1, opacity=1):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"{st} opacity="{opacity}"/>')
    def line(self, x1, y1, x2, y2, stroke=None, sw=1, opacity=1, dash=None):
        if stroke is None:
            stroke = C["border"]
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"{d}/>')
    def path(self, d, stroke=None, sw=1.5, fill="none", dash=None):
        if stroke is None:
            stroke = C["sub"]
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<path d="{d}" stroke="{stroke}" stroke-width="{sw}" fill="{fill}" stroke-linecap="round" stroke-linejoin="round"{dd}/>')

def card(s, x, y, w, h, rx=12, fill=None, stroke=None, sw=1):
    if fill is None:
        fill = C["card"]
    if stroke is None:
        stroke = C["border"]
    s.rect(x, y, w, h, rx=rx, fill=fill, stroke=stroke, sw=sw)

def chip(s, x, y, label, bg, fg, h=22, fs=11, weight="600", w=None):
    w = w or (len(label) * 6.6 + 18)
    s.rect(x, y, w, h, rx=h/2, fill=bg)
    s.text(x + w/2, y + h/2 + 4, label, fs, fg, weight, "middle")

def badge_solid(s, x, y, label, color, h=22, fs=11, weight="600", w=None):
    w = w or (len(label) * 6.6 + 18)
    s.rect(x, y, w, h, rx=h/2, fill=color)
    s.text(x + w/2, y + h/2 + 4, label, fs, "#FFFFFF", weight, "middle")

def dot(s, cx, cy, r, color):
    s.circle(cx, cy, r, fill=color)

def bot(s, x, y, scale=1.0, color=None, eye="#FFFFFF"):
    if color is None:
        color = C["black"]
    s.line(x + 8*scale, y, x + 8*scale, y + 3.2*scale, color, 1.2)
    s.circle(x + 8*scale, y - 1, 1.3*scale, fill=color)
    s.rect(x + 3*scale, y + 3.2*scale, 10*scale, 7.6*scale, rx=2.6*scale, fill=color)
    s.circle(x + 6.1*scale, y + 6.4*scale, 1.35*scale, fill=eye)
    s.circle(x + 9.9*scale, y + 6.4*scale, 1.35*scale, fill=eye)
    s.rect(x + 5.2*scale, y + 12.6*scale, 5.6*scale, 6.6*scale, rx=1.9*scale, fill=color, opacity=0.72)

def progress(s, x, y, w, h, pct, color=None):
    if color is None:
        color = C["black"]
    s.rect(x, y, w, h, rx=h/2, fill="#D8DDE3")
    s.rect(x, y, max(w*pct/100, h), h, rx=h/2, fill=color)

def pill_btn(s, x, y, w, h, label, fill=None, stroke=None, tc=None, fs=12.5, weight="600"):
    if fill is None:
        fill = C["card"]
    if stroke is None:
        stroke = C["border"]
    if tc is None:
        tc = C["text"]
    s.rect(x, y, w, h, rx=h/2, fill=fill, stroke=stroke, sw=1)
    s.text(x + w/2, y + h/2 + 4, label, fs, tc, weight, "middle")

def search_field(s, x, y, w, h=32, placeholder="Search"):
    s.rect(x, y, w, h, rx=h/2, fill="#E9ECEF", stroke=C["border"], sw=1)
    s.circle(x + 16, y + h/2, 4, fill="none", stroke=C["faint"], sw=1.5)
    s.line(x + 19, y + h/2 + 3.5, x + 23, y + h/2 + 7.5, C["faint"], 1.5)
    s.text(x + 32, y + h/2 + 4, placeholder, 12.5, C["faint"], "400")

NAV_MAIN = [("overview", "Overview"), ("tasks", "Tasks"), ("tickets", "Tickets"),
            ("backlog", "Backlog"), ("calendar", "Calendar"), ("approvals", "Approvals")]
NAV_TEAM = [("agents", "Agents"), ("factory", "Factory"), ("activity", "Live Activity")]
NAV_OBS = [("health", "Health"), ("sessions", "Sessions"), ("usage", "Usage & Cost"), ("logs", "Logs")]

def glyph(s, x, y, kind, color=C["sub"], size=16):
    cx, cy = x + size/2, y + size/2
    if kind == "overview":
        s.rect(x + 2, y + 2, size - 4, size - 4, rx=3.5, fill="none", stroke=color, sw=1.6)
        s.line(x + 5, y + size/2, x + size - 5, y + size/2, color, 1.6)
        s.line(x + size/2, y + 5, x + size/2, y + size - 5, color, 1.6)
    elif kind == "tasks":
        for i in range(3):
            s.line(x + 2.5, y + 4 + i*4.5, x + size - 2.5, y + 4 + i*4.5, color, 1.8)
        s.line(x + 2.5, y + 4, x + 5.5, y + 4, color, 1.8)
        s.line(x + 2.5, y + 8.5, x + 5.5, y + 8.5, color, 1.8)
        s.line(x + 2.5, y + 13, x + 5.5, y + 13, color, 1.8)
    elif kind == "tickets":
        s.rect(x + 2.5, y + 2.5, size - 5, size - 5, rx=3, fill="none", stroke=color, sw=1.6)
        s.line(x + 5, y + 6.5, x + size - 5, y + 6.5, color, 1.6)
        s.line(x + 5, y + 10.5, x + size - 5, y + 10.5, color, 1.4, opacity=0.5)
    elif kind == "backlog":
        s.line(x + 3, y + 3, x + size - 3, y + 3, color, 1.6)
        s.line(x + 3, y + 8, x + size - 3, y + 8, color, 1.6)
        s.line(x + 3, y + 13, x + size - 3, y + 13, color, 1.6)
        s.line(x + 3, y + 3, x + 3, y + 13, color, 1.6)
    elif kind == "calendar":
        s.rect(x + 2.5, y + 3, size - 5, size - 5, rx=3, fill="none", stroke=color, sw=1.6)
        s.line(x + 2.5, y + 7.5, x + size - 2.5, y + 7.5, color, 1.6)
        s.line(x + 5.5, y + 1.5, x + 5.5, y + 4.5, color, 1.6)
        s.line(x + size - 5.5, y + 1.5, x + size - 5.5, y + 4.5, color, 1.6)
    elif kind == "approvals":
        s.path(f"M{x+2.5},{cy} l3.5,3.5 l7.5,-8", color, 1.8)
    elif kind in ("agents", "factory"):
        bot(s, x, y + 2, 0.9, color)
    elif kind == "activity":
        pts = [(x+1.5, cy), (x+4, cy), (x+6, cy-5), (x+9, cy+5), (x+11, cy), (x+size-1.5, cy)]
        s.path("M" + " L".join(f"{px},{py}" for px, py in pts), color, 1.7)
    elif kind == "health":
        s.path(f"M{cx},{y+2.5} l-6,7 l4,0 l-2,6 l7,-8 l-4,0 z", color, 1.6)
    elif kind == "sessions":
        s.rect(x + 2, y + 3.5, size - 5, size - 5, rx=3, fill="none", stroke=color, sw=1.6)
        s.rect(x + 4.5, y + 6, size - 5, size - 5, rx=3, fill="none", stroke=color, sw=1.6)
    elif kind == "usage":
        for i, hh in enumerate([5, 8, 11]):
            s.rect(x + 2.5 + i*4.5, y + size - 3 - hh, 3.2, hh, rx=1, fill=color)
        s.line(x + 2, y + size - 1.5, x + size - 2, y + size - 1.5, color, 1.6)
    elif kind == "logs":
        for i in range(4):
            s.line(x + 2.5, y + 4 + i*3.6, x + size - 2.5, y + 4 + i*3.6, color, 1.6)
        s.circle(x + size - 4.5, y + 4, 1.6, fill=color)

def sidebar(s, selected):
    s.rect(0, 0, 220, H, fill=C["sidebar"])
    s.line(220, 0, 220, H, C["sideborder"], 1)
    s.rect(20, 22, 26, 26, rx=7, fill=C["blue"])
    s.text(22, 40, "◈", 15, "#FFFFFF", "600", "middle")
    s.text(56, 40, "Mission Control", 15, C["sidetext"], "600")
    def section(label, items, y):
        s.text(20, y, label, 11, C["sidesub"], "600", spacing="0.08em")
        y += 14
        for key, lab in items:
            sel = (key == selected)
            if sel:
                s.rect(12, y, 196, 34, rx=8, fill=C["blue"])
                s.text(42, y + 22, lab, 13.5, "#FFFFFF", "600")
                glyph(s, 17, y + 9, key, "#FFFFFF")
            else:
                s.text(42, y + 22, lab, 13.5, C["sidetext"], "400")
                glyph(s, 17, y + 9, key, C["sidesub"])
            y += 42
        return y
    y = section("WORKSPACE", NAV_MAIN, 78)
    y = section("TEAM", NAV_TEAM, y + 16)
    y = section("OBSERVE", NAV_OBS, y + 16)
    s.line(20, H - 92, 200, H - 92, C["sideborder"], 1)
    s.rect(12, H - 76, 196, 40, rx=10, fill=C["sidebar2"])
    s.text(24, H - 53, "⚙  Settings", 13, C["sidetext"], "500")
    dot(s, 26, H - 24, 5, C["green"])
    s.text(38, H - 20, "Connected · 74ms", 11.5, C["sidesub"], "400")
    s.text(120, H - 20, "ws://…:18789", 11.5, "#57606B", "400")

def topbar(s, title):
    s.rect(220, 0, W - 220, 56, fill=C["topbar"])
    s.line(220, 56, W, 56, C["border2"], 1)
    s.text(244, 35, title, 17, C["text"], "600")
    search_field(s, W - 420, 12, 200)
    dot(s, W - 190, 28, 5, C["green"])
    s.text(W - 180, 32, "Connected", 12, C["sub"], "500")
    s.line(W - 132, 16, W - 132, 40, C["border2"], 1)
    # ---- dedicated theme toggle (moon in light -> sun in dark) ----
    tx = W - 132
    s.rect(tx, 12, 40, 32, rx=16, fill=C["inner"], stroke=C["border"], sw=1)
    if THEME == "dark":
        # sun: circle + rays
        s.circle(tx + 20, 28, 4.6, fill="none", stroke=C["sidesub"], sw=1.7)
        for ang in range(0, 360, 45):
            rad = math.radians(ang)
            s.line(tx + 20 + 8.5 * math.cos(rad), 28 + 8.5 * math.sin(rad),
                   tx + 20 + 11.5 * math.cos(rad), 28 + 11.5 * math.sin(rad), C["sidesub"], 1.7)
    else:
        # moon: crescent
        s.circle(tx + 17, 27, 5.6, fill="none", stroke=C["sidesub"], sw=1.7)
        s.circle(tx + 20.5, 30.5, 5.1, fill=C["inner"])
    s.rect(W - 84, 12, 32, 32, rx=16, fill=C["black"])
    s.text(W - 68, 33, "J", 14, "#FFFFFF", "600", "middle")

def header(s, title, sub=None):
    s.text(244, 92, title, 22, C["text"], "600")
    if sub:
        s.text(244, 114, sub, 13, C["sub"], "400")

def out(name, s):
    body = "\n".join(s.parts)
    if THEME == "dark":
        for a, b in REMAP.items():
            body = body.replace(a, b)
    suffix = "-dark" if THEME == "dark" else ""
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'font-family="{FONT}">\n' + f'<rect x="0" y="0" width="{W}" height="{H}" fill="{C["canvas"]}"/>' + "\n" + body + "\n</svg>")
    with open(os.path.join(OUT, name + suffix + ".svg"), "w") as f:
        f.write(svg)
    print("wrote", name + suffix)

# ============ 00 OVERVIEW ============
def screen_overview():
    s = Svg()
    sidebar(s, "overview")
    topbar(s, "Overview")
    s.text(244, 112, "Good evening", 34, C["text"], "600")
    s.text(244, 140, "Your agents are at work. Here's the state of things.", 14.5, C["sub"], "400")
    stats = [("3", "TASKS RUNNING"), ("5", "PENDING APPROVALS"), ("14", "SHIPPED TODAY"), ("$4.82", "SPEND · 24H")]
    x = 244
    for val, lab in stats:
        card(s, x - 14, 180, 188, 74, rx=12)
        s.text(x, 212, val, 40, C["text"], "600")
        s.text(x, 238, lab, 11, C["faint"], "600", spacing="0.1em")
        x += 200
    s.line(244, 276, 1024, 276, C["border2"], 1)
    s.text(244, 308, "LIVE ACTIVITY", 11, C["faint"], "600", spacing="0.1em")
    acts = [("Henry", "#6D28D9", "web_search · openclaw auth tokens"),
            ("Ralph", "#B45309", "read · wireframes/gen_v4.py"),
            ("Scout", "#15803D", "web_fetch · docs.openclaw.ai/tailscale")]
    y = 336
    for name, col, act in acts:
        bot(s, 246, y - 10, 1.0, col)
        s.text(274, y + 4, name, 13, C["text"], "600")
        s.text(336, y + 4, act, 12.5, C["sub"], "400")
        s.line(244, y + 26, 620, y + 26, C["border2"], 1)
        y += 50
    s.text(244, y + 10, "…streaming live", 12, C["faint"], "400")
    s.text(672, 308, "APPROVALS NEEDED", 11, C["faint"], "600", spacing="0.1em")
    apps = [("Henry · apt install nginx", C["red"]), ("iPhone · pairing request", C["blue"]),
            ("Echo · launch announcement", C["purple"]), ("Ralph · session fork", C["teal"])]
    y = 336
    for desc, colr in apps:
        dot(s, 680, y, 4.5, colr)
        s.text(698, y + 4, desc, 12.5, C["text"], "500")
        pill_btn(s, 950, y - 11, 74, 28, "Review", fill=C["black"], stroke="none", tc="#FFFFFF", fs=12, weight="600")
        s.line(672, y + 26, 1024, y + 26, C["border2"], 1)
        y += 50
    out("00-overview", s)

# ============ 01 TASKS ============
def screen_tasks():
    s = Svg()
    sidebar(s, "tasks")
    topbar(s, "Tasks")
    header(s, "Tasks", "What's in flight, queued, and done today — at a glance.")
    lx, lw = 244, 780
    def group(title, rows, y):
        s.text(lx, y, title, 11, C["faint"], "600", spacing="0.1em")
        y += 10
        card(s, lx, y, lw, 14 + len(rows) * 50, rx=12)
        yy = y + 32
        for i, (name, agent, col, status, prog, started, dur) in enumerate(rows):
            s.text(lx + 16, yy + 4, name, 13, C["text"], "500")
            bot(s, lx + 420, yy - 8, 0.8, col)
            s.text(lx + 442, yy + 4, agent, 12, C["sub"], "400")
            if status == "running":
                chip(s, lx + 540, yy - 8, "RUNNING", C["bluebg"], C["bluetext"], h=20, fs=10.5)
                progress(s, lx + 616, yy, 100, 5, prog)
                s.text(lx + 726, yy + 4, f"{prog}%", 11.5, C["sub"], "400")
            elif status == "queued":
                chip(s, lx + 540, yy - 8, "QUEUED", C["orangebg"], C["orangetext"], h=20, fs=10.5)
            else:
                chip(s, lx + 540, yy - 8, "DONE", C["greenbg"], C["greentext"], h=20, fs=10.5)
            s.text(lx + 660, yy + 4, started, 11.5, C["faint"], "400")
            s.text(lx + 730, yy + 4, dur, 11.5, C["faint"], "400")
            if i < len(rows) - 1:
                s.line(lx + 16, yy + 24, lx + lw - 16, yy + 24, C["border2"], 1)
            yy += 50
        return y + 14 + len(rows) * 50 + 18
    y = group("IN FLIGHT", [
        ("Deploy mission-control to staging", "Henry", "#6D28D9", "running", 62, "12:01", "0:42"),
        ("QA review · wireframe feedback", "Ralph", "#B45309", "running", 34, "12:03", "0:21"),
    ], 128)
    y = group("QUEUED", [
        ("Draft content brief for launch", "Quill", "#0F766E", "queued", 0, "—", "—"),
        ("Scan competitor pricing pages", "Scout", "#15803D", "queued", 0, "—", "—"),
    ], y)
    group("DONE TODAY", [
        ("README + docs polish", "Codex", "#1D4ED8", "done", 100, "11:24", "3:12"),
        ("Discord channel layout", "Pixel", "#B91C1C", "done", 100, "10:58", "1:05"),
        ("Trend report · weekly", "Scout", "#15803D", "done", 100, "09:40", "2:10"),
    ], y)
    out("01-tasks", s)

# ============ 02 AGENTS (family tree) ============
def screen_agents():
    s = Svg()
    sidebar(s, "agents")
    topbar(s, "Agents")
    header(s, "Agents", "Your team hierarchy — who reports to whom, and what they're doing.")
    def node(x, y, w, h, name, role, col, status, sub=None):
        card(s, x, y, w, h, rx=10)
        bot(s, x + 14, y + 10, 1.0, col)
        s.text(x + 32, y + 22, name, 12.5, C["text"], "600")
        s.text(x + 32, y + 39, role, 11, C["sub"], "400")
        if status == "working":
            dot(s, x + w - 14, y + 16, 4.5, C["green"])
        else:
            dot(s, x + w - 14, y + 16, 4.5, C["faint"])
        if sub:
            s.text(x + 14, y + h - 8, sub, 10.5, C["faint"], "400")
    s.line(634, 188, 634, 214, C["faint"], 1.2)
    s.line(400, 214, 868, 214, C["faint"], 1.2)
    for cx in (400, 634, 868):
        s.line(cx, 214, cx, 238, C["faint"], 1.2)
    for parent, kids in [(400, (330, 470)), (634, (570, 700)), (868, (800, 936))]:
        s.line(parent, 296, parent, 318, C["faint"], 1.2)
        s.line(kids[0], 318, kids[1], 318, C["faint"], 1.2)
        for k in kids:
            s.line(k, 318, k, 342, C["faint"], 1.2)
    node(564, 138, 140, 50, "main", "Operator · Chief of Staff", C["black"], "working")
    node(330, 238, 140, 58, "Henry", "Build · Orchestrator", "#6D28D9", "working", "2 sub-agents")
    node(564, 238, 140, 58, "Ralph", "QA Manager", "#B45309", "working", "2 sub-agents")
    node(798, 238, 140, 58, "Echo", "Content · Social", "#A16207", "idle", "2 sub-agents")
    node(270, 342, 120, 50, "Charlie", "Infra Eng", "#1D4ED8", "idle")
    node(410, 342, 120, 50, "Codex", "Docs & Memory", "#1D4ED8", "idle")
    node(510, 342, 120, 50, "Scout", "Audits", "#15803D", "working")
    node(630, 342, 120, 50, "Violet", "Review", "#6D28D9", "idle")
    node(740, 342, 120, 50, "Quill", "Writer", "#0F766E", "idle")
    node(876, 342, 120, 50, "Pixel", "Designer", "#B91C1C", "idle")
    card(s, 244, 440, 780, 84, rx=12)
    s.text(262, 466, "TEAM STATUS", 11, C["faint"], "600", spacing="0.1em")
    for i, (lab, colr, val) in enumerate([("Working", C["green"], ""), ("Idle", C["faint"], ""),
                                           ("Total agents", C["black"], "7"), ("Sub-agents live", C["purple"], "4")]):
        x = 262 + i * 190
        dot(s, x + 4, 494, 5, colr)
        s.text(x + 18, 498, lab, 12, C["sub"], "400")
        if val:
            s.text(x + 150, 498, val, 12, C["text"], "600")
    out("02-agents", s)

# ============ 03 TICKETS ============
def screen_tickets():
    s = Svg()
    sidebar(s, "tickets")
    topbar(s, "Tickets")
    header(s, "Tickets", "Kanban board — pipeline stages as columns, with pipeline metrics.")
    cols = [
        ("TO-DO", [("MC-142", "Build task executor", "high", "Henry", "#6D28D9", ["core", "v2"]),
                   ("MC-143", "Wireframe family tree", "med", "Pixel", "#B91C1C", ["design"]),
                   ("MC-144", "Ticket API schema", "med", "Charlie", "#1D4ED8", ["api"])]),
        ("IN PROGRESS", [("MC-140", "Mission Control scaffold", "high", "Henry", "#6D28D9", ["core"]),
                         ("MC-141", "QA · approval flow", "high", "Ralph", "#B45309", ["qa"]),
                         ("MC-138", "Live activity feed", "med", "Scout", "#15803D", ["ui"])]),
        ("DONE", [("MC-137", "Gateway auth connect", "high", "Henry", "#6D28D9", ["core"]),
                  ("MC-135", "Logs tail viewer", "med", "Codex", "#1D4ED8", ["ui"])]),
    ]
    prio = {"high": (C["redbg"], C["redtext"]), "med": (C["orangebg"], C["orangetext"])}
    cw, gap = 248, 18
    x0 = 244
    for ci, (title, tickets) in enumerate(cols):
        x = x0 + ci * (cw + gap)
        card(s, x, 128, cw, 404, rx=12)
        s.text(x + 14, 152, title, 11, C["faint"], "600", spacing="0.1em")
        s.text(x + cw - 14, 152, str(len(tickets)), 11, C["sub"], "600", "end")
        yy = 170
        for tid, tname, pr, assignee, acol, tags in tickets:
            card(s, x + 10, yy, cw - 20, 110, rx=10, fill=C["inner"], stroke="none")
            s.text(x + 22, yy + 22, tid, 11, C["faint"], "600", family=MONO)
            s.text(x + 22, yy + 46, tname, 13, C["text"], "600")
            chip(s, x + 22, yy + 58, pr.upper(), prio[pr][0], prio[pr][1], h=18, fs=10)
            bot(s, x + 112, yy + 60, 0.8, acol)
            s.text(x + 128, yy + 74, assignee, 11, C["sub"], "400")
            tx = x + 22
            for t in tags:
                s.text(tx, yy + 100, "#" + t, 10.5, C["faint"], "400")
                tx += len(t) * 6.4 + 16
            yy += 122
    m = [("SHIPPED TODAY", "3"), ("IN PROGRESS", "4"), ("BACKLOG", "12"), ("BLOCKED", "1"), ("AVG PIPELINE TIME", "4h 12m")]
    x = 244
    for lab, val in m:
        card(s, x, 556, 148, 64, rx=10)
        s.text(x + 12, 582, val, 18, C["text"], "600")
        s.text(x + 12, 602, lab, 10, C["faint"], "600", spacing="0.06em")
        x += 158
    out("03-tickets", s)

# ============ 04 BACKLOG ============
def screen_backlog():
    s = Svg()
    sidebar(s, "backlog")
    topbar(s, "Backlog")
    header(s, "Backlog", "Every ticket not yet started — ranked, tagged, ready to pull.")
    pill_btn(s, 890, 118, 134, 34, "+  New ticket", fill=C["black"], stroke="none", tc="#FFFFFF", fs=13, weight="600")
    card(s, 244, 128, 780, 500, rx=14)
    hx = 244
    for lab, w in [("TICKET", 120), ("TITLE", 250), ("PRIORITY", 100), ("TAGS", 130), ("POINTS", 70), ("AGE", 110)]:
        s.text(hx + 18, 154, lab, 11, C["faint"], "600", spacing="0.1em")
        hx += w
    prio = {"high": (C["redbg"], C["redtext"]), "med": (C["orangebg"], C["orangetext"]), "low": (C["graychip"], C["graychiptext"])}
    rows = [
        ("MC-144", "Ticket API schema", "med", ["api", "core"], 5, "2d"),
        ("MC-146", "Agent status WebSocket", "high", ["core"], 8, "1d"),
        ("MC-147", "Calendar drag & drop", "low", ["ui"], 3, "1d"),
        ("MC-148", "Usage CSV export", "low", ["reporting"], 2, "5h"),
        ("MC-149", "Pipeline block reasons", "med", ["pipeline"], 5, "3h"),
        ("MC-150", "Dark log syntax colors", "low", ["ui", "logs"], 2, "2h"),
        ("MC-151", "Sub-agent tree collapse", "med", ["agents"], 3, "1h"),
    ]
    y = 180
    for tid, title, pr, tags, pts, age in rows:
        s.line(262, y - 10, 1004, y - 10, C["border2"], 1)
        s.text(262, y + 22, tid, 11.5, C["faint"], "600", family=MONO)
        s.text(382, y + 22, title, 13, C["text"], "500")
        chip(s, 620, y + 10, pr.upper(), prio[pr][0], prio[pr][1], h=19, fs=10)
        tx = 700
        for t in tags:
            s.text(tx, y + 22, "#" + t, 11, C["faint"], "400")
            tx += len(t) * 6.4 + 16
        s.text(850, y + 22, str(pts), 12, C["sub"], "400")
        s.text(960, y + 22, age, 12, C["faint"], "400")
        y += 64
    out("04-backlog", s)

# ============ 05 CALENDAR ============
def screen_calendar():
    s = Svg()
    sidebar(s, "calendar")
    topbar(s, "Calendar")
    header(s, "Scheduled Tasks", "Cron jobs and recurring routines, weekly view.")
    s.text(500, 124, "‹", 22, C["sub"], "400")
    s.text(750, 124, "August 2026", 16, C["text"], "600")
    s.text(985, 124, "›", 22, C["sub"], "400")
    gx, gy, gw, gh = 244, 148, 780, 440
    card(s, gx, gy, gw, gh, rx=14)
    days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    colw = gw / 7
    for i, d in enumerate(days):
        s.text(gx + colw * i + 14, gy + 26, d, 11, C["faint"], "600", spacing="0.08em")
        if i > 0:
            s.line(gx + colw * i, gy + 12, gx + colw * i, gy + gh - 12, C["border2"], 1)
    events = [
        (1, 0.9, 0.62, "Morning Brief", C["yellow"], "6:30a"),
        (1, 2.4, 0.5, "Poller", "#8A939E", "11:00a"),
        (2, 1.4, 0.55, "Trend Radar", C["orange"], "9:00a"),
        (3, 0.9, 0.62, "Scout Scan", C["green"], "6:55a"),
        (3, 2.6, 0.5, "YouTube", C["red"], "12:00p"),
        (4, 1.1, 0.55, "Quill Writer", C["teal"], "8:00a"),
        (5, 2.2, 0.5, "Content Sync", C["purple"], "10:30a"),
        (6, 1.7, 0.55, "Weekly", C["blue"], "9:30a"),
    ]
    rowh = (gh - 40) / 4
    for col, r0, hh, lab, colr, tm in events:
        x = gx + colw * col + 8
        y = gy + 40 + rowh * r0
        h = rowh * hh - 6
        s.rect(x, y, colw - 16, h, rx=8, fill=colr, opacity=0.94)
        s.text(x + 10, y + 21, lab, 11, "#FFFFFF", "600")
        s.text(x + 10, y + 37, tm, 10.5, "#FFFFFF", "400")
    fx = 244
    for lab, colr in [("Morning Brief", C["yellow"]), ("Trend Radar", C["orange"]), ("Scout Scan", C["green"]),
                      ("Quill Writer", C["teal"]), ("Weekly", C["blue"]), ("YouTube", C["red"])]:
        s.circle(fx + 6, 624, 5, fill=colr)
        s.text(fx + 16, 628, lab, 12, C["sub"], "400")
        fx += len(lab) * 7.4 + 38
    out("05-calendar", s)

# ============ 06 APPROVALS ============
def screen_approvals():
    s = Svg()
    sidebar(s, "approvals")
    topbar(s, "Approvals")
    header(s, "Approvals", "Everything waiting on you — approve or reject in one click.")
    x = 244
    for lab, on in [("All", True), ("Exec", False), ("Pairing", False), ("Messages", False), ("Sessions", False)]:
        pill_btn(s, x, 128, len(lab) * 8 + 34, 32, lab, fill=C["black"] if on else C["card"],
                 stroke="none" if on else C["border"], tc="#FFFFFF" if on else C["sub"],
                 weight="600" if on else "500")
        x += len(lab) * 8 + 46
    rows = [
        ("exec", "Exec · gateway", "Henry wants to run: apt install nginx on gateway", "2 min ago", C["red"]),
        ("pair", "Device pairing", "New device: iPhone (Operator iPhone 15) requests operator access", "11 min ago", C["blue"]),
        ("msg", "Message · discord", "Echo wants to post launch announcement in #announcements", "24 min ago", C["purple"]),
        ("exec", "Exec · sandbox", "Scout wants to run: npm install in /tmp/scan", "1 hr ago", C["red"]),
        ("sess", "Session fork", "Ralph wants to fork session 'wireframes' into 'wireframes-v2'", "2 hrs ago", C["teal"]),
    ]
    ly = 178
    card(s, 244, ly, 780, 14 + len(rows) * 94, rx=14)
    y = ly + 38
    for kind, tag, desc, ago, colr in rows:
        s.rect(262, y, 36, 36, rx=9, fill=C["inner"])
        if kind == "exec":
            s.text(277, y + 23, "›_", 13, C["red"], "600")
        elif kind == "pair":
            s.text(279, y + 23, "⧉", 14, C["blue"], "600")
        elif kind == "msg":
            s.text(278, y + 23, "✉", 13, C["purple"], "600")
        else:
            s.text(278, y + 23, "⑂", 14, C["teal"], "600")
        s.text(314, y + 14, tag, 11, colr, "600", spacing="0.06em")
        s.text(314, y + 33, desc, 13, C["text"], "500")
        s.text(850, y + 14, ago, 11.5, C["faint"], "400", "end")
        pill_btn(s, 828, y + 25, 76, 30, "Approve", fill=C["green"], stroke="none", tc="#FFFFFF", fs=12.5, weight="600")
        pill_btn(s, 912, y + 25, 76, 30, "Reject", fill=C["card"], stroke=C["border"], tc=C["sub"], fs=12.5, weight="500")
        if rows.index((kind, tag, desc, ago, colr)) < len(rows) - 1:
            s.line(262, y + 58, 1004, y + 58, C["border2"], 1)
        y += 94
    out("06-approvals", s)

# ============ 07 FACTORY (NEW - live agents building, factory theme) ============
def screen_factory():
    s = Svg()
    sidebar(s, "factory")
    topbar(s, "Factory")
    header(s, "Factory", "Live view — your agents moving between stations, building for real.")
    pill_btn(s, 900, 118, 124, 32, "❚❚  Pause", fill=C["card"], stroke=C["border"], tc=C["text"], fs=12.5)
    for i, sp in enumerate(["1x", "2x", "4x"]):
        pill_btn(s, 760 + i * 44, 118, 38, 32, sp, fill=C["black"] if i == 0 else C["card"],
                 stroke="none" if i == 0 else C["border"], tc="#FFFFFF" if i == 0 else C["sub"], fs=12, weight="600")
    # ---- factory floor ----
    fx, fy, fw, fh = 244, 152, 780, 400
    card(s, fx, fy, fw, fh, rx=14, fill="#EDE9E2", stroke="#D8D2C8", sw=1)
    # floor grid
    for gx in range(fx + 30, fx + fw, 40):
        s.line(gx, fy + 12, gx, fy + fh - 12, "#E0DAD0", 1)
    for gy in range(fy + 30, fy + fh, 40):
        s.line(fx + 12, gy, fx + fw - 12, gy, "#E0DAD0", 1)
    s.text(fx + 14, fy + 24, "FLOOR 01 · LIVE", 10.5, "#57606B", "600", spacing="0.1em")
    dot(s, fx + 138, fy + 19, 4, C["green"])
    # andon board (top right)
    s.rect(fx + fw - 148, fy + 12, 132, 22, rx=6, fill=C["black"])
    s.text(fx + fw - 82, fy + 27, "ANDON · 0", 10.5, "#FFFFFF", "600", "middle")
    # ---- gantry beam ----
    s.line(fx + 20, fy + 56, fx + fw - 20, fy + 56, "#B9B4AA", 2)
    for hx in (fx + 60, fx + fw - 60):
        s.line(hx, fy + 56, hx, fy + 64, "#B9B4AA", 1.5)
    # ---- stations with machines + stack lights ----
    stations = [
        ("BREAK ROOM", 296, "#8A939E", "bin"),
        ("BUILD", 452, "#6D28D9", "machine", "RUN · 62%", "working"),
        ("QA", 608, "#B45309", "machine", "TEST · 34%", "working"),
        ("REVIEW", 764, "#1D4ED8", "machine", "REV · 40%", "idle"),
        ("SHIP", 920, "#15803D", "machine", "DONE", "idle"),
    ]
    for st in stations:
        lab, sx, colr, kind = st[0], st[1], st[2], st[3]
        my = fy + 88
        if kind == "bin":
            # parts bin with crates
            s.rect(sx - 30, my + 8, 60, 44, rx=8, fill="#D9D4CB", stroke="#B9B4AA", sw=1)
            s.text(sx, my + 36, "PARTS", 9.5, "#3B4149", "600", "middle")
            for i, cc in enumerate(["#B45309", "#1D4ED8", "#8A939E"]):
                s.rect(sx - 16 + i * 12, my - 2, 10, 8, rx=2, fill=cc)
            s.text(sx, my + 68, lab, 10.5, "#3B4149", "600", "middle")
        else:
            # stack light (industrial andon light on pole)
            s.rect(sx - 2.5, my - 26, 5, 26, fill="#8A939E")
            for i, (lc, on) in enumerate([("#B91C1C", False), ("#B45309", False), (colr, True)]):
                s.circle(sx, my - 30 - i * 9, 3.6, fill=lc, opacity=1 if on else 0.3)
            # machine body
            s.rect(sx - 44, my, 88, 56, rx=8, fill="#E4E0D8", stroke="#B9B4AA", sw=1)
            # machine screen
            s.rect(sx - 32, my + 8, 64, 18, rx=4, fill="#FFFFFF", stroke="#D8D2C8", sw=1)
            s.text(sx, my + 21, st[4], 10, "#161A1F", "600", "middle")
            s.text(sx, my + 46, lab, 10.5, "#3B4149", "600", "middle")
    # ---- conveyor belt (BUILD -> SHIP) ----
    belt_y = fy + 196
    s.rect(fx + 40, belt_y, fw - 80, 14, rx=7, fill="#CBC5BB", stroke="#B0A99D", sw=1)
    # rollers
    for rx in range(fx + 52, fx + fw - 52, 18):
        s.circle(rx, belt_y + 7, 2.6, fill="#FFFFFF", stroke="#9AA3AD", sw=0.8)
    # crates moving on belt
    crates = [(fx + 90, "#B45309"), (fx + 200, "#1D4ED8"), (fx + 320, "#6D28D9"), (fx + 470, "#15803D")]
    for cx, cc in crates:
        s.rect(cx, belt_y + 1, 12, 12, rx=2.5, fill=cc)
        s.rect(cx + 2, belt_y + 4, 8, 2, fill="#FFFFFF", opacity=0.55)
    s.text(fx + fw - 34, belt_y + 11, "▸", 11, "#57606B", "600")
    # ---- working bots at stations ----
    bots_at = [
        (452, "Henry", "#6D28D9", "task-executor · 62%", "working"),
        (608, "Ralph", "#B45309", "review · 34%", "working"),
        (764, "Violet", "#6D28D9", "checklist", "idle"),
        (920, "Pixel", "#B91C1C", "og images · done", "working"),
    ]
    for bx, name, col, task, st in bots_at:
        bot(s, bx - 8, belt_y + 24, 1.1, col)
        s.text(bx - 4, belt_y + 56, name, 11, C["text"], "600")
        s.text(bx - 4, belt_y + 70, task, 9.5, C["sub"], "400")
        if st == "working":
            chip(s, bx - 4, belt_y + 76, "WORKING", C["bluebg"], C["bluetext"], h=16, fs=8.5)
    # bots in transit on the belt
    bot(s, fx + 250, belt_y - 10, 1.0, "#15803D")
    chip(s, fx + 236, belt_y - 32, "→ QA", C["greenbg"], C["greentext"], h=16, fs=9)
    s.text(fx + 236, belt_y - 38, "Scout", 10.5, C["text"], "600")
    bot(s, fx + 385, belt_y - 10, 1.0, "#0F766E")
    chip(s, fx + 371, belt_y - 32, "→ REVIEW", C["tealbg"], C["tealtext"], h=16, fs=9)
    s.text(fx + 371, belt_y - 38, "Quill", 10.5, C["text"], "600")
    # forklift joke / details: safety stripes bottom
    for hx in range(fx + 12, fx + fw - 12, 14):
        s.rect(hx, fy + fh - 14, 7, 5, fill="#A16207" if (hx // 14) % 2 == 0 else "#1A1A1A")
    # ---- floor stats ----
    stats = [("SHIPPED TODAY", "3"), ("ACTIVE BOTS", "5"), ("CYCLE TIME", "4h 12m"), ("THROUGHPUT", "0.8/h"), ("BLOCKED", "1")]
    x = fx + 14
    for lab, val in stats:
        s.text(x, fy + fh - 34, val, 16, C["text"], "600")
        s.text(x, fy + fh - 18, lab, 9.5, C["faint"], "600", spacing="0.06em")
        x += 148
    # ---- build log ----
    card(s, 244, 570, 780, 110, rx=12)
    s.text(262, 592, "BUILD LOG", 10.5, C["faint"], "600", spacing="0.1em")
    logs = [("12:04:33", "Henry", "committed 8f3a2c1 · task-executor v0.2", C["bluetext"]),
            ("12:04:19", "Charlie", "scaffold modules wired → BUILD", C["bluetext"]),
            ("12:03:41", "Scout", "passed QA gate → moving to REVIEW", C["greentext"])]
    y = 612
    for tm, agent, msg, colr in logs:
        s.text(262, y, tm, 11, C["faint"], "400", family=MONO)
        s.text(330, y, agent, 11, C["text"], "600")
        s.text(384, y, msg, 11, C["sub"], "400")
        y += 21
    out("07-factory", s)

# ============ 08 LIVE ACTIVITY ============
def screen_activity():
    s = Svg()
    sidebar(s, "activity")
    topbar(s, "Live Activity")
    header(s, "Live Activity", "Where your agents are working right now — zone by zone.")
    pill_btn(s, 900, 118, 124, 32, "❚❚  Pause", fill=C["card"], stroke=C["border"], tc=C["text"], fs=12.5)
    zones = [
        ("BUILD", [("Henry", "#6D28D9", "deploy · 62%"), ("Charlie", "#1D4ED8", "scaffold")]),
        ("QA", [("Ralph", "#B45309", "review · 34%"), ("Violet", "#6D28D9", "checklist")]),
        ("RESEARCH", [("Scout", "#15803D", "pricing scan")]),
        ("CONTENT", [("Quill", "#0F766E", "brief draft"), ("Echo", "#A16207", "announcement")]),
    ]
    zw, gap = 186, 12
    x0 = 244
    for zi, (zname, agents) in enumerate(zones):
        x = x0 + zi * (zw + gap)
        card(s, x, 152, zw, 152, rx=12)
        s.text(x + 12, 174, zname, 11, C["faint"], "600", spacing="0.1em")
        yy = 190
        for name, col, task in agents:
            bot(s, x + 14, yy - 8, 0.9, col)
            s.text(x + 32, yy + 4, name, 12, C["text"], "600")
            s.text(x + 12, yy + 25, task, 10.5, C["sub"], "400")
            dot(s, x + zw - 14, yy - 2, 4, C["green"])
            yy += 44
    s.text(244, 336, "EVENT STREAM", 11, C["faint"], "600", spacing="0.1em")
    card(s, 244, 348, 780, 340, rx=14)
    events = [
        ("12:01:42", "Henry", "#6D28D9", "BUILD", "web_search · openclaw gateway auth", C["bluetext"]),
        ("12:02:03", "Ralph", "#B45309", "QA", "read · wireframes/gen_v4.py", C["bluetext"]),
        ("12:02:14", "Henry", "#6D28D9", "BUILD", "Deployment started — build #42", C["purpletext"]),
        ("12:03:18", "Ralph", "#B45309", "QA", "exec · node wstest.mjs · exit 0", C["bluetext"]),
        ("12:03:41", "Scout", "#15803D", "RESEARCH", "web_fetch · docs.openclaw.ai/tailscale", C["bluetext"]),
        ("12:04:19", "Charlie", "#1D4ED8", "BUILD", "EAI_AGAIN · api.deepseek.com (retry 2/3)", C["redtext"]),
        ("12:04:33", "Henry", "#6D28D9", "BUILD", "git commit 8f3a2c1 · wireframes", C["bluetext"]),
    ]
    y = 384
    for tm, agent, col, zone, desc, acol in events:
        s.text(262, y + 6, tm, 11.5, C["faint"], "400", family=MONO)
        bot(s, 336, y - 12, 0.85, col)
        s.text(362, y + 4, agent, 12, C["text"], "600")
        chip(s, 424, y - 9, zone, C["inner"], C["sub"], h=17, fs=9.5)
        s.text(482, y + 4, desc, 12, C["sub"], "400")
        y += 44
    s.line(262, y + 8, 1004, y + 8, C["border2"], 1)
    s.text(262, y + 34, "●  Streaming live", 12, C["greentext"], "600")
    out("08-activity", s)

# ============ 09 HEALTH ============
def screen_health():
    s = Svg()
    sidebar(s, "health")
    topbar(s, "Health")
    header(s, "System Health", "Gateway vitals for your instance — VPS or local.")
    card(s, 244, 128, 780, 92, rx=14)
    dot(s, 280, 176, 10, C["green"])
    s.text(302, 168, "Gateway Running", 18, C["text"], "600")
    s.text(302, 190, "systemd user · pid 91129 · uptime 12d 4h 18m", 12.5, C["sub"], "400")
    chip(s, 700, 160, "AUTH · TOKEN", C["inner"], C["sub"], h=24, fs=11)
    chip(s, 806, 160, "LOOPBACK ONLY", C["inner"], C["sub"], h=24, fs=11)
    chip(s, 930, 160, "TAILSCALE OFF", C["inner"], C["sub"], h=24, fs=11)
    metrics = [
        ("CPU", 23, C["green"], "0.23 · 4 cores", "23%"),
        ("MEMORY", 61, C["orange"], "3.9 / 6.4 GB", "61%"),
        ("DISK", 42, C["green"], "18 / 42 GB", "42%"),
        ("WS LATENCY", 100, C["blue"], "74 ms · loopback", "74ms"),
        ("PROVIDER", 100, C["green"], "deepseek · ok", "ok"),
    ]
    x = 244
    for lab, pct, colr, sub, big in metrics:
        card(s, x, 242, 148, 112, rx=12)
        s.text(x + 12, 264, lab, 11, C["faint"], "600", spacing="0.08em")
        s.text(x + 12, 292, big, 22, C["text"], "600")
        progress(s, x + 12, 304, 124, 6, pct, colr)
        s.text(x + 12, 336, sub, 10.5, C["sub"], "400")
        x += 158
    card(s, 244, 376, 780, 122, rx=14)
    s.text(262, 400, "GATEWAY ACCESS", 11, C["faint"], "600", spacing="0.08em")
    rows = [("WebSocket", "ws://127.0.0.1:18789 (loopback)"), ("Auth mode", "token · rate-limited"),
            ("Version", "stable · node 26.5.1 · linux arm64"), ("Channels", "discord ON")]
    y = 424
    for k, v in rows:
        s.text(262, y, k, 12.5, C["sub"], "400")
        s.text(420, y, v, 12.5, C["text"], "500")
        y += 23
    out("09-health", s)

# ============ 10 SESSIONS ============
def screen_sessions():
    s = Svg()
    sidebar(s, "sessions")
    topbar(s, "Sessions")
    header(s, "Sessions", "Active agent sessions, context pressure, and last activity.")
    card(s, 244, 128, 780, 480, rx=14)
    hx = 244
    for lab, w in [("SESSION", 230), ("AGENT", 130), ("MODEL", 160), ("CONTEXT", 140), ("LAST ACTIVITY", 120)]:
        s.text(hx + 18, 154, lab, 11, C["faint"], "600", spacing="0.08em")
        hx += w
    rows = [
        ("main · discord", "main", C["black"], "deepseek-v4-flash", 42, "1m ago", False),
        ("mission-control · dev", "henry", "#6D28D9", "deepseek-v4-flash", 18, "2m ago", False),
        ("research · wireframes", "main", C["black"], "deepseek-v4-flash", 67, "12m ago", True),
        ("qa · review", "ralph", "#B45309", "zai/glm-5.2", 8, "24m ago", False),
        ("content · launch", "echo", "#A16207", "deepseek-v4-flash", 91, "1h ago", True),
    ]
    y = 180
    for sess, agent, col, model, ctx, last, hot in rows:
        s.line(262, y - 10, 1004, y - 10, C["border2"], 1)
        s.text(262, y + 22, sess, 13, C["text"], "500")
        if hot:
            dot(s, 462, y + 16, 5, C["blue"])
        bot(s, 480, y - 6, 0.8, col)
        s.text(504, y + 22, agent, 12, C["text"], "500")
        s.text(650, y + 22, model, 12, C["sub"], "400", family=MONO)
        progress(s, 830, y + 12, 90, 6, ctx, C["red"] if ctx > 80 else (C["orange"] if ctx > 50 else C["blue"]))
        s.text(930, y + 22, f"{ctx}%", 11.5, C["sub"], "400")
        s.text(955, y + 22, last, 12, C["faint"], "400")
        y += 68
    out("10-sessions", s)

# ============ 11 USAGE & COST ============
def screen_usage():
    s = Svg()
    sidebar(s, "usage")
    topbar(s, "Usage & Cost")
    header(s, "Usage & Cost", "Token spend per provider and model.")
    x = 244
    for lab, on in [("24h", True), ("7d", False), ("30d", False), ("This month", False)]:
        pill_btn(s, x, 128, len(lab) * 8 + 32, 32, lab, fill=C["black"] if on else C["card"],
                 stroke="none" if on else C["border"], tc="#FFFFFF" if on else C["sub"],
                 weight="600" if on else "500")
        x += len(lab) * 8 + 44
    card(s, 244, 176, 780, 98, rx=14)
    s.text(262, 206, "TOTAL ESTIMATED SPEND", 11, C["faint"], "600", spacing="0.08em")
    s.text(262, 240, "$4.82", 30, C["text"], "600")
    s.text(262, 262, "last 24h · 1.2M tokens in · 340K tokens out", 12, C["sub"], "400")
    chip(s, 850, 216, "PEAK WINDOW 01:00–07:00 CT", C["orangebg"], C["orangetext"], h=24, fs=10.5)
    providers = [
        ("deepseek", "DeepSeek", ["deepseek-v4-flash", 1.05, 82, "input 980K · output 260K"], C["blue"]),
        ("zai", "Z.AI (GLM)", ["glm-5.2", 0.31, 15, "input 210K · output 68K"], C["purple"]),
        ("other", "Other / fallback", ["—", 0.12, 3, "input 18K · output 4K"], C["faint"]),
    ]
    x = 244
    for key, name, [model, cost, pct, detail], colr in providers:
        card(s, x, 296, 248, 172, rx=14)
        dot(s, x + 22, 324, 8, colr)
        s.text(x + 38, 329, name, 14.5, C["text"], "600")
        s.text(x + 16, 358, model, 12, C["sub"], "400", family=MONO)
        s.text(x + 16, 390, f"${cost:.2f}", 24, C["text"], "600")
        s.text(x + 16, 410, detail, 11, C["sub"], "400")
        progress(s, x + 16, 424, 216, 6, pct, colr)
        s.text(x + 232, 428, f"{pct}%", 10.5, C["faint"], "400", "end")
        x += 266
    s.text(244, 500, "Peak-pricing alert: DeepSeek charges 2× during 01:00–07:00 CT — cron alerts are already wired.", 12.5, C["sub"], "400")
    out("11-usage", s)

# ============ 12 LOGS ============
def screen_logs():
    s = Svg()
    sidebar(s, "logs")
    topbar(s, "Logs")
    header(s, "Gateway Logs", "Live tail of gateway logs, filterable by level and source.")
    pill_btn(s, 900, 118, 124, 32, "❚❚  Pause", fill=C["card"], stroke=C["border"], tc=C["text"], fs=12.5)
    pill_btn(s, 792, 118, 96, 32, "Export", fill=C["card"], stroke=C["border"], tc=C["text"], fs=12.5)
    x = 244
    for lab, on, colr in [("ALL", True, C["black"]), ("INFO", False, C["blue"]), ("WARN", False, C["orange"]), ("ERROR", False, C["red"])]:
        pill_btn(s, x, 164, 60, 30, lab, fill=C["black"] if on else C["card"],
                 stroke="none" if on else C["border"], tc="#FFFFFF" if on else C["sub"],
                 weight="600" if on else "500")
        x += 72
    search_field(s, x + 10, 164, 300, 30, "Filter by source…")
    card(s, 244, 210, 780, 470, rx=14, fill="#EEF0F3", stroke=C["border"])
    logs = [
        ("20:47:38", "WARN", "[ws] unauthorized conn=46b7… reason=token_missing", C["orange"]),
        ("20:47:38", "INFO", "[ws] closed before connect code=4008 phase=auth", "#3B4149"),
        ("20:48:08", "WARN", "[ws] unauthorized conn=3bd6… reason=token_missing", C["orange"]),
        ("20:48:30", "INFO", "[model-fetch] start provider=deepseek model=deepseek-v4-flash", "#3B4149"),
        ("20:48:30", "INFO", "[model-fetch] response status=200 elapsedMs=698", "#3B4149"),
        ("20:49:08", "ERROR", "[ws] ✗ system-presence missing scope: operator.read", C["red"]),
        ("20:49:09", "INFO", "[model-fetch] start provider=deepseek model=deepseek-v4-flash", "#3B4149"),
        ("20:49:10", "INFO", "[model-fetch] response status=200 elapsedMs=804", "#3B4149"),
    ]
    y = 248
    for tm, lvl, msg, colr in logs:
        s.text(262, y, tm, 12, "#57606B", "400", family=MONO)
        s.text(342, y, lvl, 12, colr, "600", family=MONO)
        s.text(404, y, msg, 12, "#161A1F" if lvl != "ERROR" else C["red"], "400", family=MONO)
        y += 32
    s.text(262, y + 22, "● LIVE TAIL — streaming…", 12, "#157A3C", "600")
    out("12-logs", s)

SCREENS = [screen_overview, screen_tasks, screen_agents, screen_tickets, screen_backlog,
           screen_calendar, screen_approvals, screen_factory, screen_activity, screen_health,
           screen_sessions, screen_usage, screen_logs]

for dark in (False, True):
    THEME = "dark" if dark else "light"
    C.clear()
    C.update(DARK_C if dark else LIGHT_C)
    for fn in SCREENS:
        fn()

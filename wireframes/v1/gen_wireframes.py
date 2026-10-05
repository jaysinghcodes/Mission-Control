#!/usr/bin/env python3
"""Mission Control - Apple-minimal wireframes generator (SVG)."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 820

FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"
MONO = "SF Mono, Menlo, Consolas, monospace"

C = {
    "bg": "#f5f5f7",
    "sidebar": "#ffffff",
    "card": "#ffffff",
    "border": "#e5e5ea",
    "border2": "#d2d2d7",
    "text": "#1d1d1f",
    "sub": "#86868b",
    "faint": "#aeaeb2",
    "blue": "#0071e3",
    "bluebg": "#e8f1fd",
    "green": "#34c759",
    "orange": "#ff9500",
    "red": "#ff3b30",
    "purple": "#af52de",
    "teal": "#5ac8fa",
    "pink": "#ff2d55",
    "yellow": "#ffcc00",
}

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class Svg:
    def __init__(self):
        self.parts = []
    def add(self, s):
        self.parts.append(s)
    def text(self, x, y, s, size=13, fill=C["text"], weight="normal", anchor="start", family=FONT, spacing=None, opacity=1):
        sp = f' letter-spacing="{spacing}"' if spacing else ""
        self.add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" opacity="{opacity}"{sp}>{esc(s)}</text>')
    def rect(self, x, y, w, h, fill="none", rx=0, stroke=None, sw=1, opacity=1):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{st} opacity="{opacity}"/>')
    def circle(self, cx, cy, r, fill="none", stroke=None, sw=1, opacity=1):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"{st} opacity="{opacity}"/>')
    def line(self, x1, y1, x2, y2, stroke=C["border"], sw=1, opacity=1):
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"/>')
    def path(self, d, stroke=C["sub"], sw=1.5, fill="none"):
        self.add(f'<path d="{d}" stroke="{stroke}" stroke-width="{sw}" fill="{fill}" stroke-linecap="round" stroke-linejoin="round"/>')
    def poly(self, pts, stroke=C["sub"], sw=1.5, fill="none"):
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        self.path(d, stroke, sw, fill)

def card(s, x, y, w, h, rx=12, fill=C["card"], stroke=C["border"], shadow=True):
    if shadow:
        s.add(f'<filter id="sd" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.05"/></filter>')
        s.rect(x, y, w, h, rx=rx, fill=fill, stroke=stroke, sw=1)
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="none" filter="url(#sd)"/>')
    else:
        s.rect(x, y, w, h, rx=rx, fill=fill, stroke=stroke, sw=1)

def badge(s, x, y, label, color, text_color="#ffffff", h=20, fs=10.5, weight="600", w=None):
    w = w or (len(label) * 6.2 + 16)
    s.rect(x, y, w, h, rx=h/2, fill=color)
    s.text(x + w/2, y + h/2 + 3.5, label, fs, text_color, weight, "middle")

def dot(s, cx, cy, r, color):
    s.circle(cx, cy, r, fill=color)

def avatar(s, x, y, size, color, initials, tc="#ffffff"):
    s.circle(x + size/2, y + size/2, size/2, fill=color)
    s.text(x + size/2, y + size/2 + size*0.35, initials, size*0.42, tc, "600", "middle")

def progress(s, x, y, w, h, pct, color=C["blue"]):
    s.rect(x, y, w, h, rx=h/2, fill="#e9e9ec")
    s.rect(x, y, max(w*pct/100, h), h, rx=h/2, fill=color)

def pill_btn(s, x, y, w, h, label, fill=C["card"], stroke=C["border2"], tc=C["text"], fs=12.5, weight="500"):
    s.rect(x, y, w, h, rx=h/2, fill=fill, stroke=stroke, sw=1)
    s.text(x + w/2, y + h/2 + 4, label, fs, tc, weight, "middle")

def search_field(s, x, y, w, h=32, placeholder="Search"):
    s.rect(x, y, w, h, rx=h/2, fill="#f5f5f7", stroke=C["border"], sw=1)
    s.circle(x + 16, y + h/2, 4, fill="none", stroke=C["faint"], sw=1.5)
    s.line(x + 19, y + h/2 + 3.5, x + 23, y + h/2 + 7.5, C["faint"], 1.5)
    s.text(x + 32, y + h/2 + 4, placeholder, 12.5, C["faint"], "400")

# ---------- sidebar / topbar ----------
NAV_MAIN = [("tasks", "Tasks"), ("agents", "Agents"), ("calendar", "Calendar"),
            ("pipeline", "Pipeline"), ("approvals", "Approvals")]
NAV_OBS = [("activity", "Live Activity"), ("health", "Health"), ("sessions", "Sessions"),
           ("usage", "Usage & Cost"), ("logs", "Logs")]

def glyph(s, x, y, kind, color=C["sub"], size=16):
    cx, cy = x + size/2, y + size/2
    if kind == "tasks":
        for i in range(3):
            s.line(x + 2.5, y + 4 + i*4.5, x + size - 2.5, y + 4 + i*4.5, color, 1.8)
        s.line(x + 2.5, y + 4, x + 5.5, y + 4, color, 1.8)
        s.line(x + 2.5, y + 8.5, x + 5.5, y + 8.5, color, 1.8)
        s.line(x + 2.5, y + 13, x + 5.5, y + 13, color, 1.8)
    elif kind == "agents":
        s.circle(cx, cy - 3.5, 3.4, fill="none", stroke=color, sw=1.6)
        s.path(f"M{cx-5.5},{cy+6.5} a5.5,5.5 0 0 1 11,0", color, 1.6)
    elif kind == "calendar":
        s.rect(x + 2.5, y + 3, size - 5, size - 5, rx=3, fill="none", stroke=color, sw=1.6)
        s.line(x + 2.5, y + 7.5, x + size - 2.5, y + 7.5, color, 1.6)
        s.line(x + 5.5, y + 1.5, x + 5.5, y + 4.5, color, 1.6)
        s.line(x + size - 5.5, y + 1.5, x + size - 5.5, y + 4.5, color, 1.6)
    elif kind == "pipeline":
        for i, hh in enumerate([6, 12, 9]):
            s.rect(x + 3 + i*4.5, y + size - 3 - hh, 3.2, hh, rx=1, fill=color)
    elif kind == "approvals":
        s.path(f"M{x+2.5},{cy} l3.5,3.5 l7.5,-8", color, 1.8)
    elif kind == "activity":
        pts = [(x+1.5, cy), (x+4, cy), (x+6, cy-5), (x+9, cy+5), (x+11, cy), (x+size-1.5, cy)]
        s.poly(pts, color, 1.7)
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
    s.rect(0, 0, 220, H, fill=C["sidebar"], stroke=C["border"], sw=1)
    # brand
    s.rect(20, 22, 26, 26, rx=7, fill=C["blue"])
    s.text(22, 40, "◈", 15, "#ffffff", "600", "middle")
    s.text(56, 40, "Mission Control", 15, C["text"], "600")
    # nav
    def section(label, items, y):
        s.text(20, y, label, 11, C["faint"], "600", spacing="0.08em")
        y += 14
        for key, lab in items:
            sel = (key == selected)
            if sel:
                s.rect(12, y, 196, 34, rx=8, fill=C["bluebg"])
            s.text(42, y + 22, lab, 13.5, C["blue"] if sel else C["text"], "500" if sel else "400")
            glyph(s, 17, y + 9, key, C["blue"] if sel else C["sub"])
            y += 42
        return y
    y = section("WORKSPACE", NAV_MAIN, 78)
    y = section("OBSERVE", NAV_OBS, y + 16)
    # footer
    s.line(20, H - 92, 200, H - 92, C["border"], 1)
    s.rect(12, H - 76, 196, 40, rx=10, fill="#f5f5f7")
    s.text(24, H - 53, "⚙  Settings", 13, C["text"], "500")
    dot(s, 26, H - 24, 5, C["green"])
    s.text(38, H - 20, "Connected · 74ms", 11.5, C["sub"], "400")
    s.text(120, H - 20, "ws://…:18789", 11.5, C["faint"], "400")

def topbar(s, title):
    s.rect(220, 0, W - 220, 56, fill=C["bg"])
    s.text(244, 35, title, 17, C["text"], "600")
    search_field(s, W - 420, 12, 200)
    dot(s, W - 158, 28, 5, C["green"])
    s.text(W - 148, 32, "Connected", 12, C["sub"], "500")
    s.line(W - 130, 16, W - 130, 40, C["border2"], 1)
    s.text(W - 118, 33, "ws://127.0.0.1:18789", 12, C["sub"], "400")
    s.rect(W - 84, 12, 32, 32, rx=16, fill="#d8d8dd")
    s.text(W - 68, 33, "J", 14, "#ffffff", "600", "middle")

def header(s, title, sub=None):
    s.text(244, 92, title, 20, C["text"], "600")
    if sub:
        s.text(244, 112, sub, 12.5, C["sub"], "400")

def out(name, s):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'font-family="{FONT}">\n' + "\n".join(s.parts) + "\n</svg>")
    with open(os.path.join(OUT, name + ".svg"), "w") as f:
        f.write(svg)
    print("wrote", name)

# ============ 1. TASKS ============
def screen_tasks():
    s = Svg()
    sidebar(s, "tasks")
    topbar(s, "Tasks")
    header(s, "Tasks", "Live ledger of what your agents are running right now.")
    # summary chips
    stats = [("Running", "3", C["blue"]), ("Queued", "2", C["orange"]), ("Completed today", "14", C["green"])]
    x = 244
    for lab, val, col in stats:
        card(s, x, 128, 150, 64, rx=10)
        s.text(x + 14, 152, val, 22, C["text"], "600")
        s.text(x + 14, 174, lab, 11.5, C["sub"], "400")
        dot(s, x + 130, 146, 5, col)
        x += 162
    # list
    lx, ly, lw = 244, 216, 780
    rows = [
        ("Deploy mission-control to staging", "Henry", "#af52de", "running", 62, "12:01:42", "0:42", True),
        ("QA review · wireframes feedback", "Ralph", "#ff9500", "running", 34, "12:03:18", "0:21", True),
        ("Draft content brief for launch", "Quill", "#5ac8fa", "queued", 0, "—", "—", False),
        ("Scan competitor pricing pages", "Scout", "#34c759", "queued", 0, "—", "—", False),
        ("Shipped · README + docs polish", "Codex", "#1d1d1f", "done", 100, "11:24:06", "3:12", False),
        ("Shipped · Discord channel layout", "Pixel", "#ff2d55", "done", 100, "10:58:44", "1:05", False),
    ]
    card(s, lx, ly, lw, 64 + len(rows) * 64, rx=14)
    s.text(lx + 18, ly + 26, "TASK", 10.5, C["faint"], "600", spacing="0.08em")
    s.text(lx + 330, ly + 26, "AGENT", 10.5, C["faint"], "600", spacing="0.08em")
    s.text(lx + 470, ly + 26, "STATUS", 10.5, C["faint"], "600", spacing="0.08em")
    s.text(lx + 590, ly + 26, "STARTED", 10.5, C["faint"], "600", spacing="0.08em")
    s.text(lx + 700, ly + 26, "DURATION", 10.5, C["faint"], "600", spacing="0.08em")
    y = ly + 44
    for name, agent, col, status, pct, started, dur, cancellable in rows:
        s.line(lx + 18, y - 10, lx + lw - 18, y - 10, C["border"], 1)
        s.text(lx + 18, y + 22, name, 13, C["text"], "500")
        if status == "running":
            progress(s, lx + 18, y + 32, 280, 4, pct)
        elif status == "done":
            s.text(lx + 18, y + 34, "✓ Completed", 11.5, C["green"], "500")
        else:
            s.text(lx + 18, y + 34, "Waiting for capacity", 11.5, C["faint"], "400")
        avatar(s, lx + 330, y + 4, 22, col, agent[:2])
        s.text(lx + 360, y + 22, agent, 12.5, C["text"], "500")
        if status == "running":
            badge(s, lx + 470, y + 8, "RUNNING", C["blue"], h=20)
        elif status == "queued":
            badge(s, lx + 470, y + 8, "QUEUED", C["orange"], h=20)
        else:
            badge(s, lx + 470, y + 8, "DONE", "#e9e9ec", text_color=C["sub"], h=20)
        s.text(lx + 590, y + 22, started, 12.5, C["sub"], "400")
        s.text(lx + 700, y + 22, dur, 12.5, C["sub"], "400")
        if cancellable:
            pill_btn(s, lx + lw - 108, y + 6, 90, 26, "Cancel", fill="#fff", stroke="#ffd1cc", tc=C["red"], fs=12)
        y += 64
    out("01-tasks", s)

# ============ 2. AGENTS ============
def screen_agents():
    s = Svg()
    sidebar(s, "agents")
    topbar(s, "Agents")
    header(s, "Agents", "Your team — every configured agent and live sub-agent.")
    # team strip
    card(s, 244, 128, 780, 58, rx=12)
    for i, (lab, val) in enumerate([("TOTAL", "6"), ("WORKING", "2"), ("IDLE", "3"), ("SUB-AGENTS ACTIVE", "4")]):
        x = 244 + 16 + i * 195
        s.text(x, 152, val, 18, C["text"], "600")
        s.text(x, 172, lab, 10.5, C["faint"], "600", spacing="0.08em")
        if i < 3:
            s.line(x + 150, 140, x + 150, 174, C["border"], 1)
    # sections
    def section_agents(title, agents, y):
        s.text(244, y, title, 12, C["faint"], "600", spacing="0.1em")
        y += 16
        x = 244
        for name, role, col, status, task, w in agents:
            card(s, x, y, w, 128, rx=12)
            avatar(s, x + 16, y + 16, 40, col, name[:2])
            dot(s, x + 48, y + 20, 6, C["green"] if status == "Working" else C["faint"])
            s.text(x + 16, y + 74, name, 14, C["text"], "600")
            s.text(x + 16, y + 92, role, 11.5, C["sub"], "400")
            if status == "Working":
                badge(s, x + 16, y + 100, "WORKING", C["blue"], h=18, fs=9.5)
                s.text(x + 16, y + 120, task, 10.5, C["sub"], "400")
            else:
                badge(s, x + 16, y + 100, "IDLE", "#e9e9ec", text_color=C["sub"], h=18, fs=9.5)
            x += w + 14
        return y + 160
    y = section_agents("OPERATIONS", [
        ("Henry", "Build / Orchestrator", "#af52de", "Working", "Deploy mission-control", 248),
        ("Ralph", "QA Manager", "#ff9500", "Working", "Review wireframes PR", 248),
        ("Charlie", "Infrastructure Engineer", "#1d1d1f", "Idle", "", 248),
    ], 206)
    y = section_agents("INPUT SIGNAL / OUTPUT ACTION", [
        ("Scout", "Trend Analyst", "#34c759", "Idle", "", 180),
        ("Quill", "Content Writer", "#5ac8fa", "Idle", "", 180),
        ("Pixel", "Thumbnail Designer", "#ff2d55", "Idle", "", 180),
        ("Echo", "Social Media Manager", "#ffcc00", "Idle", "", 180),
    ], y)
    y = section_agents("META LAYER", [
        ("Codex", "Docs & Memory", "#0071e3", "Idle", "", 248),
        ("Violet", "Strategy Advisor", "#af52de", "Idle", "", 248),
    ], y)
    out("02-agents", s)

# ============ 3. CALENDAR ============
def screen_calendar():
    s = Svg()
    sidebar(s, "calendar")
    topbar(s, "Calendar")
    header(s, "Scheduled Tasks", "Cron jobs and recurring routines, weekly view.")
    # always running strip
    card(s, 244, 128, 780, 54, rx=12)
    s.text(262, 147, "ALWAYS RUNNING", 10.5, C["faint"], "600", spacing="0.08em")
    x = 262
    for lab in ["Playbook Scanner", "Opportunity Scanner", "Competitor Scanner", "Reaction Poller"]:
        pill_btn(s, x, 138, len(lab) * 6.6 + 30, 28, lab, fill="#f0f7f1", stroke="#cfe8d4", tc=C["green"], fs=11.5)
        x += len(lab) * 6.6 + 42
    # month nav
    s.text(500, 124, "‹", 22, C["sub"], "400")
    s.text(750, 124, "August 2026", 15, C["text"], "600")
    s.text(985, 124, "›", 22, C["sub"], "400")
    # week grid
    gx, gy, gw, gh = 244, 200, 780, 420
    card(s, gx, gy, gw, gh, rx=14)
    days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    colw = gw / 7
    for i, d in enumerate(days):
        s.text(gx + colw * i + 14, gy + 24, d, 10.5, C["faint"], "600", spacing="0.08em")
        if i > 0:
            s.line(gx + colw * i, gy + 12, gx + colw * i, gy + gh - 12, C["border"], 1)
    # event blocks (x: col, y: row of ~45px slots)
    events = [
        (1, 0.9, 0.62, "Morning Brief", C["yellow"], "6:30a"),
        (1, 2.4, 0.5, "Poller", "#d8d8dd", "11:00a"),
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
        s.rect(x, y, colw - 16, h, rx=8, fill=colr, opacity=0.92)
        s.text(x + 10, y + 20, lab, 10.5, "#1d1d1f" if colr == C["yellow"] else "#ffffff", "600")
        s.text(x + 10, y + 36, tm, 10.5, "#1d1d1f" if colr == C["yellow"] else "rgba(255,255,255,0.85)", "400")
    # footer chips
    fx = 244
    for lab, colr in [("Morning Brief", C["yellow"]), ("Trend Radar", C["orange"]), ("Scout Scan", C["green"]),
                      ("Quill Writer", C["teal"]), ("Weekly Review", C["blue"]), ("YouTube", C["red"])]:
        s.circle(fx + 6, 646, 5, fill=colr)
        s.text(fx + 16, 650, lab, 11.5, C["sub"], "400")
        fx += len(lab) * 7.2 + 36
    out("03-calendar", s)

# ============ 4. PIPELINE ============
def screen_pipeline():
    s = Svg()
    sidebar(s, "pipeline")
    topbar(s, "Pipeline")
    header(s, "Pipeline", "Sub-agent work flowing through build → QA → review → ship.")
    cols = [
        ("BREAK ROOM", [("Scout", "Trend report draft", "#34c759", "Idle")]),
        ("BUILD", [("Henry", "Mission Control scaffold", "#af52de", "run"), ("Charlie", "Deploy pipeline", "#1d1d1f", "run")]),
        ("QA", [("Ralph", "Wireframes review", "#ff9500", "run"), ("Codex", "Docs lint", "#0071e3", "wait")]),
        ("REVIEW", [("Violet", "Strategy check", "#af52de", "wait")]),
        ("SHIP", [("Pixel", "OG images", "#ff2d55", "done"), ("Echo", "Announcement draft", "#ffcc00", "done")]),
    ]
    cw, gap = 148, 10
    x0 = 244
    for ci, (title, items) in enumerate(cols):
        x = x0 + ci * (cw + gap)
        card(s, x, 128, cw, 436, rx=12)
        s.text(x + 12, 150, title, 10.5, C["faint"], "600", spacing="0.08em")
        s.text(x + cw - 12, 150, str(len(items)), 10.5, C["sub"], "600", "end")
        yy = 168
        for name, task, col, st in items:
            card(s, x + 8, yy, cw - 16, 74, rx=10)
            avatar(s, x + 16, yy + 10, 22, col, name[:2])
            s.text(x + 44, yy + 24, name, 12, C["text"], "600")
            s.text(x + 16, yy + 50, task, 10.5, C["sub"], "400")
            dot(s, x + cw - 26, yy + 20, 5, C["blue"] if st == "run" else (C["green"] if st == "done" else C["faint"]))
            yy += 86
        if ci < len(cols) - 1:
            s.text(x + cw + 1, 330, "›", 18, C["faint"], "400")
    # metrics
    m = [("SHIPPED TODAY", "3", C["green"]), ("IN PROGRESS", "4", C["blue"]), ("BACKLOG", "8", C["orange"]),
         ("BLOCKED", "1", C["red"]), ("AVG PIPELINE TIME", "4h 12m", C["purple"])]
    x = 244
    for lab, val, colr in m:
        card(s, x, 584, 148, 66, rx=10)
        s.text(x + 12, 610, val, 20, C["text"], "600")
        s.text(x + 12, 632, lab, 9.5, C["faint"], "600", spacing="0.06em")
        dot(s, x + 128, 604, 5, colr)
        x += 158
    out("04-pipeline", s)

# ============ 5. APPROVALS ============
def screen_approvals():
    s = Svg()
    sidebar(s, "approvals")
    topbar(s, "Approvals")
    header(s, "Approvals", "Everything waiting on you — approve or reject in one click.")
    # filter chips
    x = 244
    for lab, on in [("All", True), ("Exec", False), ("Pairing", False), ("Messages", False), ("Sessions", False)]:
        pill_btn(s, x, 128, len(lab) * 8 + 32, 30, lab, fill=C["bluebg"] if on else C["card"],
                 stroke="none" if on else C["border2"], tc=C["blue"] if on else C["sub"],
                 weight="600" if on else "500")
        x += len(lab) * 8 + 44
    rows = [
        ("exec", "Exec · gateway", "Henry wants to run: apt install nginx on gateway", "2 min ago", C["red"]),
        ("pair", "Device pairing", "New device: iPhone (Operator iPhone 15) requests operator access", "11 min ago", C["blue"]),
        ("msg", "Message · discord", "Echo wants to post launch announcement in #announcements", "24 min ago", C["purple"]),
        ("exec", "Exec · sandbox", "Scout wants to run: npm install in /tmp/scan", "1 hr ago", C["red"]),
        ("sess", "Session fork", "Ralph wants to fork session 'wireframes' into 'wireframes-v2'", "2 hrs ago", C["teal"]),
    ]
    ly = 178
    card(s, 244, ly, 780, 14 + len(rows) * 92, rx=14)
    y = ly + 36
    for kind, tag, desc, ago, colr in rows:
        s.rect(262, y, 34, 34, rx=9, fill=C["bluebg"] if kind == "pair" else ("#fdeceb" if kind == "exec" else ("#f5ecfb" if kind == "msg" else "#eaf6fb")))
        if kind == "exec":
            s.text(276, y + 22, "›_", 13, C["red"], "600")
        elif kind == "pair":
            s.text(278, y + 22, "⧉", 14, C["blue"], "600")
        elif kind == "msg":
            s.text(277, y + 22, "✉", 13, C["purple"], "600")
        else:
            s.text(277, y + 22, "⑂", 14, C["teal"], "600")
        s.text(312, y + 14, tag, 10.5, colr, "600", spacing="0.06em")
        s.text(312, y + 32, desc, 12.5, C["text"], "500")
        s.text(850, y + 14, ago, 11, C["faint"], "400", "end")
        pill_btn(s, 828, y + 24, 76, 28, "Approve", fill=C["green"], stroke="none", tc="#ffffff", fs=12, weight="600")
        pill_btn(s, 912, y + 24, 76, 28, "Reject", fill="#ffffff", stroke="#ffd1cc", tc=C["red"], fs=12, weight="500")
        if rows.index((kind, tag, desc, ago, colr)) < len(rows) - 1:
            s.line(262, y + 56, 1004, y + 56, C["border"], 1)
        y += 92
    out("05-approvals", s)

# ============ 6. LIVE ACTIVITY ============
def screen_activity():
    s = Svg()
    sidebar(s, "activity")
    topbar(s, "Live Activity")
    header(s, "Live Activity", "Real-time stream of what agents are doing, as it happens.")
    pill_btn(s, 900, 118, 124, 30, "❚❚  Pause", fill="#ffffff", stroke=C["border2"], tc=C["text"], fs=12)
    # filters
    x = 244
    for lab, on in [("All events", True), ("Tool calls", False), ("Messages", False), ("Errors", False)]:
        pill_btn(s, x, 164, len(lab) * 8 + 30, 28, lab, fill=C["bluebg"] if on else C["card"],
                 stroke="none" if on else C["border2"], tc=C["blue"] if on else C["sub"],
                 weight="600" if on else "500")
        x += len(lab) * 8 + 42
    card(s, 244, 210, 780, 470, rx=14)
    events = [
        ("12:01:42", "Henry", "#af52de", "tool", "web_search", "openclaw gateway dashboard token auth", C["blue"]),
        ("12:02:03", "Ralph", "#ff9500", "tool", "read", "wireframes/gen_wireframes.py", C["blue"]),
        ("12:02:14", "Henry", "#af52de", "msg", "—", "Deployment started — build #42", C["purple"]),
        ("12:03:18", "Ralph", "#ff9500", "tool", "exec", "node wstest.mjs · exit 0", C["blue"]),
        ("12:03:41", "Scout", "#34c759", "tool", "web_fetch", "https://docs.openclaw.ai/gateway/tailscale", C["blue"]),
        ("12:04:02", "Echo", "#ffcc00", "msg", "—", "Draft announcement ready for approval", C["purple"]),
        ("12:04:19", "Charlie", "#1d1d1f", "err", "exec", "EAI_AGAIN · api.deepseek.com unreachable (retry 2/3)", C["red"]),
        ("12:04:33", "Henry", "#af52de", "tool", "git", "commit 8f3a2c1 · wireframes + design system", C["blue"]),
    ]
    y = 244
    for tm, agent, col, kind, op, desc, acol in events:
        s.text(262, y + 6, tm, 11.5, C["faint"], "400", family=MONO)
        avatar(s, 330, y - 12, 24, col, agent[:2])
        if kind == "err":
            s.circle(398, y, 5, fill=C["red"])
        elif kind == "msg":
            s.circle(398, y, 5, fill=C["purple"])
        else:
            s.circle(398, y, 5, fill=C["blue"])
        s.text(412, y + 4, agent, 12.5, C["text"], "600")
        s.text(470, y + 4, op, 12, acol, "600", family=MONO)
        s.text(570, y + 4, desc, 12, C["sub"], "400")
        y += 48
    s.line(262, y + 10, 1004, y + 10, C["border"], 1)
    s.text(262, y + 34, "Streaming live — events appear here", 11.5, C["faint"], "400")
    out("06-activity", s)

# ============ 7. HEALTH ============
def screen_health():
    s = Svg()
    sidebar(s, "health")
    topbar(s, "Health")
    header(s, "System Health", "Gateway vitals for your instance — VPS or local.")
    # main status
    card(s, 244, 128, 780, 90, rx=14)
    s.circle(280, 174, 10, fill=C["green"])
    s.text(302, 166, "Gateway Running", 17, C["text"], "600")
    s.text(302, 188, "systemd user · pid 91129 · uptime 12d 4h 18m", 12, C["sub"], "400")
    badge(s, 700, 158, "AUTH · TOKEN", C["bluebg"], text_color=C["blue"], h=22, fs=10.5)
    badge(s, 806, 158, "LOOPBACK ONLY", "#e9e9ec", text_color=C["sub"], h=22, fs=10.5)
    badge(s, 930, 158, "TAILSCALE OFF", "#e9e9ec", text_color=C["sub"], h=22, fs=10.5)
    # metrics
    metrics = [
        ("CPU", 23, C["green"], "0.23 · 4 cores"),
        ("MEMORY", 61, C["orange"], "3.9 / 6.4 GB"),
        ("DISK", 42, C["green"], "18 / 42 GB"),
        ("WS LATENCY", 100, C["blue"], "74 ms · loopback"),
        ("PROVIDER", 100, C["green"], "deepseek · ok"),
    ]
    x = 244
    for lab, pct, colr, sub in metrics:
        card(s, x, 240, 148, 110, rx=12)
        s.text(x + 12, 262, lab, 10.5, C["faint"], "600", spacing="0.08em")
        s.text(x + 12, 288, f"{pct}%", 20, C["text"], "600")
        progress(s, x + 12, 300, 124, 5, pct, colr)
        s.text(x + 12, 332, sub, 10, C["sub"], "400")
        x += 158
    # connection card
    card(s, 244, 372, 780, 120, rx=14)
    s.text(262, 396, "GATEWAY ACCESS", 10.5, C["faint"], "600", spacing="0.08em")
    rows = [("WebSocket", "ws://127.0.0.1:18789 (loopback)"), ("Auth mode", "token · rate-limited"),
            ("Version", "stable · node 26.5.1 · linux arm64"), ("Channels", "discord ON")]
    y = 418
    for k, v in rows:
        s.text(262, y, k, 12, C["sub"], "400")
        s.text(420, y, v, 12, C["text"], "500")
        y += 22
    out("07-health", s)

# ============ 8. SESSIONS ============
def screen_sessions():
    s = Svg()
    sidebar(s, "sessions")
    topbar(s, "Sessions")
    header(s, "Sessions", "Active agent sessions, context pressure, and last activity.")
    card(s, 244, 128, 780, 480, rx=14)
    hx = 244
    for lab, w in [("SESSION", 230), ("AGENT", 130), ("MODEL", 160), ("CONTEXT", 140), ("LAST ACTIVITY", 120)]:
        s.text(hx + 18, 152, lab, 10.5, C["faint"], "600", spacing="0.08em")
        hx += w
    rows = [
        ("main · discord", "main", "#0071e3", "deepseek-v4-flash", 42, "1m ago", False),
        ("mission-control · dev", "henry", "#af52de", "deepseek-v4-flash", 18, "2m ago", False),
        ("research · wireframes", "main", "#0071e3", "deepseek-v4-flash", 67, "12m ago", True),
        ("qa · review", "ralph", "#ff9500", "zai/glm-5.2", 8, "24m ago", False),
        ("content · launch", "echo", "#ffcc00", "deepseek-v4-flash", 91, "1h ago", True),
    ]
    y = 178
    for sess, agent, col, model, ctx, last, hot in rows:
        s.line(262, y - 10, 1004, y - 10, C["border"], 1)
        s.text(262, y + 22, sess, 12.5, C["text"], "500")
        if hot:
            dot(s, 462, y + 16, 5, C["blue"])
        avatar(s, 480, y + 4, 22, col, agent[:2])
        s.text(510, y + 22, agent, 12, C["text"], "500")
        s.text(650, y + 22, model, 11.5, C["sub"], "400", family=MONO)
        progress(s, 830, y + 12, 90, 5, ctx, C["red"] if ctx > 80 else (C["orange"] if ctx > 50 else C["blue"]))
        s.text(930, y + 22, f"{ctx}%", 11, C["sub"], "400")
        s.text(955, y + 22, last, 11.5, C["faint"], "400")
        y += 66
    out("08-sessions", s)

# ============ 9. USAGE & COST ============
def screen_usage():
    s = Svg()
    sidebar(s, "usage")
    topbar(s, "Usage & Cost")
    header(s, "Usage & Cost", "Token spend per provider and model.")
    # time range
    x = 244
    for lab, on in [("24h", True), ("7d", False), ("30d", False), ("This month", False)]:
        pill_btn(s, x, 128, len(lab) * 8 + 30, 30, lab, fill=C["bluebg"] if on else C["card"],
                 stroke="none" if on else C["border2"], tc=C["blue"] if on else C["sub"],
                 weight="600" if on else "500")
        x += len(lab) * 8 + 42
    # total
    card(s, 244, 176, 780, 96, rx=14)
    s.text(262, 204, "TOTAL ESTIMATED SPEND", 10.5, C["faint"], "600", spacing="0.08em")
    s.text(262, 236, "$4.82", 30, C["text"], "600")
    s.text(262, 258, "last 24h · 1.2M tokens in · 340K tokens out", 11.5, C["sub"], "400")
    badge(s, 850, 214, "PEAK WINDOW 01:00–07:00 CT", C["orange"], h=22, fs=10)
    # provider cards
    providers = [
        ("deepseek", "DeepSeek", ["deepseek-v4-flash", 1.05, 82, "input 980K · output 260K"], C["blue"]),
        ("zai", "Z.AI (GLM)", ["glm-5.2", 0.31, 15, "input 210K · output 68K"], C["purple"]),
        ("other", "Other / fallback", ["—", 0.12, 3, "input 18K · output 4K"], C["faint"]),
    ]
    x = 244
    for key, name, [model, cost, pct, detail], colr in providers:
        card(s, x, 294, 248, 170, rx=14)
        dot(s, x + 22, 322, 8, colr)
        s.text(x + 38, 327, name, 14, C["text"], "600")
        s.text(x + 16, 356, model, 11.5, C["sub"], "400", family=MONO)
        s.text(x + 16, 386, f"${cost:.2f}", 22, C["text"], "600")
        s.text(x + 16, 406, detail, 10.5, C["sub"], "400")
        progress(s, x + 16, 420, 216, 6, pct, colr)
        s.text(x + 232, 424, f"{pct}%", 10, C["faint"], "400", "end")
        x += 266
    # note
    s.text(244, 496, "Peak-pricing alert: DeepSeek charges 2× during 01:00–07:00 CT — cron alerts are already wired.", 12, C["sub"], "400")
    out("09-usage", s)

# ============ 10. LOGS ============
def screen_logs():
    s = Svg()
    sidebar(s, "logs")
    topbar(s, "Logs")
    header(s, "Gateway Logs", "Live tail of gateway logs, filterable by level and source.")
    pill_btn(s, 900, 118, 124, 30, "❚❚  Pause", fill="#ffffff", stroke=C["border2"], tc=C["text"], fs=12)
    pill_btn(s, 792, 118, 96, 30, "Export", fill="#ffffff", stroke=C["border2"], tc=C["text"], fs=12)
    # level chips
    x = 244
    for lab, on, colr in [("ALL", True, C["blue"]), ("INFO", False, C["blue"]), ("WARN", False, C["orange"]), ("ERROR", False, C["red"])]:
        pill_btn(s, x, 164, 58, 28, lab, fill=C["bluebg"] if on else C["card"],
                 stroke="none" if on else C["border2"], tc=C["blue"] if on else C["sub"],
                 weight="600" if on else "500")
        x += 70
    search_field(s, x + 10, 164, 300, 28, "Filter by source…")
    card(s, 244, 210, 780, 470, rx=14, fill="#1d1d1f", stroke="#000000")
    logs = [
        ("20:47:38", "WARN", "[ws] unauthorized conn=46b7… reason=token_missing", C["orange"]),
        ("20:47:38", "INFO", "[ws] closed before connect code=4008 phase=auth", C["faint"]),
        ("20:48:08", "WARN", "[ws] unauthorized conn=3bd6… reason=token_missing", C["orange"]),
        ("20:48:30", "INFO", "[model-fetch] start provider=deepseek model=deepseek-v4-flash", C["faint"]),
        ("20:48:30", "INFO", "[model-fetch] response status=200 elapsedMs=698", C["faint"]),
        ("20:49:08", "ERROR", "[ws] ✗ system-presence missing scope: operator.read", C["red"]),
        ("20:49:09", "INFO", "[model-fetch] start provider=deepseek model=deepseek-v4-flash", C["faint"]),
        ("20:49:10", "INFO", "[model-fetch] response status=200 elapsedMs=804", C["faint"]),
    ]
    y = 246
    for tm, lvl, msg, colr in logs:
        s.text(262, y, tm, 11.5, "#6e6e73", "400", family=MONO)
        s.text(340, y, lvl, 11.5, colr, "600", family=MONO)
        s.text(400, y, msg, 11.5, "#e5e5ea" if lvl != "ERROR" else C["red"], "400", family=MONO)
        y += 30
    s.text(262, y + 20, "● LIVE TAIL — streaming…", 11, C["green"], "600")
    out("10-logs", s)

# ============ 0. SHELL / OVERVIEW ============
def screen_shell():
    s = Svg()
    sidebar(s, "tasks")
    topbar(s, "Mission Control")
    s.text(244, 92, "Good evening", 22, C["text"], "600")
    s.text(244, 114, "Here's what your agents are up to.", 13, C["sub"], "400")
    # hero strip
    card(s, 244, 136, 780, 84, rx=14)
    avatar(s, 268, 156, 44, "#af52de", "He")
    s.text(330, 176, "Henry · Build", 14.5, C["text"], "600")
    s.text(330, 196, "Deploying mission-control to staging — 62%", 12, C["sub"], "400")
    progress(s, 330, 206, 400, 5, 62)
    pill_btn(s, 900, 168, 104, 30, "View tasks", fill=C["blue"], stroke="none", tc="#ffffff", fs=12, weight="600")
    # cards row
    cards = [
        ("ACTIVE TASKS", "3", "running right now", C["blue"]),
        ("PENDING APPROVALS", "5", "waiting on you", C["orange"]),
        ("SHIPPED TODAY", "14", "across 4 agents", C["green"]),
        ("SPEND · 24H", "$4.82", "deepseek + glm", C["purple"]),
    ]
    x = 244
    for lab, val, sub, colr in cards:
        card(s, x, 240, 186, 110, rx=14)
        s.text(x + 14, 264, lab, 10, C["faint"], "600", spacing="0.08em")
        s.text(x + 14, 294, val, 24, C["text"], "600")
        s.text(x + 14, 314, sub, 10.5, C["sub"], "400")
        dot(s, x + 166, 260, 6, colr)
        x += 198
    # two panels
    card(s, 244, 372, 380, 320, rx=14)
    s.text(262, 398, "LIVE ACTIVITY", 10.5, C["faint"], "600", spacing="0.08em")
    acts = [("Henry", "#af52de", "web_search · openclaw auth"), ("Ralph", "#ff9500", "read · gen_wireframes.py"),
            ("Scout", "#34c759", "web_fetch · docs/tailscale"), ("Echo", "#ffcc00", "draft announcement")]
    y = 424
    for name, col, act in acts:
        avatar(s, 262, y - 10, 22, col, name[:2])
        s.text(296, y + 4, name, 12, C["text"], "600")
        s.text(352, y + 4, act, 11.5, C["sub"], "400")
        y += 52
    s.text(262, y + 8, "…streaming", 11, C["faint"], "400")
    card(s, 644, 372, 380, 320, rx=14)
    s.text(662, 398, "APPROVALS NEEDED", 10.5, C["faint"], "600", spacing="0.08em")
    apps = [("Henry · apt install nginx", C["red"]), ("iPhone pairing request", C["blue"]),
            ("Echo · launch announcement", C["purple"]), ("Ralph · session fork", C["teal"])]
    y = 424
    for desc, colr in apps:
        s.circle(672, y, 5, fill=colr)
        s.text(688, y + 4, desc, 12, C["text"], "500")
        pill_btn(s, 900, y - 12, 104, 26, "Review", fill=C["bluebg"], stroke="none", tc=C["blue"], fs=11.5, weight="600")
        y += 52
    out("00-shell", s)

for fn in [screen_shell, screen_tasks, screen_agents, screen_calendar, screen_pipeline,
           screen_approvals, screen_activity, screen_health, screen_sessions, screen_usage, screen_logs]:
    fn()

import { Kit, ROLE, X0, Y0, WW, WH, CX } from "./kit.tsx";
// Port of the approved office-apple.tsx onto the shared kit (identical layout, themeable).
export default function draw(k: Kit) {
  const t = k.t;
  k.shell({ active: "Office", title: "Office", summary: "12 agents · 8 working · 1 needs you" });
  const segX = CX + 400, segs = ["All working", "Gather", "Meeting", "Break"];
  k.seg(segX, Y0 + 30, segs, 0, 100);
  k.search(X0 + WW - 250, Y0 + 30, 160);
  k.R(X0 + WW - 78, Y0 + 30, 52, 32, t.ctl, 9); k.T(X0 + WW - 52, Y0 + 51, "❚❚", 11, t.text, 600, "middle");

  const FX = CX + 24, FY = Y0 + 92, FW = 1000, FH = WH - 116;
  k.R(FX, FY, FW, FH, t.canvas, 18);
  const zones: [string, string, string][] = [["Build", t.blue, "2 in progress"], ["QA", t.orange, "1 testing"], ["Ship", t.green, "1 ready"], ["Deploy", t.teal, "Idle"]];
  const ZW = (FW - 40 - 3 * 16) / 4, ZY = FY + 20, ZH = 470;
  zones.forEach(([z, c, sub], i) => {
    const x = FX + 20 + i * (ZW + 16);
    k.card(x, ZY, ZW, ZH, 16);
    k.dot(x + 22, ZY + 28, 5, c);
    k.T(x + 36, ZY + 33, z, 15, t.text, 600);
    k.T(x + ZW - 18, ZY + 33, sub, 12, t.sub, 500, "end");
  });
  const desk = (x: number, y: number, w: number) => {
    k.R(x, y, w, 10, t.deskTop, 5);
    k.R(x + w / 2 - 26, y - 34, 52, 32, t.monitor, 5);
    k.R(x + w / 2 - 23, y - 31, 46, 26, t.screen, 3);
    k.raw(`<rect x="${x + w / 2 - 19}" y="${y - 26}" width="24" height="3" rx="1.5" fill="#0a84ff" opacity="0.9"/><rect x="${x + w / 2 - 19}" y="${y - 20}" width="34" height="3" rx="1.5" fill="#636366"/><rect x="${x + w / 2 - 19}" y="${y - 14}" width="18" height="3" rx="1.5" fill="#636366"/>`);
    k.R(x + w / 2 - 3, y - 2, 6, 4, t.stand, 1);
  };
  const crew: [number, any, number, number, any, string][] = [
    [2, "Forge", 0, 0, "working", "Ticket 4 · Projects"], [5, "Pixel", 0, 1, "working", "Office mock"],
    [3, "Sentinel", 1, 0, "working", "QA-4 on fresh clone"], [9, "Aegis", 1, 1, "blocked", "Needs approval"],
    [8, "Quill", 2, 0, "working", "Release notes"], [1, "Atlas", 2, 1, "idle", "Spec locked"],
    [6, "Bolt", 3, 0, "idle", "Waiting on Ship"], [7, "Ledger", 3, 1, "idle", "Nightly sync"],
  ];
  crew.forEach(([slot, name, zi, row, st, task]) => {
    const zx = FX + 20 + zi * (ZW + 16);
    const cx = zx + ZW / 2, y = ZY + 64 + row * 200;
    k.bot(slot, 84, cx - 42, y, st);
    desk(zx + 30, y + 118, ZW - 60);
    k.agent(cx, y + 152, name, 13.5, "middle");
    k.T(cx, y + 170, task, 12, st === "blocked" ? t.red : t.sub, 500, "middle");
  });
  const LY = ZY + ZH + 18, LH = FY + FH - LY - 20;
  k.card(FX + 20, LY, FW - 40, LH, 16);
  k.T(FX + 42, LY + 33, "Commons", 15, t.text, 600); k.T(FX + FW - 38, LY + 33, "Build council · 4 agents", 12, t.sub, 500, "end");
  const TX = FX + FW / 2, TY = LY + LH / 2 + 50;
  k.R(TX - 230, TY - 22, 460, 44, t.fill, 22);
  k.T(TX, TY + 5, "Planning ticket 5", 12, t.sub, 500, "middle");
  ([[0, "Speedy", -180], [4, "Echo", -60], [11, "Scout", 60], [10, "Patch", 180]] as [number, string, number][]).forEach(([slot, name, dx]) => {
    k.bot(slot, 76, TX + dx - 38, TY - 146, "working");
    k.T(TX + dx, TY - 50, name, 12, t.text, 600, "middle");
    k.T(TX + dx, TY - 35, ROLE[name as keyof typeof ROLE], 11, t.sub, 500, "middle");
  });
  const plant = (x: number, y: number) => { k.raw(`<ellipse cx="${x}" cy="${y}" rx="18" ry="22" fill="#34c759" opacity="0.85"/><ellipse cx="${x + 10}" cy="${y + 4}" rx="11" ry="15" fill="#30b350"/>`); k.R(x - 13, y + 16, 26, 22, t.pot, 6); };
  plant(FX + 70, TY - 6); plant(FX + FW - 72, TY - 6);

  const AX = FX + FW + 20, AW = X0 + WW - AX - 24;
  k.T(AX, FY + 18, "Activity", 15, t.text, 600);
  k.T(AX + AW, FY + 18, "Live", 12, t.green, 600, "end");
  const acts: [number, any, string, string][] = [
    [2, "Forge", "Opened PR #25 · Projects", "2m"], [3, "Sentinel", "Running QA-4", "4m"],
    [1, "Atlas", "Locked ticket 5 spec", "11m"], [0, "Speedy", "Merged #24 to main", "18m"],
    [9, "Aegis", "Needs your approval", "22m"], [11, "Scout", "Checked OpenClaw changes", "1h"],
  ];
  k.R(AX, FY + 34, AW, 6 * 62 + 8, t.inset, 14);
  acts.forEach(([slot, who, what, tm], i) => {
    const y = FY + 44 + i * 62;
    k.bot(slot, 38, AX + 12, y + 4);
    k.agent(AX + 60, y + 22, who, 13); k.T(AX + AW - 14, y + 22, tm, 11, t.sub, 500, "end");
    k.T(AX + 60, y + 40, what, 12, i === 4 ? t.red : t.sub2, 500);
    if (i < 5) k.line(AX + 60, y + 56, AX + AW - 12, y + 56);
  });
  const PY = FY + 34 + 6 * 62 + 40;
  k.T(AX, PY, "Pipeline", 15, t.text, 600);
  k.R(AX, PY + 16, AW, 4 * 44 + 8, t.inset, 14);
  zones.forEach(([z, c], i) => { const y = PY + 24 + i * 44; k.dot(AX + 20, y + 20, 5, c); k.T(AX + 36, y + 25, z, 13, t.text, 500); k.T(AX + AW - 16, y + 25, ["2", "1", "1", "0"][i], 13, t.sub2, 600, "end"); if (i < 3) k.line(AX + 36, y + 42, AX + AW - 12, y + 42); });
}

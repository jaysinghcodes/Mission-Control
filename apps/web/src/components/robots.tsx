/**
 * robots.tsx — a roster of 12 hand-tuned cartoon robot avatars for Mission Control.
 *
 * Original artwork, pure inline SVG, no external assets. MIT License.
 *
 * Every robot is assembled from a small parts system:
 *   head shape × face × body × locomotion × arms × accessories × color
 * and drawn in a flat-vector style: thick navy outlines, flat fills, one white highlight.
 *
 * Dark-mode treatment: a light "sticker" halo (an SVG dilate filter tinted from the robot's
 * own color) keeps the navy outline readable on near-black backgrounds. Pass `tile` to sit
 * the robot on a rounded, color-tinted card instead (best at 24–32px).
 */
import { useId } from "react";
import type { CSSProperties, ReactElement } from "react";

/* ---------------------------------------------------------------- types */

export type HeadShape = "monitor" | "boxy" | "capsule" | "orb" | "dome" | "tv" | "pill";
export type Face = "smile" | "grill" | "visor" | "cyclops" | "happy" | "pixel" | "slit" | "lenses" | "wink";
export type BodyShape = "box" | "barrel" | "dome" | "egg" | "shield" | "neck";
export type Panel = "buttons" | "vents" | "chart" | "emblem" | "dial" | "none";
export type Loco = "treads" | "wheels" | "legs" | "pogo" | "spider" | "hover" | "unicycle";
export type Arms = "claws" | "pincers" | "noodle" | "stubby" | "wave" | "none";
export type Accessory =
  | "beacon" | "siren" | "antenna" | "twin" | "coil" | "star" | "propeller"
  | "dish" | "headset" | "bolts" | "hardhat";
export type RobotStatus = "working" | "idle" | "blocked" | "offline";

export interface RobotSpec {
  role: string;
  color: string; // the robot's own saturated color
  accent: string; // lights, buttons, antenna balls
  head: { shape: HeadShape; w: number; h: number; screen?: "light" | "dark" };
  face: Face;
  body: { shape: BodyShape; w: number; h: number; panel?: Panel };
  neck?: number; // gap between head and body, filled with a striped neck
  loco: Loco;
  arms: Arms;
  acc: Accessory[];
}

/* ---------------------------------------------------------------- roster */

// 12 hand-tuned robots. No two share head+locomotion+color (checked by the render script).
export const ROSTER: RobotSpec[] = [
  { role: "Chief of Staff", color: "#8d5bff", accent: "#ffd23f",
    head: { shape: "boxy", w: 44, h: 34 }, face: "grill",
    body: { shape: "box", w: 46, h: 27, panel: "buttons" }, neck: 4,
    loco: "treads", arms: "claws", acc: ["beacon", "bolts"] },
  { role: "Product", color: "#ffc531", accent: "#ff5a5f",
    head: { shape: "capsule", w: 40, h: 40 }, face: "smile",
    body: { shape: "barrel", w: 36, h: 27, panel: "dial" },
    loco: "unicycle", arms: "wave", acc: ["antenna"] },
  { role: "Engineer", color: "#9bd434", accent: "#36b3f5",
    head: { shape: "monitor", w: 50, h: 42, screen: "dark" }, face: "pixel",
    body: { shape: "neck", w: 10, h: 10 },
    loco: "pogo", arms: "pincers", acc: ["coil"] },
  { role: "QA", color: "#36b3f5", accent: "#ffd23f",
    head: { shape: "orb", w: 40, h: 40 }, face: "cyclops",
    body: { shape: "dome", w: 48, h: 26, panel: "buttons" }, neck: 4,
    loco: "wheels", arms: "noodle", acc: ["twin"] },
  { role: "Research", color: "#19c4b4", accent: "#ff8a2b",
    head: { shape: "dome", w: 50, h: 32 }, face: "visor",
    body: { shape: "egg", w: 44, h: 24, panel: "vents" },
    loco: "spider", arms: "none", acc: ["dish"] },
  { role: "Designer", color: "#ff5fa6", accent: "#ffd23f",
    head: { shape: "orb", w: 42, h: 42 }, face: "happy",
    body: { shape: "egg", w: 34, h: 26, panel: "none" },
    loco: "hover", arms: "stubby", acc: ["star"] },
  { role: "Ops", color: "#ff8a2b", accent: "#ffd23f",
    head: { shape: "tv", w: 48, h: 32 }, face: "grill",
    body: { shape: "box", w: 44, h: 27, panel: "vents" }, neck: 3,
    loco: "treads", arms: "pincers", acc: ["hardhat"] },
  { role: "Data", color: "#4a6dff", accent: "#3ddc84",
    head: { shape: "monitor", w: 44, h: 36, screen: "light" }, face: "smile",
    body: { shape: "box", w: 40, h: 30, panel: "chart" }, neck: 3,
    loco: "legs", arms: "stubby", acc: ["antenna"] },
  { role: "Writer", color: "#d257ef", accent: "#ffd23f",
    head: { shape: "capsule", w: 38, h: 36 }, face: "wink",
    body: { shape: "barrel", w: 34, h: 28, panel: "buttons" }, neck: 3,
    loco: "legs", arms: "noodle", acc: ["twin"] },
  { role: "Security", color: "#ff4f5e", accent: "#4dc3ff",
    head: { shape: "boxy", w: 42, h: 32 }, face: "slit",
    body: { shape: "shield", w: 48, h: 30, panel: "emblem" }, neck: 3,
    loco: "spider", arms: "claws", acc: ["siren"] },
  { role: "Support", color: "#2fc56f", accent: "#ff5fa6",
    head: { shape: "pill", w: 52, h: 32 }, face: "smile",
    body: { shape: "dome", w: 44, h: 26, panel: "buttons" }, neck: 4,
    loco: "wheels", arms: "wave", acc: ["headset"] },
  { role: "Scout", color: "#dfe5f0", accent: "#36b3f5",
    head: { shape: "dome", w: 44, h: 32 }, face: "lenses",
    body: { shape: "egg", w: 32, h: 22, panel: "none" },
    loco: "hover", arms: "stubby", acc: ["propeller"] },
];

export const ROBOT_COUNT = ROSTER.length;

/** Deterministically map any agent id to a roster slot (stable across reloads). */
export function slotForId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % ROBOT_COUNT;
}

/* ---------------------------------------------------------------- palette & helpers */

const OUT = "#1b2238"; // navy outline
const SW = 3; // outline width in a 120×120 viewBox
const METAL = "#cdd5e5";
const METAL_D = "#8f9ab5";
const TIRE = "#2d3452";
const SCREEN_L = "#d2eeff";
const SCREEN_D = "#1c2540";
const GLOW = "#7ef3ff";
const G = 112; // ground line

const O = { stroke: OUT, strokeWidth: SW, strokeLinejoin: "round", strokeLinecap: "round" } as const;

/** Blend a hex color toward another (t = 0..1). */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** Rounded-rect path with separate (elliptical) top radii and bottom radius. */
function rr(x: number, y: number, w: number, h: number, rt: number, rb = rt, rty = rt): string {
  return `M${x + rt},${y}H${x + w - rt}A${rt},${rty} 0 0 1 ${x + w},${y + rty}V${y + h - rb}` +
    `A${rb},${rb} 0 0 1 ${x + w - rb},${y + h}H${x + rb}A${rb},${rb} 0 0 1 ${x},${y + h - rb}` +
    `V${y + rty}A${rt},${rty} 0 0 1 ${x + rt},${y}Z`;
}

/** An outlined tube (arm, leg, neck): navy stroke underneath, colored stroke on top. */
function Tube({ d, w = 6, fill = METAL, stripes }: { d: string; w?: number; fill?: string; stripes?: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={OUT} strokeWidth={w + 5} />
      <path d={d} stroke={fill} strokeWidth={w} />
      {stripes && <path d={d} stroke={stripes} strokeWidth={w} strokeDasharray="1.6 3" strokeLinecap="butt" />}
    </g>
  );
}

/** The single white highlight streak used on heads and bodies. */
const Hi = ({ d }: { d: string }) => (
  <path d={d} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={2.6} strokeLinecap="round" />
);

interface Pal { main: string; dark: string; light: string; accent: string }
interface Box { x: number; y: number; w: number; h: number }

/* ---------------------------------------------------------------- locomotion */

const LOCO_H: Record<Loco, number> = { treads: 17, wheels: 13, legs: 17, pogo: 30, spider: 17, hover: 19, unicycle: 19 };

function Locomotion({ type, p, top }: { type: Loco; p: Pal; top: number }) {
  switch (type) {
    case "treads": {
      const w = 58, h = 17, x = 60 - w / 2, y = G - h;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={METAL} {...O} />
          <rect x={x + 5} y={y + 4} width={w - 10} height={h - 8} rx={(h - 8) / 2} fill={METAL_D} />
          {[-17, 0, 17].map((dx) => (
            <g key={dx}>
              <circle cx={60 + dx} cy={y + h / 2} r={4.4} fill={METAL} {...O} strokeWidth={2.4} />
              <circle cx={60 + dx} cy={y + h / 2} r={1.3} fill={OUT} />
            </g>
          ))}
        </g>
      );
    }
    case "wheels":
      return (
        <g>
          <rect x={40} y={G - 12} width={40} height={6} rx={3} fill={METAL_D} {...O} />
          {[-17, 17].map((dx) => (
            <g key={dx}>
              <circle cx={60 + dx} cy={G - 9} r={9} fill={TIRE} {...O} />
              <circle cx={60 + dx} cy={G - 9} r={3.6} fill={METAL} />
            </g>
          ))}
        </g>
      );
    case "legs":
      return (
        <g>
          {[-10, 10].map((dx) => (
            <g key={dx}>
              <Tube d={`M${60 + dx},${top - 2}V${G - 7}`} w={6} stripes={METAL_D} />
              <path d={rr(60 + dx - 10 + (dx > 0 ? 2 : -2), G - 8, 20, 8, 4, 2)} fill={p.dark} {...O} />
            </g>
          ))}
        </g>
      );
    case "pogo":
      return (
        <g>
          <Tube d={`M60,${top - 2}V${G - 17}`} w={8} stripes={METAL_D} />
          <path d={rr(50, G - 20, 20, 7, 7, 2, 6)} fill={METAL} {...O} />
          <path d={`M53,${G - 12}L67,${G - 9.5}L53,${G - 7}L67,${G - 4.5}`} fill="none" stroke={OUT} strokeWidth={5.5} strokeLinejoin="round" strokeLinecap="round" />
          <path d={`M53,${G - 12}L67,${G - 9.5}L53,${G - 7}L67,${G - 4.5}`} fill="none" stroke={METAL_D} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <ellipse cx={60} cy={G - 1.5} rx={10} ry={3.2} fill={TIRE} {...O} />
        </g>
      );
    case "spider":
      return (
        <g>
          {[1, -1].map((s) => (
            <g key={s} transform={s < 0 ? "matrix(-1 0 0 1 120 0)" : undefined}>
              <Tube d={`M62,${top - 3}L76,${top + 3}L79,${G - 2}`} w={4.5} fill={METAL_D} />
              <Tube d={`M66,${top - 5}L88,${top - 7}L95,${G - 2}`} w={5} />
              <circle cx={88} cy={top - 7} r={3.6} fill={p.accent} {...O} strokeWidth={2.4} />
              <path d={rr(90, G - 5, 10, 5, 2.5, 1)} fill={p.dark} {...O} strokeWidth={2.4} />
              <path d={rr(74, G - 5, 10, 5, 2.5, 1)} fill={p.dark} {...O} strokeWidth={2.4} />
            </g>
          ))}
        </g>
      );
    case "hover":
      return (
        <g>
          <ellipse cx={60} cy={G - 3} rx={16} ry={3.2} fill={GLOW} opacity={0.35} />
          <path d={`M52,${top + 3}Q60,${G - 1} 68,${top + 3}Z`} fill={GLOW} opacity={0.9} />
          <path d={`M56,${top + 3}Q60,${G - 7} 64,${top + 3}Z`} fill="#fff" />
          <path d={rr(49, top - 4, 22, 9, 3, 4)} fill={METAL} {...O} />
        </g>
      );
    case "unicycle":
      return (
        <g>
          <Tube d={`M53,${top - 2}V${G - 10}M67,${top - 2}V${G - 10}`} w={4} />
          <circle cx={60} cy={G - 10} r={10} fill={TIRE} {...O} />
          <circle cx={60} cy={G - 10} r={5.5} fill="none" stroke={METAL_D} strokeWidth={2} />
          <circle cx={60} cy={G - 10} r={2.6} fill={METAL} />
        </g>
      );
  }
}

/* ---------------------------------------------------------------- bodies */

function Body({ b, p, panel }: { b: Box & { shape: BodyShape }; p: Pal; panel: Panel }) {
  const { x, y, w, h } = b;
  const cx = x + w / 2;
  let shape: ReactElement;
  switch (b.shape) {
    case "box":
      shape = (
        <g>
          <path d={rr(x, y, w, h, 7)} fill={p.main} />
          <path d={rr(x, y + h - 8, w, 8, 0, 7)} fill={p.dark} />
          <path d={rr(x, y, w, h, 7)} fill="none" {...O} />
          <Hi d={`M${x + 6},${y + 4.5}H${x + w * 0.38}`} />
        </g>
      );
      break;
    case "barrel":
      shape = (
        <g>
          <path d={rr(x, y, w, h, 6, Math.min(w / 2, h - 6))} fill={p.main} {...O} />
          <Hi d={`M${x + 6},${y + 4.5}H${x + w * 0.38}`} />
        </g>
      );
      break;
    case "dome":
      shape = (
        <g>
          <path d={rr(x, y, w, h, w / 2, 3, h - 5)} fill={p.main} {...O} />
          <rect x={x - 3} y={y + h - 6} width={w + 6} height={7} rx={3.5} fill={p.dark} {...O} />
          <Hi d={`M${x + 8},${y + h * 0.42}Q${x + 10},${y + 5} ${cx - 4},${y + 3.5}`} />
        </g>
      );
      break;
    case "egg":
      shape = (
        <g>
          <ellipse cx={cx} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={p.main} {...O} />
          <Hi d={`M${x + 6},${y + h * 0.42}Q${x + 9},${y + 5} ${cx - 3},${y + 3.5}`} />
        </g>
      );
      break;
    case "shield":
      shape = (
        <g>
          <path d={`M${x + 5},${y}H${x + w - 5}Q${x + w},${y} ${x + w - 0.6},${y + 5}L${x + w - 7},${y + h - 4}Q${x + w - 8},${y + h} ${x + w - 12},${y + h}H${x + 12}Q${x + 8},${y + h} ${x + 7},${y + h - 4}L${x + 0.6},${y + 5}Q${x},${y} ${x + 5},${y}Z`} fill={p.main} {...O} />
          <Hi d={`M${x + 6},${y + 4.5}H${x + w * 0.36}`} />
        </g>
      );
      break;
    case "neck":
      return <Tube d={`M${cx},${y - 2}V${y + h + 2}`} w={9} stripes={METAL_D} />;
  }
  // panel details
  const py = y + h * 0.5;
  const det: Record<Panel, ReactElement | null> = {
    none: null,
    buttons: (
      <g>
        <circle cx={cx - 9} cy={py} r={3} fill="#ff5a5f" {...O} strokeWidth={2} />
        <circle cx={cx} cy={py} r={3} fill="#3ddc84" {...O} strokeWidth={2} />
        <path d={`M${cx + 6},${py - 3}H${cx + 12}M${cx + 6},${py + 1}H${cx + 12}`} stroke={OUT} strokeWidth={2} strokeLinecap="round" />
      </g>
    ),
    vents: (
      <g stroke={OUT} strokeWidth={2.2} strokeLinecap="round">
        {[-9, -4.5, 0, 4.5, 9].map((d) => <path key={d} d={`M${cx + d},${py - 4}V${py + 3}`} />)}
      </g>
    ),
    chart: (
      <g>
        <rect x={cx - 11} y={py - 8} width={22} height={14} rx={3} fill={SCREEN_D} {...O} strokeWidth={2} />
        {[[-6.5, 4], [-2, 7], [2.5, 5], [7, 9]].map(([dx, hh]) => (
          <rect key={dx} x={cx + dx - 1.5} y={py + 3 - hh} width={3} height={hh} rx={1} fill={p.accent} />
        ))}
      </g>
    ),
    emblem: (
      <g>
        <path d={`M${cx},${py - 7}L${cx + 7},${py - 4}Q${cx + 6},${py + 4} ${cx},${py + 7}Q${cx - 6},${py + 4} ${cx - 7},${py - 4}Z`} fill={p.accent} {...O} strokeWidth={2.2} />
      </g>
    ),
    dial: (
      <g>
        <circle cx={cx} cy={py} r={6} fill={p.light} {...O} strokeWidth={2.2} />
        <path d={`M${cx},${py}L${cx + 3},${py - 3}`} stroke={OUT} strokeWidth={2} strokeLinecap="round" />
      </g>
    ),
  };
  return <g>{shape}{det[panel]}</g>;
}

/* ---------------------------------------------------------------- heads & faces */

/** Draws the head shell and returns the face anchor (center + ink color). */
function Head({ hd, p, box }: { hd: RobotSpec["head"]; p: Pal; box: Box }) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  switch (hd.shape) {
    case "monitor": {
      const dark = hd.screen === "dark";
      return (
        <g>
          <rect x={x - 3} y={y + h * 0.42} width={w + 6} height={9} rx={3} fill={METAL} {...O} />
          <path d={rr(x, y, w, h, 9)} fill={p.main} {...O} />
          <rect x={x + 6} y={y + 5} width={w - 12} height={h - 15} rx={6} fill={dark ? SCREEN_D : SCREEN_L} {...O} />
          <Hi d={`M${x + 11},${y + 9}H${x + w * 0.4}`} />
          <circle cx={x + w - 14} cy={y + h - 5} r={1.8} fill="#ff5a5f" />
          <circle cx={x + w - 8.5} cy={y + h - 5} r={1.8} fill={p.accent} />
        </g>
      );
    }
    case "boxy":
      return (
        <g>
          <path d={rr(x, y, w, h, 8)} fill={p.main} {...O} />
          <rect x={x + 6} y={y + h * 0.5} width={w - 12} height={h * 0.5 - 5} rx={5} fill={p.light} {...O} strokeWidth={2.4} />
          <Hi d={`M${x + 6},${y + 5}H${x + w * 0.36}`} />
        </g>
      );
    case "capsule":
      return (
        <g>
          <path d={rr(x, y, w, h, w / 2, 7)} fill={p.main} {...O} />
          <path d={rr(x, y + h - 9, w, 9, 0, 7)} fill={p.dark} />
          <path d={rr(x, y, w, h, w / 2, 7)} fill="none" {...O} />
          <Hi d={`M${x + 6},${y + h * 0.42}Q${x + 7},${y + 7} ${cx - 3},${y + 4.5}`} />
        </g>
      );
    case "orb":
      return (
        <g>
          <circle cx={cx} cy={y + h / 2} r={w / 2} fill={p.main} {...O} />
          <Hi d={`M${x + 6},${y + h * 0.42}Q${x + 8},${y + 7} ${cx - 3},${y + 4.5}`} />
        </g>
      );
    case "dome":
      return (
        <g>
          <path d={rr(x, y, w, h, w / 2, 4, h - 8)} fill={p.main} {...O} />
          <rect x={x - 2} y={y + h - 7} width={w + 4} height={7} rx={3.5} fill={p.dark} {...O} />
          <Hi d={`M${x + 7},${y + h * 0.5}Q${x + 9},${y + 6} ${cx - 3},${y + 4}`} />
        </g>
      );
    case "tv":
      return (
        <g>
          {[x - 5, x + w].map((ex) => <rect key={ex} x={ex} y={y + h / 2 - 7} width={5} height={14} rx={2} fill={METAL} {...O} />)}
          <path d={rr(x, y, w, h, 10)} fill={p.main} {...O} />
          <rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx={7} fill="none" stroke={p.dark} strokeWidth={2.5} />
          <Hi d={`M${x + 9},${y + 8.5}H${x + w * 0.36}`} />
        </g>
      );
    case "pill":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={p.main} {...O} />
          <Hi d={`M${x + 8},${y + h * 0.4}Q${x + 10},${y + 5} ${x + 18},${y + 4.5}`} />
        </g>
      );
  }
}

function faceAnchor(hd: RobotSpec["head"], box: Box): { fx: number; fy: number } {
  const { x, y, w, h } = box;
  const fx = x + w / 2;
  switch (hd.shape) {
    case "monitor": return { fx, fy: y + 5 + (h - 15) / 2 };
    case "boxy": return { fx, fy: y + h * 0.5 };
    case "capsule": return { fx, fy: y + h * 0.56 };
    case "orb": return { fx, fy: y + h * 0.55 };
    case "dome": return { fx, fy: y + h * 0.56 };
    default: return { fx, fy: y + h / 2 };
  }
}

function FaceArt({ face, fx, fy, p, dark }: { face: Face; fx: number; fy: number; p: Pal; dark: boolean }) {
  const ink = dark ? GLOW : OUT;
  const eye = (dx: number, dy = -3) => <rect key={dx} x={fx + dx - 1.7} y={fy + dy - 3.8} width={3.4} height={7.6} rx={1.7} fill={ink} />;
  const smile = (dy = 4.5, wd = 5) => <path d={`M${fx - wd},${fy + dy}Q${fx},${fy + dy + 4.5} ${fx + wd},${fy + dy}`} fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round" />;
  switch (face) {
    case "smile":
      return <g>{eye(-7)}{eye(7)}{smile()}</g>;
    case "wink":
      return (
        <g>
          {eye(-7)}
          <path d={`M${fx + 4},${fy - 3}Q${fx + 7},${fy - 6} ${fx + 10},${fy - 3}`} fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
          {smile(4, 6)}
        </g>
      );
    case "grill":
      return (
        <g>
          {eye(-8, -6.5)}{eye(8, -6.5)}
          <rect x={fx - 11} y={fy + 1} width={22} height={9} rx={4.5} fill="#fff" {...O} strokeWidth={2.4} />
          <path d={[-5.5, -1.8, 1.8, 5.5].map((d) => `M${fx + d},${fy + 2.5}V${fy + 8.5}`).join("")} stroke={OUT} strokeWidth={1.8} />
        </g>
      );
    case "visor":
      return (
        <g>
          <rect x={fx - 17} y={fy - 8} width={34} height={12} rx={6} fill={SCREEN_D} {...O} strokeWidth={2.4} />
          <ellipse cx={fx - 7} cy={fy - 2} rx={3.4} ry={2.6} fill={GLOW} />
          <ellipse cx={fx + 7} cy={fy - 2} rx={3.4} ry={2.6} fill={GLOW} />
          {smile(7, 4)}
        </g>
      );
    case "cyclops":
      return (
        <g>
          <circle cx={fx} cy={fy - 3} r={9} fill="#fff" {...O} strokeWidth={2.6} />
          <circle cx={fx + 1} cy={fy - 2.5} r={4.6} fill={OUT} />
          <circle cx={fx + 2.6} cy={fy - 4.3} r={1.5} fill="#fff" />
          <path d={`M${fx - 4},${fy + 10}Q${fx},${fy + 12.5} ${fx + 4},${fy + 10}`} fill="none" stroke={OUT} strokeWidth={2.4} strokeLinecap="round" />
        </g>
      );
    case "happy":
      return (
        <g>
          {[-7, 7].map((dx) => <path key={dx} d={`M${fx + dx - 3.5},${fy - 1.5}Q${fx + dx},${fy - 6.5} ${fx + dx + 3.5},${fy - 1.5}`} fill="none" stroke={OUT} strokeWidth={2.6} strokeLinecap="round" />)}
          <ellipse cx={fx - 12} cy={fy + 3} rx={3.4} ry={2.2} fill="#fff" opacity={0.55} />
          <ellipse cx={fx + 12} cy={fy + 3} rx={3.4} ry={2.2} fill="#fff" opacity={0.55} />
          <path d={`M${fx - 5},${fy + 2.5}Q${fx},${fy + 9} ${fx + 5},${fy + 2.5}Z`} fill={OUT} stroke={OUT} strokeWidth={1.6} strokeLinejoin="round" />
        </g>
      );
    case "pixel":
      return (
        <g fill={ink}>
          <rect x={fx - 11} y={fy - 6} width={6} height={6} rx={1} />
          <rect x={fx + 5} y={fy - 6} width={6} height={6} rx={1} />
          <rect x={fx - 5} y={fy + 4} width={10} height={2.6} rx={1} />
          <rect x={fx - 7.5} y={fy + 2} width={2.6} height={2.6} rx={0.6} />
          <rect x={fx + 4.9} y={fy + 2} width={2.6} height={2.6} rx={0.6} />
        </g>
      );
    case "slit":
      return (
        <g>
          <rect x={fx - 17} y={fy - 10} width={34} height={10} rx={5} fill={SCREEN_D} {...O} strokeWidth={2.4} />
          <rect x={fx - 11} y={fy - 6.4} width={22} height={3} rx={1.5} fill={p.accent} />
          <rect x={fx - 7} y={fy + 3.5} width={14} height={6} rx={3} fill="#fff" {...O} strokeWidth={2.2} />
        </g>
      );
    case "lenses":
      return (
        <g>
          <rect x={fx - 3} y={fy - 4.5} width={6} height={3.4} rx={1.2} fill={METAL_D} {...O} strokeWidth={2} />
          {[-8.5, 8.5].map((dx) => (
            <g key={dx}>
              <circle cx={fx + dx} cy={fy - 3} r={7} fill={METAL} {...O} strokeWidth={2.6} />
              <circle cx={fx + dx} cy={fy - 3} r={4.2} fill={SCREEN_D} />
              <circle cx={fx + dx + 1.4} cy={fy - 4.4} r={1.4} fill={GLOW} />
            </g>
          ))}
          {smile(7, 3.5)}
        </g>
      );
  }
}

/* ---------------------------------------------------------------- arms */

/** Right-side arm (the left side is drawn mirrored). `down` = resting pose for "wave". */
function Arm({ type, p, sx, sy, raised }: { type: Arms; p: Pal; sx: number; sy: number; raised?: boolean }) {
  switch (type) {
    case "claws": {
      const ex = sx + 15, ey = sy + 20;
      return (
        <g>
          <Tube d={`M${sx},${sy}C${sx + 12},${sy - 4} ${sx + 16},${sy + 6} ${ex},${ey}`} w={6} stripes={METAL_D} />
          <Tube d={`M${ex - 5.5},${ey + 7}A5.6,5.6 0 1 1 ${ex + 5.5},${ey + 7}`} w={3} fill={METAL_D} />
          <circle cx={sx} cy={sy} r={4.5} fill={p.dark} {...O} strokeWidth={2.4} />
        </g>
      );
    }
    case "pincers": {
      const ex = sx + 13, ey = sy + 17;
      return (
        <g>
          <Tube d={`M${sx},${sy}Q${sx + 13},${sy + 1} ${ex},${ey}`} w={5.5} stripes={METAL_D} />
          <Tube d={`M${ex - 4},${ey + 8}L${ex},${ey + 1}L${ex + 4.5},${ey + 8}`} w={2.8} fill={METAL_D} />
          <circle cx={sx} cy={sy} r={4} fill={p.dark} {...O} strokeWidth={2.4} />
        </g>
      );
    }
    case "noodle": {
      const ex = sx + 11, ey = sy + 17;
      return (
        <g>
          <path d={`M${sx - 2},${sy}Q${sx + 12},${sy + 2} ${ex},${ey}`} fill="none" stroke={OUT} strokeWidth={3} strokeLinecap="round" />
          <circle cx={ex} cy={ey + 1} r={4.2} fill={p.main} {...O} strokeWidth={2.4} />
        </g>
      );
    }
    case "stubby":
      return <rect x={sx - 4} y={sy - 4} width={9} height={18} rx={4.5} fill={p.dark} {...O} transform={`rotate(-22 ${sx} ${sy})`} />;
    case "wave": {
      const d = raised
        ? `M${sx - 1},${sy}Q${sx + 14},${sy - 1} ${sx + 15},${sy - 15}`
        : `M${sx - 1},${sy}Q${sx + 11},${sy + 2} ${sx + 11},${sy + 15}`;
      const [hx, hy] = raised ? [sx + 15, sy - 18] : [sx + 11, sy + 18];
      return (
        <g>
          <Tube d={d} w={5} stripes={METAL_D} />
          <circle cx={hx} cy={hy} r={4.6} fill={p.main} {...O} strokeWidth={2.6} />
        </g>
      );
    }
    case "none":
      return null;
  }
}

/* ---------------------------------------------------------------- accessories */

function Acc({ type, p, hb }: { type: Accessory; p: Pal; hb: Box }) {
  const { x, y, w, h } = hb;
  const cx = x + w / 2;
  const ball = (bx: number, by: number, r = 3.8, fill = p.accent) => <circle cx={bx} cy={by} r={r} fill={fill} {...O} strokeWidth={2.6} />;
  switch (type) {
    case "antenna":
      return <g><path d={`M${cx},${y + 1}V${y - 10}`} stroke={OUT} strokeWidth={3} strokeLinecap="round" />{ball(cx, y - 13)}</g>;
    case "twin":
      return (
        <g stroke={OUT} strokeWidth={3} strokeLinecap="round">
          <path d={`M${cx - w * 0.22},${y + 3}L${cx - w * 0.36},${y - 8}M${cx + w * 0.22},${y + 3}L${cx + w * 0.36},${y - 8}`} />
          {ball(cx - w * 0.36, y - 10.5, 3.4)}{ball(cx + w * 0.36, y - 10.5, 3.4)}
        </g>
      );
    case "coil":
      return (
        <g>
          <path d={`M${cx},${y + 1}L${cx},${y - 2}L${cx + 4},${y - 4}L${cx - 4},${y - 7}L${cx + 4},${y - 10}L${cx},${y - 12}`} fill="none" stroke={OUT} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
          {ball(cx, y - 15)}
        </g>
      );
    case "star": {
      const s = (r: number, i: number) => {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${(cx + Math.cos(a) * r).toFixed(1)},${(y - 14 + Math.sin(a) * r).toFixed(1)}`;
      };
      const pts = Array.from({ length: 10 }, (_, i) => s(i % 2 ? 3.2 : 7, i)).join(" ");
      return <g><path d={`M${cx},${y + 1}V${y - 8}`} stroke={OUT} strokeWidth={3} strokeLinecap="round" /><polygon points={pts} fill={p.accent} {...O} strokeWidth={2.4} /></g>;
    }
    case "propeller":
      return (
        <g>
          <path d={`M${cx},${y + 1}V${y - 6}`} stroke={OUT} strokeWidth={3} strokeLinecap="round" />
          <ellipse cx={cx - 9} cy={y - 8} rx={9} ry={3} fill={p.accent} {...O} strokeWidth={2.4} />
          <ellipse cx={cx + 9} cy={y - 8} rx={9} ry={3} fill={p.accent} {...O} strokeWidth={2.4} />
          {ball(cx, y - 8, 2.8, "#ff5a5f")}
        </g>
      );
    case "beacon":
      return (
        <g>
          <rect x={cx - 7} y={y - 5} width={14} height={6} rx={2} fill={METAL} {...O} strokeWidth={2.6} />
          <path d={rr(cx - 6, y - 15, 12, 10.5, 6, 1, 6)} fill={p.accent} {...O} strokeWidth={2.6} />
          <path d={`M${cx - 2.5},${y - 11}Q${cx - 2},${y - 13} ${cx},${y - 13}`} fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
          <g fill="none" stroke={OUT} strokeWidth={2.4} strokeLinecap="round">
            <path d={`M${cx + 10},${y - 15}A8,8 0 0 1 ${cx + 11},${y - 6}`} />
            <path d={`M${cx + 14},${y - 19}A13,13 0 0 1 ${cx + 15.5},${y - 4}`} />
            <path d={`M${cx - 10},${y - 15}A8,8 0 0 0 ${cx - 11},${y - 6}`} />
            <path d={`M${cx - 14},${y - 19}A13,13 0 0 0 ${cx - 15.5},${y - 4}`} />
          </g>
        </g>
      );
    case "siren":
      return (
        <g>
          <rect x={cx - 9} y={y - 5} width={18} height={6} rx={2} fill={METAL} {...O} strokeWidth={2.6} />
          <path d={rr(cx - 7, y - 13, 14, 8.5, 4, 1)} fill={p.accent} {...O} strokeWidth={2.6} />
          <g stroke={OUT} strokeWidth={2.4} strokeLinecap="round">
            <path d={`M${cx - 12},${y - 13}L${cx - 15},${y - 16}M${cx + 12},${y - 13}L${cx + 15},${y - 16}M${cx},${y - 17}V${y - 20}`} />
          </g>
        </g>
      );
    case "dish":
      return (
        <g>
          <path d={`M${cx + 8},${y + 3}L${cx + 14},${y - 6}`} stroke={OUT} strokeWidth={3} strokeLinecap="round" />
          <path d={`M${cx + 4},${y - 12}A10,10 0 0 0 ${cx + 22},${y - 3}Z`} fill={METAL} {...O} strokeWidth={2.6} />
          <path d={`M${cx + 13},${y - 7.5}L${cx + 18},${y - 14}`} stroke={OUT} strokeWidth={2.2} strokeLinecap="round" />
          {ball(cx + 18.5, y - 15, 2.6)}
        </g>
      );
    case "headset": {
      const cy = y + h * 0.5;
      return (
        <g>
          <path d={`M${x - 1},${cy - 2}C${x - 1},${y - 10} ${x + w + 1},${y - 10} ${x + w + 1},${cy - 2}`} fill="none" stroke={OUT} strokeWidth={7} strokeLinecap="round" />
          <path d={`M${x - 1},${cy - 2}C${x - 1},${y - 10} ${x + w + 1},${y - 10} ${x + w + 1},${cy - 2}`} fill="none" stroke={TIRE} strokeWidth={3} strokeLinecap="round" />
          <path d={`M${x - 2},${cy + 2}Q${x + 2},${cy + 16} ${cx - 10},${cy + 12}`} fill="none" stroke={OUT} strokeWidth={2.6} strokeLinecap="round" />
          {ball(cx - 11, cy + 12, 2.8, TIRE)}
          <rect x={x - 6} y={cy - 8} width={9} height={16} rx={4.5} fill={p.accent} {...O} />
          <rect x={x + w - 3} y={cy - 8} width={9} height={16} rx={4.5} fill={p.accent} {...O} />
        </g>
      );
    }
    case "bolts": {
      const cy = y + h * 0.42;
      return (
        <g>
          {[[x - 6, x - 7], [x + w + 1, x + w + 7]].map(([rx, bx]) => (
            <g key={rx}><rect x={rx} y={cy - 3.5} width={5} height={7} rx={1.5} fill={METAL} {...O} strokeWidth={2.4} />{ball(bx, cy, 3)}</g>
          ))}
        </g>
      );
    }
    case "hardhat": {
      const hw = w - 6;
      return (
        <g>
          <path d={rr(cx - hw / 2, y - 9, hw, 13, hw / 2, 0, 11)} fill={p.accent} {...O} />
          <path d={`M${cx},${y - 8.5}V${y + 2}`} stroke={mix(p.accent, OUT, 0.25)} strokeWidth={4} strokeLinecap="round" />
          <rect x={x - 4} y={y + 1} width={w + 8} height={5} rx={2.5} fill={mix(p.accent, OUT, 0.15)} {...O} strokeWidth={2.6} />
          <Hi d={`M${cx - hw / 2 + 6},${y - 1}Q${cx - hw / 2 + 7},${y - 6} ${cx - 6},${y - 7}`} />
        </g>
      );
    }
  }
}

/* ---------------------------------------------------------------- layout */

/** Stack the parts bottom-up from the ground line and return every box we need. */
function layout(s: RobotSpec) {
  const bodyBottom = G - LOCO_H[s.loco] + 2;
  const body = { x: 60 - s.body.w / 2, y: bodyBottom - s.body.h, w: s.body.w, h: s.body.h };
  const headBottom = body.y + 3 - (s.neck ?? 0);
  const head = { x: 60 - s.head.w / 2, y: headBottom - s.head.h, w: s.head.w, h: s.head.h };
  // arms hang from the body sides; a neck-only robot (pogo) hangs them from the head.
  const shoulder = s.body.shape === "neck"
    ? { sx: 60 + s.head.w / 2 - 2, sy: head.y + head.h - 12 }
    : { sx: 60 + s.body.w / 2 - (s.body.shape === "egg" ? 3 : 1), sy: body.y + 8 };
  return { body, head, bodyBottom, shoulder };
}

/** The robot artwork itself (no halo / tile / status). Exported for custom compositions. */
export function RobotArt({ spec }: { spec: RobotSpec }) {
  const p: Pal = { main: spec.color, dark: mix(spec.color, OUT, 0.22), light: mix(spec.color, "#ffffff", 0.45), accent: spec.accent };
  const { body, head, bodyBottom, shoulder } = layout(spec);
  const { fx, fy } = faceAnchor(spec.head, head);
  const dark = spec.head.shape === "monitor" && spec.head.screen === "dark";
  const behind = spec.acc.filter((a) => a === "headset");
  const front = spec.acc.filter((a) => a !== "headset");
  const mirror = "matrix(-1 0 0 1 120 0)";
  return (
    <g>
      <Locomotion type={spec.loco} p={p} top={bodyBottom} />
      <g transform={mirror}><Arm type={spec.arms} p={p} {...shoulder} /></g>
      <Arm type={spec.arms} p={p} {...shoulder} raised={spec.arms === "wave"} />
      {spec.neck ? <Tube d={`M60,${head.y + head.h - 2}V${body.y + 2}`} w={11} stripes={METAL_D} /> : null}
      <Body b={{ ...body, shape: spec.body.shape }} p={p} panel={spec.body.panel ?? "none"} />
      {front.filter((a) => a !== "hardhat").map((a) => <Acc key={a} type={a} p={p} hb={head} />)}
      <Head hd={spec.head} p={p} box={head} />
      <FaceArt face={spec.face} fx={fx} fy={fy} p={p} dark={dark} />
      {behind.map((a) => <Acc key={a} type={a} p={p} hb={head} />)}
      {front.includes("hardhat") && <Acc type="hardhat" p={p} hb={head} />}
    </g>
  );
}

/* ---------------------------------------------------------------- component */

const STATUS_COLOR: Record<RobotStatus, string> = {
  working: "#3ddc84", idle: "#f5c542", blocked: "#ff5a5f", offline: "#6b7280",
};

export interface RobotAvatarProps {
  /** Roster slot 0–11 (wraps). Use `slotForId(agentId)` for a stable mapping. */
  slot: number;
  /** Rendered width/height in px. Default 64. */
  size?: number;
  status?: RobotStatus;
  /** Sit the robot on a rounded, color-tinted tile (recommended ≤ 32px). */
  tile?: boolean;
  /** Light sticker halo for dark backgrounds. Default true. */
  halo?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function RobotAvatar({ slot, size = 64, status, tile = false, halo = true, title, className, style }: RobotAvatarProps) {
  const spec = ROSTER[((Math.floor(slot) % ROBOT_COUNT) + ROBOT_COUNT) % ROBOT_COUNT];
  const uid = "rb" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const offline = status === "offline";
  const haloColor = mix(spec.color, "#ffffff", 0.82);
  const label = title ?? `${spec.role} robot${status ? ` (${status})` : ""}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width={size} height={size}
      role="img" aria-label={label} className={className} style={style}>
      <title>{label}</title>
      <defs>
        <filter id={`${uid}h`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius={2.4} result="d" />
          <feFlood floodColor={haloColor} floodOpacity={0.92} />
          <feComposite in2="d" operator="in" result="halo" />
          <feMerge><feMergeNode in="halo" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={`${uid}g`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <linearGradient id={`${uid}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix("#16161e", spec.color, 0.3)} />
          <stop offset="1" stopColor={mix("#111117", spec.color, 0.1)} />
        </linearGradient>
      </defs>
      {tile && <rect x={1} y={1} width={118} height={118} rx={26} fill={`url(#${uid}t)`} stroke="#ffffff" strokeOpacity={0.1} strokeWidth={2} />}
      <g transform={tile ? "translate(8 6) scale(0.87)" : undefined}
        filter={offline ? `url(#${uid}g)` : undefined} opacity={offline ? 0.5 : 1}>
        <ellipse cx={60} cy={G + 1.5} rx={spec.loco === "hover" ? 18 : 30} ry={3.6} fill={spec.color} opacity={0.28} />
        <g filter={halo ? `url(#${uid}h)` : undefined}><RobotArt spec={spec} /></g>
      </g>
      {status && (
        <g>
          {status === "working" && (
            <circle cx={104} cy={104} r={11} fill="none" stroke={STATUS_COLOR.working} strokeWidth={3}>
              <animate attributeName="r" values="11;15;11" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={104} cy={104} r={11} fill={STATUS_COLOR[status]} stroke="#0b0b10" strokeWidth={5} />
        </g>
      )}
    </svg>
  );
}

export default RobotAvatar;

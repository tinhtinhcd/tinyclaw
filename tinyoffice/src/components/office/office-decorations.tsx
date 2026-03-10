"use client";

import { OFFICE_WIDTH, OFFICE_HEIGHT, MEETING_CENTER } from "@/lib/office-layout";

/**
 * Static decorations: plants, rug, zone labels.
 * Renders the "set dressing" layer of the office — separated from
 * the interactive agent layer to keep office-scene.tsx focused.
 */

interface ZoneLabel {
  text: string;
  x: number;
  y: number;
}

const ZONE_LABELS: ZoneLabel[] = [
  { text: "📋 Analysis", x: 120, y: 120 },
  { text: "📌 Planning", x: 360, y: 120 },
  { text: "📐 Design", x: 600, y: 120 },
  { text: "💻 Code", x: 240, y: 340 },
  { text: "🔍 Review", x: 520, y: 340 },
  { text: "🧪 Test", x: 760, y: 340 },
];

interface Decoration {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const DECORATIONS: Decoration[] = [
  // Plants in corners
  { src: "/assets/office/plant.svg", x: 28, y: 100, w: 28, h: 38 },
  { src: "/assets/office/plant.svg", x: 900, y: 100, w: 28, h: 38 },
  { src: "/assets/office/plant.svg", x: 28, y: 460, w: 28, h: 38 },
  { src: "/assets/office/plant.svg", x: 900, y: 460, w: 28, h: 38 },
  // Meeting rug in center
  { src: "/assets/office/rug.svg", x: MEETING_CENTER.x - 48, y: MEETING_CENTER.y - 32, w: 96, h: 64 },
];

export function OfficeDecorations() {
  return (
    <>
      {/* Zone labels */}
      {ZONE_LABELS.map((label) => (
        <div
          key={label.text}
          className="absolute pointer-events-none select-none"
          style={{
            left: `${(label.x / OFFICE_WIDTH) * 100}%`,
            top: `${(label.y / OFFICE_HEIGHT) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <span className="office-zone-label">{label.text}</span>
        </div>
      ))}

      {/* Decorations (plants, rug) */}
      {DECORATIONS.map((dec, i) => (
        <img
          key={i}
          src={dec.src}
          alt=""
          className="absolute pointer-events-none"
          style={{
            left: `${(dec.x / OFFICE_WIDTH) * 100}%`,
            top: `${(dec.y / OFFICE_HEIGHT) * 100}%`,
            width: `${(dec.w / OFFICE_WIDTH) * 100}%`,
            height: `${(dec.h / OFFICE_HEIGHT) * 100}%`,
            imageRendering: "pixelated",
          }}
          draggable={false}
        />
      ))}
    </>
  );
}

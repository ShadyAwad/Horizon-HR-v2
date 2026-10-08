import type { SketchData, SketchShape } from "../../lib/stanza-document";
export function SketchPreview({ drawing }: { drawing: SketchData }) {
  return (
    <svg
      viewBox="0 0 800 450"
      role="img"
      aria-label={drawing.description || "Sketch"}
      className="stanza-sketch-preview"
    >
      <title>{drawing.description || "Sketch"}</title>
      {drawing.shapes.map((shape, i) => (
        <Shape key={i} shape={shape} />
      ))}
    </svg>
  );
}
function Shape({ shape: s }: { shape: SketchShape }) {
  const [a, b = a] = [s.points[0], s.points.at(-1)];
  const common = { stroke: s.color, strokeWidth: 3, fill: "none" };
  if (s.tool === "text")
    return (
      <text x={a[0]} y={a[1]} fill={s.color} fontSize="20">
        {s.text}
      </text>
    );
  if (s.tool === "pen")
    return (
      <polyline
        {...common}
        points={s.points.map((p) => p.join(",")).join(" ")}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (s.tool === "rectangle")
    return (
      <rect
        {...common}
        x={Math.min(a[0], b[0])}
        y={Math.min(a[1], b[1])}
        width={Math.abs(a[0] - b[0])}
        height={Math.abs(a[1] - b[1])}
      />
    );
  if (s.tool === "ellipse")
    return (
      <ellipse
        {...common}
        cx={(a[0] + b[0]) / 2}
        cy={(a[1] + b[1]) / 2}
        rx={Math.abs(a[0] - b[0]) / 2}
        ry={Math.abs(a[1] - b[1]) / 2}
      />
    );
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return (
    <g>
      <line {...common} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      {s.tool === "arrow" && (
        <polyline
          {...common}
          points={`${b[0] - 15 * Math.cos(angle - 0.5)},${b[1] - 15 * Math.sin(angle - 0.5)} ${b.join(",")} ${b[0] - 15 * Math.cos(angle + 0.5)},${b[1] - 15 * Math.sin(angle + 0.5)}`}
        />
      )}
    </g>
  );
}

import { useId, useRef, useState } from "react";
import {
  SKETCH_COLORS,
  type SketchData,
  type SketchShape,
} from "../../lib/stanza-document";
import { SketchPreview } from "./SketchPreview";
import { useLanguage } from "../../lib/LanguageContext";
import { ComposerDialog } from "../workspace-composer/ComposerDialog";
export default function SketchEditor({
  value,
  onSave,
  onClose,
}: {
  value: SketchData;
  onSave: (d: SketchData) => void;
  onClose: () => void;
}) {
  const { isRtl } = useLanguage();
  const descriptionId = useId();
  const label = (en: string, ar: string) => (isRtl ? ar : en);
  const [past, setPast] = useState<SketchShape[][]>([]),
    [future, setFuture] = useState<SketchShape[][]>([]),
    [shapes, setShapes] = useState(value.shapes),
    [description, setDescription] = useState(value.description),
    [tool, setTool] = useState<SketchShape["tool"] | "eraser">("pen"),
    [color, setColor] = useState<string>(SKETCH_COLORS[0]),
    [text, setText] = useState(""),
    [draft, setDraft] = useState<SketchShape | null>(null);
  const active = useRef<SketchShape | null>(null);
  const commit = (next: SketchShape[]) => {
    setPast((p) => [...p.slice(-49), shapes]);
    setFuture([]);
    setShapes(next);
  };
  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(800, ((e.clientX - r.left) * 800) / r.width)),
      Math.max(0, Math.min(450, ((e.clientY - r.top) * 450) / r.height)),
    ];
  };
  return (
    <ComposerDialog onClose={onClose} title={label("Sketch", "رسم")}>
      <div className="space-y-3">
        <div
          className="flex flex-wrap gap-2"
          role="toolbar"
          aria-label={label("Drawing tools", "أدوات الرسم")}
        >
          {(
            [
              "pen",
              "line",
              "arrow",
              "rectangle",
              "ellipse",
              "text",
              "eraser",
            ] as const
          ).map((t, i) => (
            <button
              type="button"
              className="stanza-document-control"
              aria-pressed={tool === t}
              key={t}
              onClick={() => setTool(t)}
            >
              {isRtl
                ? ["قلم", "خط", "سهم", "مستطيل", "بيضاوي", "نص", "ممحاة"][i]
                : t}
            </button>
          ))}
          <button
            type="button"
            className="stanza-document-control"
            disabled={!past.length}
            onClick={() => {
              setFuture((f) => [shapes, ...f]);
              setShapes(past.at(-1)!);
              setPast((p) => p.slice(0, -1));
            }}
          >
            {label("Undo", "تراجع")}
          </button>
          <button
            type="button"
            className="stanza-document-control"
            disabled={!future.length}
            onClick={() => {
              setPast((p) => [...p, shapes]);
              setShapes(future[0]);
              setFuture((f) => f.slice(1));
            }}
          >
            {label("Redo", "إعادة")}
          </button>
        </div>
        <label>
          {label("Color", "اللون")}
          <select
            className="stanza-select stanza-document-control"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          >
            {SKETCH_COLORS.map((c, i) => (
              <option key={c} value={c}>
                {isRtl
                  ? ["أسود", "أبيض", "أخضر", "أزرق", "أحمر", "كهرماني"][i]
                  : ["Black", "White", "Green", "Blue", "Red", "Amber"][i]}
              </option>
            ))}
          </select>
        </label>
        {tool === "text" && (
          <label>
            {label("Text", "نص")}
            <input
              className="stanza-form-control"
              value={text}
              maxLength={240}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        <div className="relative rounded border">
          <SketchPreview
            drawing={{
              description,
              shapes: [...shapes, ...(draft ? [draft] : [])],
            }}
          />
          <svg
            aria-label={label(
              "Drawing canvas; use pointer to draw",
              "مساحة الرسم؛ استخدم المؤشر للرسم",
            )}
            viewBox="0 0 800 450"
            className="absolute inset-0 h-full w-full touch-none"
            onPointerDown={(e) => {
              const p = point(e);
              e.currentTarget.setPointerCapture(e.pointerId);
              if (tool === "eraser") {
                commit(
                  shapes.filter(
                    (s) =>
                      !s.points.some(
                        (q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 30,
                      ),
                  ),
                );
                return;
              }
              if (shapes.length >= 300) return;
              active.current = {
                tool,
                color,
                points: [p],
                ...(tool === "text" ? { text } : {}),
              };
              setDraft(active.current);
            }}
            onPointerMove={(e) => {
              const s = active.current;
              if (!s) return;
              const p = point(e);
              active.current = {
                ...s,
                points:
                  s.tool === "pen"
                    ? [...s.points.slice(0, 999), p]
                    : [s.points[0], p],
              };
              setDraft(active.current);
            }}
            onPointerUp={() => {
              if (active.current) {
                commit([...shapes, active.current]);
                active.current = null;
                setDraft(null);
              }
            }}
            onPointerCancel={() => {
              active.current = null;
              setDraft(null);
            }}
          />
        </div>
        <p className="text-sm">
          {label(
            "Pointer drawing. Add a description for readers who cannot see the sketch.",
            "الرسم بالمؤشر. أضف وصفًا للقراء الذين لا يمكنهم رؤية الرسم.",
          )}
        </p>
        <label htmlFor={descriptionId}>
          {label("Sketch description", "وصف الرسم")}
        </label>
        <textarea
          id={descriptionId}
          className="stanza-form-control w-full"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          className="stanza-document-control"
          type="button"
          disabled={!description.trim()}
          onClick={() => onSave({ description: description.trim(), shapes })}
        >
          {label("Save sketch", "حفظ الرسم")}
        </button>
      </div>
    </ComposerDialog>
  );
}

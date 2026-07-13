import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, X } from 'lucide-react';

const CROP_SIZE = 288;
const OUTPUT_SIZE = 512;

type Point = { x: number; y: number };

export function ProfilePhotoCropDialog({
  file,
  labels,
  saving,
  onCancel,
  onSave,
}: {
  file: File;
  labels: { title: string; zoom: string; cancel: string; save: string };
  saving: boolean;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointerId: number; origin: Point; start: Point } | null>(null);
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  const baseScale = Math.max(CROP_SIZE / dimensions.width, CROP_SIZE / dimensions.height);
  const renderedWidth = dimensions.width * baseScale * zoom;
  const renderedHeight = dimensions.height * baseScale * zoom;
  const clampOffset = (point: Point) => ({
    x: Math.max(-(renderedWidth - CROP_SIZE) / 2, Math.min((renderedWidth - CROP_SIZE) / 2, point.x)),
    y: Math.max(-(renderedHeight - CROP_SIZE) / 2, Math.min((renderedHeight - CROP_SIZE) / 2, point.y)),
  });

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(clampOffset({
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y,
    }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const saveCrop = async () => {
    const image = imageRef.current;
    if (!image) return;
    const sourceSize = CROP_SIZE / (baseScale * zoom);
    const sourceX = Math.max(0, Math.min(dimensions.width - sourceSize, (dimensions.width - sourceSize) / 2 - offset.x / (baseScale * zoom)));
    const sourceY = Math.max(0, Math.min(dimensions.height - sourceSize, (dimensions.height - sourceSize) / 2 - offset.y / (baseScale * zoom)));
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    if (blob) onSave(blob);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-crop-title">
      <div className="w-full max-w-md rounded-xl border border-emerald-500/20 bg-[#04110d] p-4 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between gap-3">
          <h2 id="profile-crop-title" className="text-sm font-black uppercase tracking-widest text-emerald-50">{labels.title}</h2>
          <button type="button" onClick={onCancel} aria-label={labels.cancel} className="rounded p-2 text-emerald-100/60 hover:bg-emerald-500/10 hover:text-emerald-300"><X className="h-4 w-4" /></button>
        </div>

        <div
          className="relative mx-auto mt-4 h-72 w-72 touch-none cursor-grab overflow-hidden rounded-full border-2 border-emerald-400/70 bg-black active:cursor-grabbing"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, origin: offset, start: { x: event.clientX, y: event.clientY } };
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            ref={imageRef}
            src={objectUrl}
            alt=""
            draggable={false}
            onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{ width: renderedWidth, height: renderedHeight, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
          />
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_999px_rgba(2,6,4,0.12)]" />
        </div>

        <div className="mt-4 flex items-center gap-3" dir="ltr">
          <Minus className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => { setZoom(Number(event.target.value)); setOffset({ x: 0, y: 0 }); }}
            aria-label={labels.zoom}
            className="h-2 flex-1 cursor-pointer accent-emerald-500"
          />
          <Plus className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg border border-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-100 hover:border-emerald-400 disabled:opacity-50">{labels.cancel}</button>
          <button type="button" onClick={() => void saveCrop()} disabled={saving} className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black text-black hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">{labels.save}</button>
        </div>
      </div>
    </div>
  );
}

import { lazy, Suspense, useState } from "react";
import {
  DecoratorNode,
  $applyNodeReplacement,
  $getNodeByKey,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { SketchPreview } from "./SketchPreview";
import type { SketchData } from "../../lib/stanza-document";
import { useLanguage } from "../../lib/LanguageContext";
const SketchEditor = lazy(() => import("./SketchEditor"));
function SketchBlock({
  drawing,
  nodeKey,
}: {
  drawing: SketchData;
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [open, setOpen] = useState(false);
  const { isRtl } = useLanguage();
  return (
    <span className="my-4 block">
      <SketchPreview drawing={drawing} />
      <span className="block">{drawing.description}</span>
      {editable && (
        <button
          type="button"
          className="stanza-document-control"
          onClick={() => setOpen(true)}
        >
          {isRtl ? "تحرير الرسم" : "Edit sketch"}
        </button>
      )}
      {open && (
        <Suspense
          fallback={<p role="status">{isRtl ? "تحميل…" : "Loading…"}</p>}
        >
          <SketchEditor
            value={drawing}
            onClose={() => setOpen(false)}
            onSave={(next) => {
              editor.update(() => {
                const n = $getNodeByKey(nodeKey);
                if (n instanceof SketchNode) n.getWritable().__drawing = next;
              });
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </span>
  );
}
export class SketchNode extends DecoratorNode<React.JSX.Element> {
  __drawing: SketchData;
  static getType() {
    return "stanza-sketch";
  }
  static clone(n: SketchNode) {
    return new SketchNode(n.__drawing, n.__key);
  }
  constructor(
    drawing: SketchData = { description: "", shapes: [] },
    key?: NodeKey,
  ) {
    super(key);
    this.__drawing = drawing;
  }
  static importJSON(s: SerializedLexicalNode & { drawing: SketchData }) {
    return $createSketchNode(s.drawing);
  }
  exportJSON() {
    return {
      ...super.exportJSON(),
      type: "stanza-sketch",
      version: 1,
      drawing: this.getLatest().__drawing,
    };
  }
  createDOM() {
    return document.createElement("div");
  }
  updateDOM() {
    return false;
  }
  getTextContent() {
    return this.getLatest().__drawing.description;
  }
  decorate() {
    return <SketchBlock drawing={this.__drawing} nodeKey={this.getKey()} />;
  }
}
export function $createSketchNode(drawing?: SketchData) {
  return $applyNodeReplacement(new SketchNode(drawing));
}

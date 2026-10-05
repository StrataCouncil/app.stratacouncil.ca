"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { normalizeDoc, type RichDoc } from "@/lib/training/content";

/**
 * Rich text for lesson content: headings, bold/italic/underline, lists,
 * quotes and links. Code blocks, images and anything else are switched off
 * so the stored document always fits the safe subset learners render.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minimal,
}: {
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  placeholder?: string;
  /** No headings (callout bodies, scenario situations). */
  minimal?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        heading: minimal ? false : { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ["https", "http", "mailto"] },
      }),
    ],
    content: value,
    editorProps: { attributes: { class: "rte__content", "data-placeholder": placeholder ?? "" } },
    onUpdate: ({ editor }) => onChange(normalizeDoc(editor.getJSON())),
  });

  return (
    <div className="rte">
      {editor && <Toolbar editor={editor} minimal={minimal} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, minimal }: { editor: Editor; minimal?: boolean }) {
  const b = (label: string, active: boolean, run: () => void, title: string) => (
    <button
      type="button"
      className="rte__btn"
      data-active={active}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  const chain = () => editor.chain().focus();
  function link() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address (https://…). Leave empty to remove the link.", prev ?? "https://");
    if (url === null) return;
    if (!url.trim() || url.trim() === "https://") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }
  return (
    <div className="rte__toolbar" role="toolbar" aria-label="Text formatting">
      {!minimal && b("H2", editor.isActive("heading", { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), "Heading")}
      {!minimal && b("H3", editor.isActive("heading", { level: 3 }), () => chain().toggleHeading({ level: 3 }).run(), "Subheading")}
      {b("B", editor.isActive("bold"), () => chain().toggleBold().run(), "Bold")}
      {b("I", editor.isActive("italic"), () => chain().toggleItalic().run(), "Italic")}
      {b("U", editor.isActive("underline"), () => chain().toggleUnderline().run(), "Underline")}
      {b("•", editor.isActive("bulletList"), () => chain().toggleBulletList().run(), "Bulleted list")}
      {b("1.", editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), "Numbered list")}
      {b("“”", editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), "Quote")}
      {b("Link", editor.isActive("link"), link, "Link")}
    </div>
  );
}

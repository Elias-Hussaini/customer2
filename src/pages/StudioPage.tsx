/**
 * ابزار عکس — the professional image tools section.
 *
 * Two organized surfaces (بخش بخش، منظم و زیبا):
 *  - ویرایشگر: crop / pixel resize / rotate & flip (90° + fine) / adjustments /
 *    strong compression with live size estimate / undo-redo / small download
 *    chips for every format / save into the in-app library / «ذخیره در پرونده»
 *    when opened from a customer or employer document (replaces in place).
 *  - کتابخانه: folders + images, drag & drop everywhere, re-open in the
 *    editor, whole-scope ZIP export or straight into an OS folder (Chrome).
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ImagePlus } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { ImageEditor } from "../components/studio/ImageEditor";
import { StudioLibrary } from "../components/studio/StudioLibrary";
import { takePendingSource, type StudioSource } from "../lib/studio/session";
import { useStudioImages } from "../hooks/useData";
import { toPersianDigits } from "../utils/jalali";

export function StudioPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const images = useStudioImages();

  const [tab, setTab] = useState<"editor" | "library">("editor");
  /** Keyed source — changing the key remounts the editor for a fresh load. */
  const [source, setSource] = useState<StudioSource | null>(null);
  const [sourceKey, setSourceKey] = useState(0);

  // Consume anything opened from a profile or the library itself.
  useEffect(() => {
    const pending = takePendingSource();
    if (pending) {
      setSource(pending.source);
      setSourceKey((k) => k + 1);
      setTab("editor");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const openEditorWith = (next: StudioSource) => {
    setSource(next);
    setSourceKey((k) => k + 1);
    setTab("editor");
  };

  const totalBytes = (images ?? []).reduce((s, i) => s + i.size, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ابزار عکس"
        subtitle="ویرایشگر حرفه‌ای + کتابخانهٔ پوشه‌بندی‌شدهٔ داخلی"
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              openEditorWith({ kind: "files", files: [] })
            }
          >
            <ImagePlus size={15} /> تصویر جدید
          </button>
        }
      />

      <Tabs
        active={tab}
        onActiveChange={(key) => setTab(key === "library" ? "library" : "editor")}
        tabs={[
          {
            key: "editor",
            label: "ویرایشگر",
            content: (
              <ImageEditor
                key={sourceKey}
                source={source}
                onClearSource={() => setSource(null)}
                librarySlot={{ onOpenLibraryTab: () => setTab("library") }}
              />
            ),
          },
          {
            key: "library",
            label: `کتابخانه (${toPersianDigits(images?.length ?? 0)})`,
            content: (
              <StudioLibrary
                onEditInStudio={(image) => openEditorWith({ kind: "library", image })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

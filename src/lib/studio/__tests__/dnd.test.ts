/**
 * Internal studio drag & drop — the custom MIME payload plumbing behind the
 * explorer's «درگ اند دراپ متنوع» (image cards + folder tiles onto folder
 * tiles and breadcrumb crumbs).
 */

import { describe, expect, it } from "vitest";
import {
  DND_STUDIO_FOLDER,
  DND_STUDIO_IMAGES,
  folderIdFromDataTransfer,
  hasInternalStudioDrag,
  imageIdsFromDataTransfer,
} from "../dnd";

/** Minimal DataTransfer stand-in: stores type→payload like the browser does. */
function fakeDT(entries: Record<string, string> = {}, types?: string[]): {
  dt: DataTransfer;
  types: string[];
} {
  const map = new Map(Object.entries(entries));
  const allTypes = types ?? Object.keys(entries);
  return {
    dt: {
      getData: (type: string) => map.get(type) ?? "",
      setData: (type: string, value: string) => void map.set(type, value),
      get types() {
        return allTypes as unknown as DOMStringList;
      },
    } as unknown as DataTransfer,
    types: allTypes,
  };
}

describe("studio dnd payloads", () => {
  it("round-trips a multi-image selection", () => {
    const { dt } = fakeDT();
    dt.setData(DND_STUDIO_IMAGES, JSON.stringify(["a", "b", "c"]));
    expect(imageIdsFromDataTransfer(dt)).toEqual(["a", "b", "c"]);
  });

  it("tolerates garbage and non-array payloads", () => {
    expect(imageIdsFromDataTransfer(fakeDT({ [DND_STUDIO_IMAGES]: "{oops" }).dt)).toEqual([]);
    expect(imageIdsFromDataTransfer(fakeDT({ [DND_STUDIO_IMAGES]: "42" }).dt)).toEqual([]);
    expect(imageIdsFromDataTransfer(fakeDT({ [DND_STUDIO_IMAGES]: "[1,null,\"x\",\"\"]" }).dt)).toEqual(["x"]);
    expect(imageIdsFromDataTransfer(null)).toEqual([]);
  });

  it("round-trips the dragged folder id", () => {
    const { dt } = fakeDT({ [DND_STUDIO_FOLDER]: "folder-7" });
    expect(folderIdFromDataTransfer(dt)).toBe("folder-7");
    expect(folderIdFromDataTransfer(fakeDT().dt)).toBeNull();
    expect(folderIdFromDataTransfer(null)).toBeNull();
  });

  it("detects internal drags (and ignores plain file drags)", () => {
    expect(hasInternalStudioDrag({ dataTransfer: fakeDT({ [DND_STUDIO_IMAGES]: "[]" }).dt })).toBe(true);
    expect(hasInternalStudioDrag({ dataTransfer: fakeDT({ [DND_STUDIO_FOLDER]: "f" }).dt })).toBe(true);
    // OS files carry only the "Files" type
    expect(hasInternalStudioDrag({ dataTransfer: fakeDT({}, ["Files"]).dt })).toBe(false);
    expect(hasInternalStudioDrag({})).toBe(false);
    expect(hasInternalStudioDrag({ dataTransfer: null })).toBe(false);
  });
});

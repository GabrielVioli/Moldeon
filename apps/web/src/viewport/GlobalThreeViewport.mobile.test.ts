import { describe, expect, it } from "vitest";
import { arrangementGizmoTargetPixels, shouldExtendArrangementSelection } from "./GlobalThreeViewport";

describe("mobile arrangement interaction contract", () => {
  it("uses an explicit touch multi-select mode instead of keyboard modifiers", () => {
    expect(shouldExtendArrangementSelection({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: "touch",
      touchMultiSelect: true,
    })).toBe(true);
    expect(shouldExtendArrangementSelection({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: "touch",
      touchMultiSelect: false,
    })).toBe(false);
    expect(shouldExtendArrangementSelection({
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      pointerType: "mouse",
      touchMultiSelect: false,
    })).toBe(true);
  });

  it("keeps the touch gizmo smaller in portrait and landscape without changing desktop sizing", () => {
    expect(arrangementGizmoTargetPixels(390, 844, true)).toBe(70);
    expect(arrangementGizmoTargetPixels(844, 390, true)).toBe(64);
    expect(arrangementGizmoTargetPixels(1440, 900, false)).toBe(86);
  });
});

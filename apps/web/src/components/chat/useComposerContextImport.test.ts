import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { attachImportedImageToDraft } from "./useComposerContextImport";

describe("attachImportedImageToDraft blob URL lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("revokes the object URL immediately when the draft rejects the image", () => {
    const file = new File(["png-bytes"], "screenshot.png", { type: "image/png" });
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://localhost/rejected-image");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const accepted = attachImportedImageToDraft({
      file,
      localId: "img-rejected",
      name: file.name,
      allowDuplicates: false,
      addImages: () => [],
    });

    expect(accepted).toBe(false);
    expect(createSpy).toHaveBeenCalledOnce();
    expect(revokeSpy).toHaveBeenCalledWith("blob:http://localhost/rejected-image");
  });

  it("keeps the object URL alive when the draft accepts the image", () => {
    const file = new File(["png-bytes"], "screenshot.png", { type: "image/png" });
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://localhost/accepted-image");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const accepted = attachImportedImageToDraft({
      file,
      localId: "img-accepted",
      name: file.name,
      allowDuplicates: false,
      addImages: (images) => images.map((image) => image.id),
    });

    expect(accepted).toBe(true);
    expect(createSpy).toHaveBeenCalledOnce();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("revokes the object URL when composerDraftStore rejects a duplicate image", () => {
    const target = DraftId.make("draft-duplicate-blob-revoke");
    const store = useComposerDraftStore.getState();
    store.clearComposerContent(target);
    try {
      const file = new File(["duplicate-bytes"], "dup.png", { type: "image/png" });
      let counter = 0;
      vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
        counter += 1;
        return `blob:http://localhost/dup-${counter}`;
      });
      const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

      const firstAccepted = attachImportedImageToDraft({
        file,
        localId: "img-1",
        name: file.name,
        allowDuplicates: false,
        addImages: (images, options) => store.addImages(target, images, options),
      });
      expect(firstAccepted).toBe(true);
      expect(revokeSpy).not.toHaveBeenCalled();

      const duplicateAccepted = attachImportedImageToDraft({
        file,
        localId: "img-2",
        name: file.name,
        allowDuplicates: false,
        addImages: (images, options) => store.addImages(target, images, options),
      });
      expect(duplicateAccepted).toBe(false);
      expect(revokeSpy).toHaveBeenCalledWith("blob:http://localhost/dup-2");
    } finally {
      store.clearComposerContent(target);
    }
  });
});

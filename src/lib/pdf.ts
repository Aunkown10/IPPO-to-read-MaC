import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageSize } from "../types";
GlobalWorkerOptions.workerSrc = workerUrl;

const DEFAULT_PAGE: PageSize = { width: 760, height: 1080, mime: "application/pdf" };

async function pageSize(document: PDFDocumentProxy, pageNumber: number): Promise<PageSize> {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { width: Math.max(1, Math.round(viewport.width)), height: Math.max(1, Math.round(viewport.height)), mime: "application/pdf" };
}

export async function openPdf(
  bytes: ArrayBuffer,
  knownPages: PageSize[],
  signal: AbortSignal,
  onProgress?: (pages: PageSize[], complete: boolean) => void,
): Promise<{ document: PDFDocumentProxy; pages: PageSize[] }> {
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  const task = getDocument({
    data: new Uint8Array(bytes), cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
    enableXfa: false,
  });
  const abort = () => { void task.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const document = await task.promise;
    if (signal.aborted) throw new Error("PDF opening cancelled");

    // Do not block opening on every page. Allocate lightweight placeholders so the
    // reader knows the real page count immediately, then hydrate geometry in batches.
    const hasCompleteCache = knownPages.length === document.numPages && knownPages.length > 0;
    const pages: PageSize[] = Array.from({ length: document.numPages }, (_, index) =>
      hasCompleteCache && knownPages[index]
        ? { ...knownPages[index], mime: "application/pdf" }
        : { ...DEFAULT_PAGE },
    );
    if (!pages.length) throw new Error("PDF contains no pages");
    if (hasCompleteCache) {
      onProgress?.([...pages], true);
      return { document, pages };
    }

    const warmCount = Math.min(8, document.numPages);
    await Promise.all(Array.from({ length: warmCount }, async (_, i) => { pages[i] = await pageSize(document, i + 1); }));
    onProgress?.([...pages], warmCount === document.numPages);

    if (warmCount < document.numPages) {
      void (async () => {
        try {
          for (let base = warmCount + 1; base <= document.numPages; base += 12) {
            if (signal.aborted) return;
            const count = Math.min(12, document.numPages - base + 1);
            const batch = await Promise.all(Array.from({ length: count }, (_, offset) => pageSize(document, base + offset)));
            batch.forEach((size, offset) => { pages[base - 1 + offset] = size; });
            onProgress?.([...pages], base + count - 1 >= document.numPages);
            // Yield between batches so huge PDFs stay responsive.
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
        } catch (error) {
          if (!signal.aborted) console.warn("PDF background page geometry loading stopped", error);
        }
      })();
    }
    return { document, pages: [...pages] };
  } catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === "PasswordException") throw new Error("Password-protected PDFs are not supported in this version. Import an unlocked copy.");
    throw error;
  } finally { signal.removeEventListener("abort", abort); }
}

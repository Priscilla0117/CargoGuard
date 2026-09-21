/** Native filesystem paths avoid PDF.js treating file:// URLs as literal filenames. */
export function pdfResourceOptions() {
  if (
    typeof process === "undefined" ||
    process.release?.name !== "node" ||
    typeof process.getBuiltinModule !== "function"
  ) return {};

  // Keep Node-only modules out of browser/Worker import graphs. All supported
  // Node commands run from the application root, as required by the deployment guide.
  const { createRequire } = process.getBuiltinModule("node:module");
  const { dirname, join } = process.getBuiltinModule("node:path");
  const resolveFromApp = createRequire(join(process.cwd(), "package.json"));
  // A missing resource package surfaces as a parsing failure/review, not fallback.
  const base = dirname(resolveFromApp.resolve("pdfjs-dist/package.json"))
    .replaceAll("\\", "/");
  return {
    standardFontDataUrl: `${base}/standard_fonts/`,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    disableFontFace: true,
  };
}

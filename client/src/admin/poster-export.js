const DIMENSIONS = Object.freeze({ square: [1080, 1080], portrait: [1080, 1350], landscape: [1350, 1080], story: [1080, 1920] });

function blobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not prepare poster artwork for export."));
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.hidden = true;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPoster({ svg, poster, format = "png" }) {
  if (!svg) throw new Error("Poster preview is not ready yet.");
  const clone = svg.cloneNode(true);
  const art = clone.querySelector("image");
  if (art) {
    let src = poster.artworkDataUrl || art.getAttribute("href");
    if (src && !src.startsWith("data:")) {
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Generated artwork could not be loaded for export.");
      src = await blobAsDataUrl(await response.blob());
    }
    if (src) art.setAttribute("href", src);
  }
  const markup = new XMLSerializer().serializeToString(clone);
  const name = (poster.title || "tambola-poster").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "tambola-poster";
  if (format === "svg") {
    downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
    return { format, dimensions: "vector" };
  }
  const image = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    image.src = url; await image.decode();
    const [width, height] = DIMENSIONS[poster.layoutSize] || DIMENSIONS.portrait;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("PNG rendering failed.");
    downloadBlob(png, `${name}.png`);
    return { format, dimensions: `${width}×${height}` };
  } finally { URL.revokeObjectURL(url); }
}

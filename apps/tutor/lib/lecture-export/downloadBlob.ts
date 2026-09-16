export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  // Firefox ignores a synthetic .click() on a detached node and can revoke
  // the blob URL before the download starts. Keep the node in the document
  // and leave the URL alive long enough for the save dialog.
  link.style.position = "fixed";
  link.style.left = "0";
  link.style.top = "0";
  link.style.width = "1px";
  link.style.height = "1px";
  link.style.opacity = "0";
  document.body.appendChild(link);
  link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }),
  );
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

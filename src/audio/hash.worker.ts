self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await event.data.arrayBuffer(),
    );
    self.postMessage({
      hash: [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
    });
  } catch {
    self.postMessage({ error: true });
  }
};

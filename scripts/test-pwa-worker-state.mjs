// Observe this installation even when update() resolves before updatefound.
export function checkForWorkerUpdate(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const terminal = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Worker install did not settle")), 15_000);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        function observe() {
          if (worker.state !== "installed" && worker.state !== "redundant") return;
          clearTimeout(timer);
          worker.removeEventListener("statechange", observe);
          resolve(worker.state);
        }
        worker.addEventListener("statechange", observe);
        observe();
      }, { once: true });
    });
    const [state] = await Promise.all([terminal, registration.update()]);
    return state;
  });
}

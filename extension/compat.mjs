export function legacyDrawIsActive(host = globalThis) {
  return ['xiaobaixComfyDraw','xiaobaixNovelDraw','xiaobaixSdDraw'].some(key => host[key]?.isEnabled?.() === true);
}

export async function copyLegacyGallery(idb, destination) {
  const databases = await idb.databases();
  if (!databases.some(db => db.name === 'xb_novel_draw_previews')) return 0;
  const source = await new Promise((resolve, reject) => {
    const request = idb.open('xb_novel_draw_previews');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let copied = 0;
  try {
    for (const name of ['previews','selections']) {
      if (!source.objectStoreNames.contains(name) || !destination.objectStoreNames.contains(name)) continue;
      const rows = await new Promise((resolve, reject) => {
        const request = source.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = destination.transaction(name, 'readwrite');
        for (const row of rows) {
          const request = transaction.objectStore(name).add(row);
          request.onsuccess = () => { if (name === 'previews') copied++; };
          request.onerror = event => {
            if (request.error?.name === 'ConstraintError') { event.preventDefault(); event.stopPropagation(); }
          };
        }
        transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
      });
    }
    return copied;
  } finally { source.close(); }
}

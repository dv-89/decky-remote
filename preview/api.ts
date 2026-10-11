// Fictional in-memory files only. This preview never reads/copies real files.
const entries: Record<string, { name: string; path: string; kind: string; size: number }[]> = {
  "/home/deck": [{ name: "Downloads", path: "/home/deck/Downloads", kind: "folder", size: 0 }, { name: "Documents", path: "/home/deck/Documents", kind: "folder", size: 0 }, { name: ".config", path: "/home/deck/.config", kind: "folder", size: 0 }],
  "/home/deck/Downloads": [{ name: "notes.txt", path: "/home/deck/Downloads/notes.txt", kind: "file", size: 2560 }, { name: "controller-layout.json", path: "/home/deck/Downloads/controller-layout.json", kind: "file", size: 4096 }],
  "/home/deck/Documents": [], "/home/deck/.config": [], "/run/media/deck/SD card": [],
};
export function callable<Args extends unknown[], Result>(method: string) {
  return async (...args: Args): Promise<Result> => {
    if (method === "list_files") {
      const path = String(args[0] || "/home/deck");
      if (!entries[path]) return { ok: false, error: "Choose a folder inside Home or mounted storage" } as Result;
      return { ok: true, folder: { path, parent: path.startsWith("/home/deck/") ? "/home/deck" : "", roots: [{ name: "Home", path: "/home/deck" }, { name: "SD card", path: "/run/media/deck/SD card" }], entries: entries[path].filter(entry => args[1] || !entry.name.startsWith(".")), truncated: false } } as Result;
    }
    const [src, dest] = args.map(String);
    const source = Object.values(entries).flat().find(entry => entry.path === src);
    if (!source || !entries[dest]) return { ok: false, error: "Choose a file and destination folder" } as Result;
    if (entries[dest].some(entry => entry.name === source.name)) return { ok: false, error: "A file with that name already exists. Nothing was replaced." } as Result;
    const path = dest + "/" + source.name;
    entries[dest].push({ ...source, path });
    return { ok: true, path } as Result;
  };
}

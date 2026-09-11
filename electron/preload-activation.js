const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ocapos", {
  activar: (clave) => ipcRenderer.invoke("activar-licencia", clave),
});

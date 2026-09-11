// Puente seguro (contextIsolation) entre la ventana principal y el proceso main: solo expone
// las dos acciones de backup local, nada más del sistema de archivos ni de Node.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ocapos", {
  crearBackup: () => ipcRenderer.invoke("crear-backup"),
  restaurarBackup: () => ipcRenderer.invoke("restaurar-backup"),
});

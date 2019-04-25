export function authorizeNewStoreAccess() {
    return new Promise((resolve, reject) => {
        chrome.fileSystem.chooseEntry({ type: "openDirectory" }, entry => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(chrome.fileSystem.retainEntry(entry));
        });
    });
}

export function restoreStoreAccess(storePathId) {
    return new Promise((resolve, reject) => {
        chrome.fileSystem.restoreEntry(storePathId, entry => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (entry.isDirectory) {
                resolve(entry);
            } else {
                reject(new Error("Not a directory"));
            }
        });
    });
}

export function fetchFileContents(storeEntry, relPath, binary = false) {
    return new Promise((resolve, reject) => {
        storeEntry.getFile(
            relPath,
            {},
            fileEntry => {
                fileEntry.file(file => {
                    const reader = new FileReader();
                    reader.onerror = reject;
                    reader.onload = () => resolve(reader.result);
                    if (binary) {
                        reader.readAsArrayBuffer(file);
                    } else {
                        reader.readAsText(file);
                    }
                });
            },
            reject
        );
    });
}

export function listEncryptedFiles(storeEntry) {
    return new Promise(async (resolve, reject) => {
        try {
            const stack = [storeEntry];
            const files = [];
            while (stack.length !== 0) {
                const curDir = stack.pop();
                const entries = await readAllEntries(curDir.createReader());
                entries.forEach(entry => {
                    if (entry.isDirectory) {
                        stack.push(entry);
                    } else if (entry.name.endsWith(".gpg")) {
                        const trimmedPath = entry.fullPath.substring(
                            entry.fullPath.indexOf("/", 1) + 1
                        );
                        files.push(trimmedPath);
                    }
                });
            }
            resolve(files);
        } catch (e) {
            reject(e);
        }
    });
}

function readAllEntries(dirReader) {
    return new Promise((resolve, reject) => {
        dirReader.readEntries(async entries => {
            if (entries.length > 0) {
                try {
                    const remainingEntries = await readAllEntries(dirReader);
                    resolve(entries.concat(remainingEntries));
                } catch (e) {
                    reject(e);
                }
            } else {
                resolve([]);
            }
        }, reject);
    });
}

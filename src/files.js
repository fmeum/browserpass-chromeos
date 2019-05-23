// uses git from node_modules/isomorphic-git/dist/bundle.umd.min.js

function normalizeArgs(optionalAndCallback, errnoMap) {
    errnoMap = errnoMap || {};
    let optional;
    let callback;
    if (typeof optionalAndCallback === "function") {
        // Callback received as bare function
        callback = optionalAndCallback;
    } else if (optionalAndCallback && optionalAndCallback.length === 1) {
        // No optional argument received, only a callback
        callback = optionalAndCallback[0];
    } else if (optionalAndCallback && optionalAndCallback.length === 2) {
        // Optional argument and callback received
        optional = optionalAndCallback[0];
        callback = optionalAndCallback[1];
    } else {
        // No callback received, use a noop and log
        console.log("ChromeFS: function called without a callback");
        callback = () => {};
    }
    const resolve = (...args) => callback(null, ...args);
    const reject = e => {
        if (e instanceof ChromeFSError) {
            callback(e);
        } else if (e instanceof DOMException && e.code in errnoMap) {
            callback(new ChromeFSError(errnoMap[e.code], e.message));
        } else {
            console.error(e, e.code, e.message);
            callback(new ChromeFSError("EINVAL", e.message));
        }
    };
    return [resolve, reject, optional];
}

function dirname(path) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1) {
        throw new ChromeFSError("EINVAL", `Cannot get dirname of '${path}'`);
    } else if (lastSlash === 0) {
        return "/";
    } else {
        return path.slice(0, lastSlash);
    }
}

function basename(path) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1) {
        return path;
    } else if (lastSlash === 0) {
        throw new ChromeFSError("EINVAL", `Cannot get basename of '${path}'`);
    } else {
        return path.slice(lastSlash + 1);
    }
}

function numericHash(str) {
    return str.split("").reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
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

export function readFileEntry(fileEntry, asString = false) {
    return new Promise((resolve, reject) => {
        fileEntry.file(file => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                if (reader.result instanceof ArrayBuffer) {
                    resolve(new Uint8Array(reader.result));
                } else {
                    resolve(reader.result);
                }
            };
            if (asString) {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        });
    });
}

class ChromeFSError extends Error {
    constructor(code, ...args) {
        super(...args);
        this.code = code;
        this.name = `ChromeFSError (${code})`;
    }
}

class ChromeFS {
    constructor(root) {
        if (!(root.constructor.name === "DirectoryEntry")) {
            throw new ChromeFSError("EINVAL", "root is not a DirectoryEntry");
        }
        this._root = root;
    }

    _abs(path) {
        if (path.length === 0) {
            return this._root.fullPath;
        } else if (path[0] === "/") {
            return this._root.fullPath + path;
        } else {
            return this._root.fullPath + "/" + path;
        }
    }

    readFile(path, ...optionsAndCb) {
        path = this._abs(path);
        const [resolve, reject, options] = normalizeArgs(optionsAndCb, {
            [DOMException.NOT_FOUND_ERR]: "ENOENT",
            [DOMException.TYPE_MISMATCH_ERR]: "EISDIR"
        });
        const asString = options && (options.encoding === "utf8" || options === "utf8");
        this._root.getFile(
            path,
            {},
            fileEntry =>
                readFileEntry(fileEntry, asString)
                    .then(resolve)
                    .catch(reject),
            reject
        );
    }

    writeFile(path, data, ...optionsAndCb) {
        path = this._abs(path);
        const [resolve, reject] = normalizeArgs(optionsAndCb, {
            [DOMException.INVALID_STATE_ERR]: "EISDIR",
            [DOMException.NOT_FOUND_ERR]: "ENOENT",
            [DOMException.TYPE_MISMATCH_ERR]: "EISDIR"
        });
        let fromString;
        if (typeof data === "string") {
            fromString = true;
        } else if (data instanceof ArrayBuffer) {
            fromString = false;
        } else if (data && data.buffer instanceof ArrayBuffer) {
            data = data.buffer;
            fromString = false;
        } else {
            reject(
                new ChromeFSError("EINVAL", "data is not one of: String, TypedArray, ArrayBuffer")
            );
        }
        this._root.getFile(
            path,
            { create: true },
            fileEntry => {
                fileEntry.createWriter(writer => {
                    writer.onerror = reject;
                    writer.onwriteend = () => resolve();
                    let type;
                    if (fromString) {
                        type = "text/plain";
                    } else {
                        type = "application/octet-stream";
                    }
                    writer.write(new Blob([data], { type }));
                }, reject);
            },
            reject
        );
    }

    unlink(path, cb) {
        path = this._abs(path);
        const [resolve, reject] = normalizeArgs(cb, {
            [DOMException.NOT_FOUND_ERR]: "ENOENT"
        });
        this._root.getFile(path, /* options */ {}, file => file.remove(resolve, reject), reject);
    }

    readdir(path, ...optionsAndCb) {
        path = this._abs(path);
        const [resolve, reject] = normalizeArgs(...optionsAndCb, {
            [DOMException.NOT_FOUND_ERR]: "ENOENT"
        });
        this._root.getDirectory(
            path,
            /* options */ {},
            dir => {
                const reader = dir.createReader();
                readAllEntries(reader)
                    .then(entries => resolve(entries.map(entry => entry.name)))
                    .catch(reject);
            },
            reject
        );
    }

    mkdir(path, ...optionsAndCb) {
        path = this._abs(path);
        const [resolve, reject] = normalizeArgs(...optionsAndCb, {
            [DOMException.INVALID_MODIFICATION_ERR]: "EEXIST",
            [DOMException.NOT_FOUND_ERR]: "ENOENT"
        });
        this._root.getDirectory(path, { create: true, exclusive: true }, () => resolve(), reject);
    }

    rmdir(path, cb) {
        path = this._abs(path);
        const [resolve, reject] = normalizeArgs(cb, {
            [DOMException.INVALID_MODIFICATION_ERR]: "ENOTEMPTY",
            [DOMException.NOT_FOUND_ERR]: "ENOENT",
            [DOMException.TYPE_MISMATCH_ERR]: "ENOTDIR"
        });
        this._root.getDirectory(path, /* options */ {}, dir => dir.remove(resolve, reject), reject);
    }

    rename(oldPath, newPath, cb) {
        oldPath = this._abs(oldPath);
        newPath = this._abs(newPath);
        const [resolve, reject] = normalizeArgs(cb, {
            [DOMException.INVALID_MODIFICATION_ERR]: "EINVAL",
            [DOMException.NOT_FOUND_ERR]: "ENOENT"
        });
        let newParentPath;
        let newName;
        try {
            newParentPath = dirname(newPath);
            newName = basename(newPath);
        } catch (e) {
            reject(e);
            return;
        }
        this._root.getDirectory(
            newParentPath,
            /* options */ {},
            newParent =>
                // We cannot know whether oldPath refers to a file or a directory, so we try both
                this._root.getFile(
                    oldPath,
                    /* options */ {},
                    oldFile => oldFile.moveTo(newParent, newName, () => resolve(), reject),
                    () =>
                        this._root.getDirectory(
                            oldPath,
                            /* options */ {},
                            oldDir => oldDir.moveTo(newParent, newName, () => resolve(), reject),
                            reject
                        )
                ),
            reject
        );
    }

    stat(path, ...optionsAndCb) {
        path = this._abs(path);
        const [resolve, reject] = normalizeArgs(optionsAndCb, {
            [DOMException.NOT_FOUND_ERR]: "ENOENT"
        });
        const submitMetadata = (metadata, entry) => {
            resolve({
                type: entry.isFile ? "file" : "dir",
                size: metadata.size,
                mtimeMs: metadata.modificationTime.getTime(),
                ctimeMs: metadata.modificationTime.getTime(),
                mode: 0o600,
                uid: 1,
                gid: 1,
                dev: numericHash(this._root.filesystem.name),
                ino: numericHash(entry.fullPath),
                isFile: () => entry.isFile,
                isDirectory: () => !entry.isFile,
                isSymbolicLink: () => false
            });
        };
        // We cannot know whether path refers to a file or a directory, so we try both
        this._root.getFile(
            path,
            /* options */ {},
            file => file.getMetadata(metadata => submitMetadata(metadata, file), reject),
            () =>
                this._root.getDirectory(
                    path,
                    /* options */ {},
                    dir => dir.getMetadata(metadata => submitMetadata(metadata, dir), reject),
                    reject
                )
        );
    }

    lstat(path, ...optionsAndCb) {
        return this.stat(path, ...optionsAndCb);
    }

    readlink(path, ...optionsAndCb) {
        const [, reject] = normalizeArgs(optionsAndCb);
        reject(new ChromeFSError("ENOTSUP", "readlink() is not supported"));
    }

    symlink(target, path, ...typeAndCb) {
        const [, reject] = normalizeArgs(typeAndCb);
        reject(new ChromeFSError("ENOTSUP", "symlink() is not supported"));
    }
}

export function authorizeNewStoreAccess() {
    return new Promise((resolve, reject) => {
        chrome.fileSystem.chooseEntry({ type: "openDirectory" }, entry => {
            if (chrome.runtime.lastError) {
                // User cancelled
                reject();
                return;
            }
            const fs = new ChromeFS(entry);
            fs.stat("/.gpg-id", (e, result) => {
                if (e) {
                    reject(new Error("Selected directory is not a pass store (missing .gpg-id)"));
                } else {
                    if (!result.isFile()) {
                        reject(
                            new Error(
                                "Selected directory is not a pass store (.gpg-id is not a file)"
                            )
                        );
                    } else {
                        resolve(chrome.fileSystem.retainEntry(entry));
                    }
                }
            });
        });
    });
}

export function chooseFile() {
    return new Promise((resolve, reject) => {
        chrome.fileSystem.chooseEntry({ type: "openFile" }, entry => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(entry);
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

export function readFileInStore(storeEntry, path, asString = false) {
    return new Promise((resolve, reject) => {
        const fs = new ChromeFS(storeEntry);
        fs.readFile(path, asString ? null : { encoding: "utf8" }, (e, data) => {
            if (e) {
                reject(e);
            } else {
                resolve(data);
            }
        });
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

export async function getGpgIdPath(storeEntry, path) {
    const fs = new ChromeFS(storeEntry);
    const parent = dirname(path);
    if (path === parent) {
        throw new Error("No .gpg-id file found in the store");
    } else {
        const candidate = parent === "/" ? "/.gpg-id" : `${parent}/.gpg-id`;
        return new Promise((resolve, reject) =>
            fs.stat(candidate, (e, metadata) => {
                if (!e && metadata.isFile()) {
                    resolve(candidate);
                } else {
                    getGpgIdPath(storeEntry, parent)
                        .then(resolve)
                        .catch(reject);
                }
            })
        );
    }
}

async function test() {
    let fs = new ChromeFS(await restoreStoreAccess("70BADDB1386975CE02EFEEF18F62BB60:tmp"));
    git.plugins.set("fs", fs);
    console.log(await git.status({ dir: "/", filepath: "test2.gpg" }));
    console.log(await git.add({ dir: "/", filepath: "test2.gpg" }));
    console.log(
        await git.commit({
            dir: "/",
            message: "Dies ist ein Test",
            author: { name: "BrowserPass", email: "browserpass-chromeos@browserpass" }
        })
    );
}

//------------------------------------- Initialisation --------------------------------------//

import { ErrorCode } from "./errors.js";
import { readFileInStore, restoreStoreAccess, listEncryptedFiles } from "./files.js";
import { parsePgpMessage, decryptWithSessionKey } from "./openpgp.js";
import { decryptOnSmartCard } from "./smart-card.js";
import { validateRequest } from "./validator.js";

const VALID_SENDERS = [
    "naepdomgkenhinolocfifgehidddafch",
    "pjmbgaakjkbhpopmakjoedenlfdmcdgm",
    "klfoddkbhleoaabpmiigbmpbjfljimgb"
];

// Main entry point, invoked from browserpass.
chrome.runtime.onMessageExternal.addListener(handleRequests);

// Secondary entry point, invoked from the launcher.
// Allows to modify the app's settings.
chrome.app.runtime.onLaunched.addListener(function() {
    chrome.app.window.create("app/settings.html", {
        id: "settings"
    });
});

//------------------------------------- Function definitions --------------------------------//

async function handleRequests(request, sender, sendResponse) {
    // reject invalid senders
    if (!VALID_SENDERS.includes(sender.id)) {
        return;
    }

    const validationResult = validateRequest(request);
    if (!validationResult.valid) {
        sendResponse(
            makeErrorResponse(ErrorCode.ParseRequest, {
                message: "Unable to parse the browser request",
                error: validationResult.errors[0].message
            })
        );
        return;
    }

    let response;
    switch (request.action) {
        case "configure":
            response = await handleConfigure(request.settings);
            break;
        case "list":
            response = await handleList(request.settings);
            break;
        case "fetch":
            response = await handleFetch(request);
            break;
        case "echo":
            response = makeOkResponse(request.echoResponse);
            break;
        default:
            response = makeErrorResponse(ErrorCode.InvalidRequestAction, {
                message: "Invalid request action",
                action: request.action
            });
    }

    sendResponse(response);
}

async function handleConfigure(settings) {
    const data = { storeSettings: {} };

    if (Object.keys(settings.stores).length === 0) {
        return makeErrorResponse(ErrorCode.UnknownDefaultPasswordStoreLocation, {
            message: "Please start the Browserpass Chrome OS app to configure a password store.",
            action: "configure"
        });
    }

    for (const store of Object.values(settings.stores)) {
        try {
            const storeEntry = await restoreStoreAccess(store.path);
            data.storeSettings[store.id] = "{}";
            try {
                const rawContent = await readFileInStore(storeEntry, ".browserpass.json");
                // Verify that the file contains valid JSON.
                // TODO: Verify a schema.
                JSON.parse(rawContent);
                data.storeSettings[store.id] = rawContent;
            } catch (e) {
                if (e.code !== "ENOENT") {
                    return makeErrorResponse(ErrorCode.UnreadablePasswordStoreDefaultSettings, {
                        message: "Unable to read .browserpass.json of the password store",
                        action: "configure",
                        error: e.message,
                        storeId: store.id,
                        storeName: store.name,
                        storePath: store.path
                    });
                }
            }
        } catch (e) {
            return makeErrorResponse(ErrorCode.InaccessiblePasswordStore, {
                message: "Failed to restore access to the password store",
                action: "configure",
                error: e.message,
                storeId: store.id,
                storeName: store.name,
                storePath: store.path
            });
        }
    }

    return makeOkResponse(data);
}

async function handleList(settings) {
    const data = { files: {} };
    for (const store of Object.values(settings.stores)) {
        try {
            const storeEntry = await restoreStoreAccess(store.path);
            try {
                data.files[store.id] = await listEncryptedFiles(storeEntry);
            } catch (e) {
                return makeErrorResponse(ErrorCode.UnableToListFilesInPasswordStore, {
                    message: "Unable to list the files in the password store",
                    action: "list",
                    error: e.message,
                    storeId: store.id,
                    storeName: store.name,
                    storePath: store.path
                });
            }
        } catch (e) {
            return makeErrorResponse(ErrorCode.InaccessiblePasswordStore, {
                message: "Failed to restore access to the password store",
                action: "list",
                error: e.message,
                storeId: store.id,
                storeName: store.name,
                storePath: store.path
            });
        }
    }

    return makeOkResponse(data);
}

async function handleFetch(request) {
    const data = {};
    if (!request.file.endsWith(".gpg")) {
        return makeErrorResponse(ErrorCode.InvalidPasswordFileExtension, {
            message: "The requested password file does not have the expected '.gpg' extension",
            action: "fetch",
            file: request.file
        });
    }
    const store = request.settings.stores[request.storeId];
    if (store === undefined) {
        return makeErrorResponse(ErrorCode.InvalidPasswordStore, {
            message: "The password store is not present in the list of stores",
            action: "fetch",
            storeId: request.storeId
        });
    }
    try {
        const storeEntry = await restoreStoreAccess(store.path);
        try {
            const encryptedContents = new Uint8Array(
                await readFileInStore(storeEntry, request.file, /* binary */ true)
            );
            const { pgpMessage, encryptedSessionKeyForKeyId } = await parsePgpMessage(
                encryptedContents
            );
            const decryptedSessionKey = await decryptOnSmartCard(
                encryptedSessionKeyForKeyId,
                request.settings.windowBounds
            );
            data.contents = await decryptWithSessionKey(pgpMessage, decryptedSessionKey);
        } catch (e) {
            return makeErrorResponse(ErrorCode.UnableToDecryptPasswordFile, {
                message: "Unable to decrypt the password file",
                action: "fetch",
                error: e.message,
                file: request.file,
                storeId: store.id,
                storeName: store.name,
                storePath: store.path
            });
        }
    } catch (e) {
        return makeErrorResponse(ErrorCode.InaccessiblePasswordStore, {
            message: "Failed to restore access to the password store",
            action: "fetch",
            error: e.message,
            storeId: store.id,
            storeName: store.name,
            storePath: store.path
        });
    }

    return makeOkResponse(data);
}

function makeOkResponse(data) {
    return {
        status: "ok",
        version: versionAsInt(),
        data
    };
}

function makeErrorResponse(code, params) {
    return {
        status: "error",
        code,
        version: versionAsInt(),
        params
    };
}

function versionAsInt() {
    const { version } = chrome.runtime.getManifest();
    const versionComponents = version.split(".");
    if (versionComponents.length !== 3) {
        console.error("The 'version' field in manifest.json is not of the form X.Y.Z");
        return 0;
    }
    return (
        parseInt(versionComponents[0]) * 1000000 +
        parseInt(versionComponents[1]) * 1000 +
        parseInt(versionComponents[2])
    );
}

//------------------------------------- Initialisation --------------------------------------//

"use strict";

import { ErrorCode } from "./errors.js";
import { fetchFileContents, restoreStoreAccess } from "./files.js";

const VERSION_MAJOR = 3;
const VERSION_MINOR = 1;
const VERSION_PATCH = 0;

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
    chrome.app.window.create("options/options.html", {
        id: "options",
        bounds: { width: 620, height: 500 }
    });
});

//------------------------------------- Function definitions --------------------------------//

async function handleRequests(request, sender, sendResponse) {
    // reject invalid senders
    if (!VALID_SENDERS.includes(sender.id)) {
        return;
    }

    let response;
    switch (request.action) {
        case "configure":
            response = await handleConfigure(request.settings);
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
                const rawContent = await fetchFileContents(storeEntry, ".browserpass.json");
                // Verify that the file contains valid JSON.
                // TODO: Verify a schema.
                JSON.parse(rawContent);
                data.storeSettings[store.id] = rawContent;
            } catch (e) {
                if (e.name !== "NotFoundError") {
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
    return VERSION_MAJOR * 1000000 + VERSION_MINOR * 1000 + VERSION_PATCH;
}

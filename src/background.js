//------------------------------------- Initialisation --------------------------------------//

"use strict";

import { ErrorCode } from "./errors.js";

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

function handleRequests(request, sender, sendResponse) {
    // reject invalid senders
    if (!VALID_SENDERS.includes(sender.id)) {
        return;
    }

    let response;
    switch (request.action) {
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

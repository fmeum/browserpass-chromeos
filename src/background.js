//------------------------------------- Initialisation --------------------------------------//

"use strict";

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

//------------------------------------- Function definitions --------------------------------//

function handleRequests(request, sender, sendResponse) {
    // reject invalid senders
    if (!VALID_SENDERS.includes(sender.id)) {
        return;
    }
    // TODO: implement
    const response = makeErrorResponse(12, {
        message: "Not implemented.",
        action: request.action
    });

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

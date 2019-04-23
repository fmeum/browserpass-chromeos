"use strict";

import { authorizeNewStoreAccess } from "../files.js";

window.addEventListener("load", init);

function init() {
    document.getElementById("store-access-btn").addEventListener("click", onClickStoreAccessBtn);
    document.getElementById("store-path-id-txt").addEventListener("click", onClickStorePathIdTxt);
}

async function onClickStoreAccessBtn() {
    try {
        const storePathId = await authorizeNewStoreAccess();
        document.getElementById("store-path-id-txt").value = storePathId;
        document.getElementById("store-path-id-txt").click();
    } catch (e) {
        // User did not select a store, do nothing.
    }
}

function onClickStorePathIdTxt() {
    document.getElementById("store-path-id-txt").select();
}

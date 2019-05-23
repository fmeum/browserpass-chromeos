"use strict";

import { authorizeNewStoreAccess, chooseFile, readFileEntry } from "../files.js";
import {
    convertPubkeyToEntry,
    getEncryptionSubkeys,
    isValidPublicKey,
    openAndInitDB,
    reverseAndNormalize
} from "../openpgp.js";

window.addEventListener("load", init);

async function init() {
    document
        .querySelector(".store-access__authorize")
        .addEventListener("click", onClickStoreAccessAuthorize);
    document.querySelector(".store-access__id").addEventListener("click", onClickStoreAccessId);
    document
        .querySelector(".pubkey-list__import-from-file")
        .addEventListener("click", onClickPubkeyListImportFromFile);
    await loadSettings();
}

async function loadSettings() {
    const db = await openAndInitDB();
    const pubkeys = await db.getAll("pubkeys");
    const table = document.querySelector(".pubkey-list__table");
    document
        .querySelectorAll(".pubkey-list__table > tr")
        .forEach(el => el.parentNode.removeChild(el));
    for (const pubkey of pubkeys) {
        const row = await createRowFromRawPubkey(pubkey.raw);
        table.appendChild(row);
    }
}

function createDownloadLink(rawPubkey) {
    return `data:application/pgp-keys,${encodeURIComponent(rawPubkey)}`;
}

function prettifyHex(hex) {
    return hex
        .toUpperCase()
        .match(/.{1,4}/g)
        .join(" ");
}

async function createRowFromRawPubkey(rawPubkey) {
    // Public keys are stored individually, hence keys only has a single element
    const pubkey = (await openpgp.key.readArmored(rawPubkey)).keys[0];

    const row = document.createElement("tr");
    row.className = "pubkey-list__row";
    row.id = `pubkey-${pubkey.getFingerprint()}`;

    const deleteCell = document.createElement("td");
    deleteCell.className = "pubkey-list__delete-cell";
    const deleteLink = document.createElement("a");
    deleteLink.className = "pubkey-list__delete-link";
    deleteLink.textContent = "X";
    deleteLink.href = "#";
    deleteLink.dataset.fingerprint = pubkey.getFingerprint();
    deleteLink.addEventListener("click", onClickDeleteLink);
    deleteCell.appendChild(deleteLink);
    row.appendChild(deleteCell);

    const fingerprintCell = document.createElement("td");
    fingerprintCell.className = "pubkey-list__fingerprint-cell";
    const fingerprintLink = document.createElement("a");
    fingerprintLink.className = "pubkey-list__fingerprint";
    fingerprintLink.textContent = prettifyHex(pubkey.getFingerprint());
    fingerprintLink.setAttribute("download", `${pubkey.getFingerprint()}.pub`);
    fingerprintLink.href = createDownloadLink(rawPubkey);
    fingerprintCell.appendChild(fingerprintLink);
    row.appendChild(fingerprintCell);

    const subkeysCell = document.createElement("td");
    subkeysCell.className = "pubkey-list__subkeys-cell";
    const encryptionSubkeys = await getEncryptionSubkeys(pubkey);
    for (const subkey of encryptionSubkeys) {
        const subkeyFingerprint = document.createElement("div");
        subkeyFingerprint.className = "pubkey-list__fingerprint";
        subkeyFingerprint.textContent = prettifyHex(subkey.getFingerprint());
        subkeysCell.appendChild(subkeyFingerprint);
    }
    row.appendChild(subkeysCell);

    const idsCell = document.createElement("td");
    idsCell.className = "pubkey-list__user-ids-cell";
    for (const userId of pubkey.getUserIds()) {
        const id = document.createElement("div");
        id.className = "pubkey-list__user-id";
        id.textContent = userId;
        idsCell.appendChild(id);
    }
    row.appendChild(idsCell);

    return row;
}

async function onClickStoreAccessAuthorize() {
    try {
        const storePathId = await authorizeNewStoreAccess();
        const storePathIdTextbox = document.querySelector(".store-access__id");
        storePathIdTextbox.value = storePathId;
        storePathIdTextbox.click();
    } catch (e) {
        if (e) {
            console.error(e);
        }
    }
}

function onClickStoreAccessId() {
    document.querySelector(".store-access__id").select();
}

async function onClickPubkeyListImportFromFile() {
    let rawPubkeysFileEntry;
    try {
        rawPubkeysFileEntry = await chooseFile();
    } catch (e) {
        // User cancelled
        return;
    }
    const rawPubkeys = await readFileEntry(rawPubkeysFileEntry, /* asString */ true);
    const pubkeys = (await openpgp.key.readArmored(rawPubkeys)).keys;
    const db = await openAndInitDB();
    for (const pubkey of pubkeys) {
        if (!isValidPublicKey(pubkey)) {
            continue;
        }
        const entry = await convertPubkeyToEntry(pubkey);
        await db.put("pubkeys", entry);
    }
    await loadSettings();
}

async function onClickDeleteLink(e) {
    e.preventDefault();
    const fingerprint = e.target.dataset.fingerprint;
    (await openAndInitDB()).delete("pubkeys", reverseAndNormalize(fingerprint));
    const pubkeyRow = document.getElementById(`pubkey-${fingerprint}`);
    pubkeyRow.parentNode.removeChild(pubkeyRow);
}

// uses openpgp from "node_modules/openpgp/dist/openpgp.min.js"

import { openDB } from "../node_modules/idb/build/esm/index.js";

const util = openpgp.util;

export function bytesToHex(bytes) {
    return [...bytes]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
}

export function reverseAndNormalize(str) {
    return str
        .split("")
        .reverse()
        .join("")
        .toLowerCase();
}

export async function parsePgpMessage(encryptedFileBytes) {
    let pgpMessage;
    // Try binary format first, then expect ASCII armor.
    try {
        pgpMessage = await openpgp.message.read(encryptedFileBytes);
    } catch (_) {
        const encryptedFileContents = new TextDecoder().decode(encryptedFileBytes);
        pgpMessage = await openpgp.message.readArmored(encryptedFileContents);
    }
    const encryptedSessionKeyForKeyId = {};
    for (const pkESKeyPacket of pgpMessage.packets.filterByTag(
        openpgp.enums.packet.publicKeyEncryptedSessionKey
    )) {
        const publicKeyId = bytesToHex(pkESKeyPacket.publicKeyId.write());
        encryptedSessionKeyForKeyId[publicKeyId] = pkESKeyPacket.encrypted[0].write().subarray(2);
    }
    return { pgpMessage, encryptedSessionKeyForKeyId };
}

export async function decryptWithSessionKey(pgpMessage, rawSessionKey) {
    const checksum = rawSessionKey.subarray(-2);
    const sessionKeyBytes = rawSessionKey.subarray(1, -2);
    if (!util.equalsUint8Array(checksum, util.write_checksum(sessionKeyBytes))) {
        throw new Error("Checksum mismatch, encrypted file is malformed");
    }
    const symmetricAlgorithm = rawSessionKey[0];
    const sessionKey = {
        data: sessionKeyBytes,
        algorithm: openpgp.enums.read(openpgp.enums.symmetric, symmetricAlgorithm)
    };
    const decryptedMessage = await pgpMessage.decrypt(
        /* privateKeys */ null,
        /* passwords */ null,
        [sessionKey]
    );
    let passwordStream;
    if (decryptedMessage.packets[0].tag === openpgp.enums.packet.compressed) {
        passwordStream = decryptedMessage.packets[0].packets[0].data;
    } else {
        passwordStream = decryptedMessage.packets[0].data;
    }

    return new TextDecoder().decode(await openpgp.stream.readToEnd(passwordStream));
}

export async function isValidPublicKey(pubkey) {
    if ((await pubkey.verifyPrimaryKey()) !== openpgp.enums.keyStatus.valid) {
        return false;
    }
    for (const subkey of pubkey.getSubkeys()) {
        if ((await subkey.verify(pubkey.keyPacket)) !== openpgp.enums.keyStatus.valid) {
            return false;
        }
    }
    if (!(await pubkey.verifyAllUsers()).every(result => result.valid)) {
        return false;
    }
    return true;
}

export async function getEncryptionSubkeys(pubkey) {
    const encryptionSubkeys = [];
    const subkeyIds = pubkey.subKeys.map(subkey => subkey.getKeyId());
    for (const subkeyId of subkeyIds) {
        // The only sane way to detect whether a subkey can be used for encryption is to check
        // whether getEncryptionKey called with its key ID returns the subkey itself (and not none)
        const subkey = await pubkey.getEncryptionKey(subkeyId);
        if (subkey !== null) {
            encryptionSubkeys.push(subkey);
        }
    }
    return encryptionSubkeys;
}

export async function openAndInitDB() {
    const db = await openDB("settings", 1, {
        upgrade(db, oldVersion) {
            switch (oldVersion) {
                case 0:
                    const store = db.createObjectStore("pubkeys", { keyPath: "revFingerprint" });
                    store.createIndex("revSubkeyFingerprints", "revSubkeyFingerprints", {
                        multiEntry: true
                    });
                    store.createIndex("emails", "emails", { multiEntry: true });
                    store.createIndex("userIds", "userIds", { multiEntry: true });
            }
        }
    });
    return db;
}

export async function convertPubkeyToEntry(pubkey) {
    const revFingerprint = reverseAndNormalize(pubkey.getFingerprint());
    const revSubkeyFingerprints = (await getEncryptionSubkeys(pubkey)).map(subkey =>
        reverseAndNormalize(subkey.getFingerprint())
    );
    const emails = pubkey.users
        .map(user => (user.userId ? user.userId.email : null))
        .filter(email => email !== null);
    const userIds = pubkey.getUserIds();
    const raw = await pubkey.armor();
    return { revFingerprint, revSubkeyFingerprints, emails, userIds, raw };
}

function convertUserIdSpecifierToQuery(specifier) {
    // Reference: https://www.gnupg.org/documentation/manuals/gnupg/Specify-a-User-ID.html
    let result;
    const normalizedSpecifier = specifier.replace(/( |:)/g, "");
    // Short key ID (32 bits, 8 hex characters)
    const SHORT_KEY_ID_RE = /^(0|0x)?(?<suffix>[a-f0-9]{8})(?<force>!)?$/i;
    // Long key ID (64 bits, 16 hex characters)
    const LONG_KEY_ID_RE = /^(0|0x)?(?<suffix>[a-f0-9]{16})(?<force>!)?$/i;
    // Short fingerprint (128 bits, 32 hex characters)
    const SHORT_FINGERPRINT_RE = /^(0|0x)?(?<suffix>[a-f0-9]{32})(?<force>!)?$/i;
    // Fingerprint (160 bits, 40 hex characters)
    const FINGERPRINT_RE = /^(0|0x)?(?<suffix>[a-f0-9]{40})(?<force>!)?$/i;
    if (
        (result = normalizedSpecifier.match(SHORT_KEY_ID_RE)) ||
        (result = normalizedSpecifier.match(LONG_KEY_ID_RE)) ||
        (result = normalizedSpecifier.match(SHORT_FINGERPRINT_RE)) ||
        (result = normalizedSpecifier.match(FINGERPRINT_RE))
    ) {
        const prefix = reverseAndNormalize(result.groups.suffix);
        // Trick: A lowercase hex string S has prefix P if and only if, according to the
        // lexicographic ordering:
        // P <= S < P + "g"
        return {
            key: "revFingerprint",
            index: "revSubkeyFingerprints",
            query: IDBKeyRange.bound(prefix, prefix + "g", false, true),
            forceSuffix:
                result.groups.force === "!" ? result.groups.suffix.toLowerCase() : undefined
        };
    }

    // Exact match on the entire user ID
    if (specifier.startsWith("=")) {
        return { index: "userIds", query: specifier.slice(1) };
    }

    // Exact match on the email part of the user ID
    if (specifier.startsWith("<") && specifier.endsWith(">")) {
        return { index: "emails", query: specifier.slice(1, -1) };
    }

    // If no match mode is specified, we fall back to an exact email match (as opposed to gpg,
    // which falls back to substring match)
    return { index: "emails", query: specifier };
}

async function stripAllButOneSubkey(pubkey, suffix) {
    pubkey.subKeys = pubkey.subKeys.filter(subkey => subkey.getFingerprint().endsWith(suffix));
}

export async function encryptToUserIdSpecifiers(data, specifiers) {
    const db = await openAndInitDB();
    const publicKeys = [];
    for (const specifier of specifiers) {
        const { key, index, query, forceSuffix } = convertUserIdSpecifierToQuery(specifier);
        let revFingerprints = [];
        if (key) {
            const keyMatches = await db.getAllKeys("pubkeys", query);
            if (keyMatches.length > 1) {
                throw new Error(
                    `Key ID or fingerprint '${specifier}' does not match a unique public key`
                );
            }
            revFingerprints = revFingerprints.concat(keyMatches);
        }
        if (index) {
            const indexMatches = await db
                .transaction("pubkeys", "readonly")
                .store.index(index)
                .getAllKeys(query);
            if (indexMatches.length > 1) {
                throw new Error(
                    `User ID specifier '${specifier}' does not match a unique public key`
                );
            }
            revFingerprints = revFingerprints.concat(indexMatches);
        }
        if (revFingerprints.length > 1) {
            // This can only happen if we have both a key and an index to look up, hence for key IDs
            // and fingerprints only
            throw new Error(
                `Key ID or fingerprint '${specifier}' does not match a unique public key`
            );
        } else if (revFingerprints.length === 0) {
            throw new Error(`No public key found matching '${specifier}'`);
        }
        const [revFingerprint] = revFingerprints;
        const rawPubkey = (await db.get("pubkeys", revFingerprint)).raw;
        const pubkey = (await openpgp.key.readArmored(rawPubkey)).keys[0];
        if (forceSuffix) {
            stripAllButOneSubkey(pubkey, forceSuffix);
        }
        publicKeys.push(pubkey);
    }
    const message =
        typeof data === "string"
            ? await openpgp.message.fromText(data)
            : await openpgp.message.fromBinary(data);
    return (await openpgp.encrypt({ message, publicKeys })).data;
}

// uses openpgp from "node_modules/openpgp/dist/openpgp.min.js"

const util = openpgp.util;

export function bytesToHex(bytes) {
    return [...bytes]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
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

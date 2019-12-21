// uses openpgp from "node_modules/openpgp/dist/openpgp.min.js"

import { bytesToHex } from "./openpgp.js";
import { getPinForId, setPinForId } from "./secrets.js";

const GSC = GoogleSmartCard;
const Constants = GSC.PcscLiteCommon.Constants;
const API = GSC.PcscLiteClient.API;

// The API context handle
let contextHandle;
// The singleton smart card manager instance
let manager;

const KEY_TYPE_RSA = 0x01;

class OpenPGPSmartCardManager {
    constructor(api) {
        this.api = api;
        this.connected = false;
        this.context = 0;
        this.reader = null;
        this.cardHandle = 0;
        this.activeProtocol = 0;
        this.appletSelected = false;
        this.supportsChaining = false;
        this.supportsExtendedLength = false;
    }

    async decodeError(error) {
        // Numeric error codes signify PC/SC-Lite errors
        if (typeof error === "number") {
            try {
                const errorText = await this.api.pcsc_stringify_error(error);
                return new Error(`PC/SC-Lite error (${error}): ${errorText}`);
            } catch (e) {
                if (typeof e === "number") {
                    // Stringifying the error failed
                    return new Error(`Unknown PC/SC-Lite error (${error})`);
                } else if (e instanceof Error) {
                    return e;
                } else {
                    return new Error(`${e}`);
                }
            }
        } else if (error instanceof Error) {
            return error;
        } else {
            return new Error(`${error}`);
        }
    }

    get readerShort() {
        if (this.reader.includes("Yubikey NEO-N")) {
            return "Yubikey NEO-N";
        } else if (this.reader.includes("Yubikey NEO")) {
            return "YubiKey NEO";
        } else if (this.reader.includes("Yubikey 4")) {
            return "YubiKey 4";
        } else if (this.reader.includes("Nitrokey Start")) {
            return "Nitrokey Start";
        } else if (this.reader.includes("Nitrokey Pro")) {
            return "Nitrokey Pro";
        } else if (this.reader.includes("Nitrokey Storage")) {
            return "Nitrokey Storage";
        } else if (this.reader.includes("Gemalto USB Shell Token")) {
            return "Gemalto Shell Token";
        } else if (this.reader.includes("Gemalto PC Twin Reader")) {
            return "Gemalto Twin Reader";
        } else {
            return this.reader;
        }
    }

    async establishContext() {
        if (!(await this.isValidContext())) {
            this.context = await this._execute(
                this.api.SCardEstablishContext(API.SCARD_SCOPE_SYSTEM, null, null)
            );
        }
    }

    async isValidContext() {
        try {
            await this._execute(this.api.SCardIsValidContext(this.context));
        } catch (_) {
            return false;
        }
        return true;
    }

    async listReaders() {
        if ((await this.isValidContext()) && !this.connected) {
            return this._execute(this.api.SCardListReaders(this.context, null));
        } else {
            throw new Error("SmartCardManager.listReaders: not connected");
        }
    }

    async connect(reader) {
        if ((await this.isValidContext()) && !this.connected) {
            this.reader = reader;
            [this.cardHandle, this.activeProtocol] = await this._execute(
                this.api.SCardConnect(
                    this.context,
                    this.reader,
                    API.SCARD_SHARE_EXCLUSIVE,
                    API.SCARD_PROTOCOL_T1
                )
            );
            this.connected = true;
        }
    }

    _execute(sCardPromise) {
        return sCardPromise.then(
            result =>
                new Promise(function(resolve, reject) {
                    result.get(
                        (...args) => (args.length > 1 ? resolve(args) : resolve(args[0])),
                        reject
                    );
                })
        );
    }

    async _getData(result) {
        result[1] = new Uint8Array(result[1]);
        let data = result[1].slice(0, -2);
        const returnCode = result[1].slice(-2);
        if (returnCode[0] === 0x61) {
            const dataContinued = await this.transmit(new CommandAPDU(0x00, 0xc0, 0x00, 0x00));
            data = openpgp.util.concatUint8Array([data, dataContinued]);
        } else if (!(returnCode[0] === 0x90 && returnCode[1] === 0x00)) {
            console.warn(
                `Operation returned specific status bytes: 0x${returnCode[0].toString(
                    16
                )} 0x${returnCode[1].toString(16)}`
            );
            throw returnCode;
        }
        return data;
    }

    async transmit(commandAPDU) {
        if (this.connected) {
            let data = null;
            for (const command of commandAPDU.commands(
                this.supportsChaining,
                this.supportsExtendedLength
            )) {
                const result = await this._execute(
                    this.api.SCardTransmit(this.cardHandle, API.SCARD_PCI_T1, Array.from(command))
                );
                data = await this._getData(result);
            }
            return data;
        } else {
            throw new Error("SmartCardManager.transmit: not connected");
        }
    }

    async selectApplet() {
        if (this.connected) {
            if (!this.appletSelected) {
                await this.transmit(
                    new CommandAPDU(
                        0x00,
                        0xa4,
                        0x04,
                        0x00,
                        new Uint8Array([0xd2, 0x76, 0x00, 0x01, 0x24, 0x01])
                    )
                );
                await this._determineOpenPGPCardCapabilities();
                this.appletSelected = true;
            }
        } else {
            throw new Error("SmartCardManager.selectApplet: not connected");
        }
    }

    async _determineOpenPGPCardCapabilities() {
        const historicalBytes = await this.transmit(new CommandAPDU(0x00, 0xca, 0x5f, 0x52));
        // Parse data objects in COMPACT-TLV.
        // First byte is assumed to be 0x00, last three bytes are status bytes.
        const compactTLVData = historicalBytes.slice(1, -3);
        let pos = 0;
        let capabilitiesBytes = null;
        while (pos < compactTLVData.length) {
            const tag = compactTLVData[pos];
            if (tag === 0x73) {
                capabilitiesBytes = compactTLVData.slice(pos + 1, pos + 4);
                break;
            } else {
                // The length of the tag is encoded in the second nibble.
                pos += 1 + (tag & 0x0f);
            }
        }

        if (capabilitiesBytes) {
            this.supportsChaining = capabilitiesBytes[2] & (1 << 7);
            this.supportsExtendedLength = capabilitiesBytes[2] & (1 << 6);
        } else {
            throw new Error(
                "SmartCardManager.determineOpenPGPCardCapabilities: capabilities tag not found"
            );
        }
    }

    async fetchFingerprint() {
        if (!this.appletSelected) {
            throw new Error("SmartCardManager.fetchFingerprint: applet not selected");
        }
        const appRelatedData = DataObject.fromBytes(
            await this.transmit(new CommandAPDU(0x00, 0xca, 0x00, 0x6e))
        );
        // Second fingerprint corresponds to the encryption subkey
        const fingerprintBytes = appRelatedData.lookup(0xc5).subarray(20, 40);
        return bytesToHex(fingerprintBytes);
    }

    async fetchKeyId() {
        if (!this.appletSelected) {
            throw new Error("SmartCardManager.fetchKeyId: applet not selected");
        }
        const fingerprint = await this.fetchFingerprint();
        return fingerprint.slice(-16);
    }

    async fetchKeyType() {
        if (!this.appletSelected) {
            throw new Error("SmartCardManager.fetchKeyType: applet not selected");
        }
        const appRelatedData = DataObject.fromBytes(
            await this.transmit(new CommandAPDU(0x00, 0xca, 0x00, 0x6e))
        );
        return appRelatedData.lookup(0xc2)[0];
    }

    async fetchPinTriesRemaining() {
        if (!this.appletSelected) {
            throw new Error("SmartCardManager.fetchPinTriesRemaining: applet not selected");
        }
        const appRelatedData = DataObject.fromBytes(
            await this.transmit(new CommandAPDU(0x00, 0xca, 0x00, 0x6e))
        );
        return appRelatedData.lookup(0xc4)[4];
    }

    async verifyPin(pinBytes) {
        if (!this.appletSelected) {
            throw new Error("SmartCardManager.verifyPin: applet not selected");
        }
        try {
            await this.transmit(new CommandAPDU(0x00, 0x20, 0x00, 0x82, pinBytes, false));
            // At this point PIN verification has succeeded, otherwise transmit has thrown
            return true;
        } catch (e) {
            if (e instanceof Uint8Array && e.length === 2) {
                // Special status bytes
                const statusBytesValue = openpgp.util.readNumber(e);
                switch (statusBytesValue) {
                    // Invalid PIN
                    case 0x6982:
                        return false;
                    // Device is blocked (this should not be reached as we check the
                    // number of remaining tries and block PIN entry in this case)
                    case 0x6983:
                        console.error(
                            "SmartCardManager.verifyPin: device is blocked (should never be reached"
                        );
                        throw new Error("SmartCardManager.verifyPin: device is blocked");
                    default:
                        console.error(
                            `SmartCardManager.verifyPin: unrecognized status bytes ${statusBytesValue.toString(
                                16
                            )}`
                        );
                }
            } else {
                // pcsclite error
                console.error(await this.decodeError(e));
                throw new Error("Unknown error during PIN verification");
            }
        }
    }

    async decrypt(cryptogram) {
        if (!this.appletSelected) {
            throw new Error("SmartCardManager.decrypt: applet not selected");
        }
        // The 0x00 padding byte indicates RSA
        return this.transmit(
            new CommandAPDU(
                0x00,
                0x2a,
                0x80,
                0x86,
                openpgp.util.concatUint8Array([new Uint8Array([0x00]), cryptogram])
            )
        );
    }

    async _waitForReaderRemoved(reader) {
        let readerState;
        try {
            // Returns immediately
            readerState = await this._execute(
                this.api.SCardGetStatusChange(this.context, API.INFINITE, [
                    API.createSCardReaderStateIn(reader, API.SCARD_STATE_UNAWARE, 0x1)
                ])
            );
            readerState[0].current_state = readerState[0].event_state;
        } catch (e) {
            throw Error("SmartCardManager._waitForReaderRemoved: " + (await this.decodeError(e)));
        }

        while (readerState[0].current_state & API.SCARD_STATE_PRESENT) {
            try {
                const newState = await this._execute(
                    this.api.SCardGetStatusChange(this.context, API.INFINITE, [
                        API.createSCardReaderStateIn(reader, readerState[0].current_state, 0x1)
                    ])
                );
                readerState[0].current_state = newState[0].event_state;
            } catch (e) {
                if (e === API.SCARD_E_CANCELLED) {
                    // SCardGetStatusChange cancelled by SCardCancel
                    return false;
                }
                if (e !== API.SCARD_E_TIMEOUT) {
                    throw Error(
                        "SmartCardManager._waitForReaderRemoved: " + (await this.decodeError(e))
                    );
                }
            }
        }
        return true;
    }

    async callOnReaderRemoved(reader, callback) {
        const tempManager = new OpenPGPSmartCardManager(this.api);
        await tempManager.establishContext();
        // Call _waitForReaderRemoval without await to prevent blocking
        tempManager
            ._waitForReaderRemoved(reader)
            .then(shouldRun => {
                if (shouldRun) {
                    callback();
                }
            })
            .catch(e => {
                console.error(e);
                callback();
            })
            .then(() => tempManager.releaseContext());
    }

    async disconnect() {
        if (this.connected) {
            await this._execute(this.api.SCardDisconnect(this.cardHandle, API.SCARD_LEAVE_CARD));
            this.appletSelected = false;
            this.connected = false;
            this.reader = null;
            this.cardHandle = 0;
            this.activeProtocol = 0;
        }
    }

    async releaseContext() {
        if ((await this.isValidContext()) && !this.connected) {
            await this._execute(this.api.SCardReleaseContext(this.context));
            this.context = 0;
        }
    }
}

class CommandAPDU {
    constructor(cla, ins, p1, p2, data = new Uint8Array([]), expectResponse = true) {
        this.header = new Uint8Array([cla, ins, p1, p2]);
        this.data = data;
        this.expectResponse = expectResponse;
    }

    commands(supportsChaining, supportsExtendedLength) {
        const MAX_LC = 255;
        const MAX_EXTENDED_LC = 65535;

        if (this.data.length === 0 && supportsExtendedLength) {
            const extendedLe = this.expectResponse
                ? new Uint8Array([0x00, 0x00, 0x00])
                : new Uint8Array([]);
            return [openpgp.util.concatUint8Array([this.header, extendedLe])];
        }
        if (this.data.length === 0) {
            const le = this.expectResponse ? new Uint8Array([0x00]) : new Uint8Array([]);
            return [openpgp.util.concatUint8Array([this.header, le])];
        }
        if (this.data.length <= MAX_EXTENDED_LC && supportsExtendedLength) {
            const extendedLc = new Uint8Array([
                0x00,
                this.data.length >> 8,
                this.data.length & 0xff
            ]);
            const extendedLe = this.expectResponse
                ? new Uint8Array([0x00, 0x00])
                : new Uint8Array([]);
            return [
                openpgp.util.concatUint8Array([this.header, extendedLc, this.data, extendedLe])
            ];
        }
        if (this.data.length <= MAX_LC || supportsChaining) {
            let commands = [];
            let remainingBytes = this.data.length;
            while (remainingBytes > MAX_LC) {
                let header = new Uint8Array(this.header);
                // Set continuation bit in CLA byte.
                header[0] |= 1 << 4;
                const lc = new Uint8Array([MAX_LC]);
                const data = this.data.subarray(
                    this.data.length - remainingBytes,
                    this.data.length - remainingBytes + MAX_LC
                );
                const le = this.expectResponse ? new Uint8Array([0x00]) : new Uint8Array([]);
                commands.push(openpgp.util.concatUint8Array([header, lc, data, le]));
                remainingBytes -= MAX_LC;
            }
            const lc = new Uint8Array([remainingBytes]);
            const data = this.data.subarray(this.data.length - remainingBytes);
            const le = this.expectResponse ? new Uint8Array([0x00]) : new Uint8Array([]);
            commands.push(openpgp.util.concatUint8Array([this.header, lc, data, le]));
            return commands;
        }
        throw new Error(
            `CommandAPDU.commands: data field too long (${this.data.length} ` +
                ` > ${MAX_LC}) and no support for chaining`
        );
    }
}

const DATA_OBJECT_TAG = {
    0x5e: "Login data",
    0x5f50: "URL to public keys",

    0x65: "Cardholder Related Data",
    0x5b: "Name",
    0x5f2d: "Language preference",
    0x5f35: "Sex",

    0x6e: "Application Related Data",
    0x4f: "Application Identifier",
    0x5f52: "Historical bytes",
    0x73: "Discretionary data objects",
    0xc0: "Extended capabilities",
    0xc1: "Algorithm attributes: signature",
    0xc2: "Algorithm attributes: decryption",
    0xc3: "Algorithm attributes: authentication",
    0xc4: "PW Status Bytes",
    0xc5: "Fingerprints",
    0xc6: "CA Fingerprints",
    0xcd: "Generation Timestamps",

    0x7a: "Security support template",
    0x93: "Digital signature counter"
};

const DATA_OBJECT_TAG_CLASS = {
    0: "universal",
    1: "application",
    2: "context-specific",
    3: "private"
};

class DataObject {
    lookup(tag) {
        if (this.tag === tag) {
            if (this.isConstructed) {
                return this.children;
            } else {
                return this.value;
            }
        } else {
            if (this.isConstructed) {
                for (let child of this.children) {
                    let result = child.lookup(tag);
                    if (result !== null) {
                        return result;
                    }
                }
            }
            return null;
        }
    }

    static fromBytesInRange(bytes, start = 0, end = bytes.length) {
        let pos = start;
        // Skip 0x00 and 0xFF bytes before and between tags.
        while (pos < end && (bytes[pos] === 0x00 || bytes[pos] === 0xff)) {
            ++pos;
        }
        if (pos >= end) {
            return [null, start];
        }

        const dataObject = new DataObject();
        const tagByte = bytes[pos++];
        dataObject.tagClass = tagByte >>> 6;
        dataObject.tagClassDescription = DATA_OBJECT_TAG_CLASS[dataObject.tagClass];
        const isConstructed = !!(tagByte & (1 << 5));
        dataObject.isConstructed = isConstructed;

        let tagNumber = tagByte & 0b00011111;
        let numTagNumberBytes = 1;
        if (tagNumber === 0b00011111) {
            if (!(bytes[pos] & 0b01111111)) {
                throw new Error("DataObject.fromBytesInRange: first byte of the tag number is 0");
            }
            tagNumber = 0;
            do {
                tagNumber = (tagNumber << 7) + (bytes[pos] & 0b01111111);
                ++numTagNumberBytes;
            } while (bytes[pos++] & (1 << 7));
        }
        dataObject.tagNumber = tagNumber;
        dataObject.tag = openpgp.util.readNumber(bytes.slice(pos - numTagNumberBytes, pos));
        dataObject.tagDescription =
            DATA_OBJECT_TAG[dataObject.tag] || `<unimplemented tag: ${dataObject.tag}>`;

        const lengthByte = bytes[pos++];
        let valueLength = 0;
        if (lengthByte <= 0x7f) {
            valueLength = lengthByte;
        } else {
            const numLengthBytes = lengthByte & 0b01111111;
            for (let i = 0; i < numLengthBytes; ++i) {
                valueLength = valueLength * 0x100 + bytes[pos++];
            }
        }
        dataObject.valueLength = valueLength;

        const valueStart = pos;
        const valueEnd = pos + valueLength;
        const value = bytes.slice(valueStart, valueEnd);

        if (isConstructed) {
            dataObject.children = [];
            let child;
            do {
                [child, pos] = DataObject.fromBytesInRange(bytes, pos, valueEnd);
                if (child) {
                    dataObject.children.push(child);
                }
            } while (child);
        } else {
            dataObject.value = value;
        }
        return [dataObject, valueEnd];
    }

    static fromBytes(bytes) {
        let dataObjects = [];
        let pos = 0;
        let dataObject;
        do {
            [dataObject, pos] = DataObject.fromBytesInRange(bytes, pos);
            if (dataObject) {
                dataObjects.push(dataObject);
            }
        } while (dataObject);

        if (dataObjects.length === 0) {
            return null;
        }
        if (dataObjects.length === 1) {
            return dataObjects[0];
        }

        // Create an artificial root object under which all tags of a top-level
        // tag list are subsumed. This ensures a consistent structure of replies
        // to GET DATA command among different smart card brands.
        const artificialRootObject = new DataObject();
        artificialRootObject.isConstructed = true;
        artificialRootObject.children = dataObjects;
        return artificialRootObject;
    }
}

async function initializeApiContext() {
    if (!contextHandle || !manager) {
        contextHandle = new GSC.PcscLiteClient.Context(
            chrome.runtime.getManifest().name,
            Constants.SERVER_OFFICIAL_APP_ID
        );
        // Wait for an API context for at most 2 seconds
        const api = await Promise.race([
            new Promise(function(resolve) {
                contextHandle.addOnInitializedCallback(resolve);
                contextHandle.addOnDisposeCallback(() => {
                    contextHandle = null;
                    manager = null;
                });
                contextHandle.initialize();
            }),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        if (api) {
            manager = new OpenPGPSmartCardManager(api);
        } else {
            throw Error("Smart Card Connector extension not installed or disabled");
        }
    }
}

async function connectToReaderByKeyId(keyIds) {
    let readers;
    try {
        await manager.establishContext();
        readers = await manager.listReaders();
    } catch (e) {
        await manager.releaseContext();
        console.error("Failed to list readers");
        console.error(await manager.decodeError(e));
        throw new Error("No OpenPGP token found");
    }
    const blockedReaderFound = false;
    const unsupportedKeyTypeFound = false;
    for (const reader of readers) {
        try {
            await manager.connect(reader);
            await manager.selectApplet();
            const readerKeyId = await manager.fetchKeyId();
            if (!keyIds.includes(readerKeyId)) {
                await manager.disconnect();
                continue;
            }
            const triesRemaining = await manager.fetchPinTriesRemaining();
            if (triesRemaining === 0) {
                blockedReaderFound = true;
                await manager.disconnect();
                continue;
            }
            const keyType = await manager.fetchKeyType();
            if (keyType !== KEY_TYPE_RSA) {
                unsupportedKeyTypeFound = true;
                await manager.disconnect();
                continue;
            }
            // At this point we are connected to a working matching reader
            return readerKeyId;
        } catch (e) {
            await manager.disconnect();
            console.error(`Failed to get public key information from ${reader}, skipping`);
            console.error(await manager.decodeError(e));
        }
    }
    // At this point we have iterated over all readers without finding a matching one that works
    await manager.releaseContext();
    if (unsupportedKeyTypeFound) {
        throw new Error("Matching OpenPGP token found, but only RSA keys are supported");
    }
    if (blockedReaderFound) {
        throw new Error("Matching OpenPGP token found, but no PIN tries left");
    }
    throw new Error("No OpenPGP token found with matching secret key");
}

export async function decryptOnSmartCard(encryptedSessionKeyForKeyId, windowBounds) {
    const keyIds = Object.keys(encryptedSessionKeyForKeyId);
    await initializeApiContext();
    try {
        const keyId = await connectToReaderByKeyId(keyIds);
        let verified = false;
        do {
            const triesRemaining = await manager.fetchPinTriesRemaining();
            if (triesRemaining === 0) {
                throw new Error("OpenPGP token has no PIN tries left");
            }
            const reader = manager.reader;
            const pinId = `${keyId}:${reader}`;
            const infoToShow = { reader, keyId, triesRemaining };
            const [pinBytes, shouldCache] = await getPinForId(pinId, infoToShow, windowBounds);
            // Check whether user cancelled PIN entry
            if (pinBytes === null) {
                throw new Error("PIN entry cancelled by user");
            }
            verified = await manager.verifyPin(pinBytes);
            if (verified && shouldCache) {
                await setPinForId(pinId, pinBytes);
                await manager.callOnReaderRemoved(reader, () => {
                    setPinForId(pinId, null);
                });
            }
            pinBytes.fill(0);
        } while (!verified);
        const encryptedSessionKey = encryptedSessionKeyForKeyId[keyId];
        return await manager.decrypt(encryptedSessionKey);
    } catch (e) {
        // All errors here are either unexpected raw PC/SC error codes or Error instances to be
        // passed on to the GUI
        if (typeof e === "number") {
            console.error(await manager.decodeError(e));
            throw new Error("Unexpected error in communication with the OpenPGP token");
        } else {
            throw e;
        }
    } finally {
        await manager.disconnect();
        await manager.releaseContext();
    }
}

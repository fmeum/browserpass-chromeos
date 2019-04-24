const AES_KEY_LENGTH_IN_BITS = 128;

class PinCache {
    constructor() {
        this.init();
    }

    init() {
        this.cache = {};
        this.cryptoKey = null;
    }

    async generateKey() {
        this.cryptoKey = await window.crypto.subtle.generateKey(
            { name: "AES-CBC", length: AES_KEY_LENGTH_IN_BITS },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async setPin(id, pin) {
        if (pin === null) {
            delete this.cache[id];
            return;
        }
        if (!this.cryptoKey) {
            await this.generateKey();
        }
        const iv = window.crypto.getRandomValues(new Uint8Array(AES_KEY_LENGTH_IN_BITS / 8));
        const encryptedPin = await window.crypto.subtle.encrypt(
            { name: "AES-CBC", iv },
            this.cryptoKey,
            pin.buffer
        );
        this.cache[id] = { encryptedPin, iv };
    }

    async getPin(id) {
        if (id in this.cache) {
            const { encryptedPin, iv } = this.cache[id];
            return new Uint8Array(
                await window.crypto.subtle.decrypt(
                    { name: "AES-CBC", iv },
                    this.cryptoKey,
                    encryptedPin
                )
            );
        }
        return null;
    }
}

function launchPinEntry(infoToShow) {
    return new Promise((resolve, reject) => {
        const TOP_CHROME_HEIGHT = 72;

        const width = 350;
        const height = 200;
        const left = (screen.availWidth - width) / 2;
        const top = TOP_CHROME_HEIGHT / 2;

        chrome.app.window.create(
            "pin-entry/pin-entry.html",
            {
                frame: "none",
                outerBounds: { left, top, height, width },
                resizable: false,
                alwaysOnTop: true
            },
            w => {
                w.contentWindow.submitCallback = (pinString, shouldCache) => {
                    resolve([new TextEncoder().encode(pinString), shouldCache]);
                };
                w.contentWindow.cancelCallback = reject;
                w.contentWindow.infoToShow = infoToShow;
            }
        );
    });
}

const modulePinCache = new PinCache();
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(state => {
    if (state === "locked" || state === "idle") {
        modulePinCache.init();
    }
});

export async function setPinForId(id, pin) {
    await modulePinCache.setPin(id, pin);
}

export async function getPinForId(id, infoToShow) {
    try {
        let pin = await modulePinCache.getPin(id);
        if (pin !== null) {
            return [pin, false];
        } else {
            return await launchPinEntry(infoToShow);
        }
    } catch (e) {
        return [null, false];
    }
}

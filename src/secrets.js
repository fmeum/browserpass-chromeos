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

function launchPinEntry(infoToShow, windowBounds) {
    return new Promise(async (resolve, reject) => {
        // In order to allow the user to distinguish the PIN entry dialog from both a popup and an
        // image embedded in a web page, we display it without a window frame and such that it
        // intersects the address bar.

        // hardcoded height of the Chrome address bar
        const TOP_CHROME_HEIGHT = 72;

        const width = 350;
        const height = 200;
        // Center the dialog horizontally with respect to the current browser window and let it
        // partially hide the address bar.
        const left = windowBounds.left + Math.max(0, (windowBounds.width - width) / 2);
        const top = windowBounds.top + TOP_CHROME_HEIGHT / 2;

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

export async function getPinForId(id, infoToShow, windowBounds) {
    try {
        let pin = await modulePinCache.getPin(id);
        if (pin !== null) {
            return [pin, false];
        } else {
            return await launchPinEntry(infoToShow, windowBounds);
        }
    } catch (e) {
        return [null, false];
    }
}

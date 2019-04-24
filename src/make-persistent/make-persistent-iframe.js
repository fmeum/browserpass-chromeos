const port = chrome.runtime.connect({
    name: "make-persistent"
});

port.onDisconnect.addListener(() =>
    console.error("The 'make-persistent' message port to the background page was disconnected.")
);

port.onMessage.addListener(() =>
    console.error(
        "Unexpectedly received a message from the background page through the 'make-persistent' message port."
    )
);

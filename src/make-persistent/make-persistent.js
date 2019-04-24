(function() {
    window.addEventListener("load", makePersistent);

    function makePersistent() {
        chrome.runtime.onConnect.addListener(port => {
            if (port.name === "make-persistent") {
                port.onDisconnect.addListener(() =>
                    console.error(
                        "The 'make-persistent' message port to the iframe was disconnected."
                    )
                );

                port.onMessage.addListener(() =>
                    console.error(
                        "Unexpectedly received a message from the iframe through the 'make-persistent' message port."
                    )
                );
            }
        });

        const iframe = document.createElement("iframe");
        iframe.src = chrome.runtime.getURL("/make-persistent/make-persistent-iframe.html");
        document.body.appendChild(iframe);
    }
})();
